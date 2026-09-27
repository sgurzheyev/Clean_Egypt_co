/**
 * Run: npx tsx src/lib/twaContext.test.ts
 */
import assert from 'node:assert/strict';
import { TWA_REFERRER_PREFIX, twaSignalFrom } from './twaContext.ts';
import {
  STRIPE_ENTRY_POINTS,
  stripeRailBlockedInTwa,
} from './stripeEntryPoints.ts';

assert.equal(
  twaSignalFrom({ referrer: TWA_REFERRER_PREFIX }).active,
  true
);
assert.equal(
  twaSignalFrom({ referrer: `${TWA_REFERRER_PREFIX}/` }).shouldPersist,
  true
);
assert.equal(
  twaSignalFrom({ referrer: `${TWA_REFERRER_PREFIX}?ref=1` }).active,
  true
);
assert.equal(
  twaSignalFrom({ referrer: `${TWA_REFERRER_PREFIX}#top` }).active,
  true
);
assert.equal(
  twaSignalFrom({ referrer: 'android-app://com.other.app' }).active,
  false
);
assert.equal(
  twaSignalFrom({ referrer: 'android-app://com.garbagin.app.fake' }).active,
  false
);
assert.equal(twaSignalFrom({ search: '?twa=1' }).active, true);
assert.equal(twaSignalFrom({ search: '?mission=abc&twa=1' }).shouldPersist, true);
assert.equal(twaSignalFrom({ search: '?twa=0', stored: false }).active, false);
assert.equal(twaSignalFrom({ stored: true }).active, true);
assert.equal(twaSignalFrom({ stored: true }).shouldPersist, false);
assert.equal(twaSignalFrom({}).active, false);

const blocked = STRIPE_ENTRY_POINTS.filter((row) => stripeRailBlockedInTwa(row.rail));
assert.ok(blocked.some((row) => row.id === 'stripe-token-intent'));
assert.ok(blocked.some((row) => row.id === 'stripe-subscription-intent'));
assert.ok(blocked.some((row) => row.id === 'stripe-contribution-checkout'));
assert.equal(
  STRIPE_ENTRY_POINTS.some((row) => row.rail === 'physical_service'),
  false
);
assert.ok(STRIPE_ENTRY_POINTS.some((row) => row.id === 'verify-job-payment'));
assert.equal(stripeRailBlockedInTwa('legacy_unused'), false);

console.log('twaContext.test.ts ok');
