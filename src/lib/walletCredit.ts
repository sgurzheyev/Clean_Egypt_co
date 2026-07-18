import { CURRENCY_RISK_BUFFER_FACTOR } from '../../constants';

/**
 * Stripe settles in USD; wallet is credited in USD (same unit).
 * Applies platform risk buffer (0.97). No FX conversion.
 */
export function stripeUsdToWalletCredit(usdCharged: number): number {
  if (!Number.isFinite(usdCharged) || usdCharged <= 0) return 0;
  return Math.floor(usdCharged * CURRENCY_RISK_BUFFER_FACTOR);
}

/** User enters USD; Stripe charges that USD; credit uses buffer. */
export function stripeUsdInputToWalletCredit(inputUsd: number): number {
  if (!Number.isFinite(inputUsd) || inputUsd <= 0) return 0;
  return stripeUsdToWalletCredit(inputUsd);
}

/** Stripe charge amount for a USD-denominated deposit (identity). */
export function usdInputToChargeUsd(inputUsd: number): number {
  if (!Number.isFinite(inputUsd) || inputUsd <= 0) return 0;
  return Math.round(inputUsd * 10000) / 10000;
}

/** Profile wallet_balance / frozen_balance stored in USD. */
export function profileWalletBalanceUsd(raw: number | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.floor(n);
}
