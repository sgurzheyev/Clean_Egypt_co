import { CURRENCY_RISK_BUFFER_FACTOR, USD_TO_EGP_RATE } from '../../constants';

/**
 * International card payment settled in USD → credit to internal EGP wallet.
 * Example: $10 × 48.5 × 0.97 ≈ 470.45 EGP
 */
export function stripeUsdToWalletEgp(usdCharged: number): number {
  if (!Number.isFinite(usdCharged) || usdCharged <= 0) return 0;
  const raw = usdCharged * USD_TO_EGP_RATE * CURRENCY_RISK_BUFFER_FACTOR;
  return Math.max(0, Math.round(raw * 100) / 100);
}

/**
 * User enters EGP in the deposit form; Stripe charges USD = EGP / rate; credit uses same rule as USD path.
 * Net EGP ≈ (EGP / rate) × rate × 0.97 = EGP × 0.97
 */
export function stripeEgpInputToWalletEgp(inputEgp: number): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0) return 0;
  const chargeUsd = inputEgp / USD_TO_EGP_RATE;
  return stripeUsdToWalletEgp(chargeUsd);
}

/** USD amount Stripe will charge for an EGP-denominated deposit input. */
export function egpInputToChargeUsd(inputEgp: number, usdPerEgpRate: number = USD_TO_EGP_RATE): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0 || !Number.isFinite(usdPerEgpRate) || usdPerEgpRate <= 0) {
    return 0;
  }
  return Math.round((inputEgp / usdPerEgpRate) * 10000) / 10000;
}
