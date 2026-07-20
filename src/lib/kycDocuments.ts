import { supabase } from '../../services/supabase';

export const KYC_DOCUMENTS_BUCKET = 'kyc_documents';

const SIGNED_URL_TTL_SEC = 3600;

/** Admin/user signed URL for a private object in kyc_documents. */
export async function createKycSignedUrl(objectPath: string | null | undefined): Promise<string | null> {
  const path = String(objectPath ?? '').trim();
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(KYC_DOCUMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);

  if (error) {
    console.error('createKycSignedUrl', path, error.message);
    return null;
  }

  return data?.signedUrl ?? null;
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
