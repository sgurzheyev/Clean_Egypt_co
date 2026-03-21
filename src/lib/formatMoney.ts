/**
 * Internal wallet / missions use EGP. Display consistently as "1,234.56 EGP" or whole numbers when .00.
 */
export function formatEgp(amount: number, opts?: { minFractionDigits?: 0 | 2; maxFractionDigits?: 0 | 2 }): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0 EGP';
  const min = opts?.minFractionDigits ?? 0;
  const max = opts?.maxFractionDigits ?? 2;
  const formatted = new Intl.NumberFormat('en-EG', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
  return `${formatted} EGP`;
}

/** Same as formatEgp but uses L.E. suffix (common in Egypt). */
export function formatLe(amount: number, opts?: { minFractionDigits?: 0 | 2; maxFractionDigits?: 0 | 2 }): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '0 L.E.';
  const min = opts?.minFractionDigits ?? 0;
  const max = opts?.maxFractionDigits ?? 2;
  const formatted = new Intl.NumberFormat('en-EG', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
  return `${formatted} L.E.`;
}
