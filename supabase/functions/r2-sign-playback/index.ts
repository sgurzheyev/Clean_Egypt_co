/**
 * Mint a short-lived R2 GET URL so a donor / creator / assigned worker can
 * play a private proof video (crowdfunding missions only).
 *
 * POST { mission_id, object_key }
 * → { playback_url, expires_in }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.42.0';
import { GetObjectCommand } from 'npm:@aws-sdk/client-s3@3.699.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.699.0';
import {
  createR2Client,
  isProofKeyForMission,
  R2_GET_TTL_SEC,
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
  console.error('[r2-sign-playback]', message, extra || '');
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

    let body: { mission_id?: unknown; object_key?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonError('Invalid JSON body', 400, { detail: msg });
    }

    const missionId = typeof body.mission_id === 'string' ? body.mission_id.trim() : '';
    const objectKeyRaw = typeof body.object_key === 'string' ? body.object_key.trim() : '';
    const objectKey = objectKeyRaw.replace(/^\/+/, '').split('?')[0];

    if (!UUID_RE.test(missionId)) return jsonError('Invalid mission_id', 400);
    if (!objectKey || !isProofKeyForMission(objectKey, missionId)) {
      return jsonError('Invalid object_key for this mission', 400);
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
      .select('id, creator_id, cleaner_id, crowdfunding_mode, proof_video_url')
      .eq('id', missionId)
      .maybeSingle();

    if (missionErr) {
      return jsonError('Failed to load mission', 500, { detail: missionErr.message });
    }
    if (!mission) return jsonError('Mission not found', 404);
    if (!mission.crowdfunding_mode) {
      return jsonError('R2 playback is only for crowdfunding missions', 403);
    }

    const isCreator = mission.creator_id === user.id;
    const isWorker = mission.cleaner_id === user.id;

    let isDonor = false;
    if (!isCreator && !isWorker) {
      const { data: donation, error: donationErr } = await supabaseAdmin
        .from('contributions')
        .select('id')
        .eq('mission_id', missionId)
        .eq('contributor_id', user.id)
        .limit(1)
        .maybeSingle();
      if (donationErr) {
        return jsonError('Failed to verify donor', 500, { detail: donationErr.message });
      }
      isDonor = !!donation;
    }

    if (!isCreator && !isWorker && !isDonor) {
      return jsonError('Only donors, the creator, or the assigned worker can play this video', 403);
    }

    // If the mission already stored a key, require an exact match (Stage 2 column).
    const stored = String(mission.proof_video_url || '').trim();
    if (stored && !stored.startsWith('http') && stored !== objectKey) {
      return jsonError('object_key does not match stored proof', 403);
    }

    const client = createR2Client(r2);
    const command = new GetObjectCommand({
      Bucket: r2.bucket,
      Key: objectKey,
    });
    const playbackUrl = await getSignedUrl(client, command, { expiresIn: R2_GET_TTL_SEC });

    return jsonOk({
      playback_url: playbackUrl,
      object_key: objectKey,
      expires_in: R2_GET_TTL_SEC,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[r2-sign-playback] unhandled', msg);
    return jsonError(msg, 500);
  }
});
