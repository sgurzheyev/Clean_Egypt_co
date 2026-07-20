# Stripe USD Flow

> All fiat rails are **USD** (cents on Stripe, whole dollars in Postgres). Links: [[Architecture_Overview]], [[Security_and_RPCs]], [[P2P_Deal_Flow]], [[KYC_Verification]].

## Crowdfunding contributions

1. Client → `startContributionCheckout` ([[../src/lib/contributions.ts]])
2. Edge → [[../supabase/functions/stripe-contribution-checkout/index.ts]] (Checkout Session, `currency: usd`)
3. Redirect back with `cf_contribution=1&session_id=…`
4. Edge → [[../supabase/functions/stripe-contribution-confirm/index.ts]]
5. RPC `apply_stripe_contribution` (service_role) inserts `contributions.amount_usd` + `stripe_checkout_session_id`, bumps `missions.current_funding`
6. If `current_funding >= expected_price` → status `available` (open for bids)

### Schema notes

- Column: `contributions.amount_usd` (not EGP) — [[../supabase/migrations/20260720_drop_contributions_amount_egp.sql]]
- Idempotency: `stripe_checkout_session_id` — [[../supabase/migrations/20260720_add_contributions_stripe_session_id.sql]]
- Client free-path revoked: [[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]

## Expiry (street / garbage campaigns)

- Column: `missions.crowdfunding_expires_at` (set on create, default **7 days**)
- Sweep: `process_expired_crowdfunding_missions()` → `status = expired` + row in `city_notification_events`
- Cron / stub: [[../api/process-expired-crowdfunding.ts]], PDF helper [[../src/lib/cityNotification.ts]]
- UI countdown: [[../components/MissionBriefing.tsx]] via [[../src/lib/crowdfunding.ts]]

Funds on expiry are **not** card-refunded; municipal notification path ([[../.cursorrules]], [[P2P_Deal_Flow]] contrast).

## Tokens & subscriptions

| Flow | Edge |
| --- | --- |
| Token pack intent / credit | [[../supabase/functions/stripe-token-intent/index.ts]], [[../supabase/functions/stripe-token-credit/index.ts]] |
| Yearly subscription | [[../supabase/functions/stripe-subscription-intent/index.ts]], [[../supabase/functions/stripe-subscription-activate/index.ts]] |
| Wallet top-up | [[../supabase/functions/stripe-intent/index.ts]], [[../supabase/functions/stripe-wallet-credit/index.ts]] |

UI: [[../src/components/TokenPackModal.tsx]], pricing [[../src/lib/tokenPricing.ts]].

## Error visibility

Confirm failures return `{ error }` JSON; client parses via [[../src/lib/supabaseFunctionError.ts]] + auth token hydration [[../src/lib/supabaseAuth.ts]].

## Hub

[[Architecture_Overview]] · [[../00_Dashboard]] · [[Security_and_RPCs]]
