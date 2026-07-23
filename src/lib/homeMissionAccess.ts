/**
 * Home/office mission access gates (KYC).
 * Legacy 50% security/trust deposit escrow was removed — subscription + tokens only.
 */

export function isHomeMissionCategory(category: string | null | undefined): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'home' || c === 'office';
}

export type HomeMissionAccessCheck = { ok: true } | { ok: false; reason: 'not_id_verified' };

/** Home/office missions require ID-verified workers. */
export function checkHomeMissionWorkerVerification(
  category: string | null | undefined,
  isIdVerified: boolean | null | undefined
): HomeMissionAccessCheck {
  if (!isHomeMissionCategory(category)) return { ok: true };
  if (isIdVerified) return { ok: true };
  return { ok: false, reason: 'not_id_verified' };
}
