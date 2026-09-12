/** Worker-facing work budget in USD (separate from token bid in amount_target). */
export function missionWorkBudgetUsd(job: {
  expected_price?: number | null;
  amount_target?: number | null;
}): number {
  const budget = Number(job.expected_price);
  if (Number.isFinite(budget) && budget > 0) {
    return Math.floor(budget);
  }
  /**
   * Pre-Wave-C leftover: amount_target once held fiat (typically 100+).
   * After the P2-3 backfill those rows copy USD into expected_price and reset
   * rank to 1 — this branch only remains for un-migrated hosts.
   */
  const legacy = Number(job.amount_target);
  if (Number.isFinite(legacy) && legacy >= 100) {
    return Math.floor(legacy);
  }
  return 0;
}

/** Platform token bid stored in amount_target (listing rank / pin cost). */
export function missionTokenBid(job: {
  amount_target?: number | null;
  is_report?: boolean | null;
  status?: string | null;
}): number {
  if (job.is_report || String(job.status || '').toLowerCase() === 'reported') {
    return 0;
  }
  const n = Math.floor(Number(job.amount_target ?? 1));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
