/**
 * Crowdfund donation release rules. The SQL in
 * supabase/migrations/20260927170000_donor_vote_release.sql is authoritative.
 *
 * Regular missions never enter this table: the client pays the worker
 * off-platform, and status=completed moves no platform-held money.
 */
export const DONOR_VOTE_DEADLINE_HOURS = 24;

export type DonationSettlement =
  | 'release_to_worker'
  | 'not_cleaned'
  | 'hold'
  | 'off_platform';

export type DonationSettlementEvent =
  | 'donor_approved'
  | 'donor_rejected'
  | 'vote_deadline'
  | 'funding_expired'
  | 'status_completed'
  | 'p2p_completed';

export function donationSettlement(input: {
  crowdfunding: boolean;
  event: DonationSettlementEvent;
}): DonationSettlement {
  if (!input.crowdfunding || input.event === 'p2p_completed') return 'off_platform';
  if (input.event === 'donor_approved') return 'release_to_worker';
  if (
    input.event === 'donor_rejected' ||
    input.event === 'vote_deadline' ||
    input.event === 'funding_expired'
  ) {
    return 'not_cleaned';
  }
  return 'hold';
}
