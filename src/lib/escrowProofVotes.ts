/**
 * Crowdfunding escrow: signed R2 playback + first-donor vote RPC.
 */
import { supabase } from '../../services/supabase';
import { resolveAccessToken } from './supabaseAuth';
import { throwIfInvokeFailed } from './supabaseFunctionError';

/** Extract crowdfunding R2 key (`proofs/…`) from stored proof_video_url. */
export function proofObjectKeyFromStored(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('proofs/')) return s.split('?')[0];
  try {
    const u = new URL(s);
    const path = u.pathname.replace(/^\/+/, '');
    const idx = path.indexOf('proofs/');
    if (idx >= 0) return path.slice(idx).split('?')[0];
  } catch {
    /* not a URL */
  }
  const idx = s.indexOf('proofs/');
  if (idx >= 0) return s.slice(idx).split('?')[0];
  // P2P liveness keys (`mission-photos/…`) and legacy Storage URLs are not escrow proofs.
  return null;
}

export async function fetchProofPlaybackUrl(input: {
  missionId: string;
  objectKey: string;
}): Promise<string> {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('r2-sign-playback', {
    body: {
      mission_id: input.missionId,
      object_key: input.objectKey,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await throwIfInvokeFailed('r2-sign-playback', res);

  const url = String((res.data as { playback_url?: unknown } | null)?.playback_url || '');
  if (!url) throw new Error('Playback URL missing');
  return url;
}

export async function processProofVote(input: {
  missionId: string;
  isApproved: boolean;
}): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('process_proof_vote', {
    p_mission_id: input.missionId,
    p_is_approved: input.isApproved,
  });
  if (error) throw error;
  const status = String((data as { status?: unknown } | null)?.status || '');
  return { status };
}

export async function userIsMissionDonor(
  missionId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('contributions')
    .select('id')
    .eq('mission_id', missionId)
    .eq('contributor_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('userIsMissionDonor', error.message);
    return false;
  }
  return !!data;
}
