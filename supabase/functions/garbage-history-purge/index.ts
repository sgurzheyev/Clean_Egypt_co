/**
 * Garbage History R2 purge (Wave D / P2-1b)
 *
 * After history_public_until:
 *  1) SQL process_garbage_history_archives() already flipped status → archived
 *     (or this Edge claims expired rows that are past the window).
 *  2) Delete public R2 keys: reports/, mission-photos/, proofs/, city-pdfs/
 *     for that mission_id (from stored columns + prefix list).
 *  3) mark_garbage_history_media_purged — clears media columns, sets media_purged_at.
 *
 * Idempotent. Service-role / cron only. Fail-soft per object.
 *
 * Auth (any one):
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   x-webhook-secret: GARBAGE_HISTORY_PURGE_SECRET (optional extra)
 *
 * Invoke:
 *   POST {} or { "limit": 20 }
 *   pg_net from process_garbage_history_archives_and_purge()
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { DeleteObjectCommand, ListObjectsV2Command } from 'npm:@aws-sdk/client-s3@3.699.0';
import {
  collectPurgeableHistoryKeys,
  createR2Client,
  isPurgeableHistoryObjectKey,
  readR2Env,
} from '../_shared/r2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ClaimRow = {
  id: string;
  photo_urls: string[] | null;
  after_photo_urls: string[] | null;
  proof_video_url: string | null;
  video_proof_url: string | null;
  creator_id: string | null;
  history_public_until: string | null;
  status: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

async function listPrefixKeys(
  client: ReturnType<typeof createR2Client>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  for (let i = 0; i < 8; i += 1) {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 200,
      })
    );
    for (const obj of page.Contents || []) {
      if (obj.Key && isPurgeableHistoryObjectKey(obj.Key)) keys.push(obj.Key);
    }
    if (!page.IsTruncated || !page.NextContinuationToken) break;
    token = page.NextContinuationToken;
  }
  return keys;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const purgeSecret = Deno.env.get('GARBAGE_HISTORY_PURGE_SECRET') || '';
  const providedAuth =
    req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const providedSecret =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  const authOk =
    (serviceKey && providedAuth === serviceKey) ||
    (purgeSecret && providedSecret === purgeSecret);
  if (!authOk) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  let limit = 20;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const n = Number(body.limit);
    if (Number.isFinite(n)) limit = Math.max(1, Math.min(50, Math.floor(n)));
  } catch {
    // empty body is fine
  }

  const r2 = readR2Env();
  if ('error' in r2) {
    return json({ error: r2.error }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimed, error: claimErr } = await supabase.rpc(
    'claim_garbage_history_purge_batch',
    { p_limit: limit }
  );
  if (claimErr) {
    return json({ error: claimErr.message }, 500);
  }

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimRow[];
  if (rows.length === 0) {
    return json({ ok: true, claimed: 0, purged: 0 });
  }

  const client = createR2Client(r2);
  const publicBase = String(Deno.env.get('R2_PUBLIC_BASE_URL') || '').trim();
  const results: Array<{
    mission_id: string;
    deleted: number;
    marked: boolean;
    errors: string[];
  }> = [];

  for (const row of rows) {
    const stored = [
      ...asStringArray(row.photo_urls),
      ...asStringArray(row.after_photo_urls),
      row.proof_video_url,
      row.video_proof_url,
    ];
    const keys = new Set(collectPurgeableHistoryKeys(stored, publicBase));

    try {
      const listed = await Promise.all([
        listPrefixKeys(client, r2.bucket, `city-pdfs/${row.id}/`),
        listPrefixKeys(client, r2.bucket, `proofs/${row.id}/`),
      ]);
      for (const key of listed.flat()) keys.add(key);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[garbage-history-purge] list failed', row.id, msg);
    }

    const errors: string[] = [];
    let deleted = 0;
    for (const key of keys) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: r2.bucket,
            Key: key,
          })
        );
        deleted += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${key}: ${msg}`.slice(0, 200));
      }
    }

    // Keep stored keys if any delete failed so the next cron can retry.
    let marked = false;
    if (errors.length === 0) {
      const { data, error: markErr } = await supabase.rpc(
        'mark_garbage_history_media_purged',
        { p_mission_id: row.id }
      );
      if (markErr) {
        errors.push(markErr.message);
      } else {
        marked = data === true;
      }
    }

    results.push({
      mission_id: row.id,
      deleted,
      marked: marked === true,
      errors,
    });
  }

  return json({
    ok: true,
    claimed: rows.length,
    purged: results.filter((r) => r.marked).length,
    results,
  });
});
