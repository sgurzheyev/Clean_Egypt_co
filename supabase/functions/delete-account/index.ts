import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CONFIRM_PHRASES = new Set(['DELETE', 'УДАЛИТЬ']);

type StorageRow = { bucket_id: string; object_name: string };

function jsonError(message: string, status = 400, code?: string) {
  return new Response(JSON.stringify({ error: message, code: code ?? null }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pathFromPublicUrl(url: string, bucket: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/object/authenticated/${bucket}/`,
  ];
  for (const marker of markers) {
    const i = raw.indexOf(marker);
    if (i >= 0) {
      const rest = raw.slice(i + marker.length).split('?')[0];
      try {
        return decodeURIComponent(rest);
      } catch {
        return rest;
      }
    }
  }
  if (raw.startsWith(`${bucket}/`)) return raw.slice(bucket.length + 1);
  return null;
}

async function listFolderRecursive(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [prefix.replace(/\/+$/, '')];

  while (queue.length) {
    const path = queue.shift()!;
    const { data, error } = await admin.storage.from(bucket).list(path || '', {
      limit: 1000,
      offset: 0,
    });
    if (error || !data?.length) continue;

    for (const item of data) {
      if (!item?.name || item.name === '.emptyFolderPlaceholder') continue;
      const full = path ? `${path}/${item.name}` : item.name;
      // Folders typically have null metadata in Storage list responses.
      if (item.metadata == null && !item.id) {
        queue.push(full);
      } else {
        out.push(full);
      }
    }
  }

  return out;
}

async function purgeStorageForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  listed: StorageRow[]
): Promise<{ removed: number; errors: string[] }> {
  const byBucket = new Map<string, Set<string>>();
  const add = (bucket: string, name: string) => {
    const n = String(name || '').trim().replace(/^\/+/, '');
    if (!bucket || !n) return;
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Set());
    byBucket.get(bucket)!.add(n);
  };

  for (const row of listed) {
    add(String(row.bucket_id || ''), String(row.object_name || ''));
  }

  // Defensive prefix walks (KYC docs, avatars, store uploads).
  for (const [bucket, prefix] of [
    ['kyc_documents', `kyc/${userId}`],
    ['avatars', userId],
    ['order-photos', `stores/${userId}`],
  ] as const) {
    const found = await listFolderRecursive(admin, bucket, prefix);
    for (const p of found) add(bucket, p);
  }

  // Mission / proof media linked on missions where user was creator or cleaner.
  const { data: missions } = await admin
    .from('missions')
    .select('id, photo_urls, after_photo_urls')
    .or(`creator_id.eq.${userId},cleaner_id.eq.${userId}`);

  for (const m of missions || []) {
    const urls: string[] = [];
    for (const key of ['photo_urls', 'after_photo_urls'] as const) {
      const v = (m as Record<string, unknown>)[key];
      if (Array.isArray(v)) {
        for (const img of v) {
          if (typeof img === 'string' && img.trim()) urls.push(img);
        }
      }
    }
    for (const u of urls) {
      for (const bucket of ['mission-photos', 'missions', 'proofs', 'order-photos'] as const) {
        const p = pathFromPublicUrl(u, bucket);
        if (p) add(bucket, p);
      }
    }
  }

  // Chat photos under {missionId}/{userId}/…
  const { data: chats } = await admin
    .from('mission_chats')
    .select('image_url')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .not('image_url', 'is', null);

  for (const c of chats || []) {
    const u = String((c as { image_url?: string }).image_url || '');
    const p = pathFromPublicUrl(u, 'chat-photos');
    if (p) add('chat-photos', p);
  }

  let removed = 0;
  const errors: string[] = [];

  for (const [bucket, names] of byBucket) {
    const paths = [...names];
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        errors.push(`${bucket}: ${error.message}`);
      } else {
        removed += chunk.length;
      }
    }
  }

  return { removed, errors };
}

/**
 * GDPR / App Store / Play Store: authenticated user confirms permanent account erasure.
 * Order: assert deletable → purge Storage (KYC, avatars, …) → erase DB → delete auth.users.
 */
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
      throw new Error('Missing Supabase env');
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user) return jsonError('Unauthorized', 401);

    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
    const confirmRaw = typeof body.confirm === 'string' ? body.confirm.trim() : '';
    const confirmNormalized =
      confirmRaw.toUpperCase() === 'DELETE' ? 'DELETE' : confirmRaw === 'УДАЛИТЬ' ? 'УДАЛИТЬ' : '';
    if (!CONFIRM_PHRASES.has(confirmNormalized)) {
      return jsonError(
        'Type DELETE or УДАЛИТЬ to confirm permanent account deletion.',
        400,
        'CONFIRM_REQUIRED'
      );
    }

    const { error: assertErr } = await supabaseUser.rpc('assert_own_account_deletable');
    if (assertErr) {
      const msg = String(assertErr.message || assertErr);
      if (/ACTIVE_MISSIONS/i.test(msg)) {
        return jsonError(
          'You still have active missions. Finish or cancel them before deleting your account.',
          409,
          'ACTIVE_MISSIONS'
        );
      }
      return jsonError(msg || 'Account cannot be deleted', 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: listed, error: listErr } = await admin.rpc(
      'list_user_storage_objects_for_deletion',
      { p_user_id: user.id }
    );
    if (listErr) {
      console.error('[delete-account] list storage', listErr);
      return jsonError(listErr.message || 'Failed to list storage objects', 500);
    }

    const purge = await purgeStorageForUser(
      admin,
      user.id,
      (listed || []) as StorageRow[]
    );
    if (purge.errors.length) {
      console.warn('[delete-account] storage purge warnings', purge.errors);
    }

    const { data: eraseData, error: eraseErr } = await admin.rpc(
      'erase_account_data_for_user',
      { p_user_id: user.id }
    );
    if (eraseErr) {
      const msg = String(eraseErr.message || eraseErr);
      if (/ACTIVE_MISSIONS/i.test(msg)) {
        return jsonError(
          'You still have active missions. Finish or cancel them before deleting your account.',
          409,
          'ACTIVE_MISSIONS'
        );
      }
      console.error('[delete-account] erase', eraseErr);
      return jsonError(msg || 'Failed to erase account data', 500);
    }

    const { error: delAuthErr } = await admin.auth.admin.deleteUser(user.id);
    if (delAuthErr) {
      console.error('[delete-account] auth.deleteUser', delAuthErr);
      return jsonError(
        delAuthErr.message || 'Profile erased but auth user delete failed — contact support.',
        500,
        'AUTH_DELETE_FAILED'
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        storage_removed: purge.removed,
        erase: eraseData,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[delete-account]', e);
    return jsonError(e instanceof Error ? e.message : 'Internal error', 500);
  }
});
