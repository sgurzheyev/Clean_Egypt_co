# Stripe USD Flow

> All fiat rails are **USD** (cents on Stripe, whole dollars in Postgres). Links: [[🗺️ GARBAGIN Master Index]], [[01_Architecture/Architecture_Overview]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/P2P_Deal_Flow]], [[01_Architecture/KYC_Verification]], [[01_Architecture/P0_Split_Expiry_First_Donate]].

## Crowdfunding contributions

1. Client → `startContributionCheckout` ([[../src/lib/contributions.ts]])
2. Edge → [[../supabase/functions/stripe-contribution-checkout/index.ts]] (Checkout Session, `currency: usd`)
3. Redirect back to `https://garbagin.com/…` with `cf_contribution=1&session_id=…` (client builds success/cancel via `getAppOrigin()` / `VITE_APP_ORIGIN`)
4. Edge → [[../supabase/functions/stripe-contribution-confirm/index.ts]] (browser confirm)
5. **Also** Edge → [[../supabase/functions/stripe-webhook/index.ts]] on `checkout.session.completed` (server-side safety net if the user closes the tab)
6. RPC `apply_stripe_contribution` (service_role) inserts `contributions.amount_usd` + `stripe_checkout_session_id`, bumps `missions.current_funding` — **idempotent** so confirm + webhook never double-credit. Optional `p_target_usd` wakes a `reported` pin (P0-2 — [[P0_Split_Expiry_First_Donate]]).
7. If `current_funding >= expected_price` → `in_progress` when a cleaner is already locked, else `available` (open for bids)

Webhook requires `STRIPE_WEBHOOK_SECRET` and `verify_jwt = false` (see `supabase/config.toml`).

### Schema notes

- Column: `contributions.amount_usd` (not EGP) — [[../supabase/migrations/20260720_drop_contributions_amount_egp.sql]]
- Idempotency: `stripe_checkout_session_id` — [[../supabase/migrations/20260720_add_contributions_stripe_session_id.sql]]
- Client free-path revoked: [[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]

## Expiry (street / garbage campaigns)

P0 split (2026-09-12): [[P0_Split_Expiry_First_Donate]] · SQL [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]].

- Column: `missions.crowdfunding_expires_at`
  - Free civic pin: `now()/created_at + 7 days` (quiet hide clock)
  - Live campaign: +7d at create/convert; `GREATEST(expires, now()+30d)` after any successful Stripe contribution
- Sweep: `process_expired_crowdfunding_missions()`
  - **raised = $0** (`reported` or `funding`) → `status = hidden`, **no** `city_notification_events`
  - **0 < raised < target** → `status = expired` + `crowdfunding_expired` Gov Notice
- Cron / stub: [[../api/process-expired-crowdfunding.ts]] (placeholder only), PDF helper [[../src/lib/cityNotification.ts]]
- UI countdown: [[../components/MissionBriefing.tsx]] via [[../src/lib/crowdfunding.ts]]
- First dollar on a `reported` pin: checkout accepts the report; apply freezes `target_usd` (≥ $2) and starts the campaign — no unpaid convert required

Funds on expiry are **not** card-refunded; municipal notification path runs **only** when money was raised ([[../.cursorrules]], [[P2P_Deal_Flow]] contrast). Full eco-ultimatum / Garbage History pipeline: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]].

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

[[01_Architecture/Architecture_Overview]] · [[04_Roadmap_Tasks/00_Dashboard]] · [[01_Architecture/Security_and_RPCs]] · [[01_Architecture/P0_Split_Expiry_First_Donate]] · [[🗺️ GARBAGIN Master Index]]
