import { supabase } from '../../services/supabase';
import { resolveAccessToken } from './supabaseAuth';
import { throwIfInvokeFailed } from './supabaseFunctionError';

export const KYC_DOCUMENTS_BUCKET = 'kyc_documents';

const SIGNED_URL_TTL_SEC = 3600;

/**
 * Detect R2 KYC object keys (UUID leaf) vs legacy Supabase Storage paths
 * (`front_${ts}.jpg` under the same `kyc/` prefix).
 */
export function isR2KycObjectKey(objectPath: string): boolean {
  const path = String(objectPath ?? '')
    .trim()
    .replace(/^\/+/, '');
  if (!path.startsWith('kyc/')) return false;
  return /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(
    path
  );
}

/**
 * Signed URL for a private KYC object.
 * Legacy Storage paths use client Storage API; R2 keys go through the admin Edge
 * Function (service-side R2 GET). Prefer {@link createKycAdminSignedUrls} in admin UI.
 */
export async function createKycSignedUrl(objectPath: string | null | undefined): Promise<string | null> {
  const path = String(objectPath ?? '').trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  if (isR2KycObjectKey(path)) {
    try {
      const urls = await createKycAdminSignedUrls([path]);
      return urls[path] ?? null;
    } catch (e) {
      console.error('createKycSignedUrl R2', path, e);
      return null;
    }
  }

  const { data, error } = await supabase.storage
    .from(KYC_DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);

  if (error) {
    console.error('createKycSignedUrl', path, error.message);
    return null;
  }

  return data?.signedUrl ?? null;
}

/**
 * Admin-only: mint signed URLs via Edge Function + service_role / R2.
 * Needed because Storage RLS owner checks block platform admins who are not
 * the document owner (and may not have profiles.role = 'admin').
 * Also signs Cloudflare R2 KYC keys after the Storage → R2 migration.
 */
export async function createKycAdminSignedUrls(
  paths: Array<string | null | undefined>
): Promise<Record<string, string | null>> {
  const cleaned = paths.map((p) => String(p ?? '').trim()).filter(Boolean);
  if (cleaned.length === 0) return {};

  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const res = await supabase.functions.invoke('kyc-admin-signed-urls', {
    body: { paths: cleaned },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await throwIfInvokeFailed('kyc-admin-signed-urls', res);

  const urls = (res.data as { urls?: Record<string, string | null> } | null)?.urls || {};
  return urls;
}

export const KYC_DOC_TYPE_LABELS: Record<string, string> = {
  national_id_local: 'National ID (Local)',
  drivers_license: "Driver's License",
  international_passport: 'International Passport',
  residence_permit: 'Residence Permit',
};

export function kycDocTypeLabel(slug: string | null | undefined): string {
  const key = String(slug ?? '').trim();
  if (!key) return '—';
  return KYC_DOC_TYPE_LABELS[key] ?? key.replace(/_/g, ' ');
}
