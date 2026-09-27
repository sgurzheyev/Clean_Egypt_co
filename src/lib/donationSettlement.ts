/**
 * Crowdfund donation release rules. The SQL in
 * supabase/migrations/20260927170000_donor_vote_release.sql is authoritative.
 *
 * Weight is in token-units at the closed-economy rate (bonus-inclusive
 * tokens_per_usd, default 60). That is not the shop rate of 5000 tokens
 * for $99. $10 → 600. A held 120-token gift → 120.
 *
 * Regular missions never enter this table: the client pays the worker
 * off-platform, and status=completed moves no platform-held money.
 */
export const DONOR_VOTE_WINDOW_HOURS = 24;
export const PROOF_REUPLOAD_LIMIT = 1;

/** @deprecated Use DONOR_VOTE_WINDOW_HOURS. The window is configurable in SQL. */
export const DONOR_VOTE_DEADLINE_HOURS = DONOR_VOTE_WINDOW_HOURS;

export type DonationSettlement =
  | 'release_to_worker'
  | 'not_cleaned'
  | 'hold'
  | 'off_platform';

export type DonationSettlementEvent =
  | 'funding_expired'
  | 'status_completed'
  | 'p2p_completed';

export type CrowdfundVoteOutcome = 'release' | 'hold' | 'retry' | 'not_cleaned';

export function crowdfundDonationWeight(input: {
  usd: number;
  heldTokenGifts: number;
  tokensPerUsd?: number;
}): number {
  const rate = input.tokensPerUsd ?? 60;
  const usd = Math.max(0, Math.floor(input.usd));
  const gifts = Math.max(0, Math.floor(input.heldTokenGifts));
  return usd * rate + gifts;
}

/**
 * Early release when approve weight is more than half of every donation.
 * At the window end, only votes cast are compared. A single no is not final.
 * A no majority may grant one re-upload. No votes or a tie is not cleaned.
 */
export function crowdfundVoteDecision(input: {
  approveWeight: number;
  rejectWeight: number;
  totalWeight: number;
  votesCast: number;
  retryCount: number;
  reuploadLimit: number;
  atWindowEnd: boolean;
}): CrowdfundVoteOutcome {
  const approveWeight = input.approveWeight;
  const rejectWeight = input.rejectWeight;
  const totalWeight = input.totalWeight;
  if (totalWeight > 0 && approveWeight * 2 > totalWeight) return 'release';
  if (!input.atWindowEnd) return 'hold';
  if (input.votesCast <= 0) return 'not_cleaned';
  if (approveWeight > rejectWeight) return 'release';
  if (rejectWeight > approveWeight && input.retryCount < input.reuploadLimit) return 'retry';
  return 'not_cleaned';
}

export function donationSettlement(input: {
  crowdfunding: boolean;
  event: DonationSettlementEvent;
}): DonationSettlement {
  if (!input.crowdfunding || input.event === 'p2p_completed') return 'off_platform';
  if (input.event === 'funding_expired') return 'not_cleaned';
  return 'hold';
}
