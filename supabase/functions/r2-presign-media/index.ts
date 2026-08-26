/**
 * Mint a short-lived R2 PUT URL for authenticated media uploads
 * (KYC docs, store gallery, avatars, mission photos, chat).
 *
 * POST { folder, content_type, byte_size?, subpath? }
 * → { upload_url, object_key, method, headers, expires_in, max_bytes, public_url? }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.699.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.699.0';
import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  buildMediaObjectKey,
  createR2Client,
  extForMediaContentType,
  isAllowedMediaContentType,
  isR2MediaFolder,
  R2_MAX_MEDIA_BYTES_DEFAULT,
  R2_MAX_PROOF_BYTES_DEFAULT,
  R2_PUT_TTL_SEC,
  readR2Env,
  type R2MediaFolder,
} from '../_shared/r2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  console.error('[r2-presign-media]', message, extra || '');
  return new Response(JSON.stringify({ error: message, ...(extra || {}) }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function jsonOk(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Folders that may be served via public custom domain (not KYC). */
const PUBLIC_FOLDERS = new Set<R2MediaFolder>([
  'stores',
  'avatars',
  'mission-photos',
  'chat',
  'reports',
  'city-pdfs',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Missing Authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) {
      return jsonError('Missing Supabase env', 500);
    }

    const r2 = readR2Env();
    if ('error' in r2) return jsonError(r2.error, 500);

    let body: {
      folder?: unknown;
      content_type?: unknown;
      byte_size?: unknown;
      subpath?: unknown;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError('Invalid JSON body', 400, { detail: msg });
    }

    const folderRaw = typeof body.folder === 'string' ? body.folder.trim().toLowerCase() : '';
    if (!isR2MediaFolder(folderRaw)) {
      return jsonError('Invalid folder', 400, {
        allowed: [
          'kyc',
          'stores',
          'avatars',
          'mission-photos',
          'chat',
          'reports',
          'city-pdfs',
        ],
      });
    }
    const folder = folderRaw;

    // city-pdfs are written by city-notification-pipeline (service PutObject), not browsers.
    if (folder === 'city-pdfs') {
      return jsonError('city-pdfs uploads are server-only', 403);
    }

    const contentTypeRaw =
      typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
    const contentType = contentTypeRaw.split(';')[0].trim();
    if (!isAllowedMediaContentType(contentType)) {
      return jsonError('Unsupported content_type', 400, {
        allowed: ALLOWED_MEDIA_CONTENT_TYPES,
      });
    }

    // Video: KYC liveness, pin evidence (mission-photos / reports).
    // Crowdfunding *worker* completion video uses r2-presign-proof (proofs/).
    if (
      contentType.startsWith('video/') &&
      folder !== 'kyc' &&
      folder !== 'mission-photos' &&
      folder !== 'reports'
    ) {
      return jsonError('Video uploads only allowed in kyc, mission-photos, or reports', 400);
    }

    // PDF only for city pipeline (server); clients never need PDF via this endpoint.
    if (contentType === 'application/pdf') {
      return jsonError('PDF uploads are server-only (city-pdfs)', 403);
    }

    const maxBytesDefault = contentType.startsWith('video/')
      ? Number.parseInt(
          String(Deno.env.get('R2_MAX_PROOF_BYTES') || R2_MAX_PROOF_BYTES_DEFAULT),
          10
        )
      : Number.parseInt(
          String(Deno.env.get('R2_MAX_MEDIA_BYTES') || R2_MAX_MEDIA_BYTES_DEFAULT),
          10
        );
    const maxBytes = Number.isFinite(maxBytesDefault) ? maxBytesDefault : R2_MAX_MEDIA_BYTES_DEFAULT;
    const byteSize =
      typeof body.byte_size === 'number'
        ? body.byte_size
        : typeof body.byte_size === 'string'
          ? Number.parseInt(body.byte_size, 10)
          : null;
    if (byteSize != null && (!Number.isFinite(byteSize) || byteSize <= 0)) {
      return jsonError('Invalid byte_size', 400);
    }
    if (byteSize != null && byteSize > maxBytes) {
      return jsonError('File exceeds max size', 413, { max_bytes: maxBytes });
    }

    const subpath =
      typeof body.subpath === 'string'
        ? body.subpath
            .trim()
            .replace(/^\/+|\/+$/g, '')
            .replace(/\.\./g, '')
            .slice(0, 120)
        : '';

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return jsonError('Unauthorized', 401, { detail: userErr?.message || 'No user' });
    }

    const objectKey = buildMediaObjectKey({
      folder,
      userId: user.id,
      ext: extForMediaContentType(contentType),
      subpath: subpath || undefined,
    });

    const client = createR2Client(r2);
    const command = new PutObjectCommand({
      Bucket: r2.bucket,
      Key: objectKey,
      ContentType: contentType,
      ...(byteSize != null ? { ContentLength: byteSize } : {}),
      Metadata: {
        user_id: user.id,
        folder,
      },
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: R2_PUT_TTL_SEC });

    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };
    if (byteSize != null) {
      headers['Content-Length'] = String(byteSize);
    }

    const publicBase = String(Deno.env.get('R2_PUBLIC_BASE_URL') || '')
      .trim()
      .replace(/\/$/, '');
    const publicUrl =
      PUBLIC_FOLDERS.has(folder) && publicBase
        ? `${publicBase}/${objectKey}`
        : null;

    return jsonOk({
      upload_url: uploadUrl,
      object_key: objectKey,
      method: 'PUT',
      headers,
      expires_in: R2_PUT_TTL_SEC,
      max_bytes: maxBytes,
      folder,
      public_url: publicUrl,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[r2-presign-media] unhandled', msg);
    return jsonError(msg, 500);
  }
});
