/**
 * Crowdfunding proof video: presign via Edge Function, PUT straight to R2.
 * Never sends R2 credentials to the browser.
 */
import { supabase } from '../../services/supabase';
import { resolveAccessToken } from './supabaseAuth';
import { throwIfInvokeFailed } from './supabaseFunctionError';

const ALLOWED_TYPES = new Set(['video/webm', 'video/mp4', 'video/quicktime']);

export type ProofUploadPhase = 'idle' | 'presigning' | 'uploading' | 'submitting';

function normalizeVideoContentType(file: File): string {
  const raw = String(file.type || '').trim().toLowerCase().split(';')[0];
  if (ALLOWED_TYPES.has(raw)) return raw;
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  return 'video/mp4';
}

export type R2PresignProofResult = {
  upload_url: string;
  object_key: string;
  method: string;
  headers: Record<string, string>;
  expires_in: number;
  max_bytes: number;
};

export async function uploadCrowdfundingProofToR2(
  missionId: string,
  file: File,
  onPhase?: (phase: ProofUploadPhase) => void
): Promise<{ objectKey: string }> {
  if (!file || file.size < 1) {
    throw new Error('A proof video is required');
  }

  const contentType = normalizeVideoContentType(file);
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  onPhase?.('presigning');
  const res = await supabase.functions.invoke('r2-presign-proof', {
    body: {
      mission_id: missionId,
      content_type: contentType,
      byte_size: file.size,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await throwIfInvokeFailed('r2-presign-proof', res);

  const payload = (res.data || {}) as Partial<R2PresignProofResult>;
  const uploadUrl = String(payload.upload_url || '');
  const objectKey = String(payload.object_key || '').trim();
  if (!uploadUrl || !objectKey) {
    throw new Error('R2 upload URL missing');
  }

  const putHeaders: Record<string, string> = {
    ...(payload.headers || {}),
    'Content-Type': payload.headers?.['Content-Type'] || contentType,
  };

  onPhase?.('uploading');
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: file,
  });
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '');
    throw new Error(
      detail
        ? `R2 upload failed (${putRes.status}): ${detail.slice(0, 180)}`
        : `R2 upload failed (${putRes.status})`
    );
  }

  return { objectKey };
}
