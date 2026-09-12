---
tags: [architecture, stripe, usd, crowdfunding]
aliases: [Stripe USD Flow, Crowdfunding money]
---

# Stripe USD Flow

> All fiat rails are **USD** (cents on Stripe, whole dollars in Postgres). Links: [[🗺️ GARBAGIN Master Index]], [[01_Architecture/Architecture_Overview]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/P2P_Deal_Flow]], [[01_Architecture/KYC_Verification]], [[04_Roadmap_Tasks/Garbage_History_Lifecycle]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[docs/GARBAGIN_LIFECYCLE_AUDIT]].

## Crowdfunding contributions

1. Client → `startContributionCheckout` ([[../src/lib/contributions.ts]])
2. Edge → [[../supabase/functions/stripe-contribution-checkout/index.ts]] (Checkout Session, `currency: usd`)
3. Redirect back to `https://garbagin.com/…` with `cf_contribution=1&session_id=…` (client builds success/cancel via `getAppOrigin()` / `VITE_APP_ORIGIN`)
4. Edge → [[../supabase/functions/stripe-contribution-confirm/index.ts]] (browser confirm)
5. **Also** Edge → [[../supabase/functions/stripe-webhook/index.ts]] on `checkout.session.completed` (server-side safety net if the user closes the tab)
6. RPC `apply_stripe_contribution` (service_role) inserts `contributions.amount_usd` + `stripe_checkout_session_id`, bumps `missions.current_funding` — **idempotent** so confirm + webhook never double-credit. Optional `p_target_usd` wakes a `reported` pin (P0-2).
7. If `current_funding >= expected_price` → `in_progress` when a cleaner is already locked, else `available` (open for bids). A later donor **reject** on the proof video does **not** refund the pot — it sends work back to `in_progress` ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]). Funded crowd jobs are not silently abandoned after 24h.
8. **P0-3 reject-refund:** if apply permanently rejects a *paid* Session (over-budget / not accepting / expired / …), confirm + webhook auto-create a Stripe refund. Ledger: `stripe_contribution_refunds`. Helper: [[../supabase/functions/_shared/contributionRefund.ts]]. Never refund a session that already has a `contributions` row. Product note: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]].

Webhook requires `STRIPE_WEBHOOK_SECRET` and `verify_jwt = false` (see `supabase/config.toml`).

### Schema notes

- Column: `contributions.amount_usd` (not EGP) — [[../supabase/migrations/20260720_drop_contributions_amount_egp.sql]]
- Idempotency: `stripe_checkout_session_id` — [[../supabase/migrations/20260720_add_contributions_stripe_session_id.sql]]
- Client free-path revoked: [[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]

## Expiry (street / garbage campaigns)

- Column: `missions.crowdfunding_expires_at` (set on create, default **7 days**)
- Sweep: `process_expired_crowdfunding_missions()` (P0-1): `$0` → `hidden` (no city event); `0 < raised < target` → `status = expired` + `city_notification_events`
- Cron / stub: [[../api/process-expired-crowdfunding.ts]], PDF helper [[../src/lib/cityNotification.ts]]
- UI countdown: [[../components/MissionBriefing.tsx]] via [[../src/lib/crowdfunding.ts]]

Funds on **expiry with money raised** are **not** card-refunded; municipal notification path ([[../.cursorrules]], [[P2P_Deal_Flow]] contrast). That is different from P0-3: a Checkout the pot **never accepted** is refunded. Full eco-ultimatum / Garbage History pipeline: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]].

## Tokens & subscriptions

| Flow | Edge |
| --- | --- |
| Token pack intent / credit | [[../supabase/functions/stripe-token-intent/index.ts]], [[../supabase/functions/stripe-token-credit/index.ts]] |
| Yearly subscription | [[../supabase/functions/stripe-subscription-intent/index.ts]], [[../supabase/functions/stripe-subscription-activate/index.ts]] |
| Wallet top-up | [[../supabase/functions/stripe-intent/index.ts]], [[../supabase/functions/stripe-wallet-credit/index.ts]] |

UI: [[../src/components/TokenPackModal.tsx]], pricing [[../src/lib/tokenPricing.ts]].

## Error visibility

Confirm failures return `{ error }` JSON; client parses via [[../src/lib/supabaseFunctionError.ts]] + auth token hydration [[../src/lib/supabaseAuth.ts]]. Permanent reject after pay returns `code: contribution_rejected_refunded` and `refunded: true` (toast in [[../components/MapPicker.tsx]]).

## Hub

Campaign USD is `expected_price` / `current_funding`. `amount_target` is token listing rank and must not store dollars ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]).

[[01_Architecture/Architecture_Overview]] · [[04_Roadmap_Tasks/00_Dashboard]] · [[01_Architecture/Security_and_RPCs]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · [[🗺️ GARBAGIN Master Index]]
