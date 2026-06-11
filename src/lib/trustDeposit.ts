/**
 * SaaS model: the legacy security/trust deposit (50% escrow) is removed.
 * The only remaining worker-trust rule is ID verification for home/office missions.
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
