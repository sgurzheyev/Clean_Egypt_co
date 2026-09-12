/**
 * Cloudflare R2 (S3-compatible) client for proof-video + general media presign.
 * Keys stay in Edge Function secrets — never in the Vite bundle.
 *
 * AWS SDK v3 checksums break R2 unless forced to WHEN_REQUIRED.
 */
import { S3Client } from 'npm:@aws-sdk/client-s3@3.699.0';

export const R2_PUT_TTL_SEC = 15 * 60;
export const R2_GET_TTL_SEC = 10 * 60;
export const R2_MAX_PROOF_BYTES_DEFAULT = 80 * 1024 * 1024;
export const R2_MAX_MEDIA_BYTES_DEFAULT = 25 * 1024 * 1024;

export const ALLOWED_PROOF_CONTENT_TYPES = [
  'video/webm',
  'video/mp4',
  'video/quicktime',
] as const;

export type AllowedProofContentType = (typeof ALLOWED_PROOF_CONTENT_TYPES)[number];

export function isAllowedProofContentType(value: string): value is AllowedProofContentType {
  return (ALLOWED_PROOF_CONTENT_TYPES as readonly string[]).includes(value);
}

export function extForContentType(contentType: AllowedProofContentType): string {
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  return 'mp4';
}

/** Authenticated media folders (images, KYC/video, civic reports, city PDFs). */
export const R2_MEDIA_FOLDERS = [
  'kyc',
  'stores',
  'avatars',
  'mission-photos',
  'chat',
  'reports',
  'city-pdfs',
] as const;

export type R2MediaFolder = (typeof R2_MEDIA_FOLDERS)[number];

export function isR2MediaFolder(value: string): value is R2MediaFolder {
  return (R2_MEDIA_FOLDERS as readonly string[]).includes(value);
}

export const ALLOWED_MEDIA_CONTENT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const;

export type AllowedMediaContentType = (typeof ALLOWED_MEDIA_CONTENT_TYPES)[number];

export function isAllowedMediaContentType(value: string): value is AllowedMediaContentType {
  const ct = value.trim().toLowerCase().split(';')[0];
  return (ALLOWED_MEDIA_CONTENT_TYPES as readonly string[]).includes(ct);
}

export function extForMediaContentType(contentType: string): string {
  const ct = contentType.trim().toLowerCase().split(';')[0];
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/heic' || ct === 'image/heif') return 'heic';
  if (ct === 'video/webm') return 'webm';
  if (ct === 'video/quicktime') return 'mov';
  if (ct === 'video/mp4') return 'mp4';
  if (ct === 'application/pdf') return 'pdf';
  return 'jpg';
}

export type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

export function readR2Env(): R2Env | { error: string } {
  const accountId = String(Deno.env.get('R2_ACCOUNT_ID') || '').trim();
  const accessKeyId = String(Deno.env.get('R2_ACCESS_KEY_ID') || '').trim();
  const secretAccessKey = String(Deno.env.get('R2_SECRET_ACCESS_KEY') || '').trim();
  const bucket = String(Deno.env.get('R2_PROOF_BUCKET') || '').trim();
  const endpointOverride = String(Deno.env.get('R2_S3_ENDPOINT') || '').trim();

  if (!accountId) return { error: 'Missing R2_ACCOUNT_ID env' };
  if (!accessKeyId) return { error: 'Missing R2_ACCESS_KEY_ID env' };
  if (!secretAccessKey) return { error: 'Missing R2_SECRET_ACCESS_KEY env' };
  if (!bucket) return { error: 'Missing R2_PROOF_BUCKET env' };

  const endpoint =
    endpointOverride || `https://${accountId}.r2.cloudflarestorage.com`;

  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

export function createR2Client(env: R2Env): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: env.endpoint,
    credentials: {
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
    },
    // R2 does not implement AWS flexible checksums used by newer SDK defaults.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  } as ConstructorParameters<typeof S3Client>[0]);
}

function newObjectId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** proofs/{missionId}/{workerId}/{uuid}.{ext} */
export function buildProofObjectKey(input: {
  missionId: string;
  workerId: string;
  ext: string;
}): string {
  return `proofs/${input.missionId}/${input.workerId}/${newObjectId()}.${input.ext}`;
}

export function isProofKeyForMission(objectKey: string, missionId: string): boolean {
  const key = objectKey.replace(/^\/+/, '');
  const prefix = `proofs/${missionId}/`;
  if (!key.startsWith(prefix)) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  return key.length > prefix.length && key.length < 512;
}

/**
 * Build object key under a media folder.
 * Always prefixes with `{folder}/{userId}/…` so owners cannot write outside their tree.
 */
export function buildMediaObjectKey(input: {
  folder: R2MediaFolder;
  userId: string;
  ext: string;
  /** Optional subpath after userId, e.g. docs/national_id/front */
  subpath?: string;
}): string {
  const sub = String(input.subpath || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\./g, '')
    .replace(/\\/g, '');
  const leaf = `${newObjectId()}.${input.ext.replace(/^\./, '')}`;
  if (sub) return `${input.folder}/${input.userId}/${sub}/${leaf}`;
  return `${input.folder}/${input.userId}/${leaf}`;
}

export function isMediaKeyForUser(
  objectKey: string,
  userId: string,
  folder?: R2MediaFolder
): boolean {
  const key = objectKey.replace(/^\/+/, '');
  if (key.includes('..') || key.includes('\\') || key.length > 512) return false;
  if (folder) {
    return key.startsWith(`${folder}/${userId}/`);
  }
  return R2_MEDIA_FOLDERS.some((f) => key.startsWith(`${f}/${userId}/`));
}

export function isKycObjectKey(objectKey: string): boolean {
  const key = objectKey.replace(/^\/+/, '');
  return key.startsWith('kyc/') && !key.includes('..') && key.length < 512;
}

/** Heavy public objects the Garbage History purge may delete. Never kyc/avatars/chat/stores. */
export const R2_HISTORY_PURGE_PREFIXES = [
  'reports/',
  'mission-photos/',
  'proofs/',
  'city-pdfs/',
] as const;

export function isPurgeableHistoryObjectKey(objectKey: string): boolean {
  const key = objectKey.replace(/^\/+/, '');
  if (!key || key.includes('..') || key.includes('\\') || key.length > 512) return false;
  return R2_HISTORY_PURGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Turn a stored photo/PDF value (object key, JSON wrapper, or public CDN URL)
 * into an R2 object key. Returns null when the value is not a purgeable key.
 */
export function objectKeyFromStoredMedia(
  stored: string | null | undefined,
  publicBaseUrl?: string | null
): string | null {
  let value = String(stored ?? '').trim();
  if (!value || value === 'null' || value === 'undefined') return null;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;

  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === 'string') {
        return objectKeyFromStoredMedia(parsed, publicBaseUrl);
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rec = parsed as Record<string, unknown>;
        for (const k of ['object_key', 'objectKey', 'key', 'path', 'url', 'public_url', 'src']) {
          if (typeof rec[k] === 'string') {
            const inner = objectKeyFromStoredMedia(rec[k], publicBaseUrl);
            if (inner) return inner;
          }
        }
      }
    } catch {
      // treat as a raw path
    }
  }

  try {
    if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      value = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    }
  } catch {
    return null;
  }

  const base = String(publicBaseUrl || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (base && (value === base || value.startsWith(`${base}/`))) {
    value = value.slice(base.length).replace(/^\/+/, '');
  }

  const key = value.replace(/^\/+/, '');
  return isPurgeableHistoryObjectKey(key) ? key : null;
}

export function collectPurgeableHistoryKeys(values: Array<string | null | undefined>, publicBaseUrl?: string | null): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const key = objectKeyFromStoredMedia(value, publicBaseUrl);
    if (key) out.add(key);
  }
  return [...out];
}
