/**
 * Cloudflare R2 (S3-compatible) client for proof-video presign.
 * Keys stay in Edge Function secrets — never in the Vite bundle.
 *
 * AWS SDK v3 checksums break R2 unless forced to WHEN_REQUIRED.
 */
import { S3Client } from 'npm:@aws-sdk/client-s3@3.699.0';

export const R2_PUT_TTL_SEC = 15 * 60;
export const R2_GET_TTL_SEC = 10 * 60;
export const R2_MAX_PROOF_BYTES_DEFAULT = 80 * 1024 * 1024;

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

/** proofs/{missionId}/{workerId}/{uuid}.{ext} */
export function buildProofObjectKey(input: {
  missionId: string;
  workerId: string;
  ext: string;
}): string {
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `proofs/${input.missionId}/${input.workerId}/${id}.${input.ext}`;
}

export function isProofKeyForMission(objectKey: string, missionId: string): boolean {
  const key = objectKey.replace(/^\/+/, '');
  const prefix = `proofs/${missionId}/`;
  if (!key.startsWith(prefix)) return false;
  if (key.includes('..') || key.includes('\\')) return false;
  return key.length > prefix.length && key.length < 512;
}
