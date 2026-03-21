/** Whole EGP amounts only — no fractional piastres in UI. */
function roundWhole(amount: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function formatNumberEg(amount: number): string {
  const n = roundWhole(amount);
  return new Intl.NumberFormat('en-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Numeric part only (no “EGP”) — use in i18n strings that add “EGP” once. */
export function formatEgpDigits(amount: number): string {
  return formatNumberEg(amount);
}

/**
 * Internal wallet / missions use EGP. Always whole numbers (absolute rounding).
 */
export function formatEgp(amount: number): string {
  return `${formatNumberEg(amount)} EGP`;
}

/** Same as formatEgp but uses L.E. suffix (common in Egypt). */
export function formatLe(amount: number): string {
  return `${formatNumberEg(amount)} L.E.`;
}
