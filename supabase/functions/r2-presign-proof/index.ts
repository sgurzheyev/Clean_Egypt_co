/**
 * Mint a short-lived R2 PUT URL so the assigned worker can upload a proof
 * video directly to Cloudflare (crowdfunding missions only).
 *
 * POST { mission_id, content_type, byte_size? }
 * → { upload_url, object_key, method, headers, expires_in, max_bytes }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.699.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.699.0';
import {
  ALLOWED_PROOF_CONTENT_TYPES,
  buildProofObjectKey,
  createR2Client,
  extForContentType,
  isAllowedProofContentType,
  R2_MAX_PROOF_BYTES_DEFAULT,
  R2_PUT_TTL_SEC,
  readR2Env,
} from '../_shared/r2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  console.error('[r2-presign-proof]', message, extra || '');
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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonError('Missing Supabase env', 500);
    }

    const r2 = readR2Env();
    if ('error' in r2) return jsonError(r2.error, 500);

    let body: { mission_id?: unknown; content_type?: unknown; byte_size?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError('Invalid JSON body', 400, { detail: msg });
    }

    const missionId = typeof body.mission_id === 'string' ? body.mission_id.trim() : '';
    if (!UUID_RE.test(missionId)) return jsonError('Invalid mission_id', 400);

    const contentTypeRaw =
      typeof body.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
    const contentType = contentTypeRaw.split(';')[0].trim();
    if (!isAllowedProofContentType(contentType)) {
      return jsonError('Unsupported content_type', 400, {
        allowed: ALLOWED_PROOF_CONTENT_TYPES,
      });
    }

    const maxBytes = Number.parseInt(
      String(Deno.env.get('R2_MAX_PROOF_BYTES') || R2_MAX_PROOF_BYTES_DEFAULT),
      10
    );
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
      return jsonError('Video exceeds max size', 413, { max_bytes: maxBytes });
    }

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

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: mission, error: missionErr } = await supabaseAdmin
      .from('missions')
      .select('id, cleaner_id, status, crowdfunding_mode')
      .eq('id', missionId)
      .maybeSingle();

    if (missionErr) {
      return jsonError('Failed to load mission', 500, { detail: missionErr.message });
    }
    if (!mission) return jsonError('Mission not found', 404);

    if (!mission.crowdfunding_mode) {
      return jsonError('R2 proof upload is only for crowdfunding missions', 403);
    }
    if (mission.cleaner_id !== user.id) {
      return jsonError('Only the assigned worker can upload proof video', 403);
    }

    const status = String(mission.status || '').toLowerCase();
    // Stage 2 will add AWAITING_APPROVAL; keep review/pending_approval for retries.
    if (!['in_progress', 'review', 'pending_approval', 'awaiting_approval'].includes(status)) {
      return jsonError('Mission is not eligible for proof upload', 409, { status });
    }

    const objectKey = buildProofObjectKey({
      missionId,
      workerId: user.id,
      ext: extForContentType(contentType),
    });

    const client = createR2Client(r2);
    const command = new PutObjectCommand({
      Bucket: r2.bucket,
      Key: objectKey,
      ContentType: contentType,
      ...(byteSize != null ? { ContentLength: byteSize } : {}),
      Metadata: {
        mission_id: missionId,
        worker_id: user.id,
      },
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: R2_PUT_TTL_SEC });

    const headers: Record<string, string> = {
      'Content-Type': contentType,
    };
    if (byteSize != null) {
      headers['Content-Length'] = String(byteSize);
    }

    return jsonOk({
      upload_url: uploadUrl,
      object_key: objectKey,
      method: 'PUT',
      headers,
      expires_in: R2_PUT_TTL_SEC,
      max_bytes: maxBytes,
      bucket: r2.bucket,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[r2-presign-proof] unhandled', msg);
    return jsonError(msg, 500);
  }
});
