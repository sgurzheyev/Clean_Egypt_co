import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { GetObjectCommand } from 'npm:@aws-sdk/client-s3@3.699.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.699.0';
import {
  createR2Client,
  isKycObjectKey,
  R2_GET_TTL_SEC,
  readR2Env,
} from '../_shared/r2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const KYC_BUCKET = 'kyc_documents';
const SIGNED_TTL_SEC = 60 * 60;

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * R2 media keys end with a UUID filename (`…/uuid.ext`).
 * Legacy Supabase Storage KYC paths used `front_${ts}.jpg` / `liveness_${ts}.webm`.
 */
function isLikelyR2KycKey(path: string): boolean {
  return /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(
    path
  );
}

/**
 * Admin-only: mint signed URLs for private KYC objects.
 * Prefers Cloudflare R2 for new uploads; falls back to Supabase Storage
 * for legacy `kyc_documents` objects (pre-R2 migration).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('[kyc-admin-signed-urls] Missing Authorization');
      return jsonError('Missing Authorization', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.error('[kyc-admin-signed-urls] Missing Supabase env');
      return jsonError('Missing Supabase env', 500);
    }

    let body: { paths?: unknown; user_id?: unknown };
    try {
      body = (await req.json()) as { paths?: unknown; user_id?: unknown };
    } catch (e: any) {
      console.error('[kyc-admin-signed-urls] Invalid JSON body', e?.message || e);
      return jsonError('Invalid JSON body');
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      console.error('[kyc-admin-signed-urls] Unauthorized', userErr?.message);
      return jsonError('Unauthorized', 401);
    }

    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc('is_platform_admin', {
      p_uid: user.id,
    });
    if (adminErr) {
      console.error('[kyc-admin-signed-urls] is_platform_admin failed', adminErr);
      const supabaseServiceProbe = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: profile } = await supabaseServiceProbe
        .from('profiles')
        .select('role, telegram_username')
        .eq('id', user.id)
        .maybeSingle();
      const email = String(user.email || '').toLowerCase();
      const roleOk = String(profile?.role || '').toLowerCase() === 'admin';
      const emailOk =
        email === 'sgurzheyev@gmail.com' || email.includes('tg_6618910143');
      const tgOk = String(profile?.telegram_username || '').toLowerCase() === 'sergiogurgini';
      if (!roleOk && !emailOk && !tgOk) {
        return jsonError(adminErr.message || 'Admin check failed', 403);
      }
    } else if (!isAdmin) {
      console.error('[kyc-admin-signed-urls] Forbidden for', user.id);
      return jsonError('Admin only', 403);
    }

    const rawPaths = Array.isArray(body.paths) ? body.paths : [];
    const paths = rawPaths
      .map((p) => String(p ?? '').trim())
      .filter((p) => p.length > 0);

    if (paths.length === 0) {
      return new Response(JSON.stringify({ urls: {} }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseService = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const r2Env = readR2Env();
    const r2Client = !('error' in r2Env) ? createR2Client(r2Env) : null;
    const r2Bucket = !('error' in r2Env) ? r2Env.bucket : null;
    if ('error' in r2Env) {
      console.warn('[kyc-admin-signed-urls] R2 unavailable, Storage only:', r2Env.error);
    }

    const urls: Record<string, string | null> = {};
    for (const path of paths) {
      if (/^https?:\/\//i.test(path)) {
        urls[path] = path;
        continue;
      }

      const key = path.replace(/^\/+/, '');

      // New uploads: Cloudflare R2 under kyc/{userId}/…/{uuid}.ext
      if (r2Client && r2Bucket && isKycObjectKey(key) && isLikelyR2KycKey(key)) {
        try {
          const command = new GetObjectCommand({
            Bucket: r2Bucket,
            Key: key,
          });
          urls[path] = await getSignedUrl(r2Client, command, {
            expiresIn: Math.min(SIGNED_TTL_SEC, R2_GET_TTL_SEC * 6),
          });
          continue;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('[kyc-admin-signed-urls] R2 sign failed', key, msg);
        }
      }

      // Legacy: Supabase Storage bucket kyc_documents
      const { data, error } = await supabaseService.storage
        .from(KYC_BUCKET)
        .createSignedUrl(key, SIGNED_TTL_SEC);
      if (error) {
        console.error('[kyc-admin-signed-urls] createSignedUrl failed', key, error.message);
        urls[path] = null;
      } else {
        urls[path] = data?.signedUrl ?? null;
      }
    }

    return new Response(JSON.stringify({ urls }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[kyc-admin-signed-urls] unhandled', error?.message || error);
    return jsonError(String(error?.message || 'Unknown error'), 500);
  }
});
