import { USD_TO_EGP_RATE } from '../../constants';

/** Minimum frozen security (EGP) for street / public / city missions. */
export const MIN_TRUST_DEPOSIT_EGP_PUBLIC = 100;

function isStreetMissionCategory(category: string | null | undefined): boolean {
  const c = String(category || '').toLowerCase();
  return c === 'public' || c === 'street' || c === 'city';
}

/**
 * Required worker frozen balance expressed in EGP for the mission category/amount.
 * - Street / public / city: 100 EGP
 * - Home / office: max(100 EGP, 50% of mission price in EGP when amount_target > $4 USD); otherwise 100 EGP minimum.
 */
export function requiredTrustDepositEgp(category: string | null | undefined, amountTargetUsd: number): number {
  const target = Number(amountTargetUsd);
  if (!Number.isFinite(target) || target <= 0) return MIN_TRUST_DEPOSIT_EGP_PUBLIC;

  if (isStreetMissionCategory(category)) {
    return MIN_TRUST_DEPOSIT_EGP_PUBLIC;
  }

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

export type SecurityDepositCheck =
  | { ok: true }
  | { ok: false; reason: 'frozen_exceeds_wallet' | 'insufficient_funds' };

export function isSecurityDepositFailure(
  c: SecurityDepositCheck
): c is Extract<SecurityDepositCheck, { ok: false }> {
  return c.ok === false;
}

/**
 * Worker must have enough total wallet to cover trust (frozen + liquid).
 * - Invariant: frozen_balance must not exceed wallet_balance.
 * - If existing frozen already meets required EGP trust, OK.
 * - Otherwise liquid (wallet − frozen) must cover the USD shortfall to reach required trust.
 */
export function workerCanSecureMissionDeposit(
  walletBalanceUsd: number,
  frozenBalanceUsd: number,
  category: string | null | undefined,
  amountTargetUsd: number
): SecurityDepositCheck {
  const wb = Math.max(0, Number(walletBalanceUsd || 0));
  const fr = Math.max(0, Number(frozenBalanceUsd || 0));
  if (fr > wb + 0.01) {
    return { ok: false, reason: 'frozen_exceeds_wallet' };
  }
  const requiredEgp = requiredTrustDepositEgp(category, amountTargetUsd);
  const frozenEgp = fr * USD_TO_EGP_RATE;
  if (frozenEgp >= requiredEgp - 0.01) {
    return { ok: true };
  }
  const shortfallEgp = requiredEgp - frozenEgp;
  const shortfallUsd = shortfallEgp / USD_TO_EGP_RATE;
  const available = wb - fr;
  if (available >= shortfallUsd - 0.01) {
    return { ok: true };
  }
  return { ok: false, reason: 'insufficient_funds' };
}
