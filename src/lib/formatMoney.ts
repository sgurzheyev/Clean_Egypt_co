/** Token amounts only — whole integers in UI. */
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

/** Numeric part only (no “Tokens”). */
export function formatEgpDigits(amount: number): string {
  return formatNumber(amount);
}

/**
 * Token-only UI: the app displays all internal balances as tokens.
 * We keep the legacy function names to avoid a huge refactor.
 */
export function formatEgp(amount: number): string {
  return `${formatNumber(amount)} Tokens`;
}

/** Client-offered work budget for workers (EGP, not platform tokens). */
export function formatWorkBudgetEgp(amount: number): string {
  const n = roundWhole(amount);
  if (n <= 0) return '—';
  return `${formatNumber(n)} EGP`;
}

/** Same as formatEgp (legacy alias). */
export function formatLe(amount: number): string {
  return `${formatNumber(amount)} Tokens`;
}
