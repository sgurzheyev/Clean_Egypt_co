/**
 * Closed-loop conversion. Keep in sync with
 * `closed_economy_tokens_per_usd` / `closed_economy_token_refund_tokens`
 * in supabase/migrations/20260927160000_closed_economy.sql
 * and with the top slider tier in `tokenPricing.ts` ($99 = 5000 tokens).
 *
 * Stripe expiry credit:
 *   tokens_per_usd = floor(anchor_tokens * (100 + bonus_percent) / (anchor_usd * 100))
 *   credited       = amount_usd * tokens_per_usd
 *   Defaults: floor(5000 * 120 / (99 * 100)) = 60, so $100 → 6000.
 *
 * Token-donation expiry refund:
 *   credited = floor(tokens * (100 + bonus_percent) / 100)
 *   Defaults: 100 → 120. Amounts under 5 tokens floor to the original gift.
 */
export const CLOSED_ECONOMY_DEFAULTS = {
  anchorUsd: 99,
  anchorTokens: 5000,
  stripeBonusPercent: 20,
  tokenRefundBonusPercent: 20,
} as const;

export type ClosedEconomyRates = {
  anchorUsd: number;
  anchorTokens: number;
  stripeBonusPercent: number;
  tokenRefundBonusPercent: number;
};

export function stripeExpiryTokensPerUsd(
  config: ClosedEconomyRates = CLOSED_ECONOMY_DEFAULTS
): number {
  const anchorUsd = Math.floor(config.anchorUsd);
  const anchorTokens = Math.floor(config.anchorTokens);
  const bonus = Math.floor(config.stripeBonusPercent);
  if (anchorUsd <= 0 || anchorTokens <= 0 || bonus < 0) return 0;
  return Math.floor((anchorTokens * (100 + bonus)) / (anchorUsd * 100));
}

export function stripeExpiryBonusTokens(
  amountUsd: number,
  config: ClosedEconomyRates = CLOSED_ECONOMY_DEFAULTS
): number {
  const usd = Math.floor(amountUsd);
  if (usd <= 0) return 0;
  return usd * stripeExpiryTokensPerUsd(config);
}

export function tokenExpiryRefundTokens(
  tokens: number,
  config: ClosedEconomyRates = CLOSED_ECONOMY_DEFAULTS
): number {
  const amount = Math.floor(tokens);
  const bonus = Math.floor(config.tokenRefundBonusPercent);
  if (amount <= 0 || bonus < 0) return 0;
  return Math.floor((amount * (100 + bonus)) / 100);
}
