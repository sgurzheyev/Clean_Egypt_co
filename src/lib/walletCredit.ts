/** Stripe fixed fee (USD) before percentage. */
export const STRIPE_FIXED_FEE_USD = 0.3;
/** Combined Stripe variable fee factor (≈3.5% on amount after fixed fee): 1 - 0.035 = 0.965 */
export const STRIPE_VARIABLE_FACTOR = 0.965;
/** Platform currency conversion buffer (2.5%) */
export const CURRENCY_BUFFER_FACTOR = 0.975;

/**
 * Transparent fee calculator — wallet credit in USD:
 * Credit = (Input_USD - $0.30) × 0.965 × 0.975
 */
export function computeNetWalletCreditUsd(inputUsd: number): number {
  if (!Number.isFinite(inputUsd) || inputUsd <= 0) return 0;
  const afterStripe = (inputUsd - STRIPE_FIXED_FEE_USD) * STRIPE_VARIABLE_FACTOR;
  const afterBuffer = afterStripe * CURRENCY_BUFFER_FACTOR;
  return Math.max(0, Math.round(afterBuffer * 100) / 100);
}

/** User enters EGP; convert to USD at rate, then same net formula (wallet is USD). */
export function computeNetWalletCreditFromEgpInput(inputEgp: number, usdPerEgpRate: number): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0 || !Number.isFinite(usdPerEgpRate) || usdPerEgpRate <= 0) {
    return 0;
  }
  const chargeUsd = inputEgp / usdPerEgpRate;
  return computeNetWalletCreditUsd(chargeUsd);
}

/** USD amount Stripe will charge for an EGP-denominated input (before net fee calc). */
export function egpInputToChargeUsd(inputEgp: number, usdPerEgpRate: number): number {
  if (!Number.isFinite(inputEgp) || inputEgp <= 0 || !Number.isFinite(usdPerEgpRate) || usdPerEgpRate <= 0) {
    return 0;
  }
  return Math.round((inputEgp / usdPerEgpRate) * 10000) / 10000;
}
