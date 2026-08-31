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
  | 'chat'
  | 'reports'
  | 'city-pdfs';

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
  let value = String(stored ?? '').trim();
  if (!value || value === 'null' || value === 'undefined') return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }
  const base = getR2PublicBaseUrl();
  if (!base) return value;
  const key = value.replace(/^\/+/, '');
  // Already a CDN path without scheme, or accidentally prefixed twice.
  if (key.startsWith(`${base.replace(/^https?:\/\//i, '')}/`)) {
    return `${base.split('://')[0]}://${key}`;
  }
  if (value === base || value.startsWith(`${base}/`)) return value;
  return `${base}/${key}`;
}

const MEDIA_OBJECT_KEYS = [
  'url',
  'public_url',
  'publicUrl',
  'src',
  'href',
  'displayUrl',
  'display_url',
  'object_key',
  'objectKey',
  'key',
  'path',
  'photo_url',
  'photoUrl',
] as const;

function looksLikeMediaPath(value: string): boolean {
  return /^(https?:\/\/|data:|blob:|[a-z0-9_./-]+)/i.test(value);
}

/**
 * Pull a single stored key/URL out of a string, JSON object, or nested wrapper.
 */
function extractStoredMediaUrl(item: unknown, depth = 0): string {
  if (item == null || depth > 6) return '';
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return '';
    const looksJson =
      trimmed.startsWith('[') || (trimmed.startsWith('{') && trimmed.includes(':'));
    if (looksJson) {
      try {
        const nested = extractStoredMediaUrl(JSON.parse(trimmed), depth + 1);
        if (nested) return nested;
      } catch {
        /* not JSON — keep as a path/key */
      }
    }
    return trimmed;
  }
  if (Array.isArray(item)) {
    for (const entry of item) {
      const found = extractStoredMediaUrl(entry, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof item === 'object') {
    const rec = item as Record<string, unknown>;
    for (const key of MEDIA_OBJECT_KEYS) {
      if (key in rec) {
        const found = extractStoredMediaUrl(rec[key], depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(rec)) {
      if (typeof value === 'string' && looksLikeMediaPath(value.trim())) {
        const found = extractStoredMediaUrl(value, depth + 1);
        if (found) return found;
      }
    }
  }
  return '';
}

/**
 * Coerce `missions.photo_urls` / `after_photo_urls` / `photos` from PostgREST.
 * Handles string[], JSON strings, Postgres `{a,b}` literals, and `{url}` / `{object_key}` objects.
 */
export function coerceStoredMediaUrls(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => coerceStoredMediaUrls(item));
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const numericKeys = Object.keys(rec)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      return coerceStoredMediaUrls(numericKeys.map((key) => rec[key]));
    }
    const url = extractStoredMediaUrl(value);
    return url ? [url] : [];
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return [];
  if (trimmed.startsWith('[')) {
    try {
      return coerceStoredMediaUrls(JSON.parse(trimmed));
    } catch {
      /* fall through to PG literal / single key */
    }
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    if (trimmed.includes(':')) {
      try {
        return coerceStoredMediaUrls(JSON.parse(trimmed));
      } catch {
        /* Postgres text[] literal */
      }
    }
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => extractStoredMediaUrl(part.trim().replace(/^"(.*)"$/, '$1')))
      .filter((part) => part.length > 0);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const inner = JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1)}"` : trimmed);
      if (typeof inner === 'string') return coerceStoredMediaUrls(inner);
    } catch {
      /* keep as a single key */
    }
  }
  const extracted = extractStoredMediaUrl(trimmed);
  return extracted ? [extracted] : [];
}

/** First usable stored key/URL, or null when the field is empty / unparsable. */
export function firstStoredMediaUrl(value: unknown): string | null {
  return coerceStoredMediaUrls(value)[0] ?? null;
}

/**
 * Gallery URLs for a mission card. Prefer `photo_urls`; fall back to `photos`
 * so a single stored link still appears in the slider/grid.
 */
export function coerceMissionGalleryUrls(source: {
  photo_urls?: unknown;
  photos?: unknown;
} | null | undefined): string[] {
  const fromPhotoUrls = coerceStoredMediaUrls(source?.photo_urls);
  if (fromPhotoUrls.length > 0) return fromPhotoUrls;
  return coerceStoredMediaUrls(source?.photos);
}

/** Coerce then resolve each key through the public R2 CDN (https URLs pass through). */
export function resolveMissionPhotoUrls(value: unknown): string[] {
  return coerceStoredMediaUrls(value)
    .map((key) => resolveR2PublicUrl(key))
    .filter((url) => url.length > 0);
}

/** Single stored photo/video field → playable/display URL, or ''. */
export function resolveStoredMediaUrl(value: unknown): string {
  return resolveR2PublicUrl(firstStoredMediaUrl(value));
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
    if (name.endsWith('.pdf')) return 'application/pdf';
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
export const resolveChatPhotoUrl = resolveR2PublicUrl;
export const resolveReportPhotoUrl = resolveR2PublicUrl;
