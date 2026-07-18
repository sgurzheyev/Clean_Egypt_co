/** Platform exit fee on withdrawals (12%). */

/** All amounts in USD (internal wallet currency). */
export function computeWithdrawalExitBreakdown(requestedUsd: number): {
  gross: number;
  fee: number;
  net: number;
} {
  const gross = Math.round(Math.max(0, requestedUsd) * 100) / 100;
  const fee = Math.round(gross * 0.12 * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;
  return { gross, fee, net };
}
