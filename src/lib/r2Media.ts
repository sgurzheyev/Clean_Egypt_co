/**
 * General R2 media upload (KYC, stores, avatars, …).
 * Presign via Edge Function → direct PUT → store object key (or public URL).
 */
import { supabase } from '../../services/supabase';
import { resolveAccessToken } from './supabaseAuth';
import { throwIfInvokeFailed } from './supabaseFunctionError';

export type R2MediaFolder =
  | 'kyc'
  | 'stores'
  | 'avatars'
  | 'mission-photos'
  | 'chat';

export type R2PresignMediaResult = {
  upload_url: string;
  object_key: string;
  method: string;
  headers: Record<string, string>;
  expires_in: number;
  max_bytes: number;
  folder: string;
  public_url?: string | null;
};

/** Public custom domain for R2 (no trailing slash). Falls back empty → keys only. */
export function getR2PublicBaseUrl(): string {
  const raw =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env?.VITE_R2_PUBLIC_BASE_URL === 'string'
      ? String(import.meta.env.VITE_R2_PUBLIC_BASE_URL).trim()
      : '';
  return raw.replace(/\/$/, '');
}

/**
 * Resolve a stored media value for <img src>.
 * - Absolute http(s) URLs (legacy Supabase Storage) pass through.
 * - Object keys → `{VITE_R2_PUBLIC_BASE_URL}/{key}` when configured.
 */
export function resolveR2PublicUrl(stored: string | null | undefined): string {
  const value = String(stored ?? '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }
  const base = getR2PublicBaseUrl();
  if (!base) return value;
  const key = value.replace(/^\/+/, '');
  return `${base}/${key}`;
}

function normalizeContentType(file: File | Blob, fallback = 'image/jpeg'): string {
  const raw = String(file.type || '')
    .trim()
    .toLowerCase()
    .split(';')[0];
  if (raw === 'image/jpg') return 'image/jpeg';
  if (raw) return raw;
  if (file instanceof File) {
    const name = String(file.name || '').toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.mov')) return 'video/quicktime';
    if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  }
  return fallback;
}

export type UploadToR2Options = {
  folder: R2MediaFolder;
  file: File | Blob;
  /** Optional subfolder under {folder}/{userId}/, e.g. docs/passport/front */
  subpath?: string;
  /** Prefer returning public URL when Edge provides it (stores/avatars). */
  preferPublicUrl?: boolean;
};

/**
 * Presign + PUT to R2.
 * Returns object_key by default; for public folders may return public_url when preferPublicUrl.
 */
export async function uploadToR2(opts: UploadToR2Options): Promise<{
  objectKey: string;
  publicUrl: string | null;
  displayUrl: string;
}> {
  const { folder, file, subpath, preferPublicUrl = true } = opts;
  if (!file || (typeof file.size === 'number' && file.size < 1)) {
    throw new Error('Empty file');
  }

  const contentType = normalizeContentType(file);
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('r2-presign-media', {
    body: {
      folder,
      content_type: contentType,
      byte_size: file.size,
      ...(subpath ? { subpath } : {}),
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await throwIfInvokeFailed('r2-presign-media', res);

  const payload = (res.data || {}) as Partial<R2PresignMediaResult>;
  const uploadUrl = String(payload.upload_url || '');
  const objectKey = String(payload.object_key || '').trim();
  if (!uploadUrl || !objectKey) {
    throw new Error('R2 upload URL missing');
  }

  const putHeaders: Record<string, string> = {
    ...(payload.headers || {}),
    'Content-Type': payload.headers?.['Content-Type'] || contentType,
  };

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

  const publicUrl =
    typeof payload.public_url === 'string' && payload.public_url.trim()
      ? payload.public_url.trim()
      : resolveR2PublicUrl(objectKey) || null;

  const displayUrl =
    preferPublicUrl && publicUrl && /^https?:\/\//i.test(publicUrl)
      ? publicUrl
      : objectKey;

  return { objectKey, publicUrl, displayUrl };
}

/** Store object key in DB; resolve with {@link resolveR2PublicUrl} when rendering. */
export async function uploadAvatarToR2(file: File | Blob): Promise<string> {
  const { objectKey } = await uploadToR2({
    folder: 'avatars',
    file,
    preferPublicUrl: false,
  });
  return objectKey;
}

/** Mission before/after / creator photos → `mission-photos/`. Returns object key. */
export async function uploadMissionPhotoToR2(
  file: File | Blob,
  subpath?: string
): Promise<string> {
  const { objectKey } = await uploadToR2({
    folder: 'mission-photos',
    file,
    subpath,
    preferPublicUrl: false,
  });
  return objectKey;
}

export const resolveAvatarUrl = resolveR2PublicUrl;
export const resolveMissionPhotoUrl = resolveR2PublicUrl;
