/**
 * Integer USD only: no commas/decimals in the controlled input value.
 * Use with step="1", pattern="\\d*", inputMode="numeric".
 */

/** Keep only digits (strips commas, dots, spaces, minus, etc.). */
export function sanitizeIntegerUsdDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Parse a digit-only field to a non-negative integer USD amount. */
export function parseIntegerUsdFromInput(value: string): number {
  const d = sanitizeIntegerUsdDigits(value);
  if (d === '') return 0;
  const n = Math.floor(Number(d));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Floor any numeric amount before RPC/API payloads (integer USD). */
export function floorUsd(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.floor(x));
}
