/** Whole-integer amounts in UI. */
function roundWhole(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function formatNumber(amount: number): string {
  const n = roundWhole(amount);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Numeric part only (no currency suffix). */
export function formatUsdDigits(amount: number): string {
  return formatNumber(amount);
}

/** Platform token balances / token bids (amount_target). */
export function formatTokens(amount: number): string {
  return `${formatNumber(amount)} Tokens`;
}

/** Client-offered work budget / bids / crowdfunding (USD). */
export function formatWorkBudgetUsd(amount: number): string {
  const n = roundWhole(amount);
  if (n <= 0) return '—';
  return `$${formatNumber(n)}`;
}

/** Alias for USD work budgets. */
export function formatUsd(amount: number): string {
  return formatWorkBudgetUsd(amount);
}

/** Legacy alias for formatTokens. */
export function formatLe(amount: number): string {
  return formatTokens(amount);
}
