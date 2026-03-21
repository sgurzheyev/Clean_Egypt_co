/**
 * Estimated net wallet credit after Stripe-style fees and a 2.5% FX buffer.
 * Formula: (Input - $0.30) × 96.5% (Stripe-ish), then × 97.5% (platform currency buffer).
 */
export function computeNetWalletCreditUsd(inputUsd: number): number {
  if (!Number.isFinite(inputUsd) || inputUsd <= 0) return 0;
  const afterStripe = (inputUsd - 0.3) * 0.965;
  const afterBuffer = afterStripe * (1 - 0.025);
  return Math.max(0, Math.round(afterBuffer * 100) / 100);
}
