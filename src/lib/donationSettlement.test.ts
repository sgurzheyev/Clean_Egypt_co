/**
 * Run: npx tsx src/lib/donationSettlement.test.ts
 */
import assert from 'node:assert/strict';
import {
  DONOR_VOTE_WINDOW_HOURS,
  PROOF_REUPLOAD_LIMIT,
  crowdfundDonationWeight,
  crowdfundVoteDecision,
  donationSettlement,
} from './donationSettlement.ts';

assert.equal(DONOR_VOTE_WINDOW_HOURS, 24);
assert.equal(PROOF_REUPLOAD_LIMIT, 1);

assert.equal(crowdfundDonationWeight({ usd: 10, heldTokenGifts: 0 }), 600);
assert.equal(crowdfundDonationWeight({ usd: 0, heldTokenGifts: 120 }), 120);
assert.equal(crowdfundDonationWeight({ usd: 10, heldTokenGifts: 120 }), 720);
assert.equal(crowdfundDonationWeight({ usd: 100, heldTokenGifts: 0 }), 6000);

const base = {
  retryCount: 0,
  reuploadLimit: PROOF_REUPLOAD_LIMIT,
};

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 600,
    rejectWeight: 0,
    totalWeight: 600,
    votesCast: 1,
    atWindowEnd: false,
  }),
  'release',
  'the only donor saying yes is more than half of all donations'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 600,
    rejectWeight: 0,
    totalWeight: 1200,
    votesCast: 1,
    atWindowEnd: false,
  }),
  'hold',
  'one of two equal donors does not release early'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 0,
    rejectWeight: 600,
    totalWeight: 600,
    votesCast: 1,
    atWindowEnd: false,
  }),
  'hold',
  'one no is not final inside the window'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 100,
    rejectWeight: 0,
    totalWeight: 1000,
    votesCast: 1,
    atWindowEnd: true,
  }),
  'release',
  'at the deadline a lone yes beats no votes cast'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 0,
    rejectWeight: 0,
    totalWeight: 1000,
    votesCast: 0,
    atWindowEnd: true,
  }),
  'not_cleaned'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 200,
    rejectWeight: 400,
    totalWeight: 1000,
    votesCast: 2,
    atWindowEnd: true,
  }),
  'retry'
);

assert.equal(
  crowdfundVoteDecision({
    approveWeight: 200,
    rejectWeight: 400,
    totalWeight: 1000,
    votesCast: 2,
    retryCount: 1,
    reuploadLimit: 1,
    atWindowEnd: true,
  }),
  'not_cleaned',
  'the second no majority does not grant another upload'
);

assert.equal(
  crowdfundVoteDecision({
    ...base,
    approveWeight: 300,
    rejectWeight: 300,
    totalWeight: 1000,
    votesCast: 2,
    atWindowEnd: true,
  }),
  'not_cleaned',
  'a tie is not a majority rejection and does not release'
);

assert.equal(
  donationSettlement({ crowdfunding: true, event: 'funding_expired' }),
  'not_cleaned'
);
assert.equal(
  donationSettlement({ crowdfunding: true, event: 'status_completed' }),
  'hold'
);
assert.equal(
  donationSettlement({ crowdfunding: false, event: 'p2p_completed' }),
  'off_platform'
);

console.log('donationSettlement.test.ts ok');
