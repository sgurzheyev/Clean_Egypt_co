/**
 * Run: npx tsx src/lib/donationSettlement.test.ts
 */
import assert from 'node:assert/strict';
import {
  DONOR_VOTE_DEADLINE_HOURS,
  donationSettlement,
} from './donationSettlement.ts';

assert.equal(DONOR_VOTE_DEADLINE_HOURS, 24);

assert.equal(
  donationSettlement({ crowdfunding: true, event: 'donor_approved' }),
  'release_to_worker'
);
assert.equal(
  donationSettlement({ crowdfunding: true, event: 'donor_rejected' }),
  'not_cleaned'
);
assert.equal(
  donationSettlement({ crowdfunding: true, event: 'vote_deadline' }),
  'not_cleaned'
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
assert.equal(
  donationSettlement({ crowdfunding: false, event: 'donor_approved' }),
  'off_platform'
);

console.log('donationSettlement.test.ts ok');
