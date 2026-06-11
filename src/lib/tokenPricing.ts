/** SaaS token top-up tiers — keep in sync with `stripe-token-intent`. */
export const TOKEN_TOPUP_TIERS = [
  { usd: 10, tokens: 100, cents: 1000 },
  { usd: 19.99, tokens: 300, cents: 1999 },
  { usd: 49.99, tokens: 700, cents: 4999 },
  { usd: 99, tokens: 5000, cents: 9900 },
] as const;

export type TokenTopupTier = (typeof TOKEN_TOPUP_TIERS)[number];

export const YEARLY_SUBSCRIPTION = {
  usd: 9.99,
  cents: 999,
  months: 12,
  bonusTokens: 100,
  planTier: 'yearly_access',
} as const;

export function formatUsdPrice(usd: number): string {
  return usd % 1 === 0 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

export function isAllowedTokenPack(cents: number, tokens: number): boolean {
  return TOKEN_TOPUP_TIERS.some((t) => t.cents === cents && t.tokens === tokens);
}
