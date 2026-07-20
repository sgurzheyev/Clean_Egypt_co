import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';

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
 * Admin-only: mint signed URLs for private kyc_documents objects.
 * Uses service_role so Storage RLS (owner-only) does not block platform admins
 * who authenticate via is_platform_admin (email) rather than profiles.role.
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

    // Prefer service-role admin check that does NOT short-circuit on JWT role.
    // is_platform_admin returns true for any service_role JWT — so call with user JWT.
    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc('is_platform_admin', {
      p_uid: user.id,
    });
    if (adminErr) {
      console.error('[kyc-admin-signed-urls] is_platform_admin failed', adminErr);
      // Fallback: email / role via service role (mirrors is_platform_admin rules).
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

    // Service role bypasses Storage RLS for private bucket signed URLs.
    const supabaseService = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const urls: Record<string, string | null> = {};
    for (const path of paths) {
      const { data, error } = await supabaseService.storage
        .from(KYC_BUCKET)
        .createSignedUrl(path, SIGNED_TTL_SEC);
      if (error) {
        console.error('[kyc-admin-signed-urls] createSignedUrl failed', path, error.message);
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
