/**
 * Run: npx tsx src/lib/closedEconomy.test.ts
 */
import assert from 'node:assert/strict';
import { TOKEN_TOPUP_TIERS } from './tokenPricing.ts';
import {
  CLOSED_ECONOMY_DEFAULTS,
  stripeExpiryBonusTokens,
  stripeExpiryTokensPerUsd,
  tokenExpiryRefundTokens,
} from './closedEconomy.ts';

const top = TOKEN_TOPUP_TIERS[TOKEN_TOPUP_TIERS.length - 1];
assert.equal(top.usd, 99);
assert.equal(top.tokens, 5000);
assert.equal(top.cents, 9900);

const fromSlider = {
  anchorUsd: top.usd,
  anchorTokens: top.tokens,
  stripeBonusPercent: 20,
  tokenRefundBonusPercent: 20,
};

assert.equal(stripeExpiryTokensPerUsd(fromSlider), 60);
assert.equal(stripeExpiryBonusTokens(100, fromSlider), 6000);
assert.equal(stripeExpiryBonusTokens(99, fromSlider), 5940);
assert.equal(stripeExpiryBonusTokens(1, fromSlider), 60);
assert.equal(stripeExpiryBonusTokens(10), 600);
assert.equal(stripeExpiryBonusTokens(0), 0);
assert.equal(stripeExpiryBonusTokens(-5), 0);

assert.equal(tokenExpiryRefundTokens(100), 120);
assert.equal(tokenExpiryRefundTokens(25), 30);
assert.equal(tokenExpiryRefundTokens(10), 12);
assert.equal(tokenExpiryRefundTokens(5), 6);
assert.equal(tokenExpiryRefundTokens(1), 1);
assert.equal(tokenExpiryRefundTokens(0), 0);

assert.equal(
  stripeExpiryBonusTokens(100, { ...CLOSED_ECONOMY_DEFAULTS, stripeBonusPercent: 0 }),
  5000
);

console.log('closedEconomy.test.ts ok');
