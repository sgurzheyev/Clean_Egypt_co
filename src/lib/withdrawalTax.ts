/** 12% platform exit tax on manual cash-out requests */
export const WITHDRAWAL_PLATFORM_FEE_RATE = 0.12;

export function computeWithdrawalExitBreakdown(requestedUsd: number): {
  gross: number;
  fee: number;
  net: number;
} {
  const gross = Math.round(Math.max(0, requestedUsd) * 100) / 100;
  const fee = Math.round(gross * WITHDRAWAL_PLATFORM_FEE_RATE * 100) / 100;
  const net = Math.round((gross - fee) * 100) / 100;
  return { gross, fee, net };
}
