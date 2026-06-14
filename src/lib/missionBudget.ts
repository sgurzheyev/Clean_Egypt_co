/** Worker-facing work budget in EGP (separate from token bid in amount_target). */
export function missionWorkBudgetEgp(job: {
  expected_price?: number | null;
  amount_target?: number | null;
}): number {
  const budget = Number(job.expected_price);
  if (Number.isFinite(budget) && budget > 0) {
    return Math.floor(budget);
  }
  /** Legacy rows: amount_target held EGP before expected_price existed (typically 100+). */
  const legacy = Number(job.amount_target);
  if (Number.isFinite(legacy) && legacy >= 100) {
    return Math.floor(legacy);
  }
  return 0;
}

/** Platform token bid stored in amount_target (listing rank / pin cost). */
export function missionTokenBid(job: { amount_target?: number | null }): number {
  return Math.max(1, Math.floor(Number(job.amount_target ?? 1)));
}
