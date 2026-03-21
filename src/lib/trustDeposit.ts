import { USD_TO_EGP_RATE } from '../../constants';

/** Minimum frozen security (EGP) for street/public missions. */
export const MIN_TRUST_DEPOSIT_EGP_PUBLIC = 100;

/**
 * Required worker frozen balance expressed in EGP for the mission category/amount.
 * - Public: 100 EGP
 * - Home/office: max(100 EGP, 50% of mission target converted to EGP). For amount_target ≤ $4, still 100 EGP minimum.
 */
export function requiredTrustDepositEgp(category: string | null | undefined, amountTargetUsd: number): number {
  const cat = String(category || '').toLowerCase();
  const target = Number(amountTargetUsd);
  if (!Number.isFinite(target) || target <= 0) return MIN_TRUST_DEPOSIT_EGP_PUBLIC;

  if (cat === 'public') {
    return MIN_TRUST_DEPOSIT_EGP_PUBLIC;
  }

  // home / office / other private missions
  const halfMissionEgp = target * 0.5 * USD_TO_EGP_RATE;
  if (target > 4) {
    return Math.max(MIN_TRUST_DEPOSIT_EGP_PUBLIC, Math.round(halfMissionEgp * 100) / 100);
  }
  return MIN_TRUST_DEPOSIT_EGP_PUBLIC;
}

/** Compare worker frozen balance (stored in USD in profiles) against required EGP threshold. */
export function workerFrozenUsdMeetsTrustDeposit(
  frozenBalanceUsd: number,
  category: string | null | undefined,
  amountTargetUsd: number
): boolean {
  const requiredEgp = requiredTrustDepositEgp(category, amountTargetUsd);
  const frozenEgp = Number(frozenBalanceUsd || 0) * USD_TO_EGP_RATE;
  return frozenEgp >= requiredEgp - 0.01;
}
