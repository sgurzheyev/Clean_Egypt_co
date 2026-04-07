import { CURRENCY_RISK_BUFFER_FACTOR, DEFAULT_USD_TO_EGP_RATE } from '../../constants';

/**
 * International card payment settled in USD → credit to internal EGP wallet.
 * Pass `usdToEgpRate` from {@link fetchUsdToEgpRate} when possible.
 */
export function stripeUsdToWalletEgp(usdCharged: number, usdToEgpRate: number = DEFAULT_USD_TO_EGP_RATE): number {
  if (!Number.isFinite(usdCharged) || usdCharged <= 0) return 0;
  if (!Number.isFinite(usdToEgpRate) || usdToEgpRate <= 0) return 0;
  const raw = usdCharged * usdToEgpRate * CURRENCY_RISK_BUFFER_FACTOR;
  /** Whole EGP integers only (check_integer_egp / wallet storage). */
  return Math.max(0, Math.floor(raw));
}

/**
 * User enters EGP in the deposit form; Stripe charges USD = EGP / rate; credit uses same rule as USD path.
 * Net EGP ≈ (EGP / rate) × rate × 0.97 = EGP × 0.97
 */
export function stripeEgpInputToWalletEgp(inputEgp: number, usdToEgpRate: number = DEFAULT_USD_TO_EGP_RATE): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0) return 0;
  const chargeUsd = inputEgp / usdToEgpRate;
  return stripeUsdToWalletEgp(chargeUsd, usdToEgpRate);
}

/** Convert bid/deposit input: USD → EGP using platform rate (internal wallet is EGP-only). */
export function usdInputToEgp(usd: number, rate: number = DEFAULT_USD_TO_EGP_RATE): number {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, Math.floor(usd * rate));
}

/** USD amount Stripe will charge for an EGP-denominated deposit input. */
export function egpInputToChargeUsd(inputEgp: number, usdPerEgpRate: number = DEFAULT_USD_TO_EGP_RATE): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0 || !Number.isFinite(usdPerEgpRate) || usdPerEgpRate <= 0) {
    return 0;
  }
  return Math.round((inputEgp / usdPerEgpRate) * 10000) / 10000;
}

/**
 * Profile `wallet_balance` / `frozen_balance` are stored in EGP (internal economy).
 * Card top-ups convert USD → EGP using the live `platform_settings.usd_to_egp_rate` via {@link stripeUsdToWalletEgp}.
 */
export function profileWalletBalanceEgp(raw: number | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
