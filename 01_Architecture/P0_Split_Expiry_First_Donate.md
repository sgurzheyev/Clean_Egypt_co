---
title: P0 Split Expiry + First-Donate Wake
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, p0, expiry, stripe, civic-pin]
aliases: [P0 Split Expiry, First-Donate Wake, Quiet Hide, P0-1, P0-2]
---

# P0 — Split expiry + first Stripe dollar wakes a report

> Shipped 2026-09-12 (PR #3). Canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · money: [[01_Architecture/Stripe_USD_Flow]] · hub: [[🗺️ GARBAGIN Master Index]] · field: [[04_Roadmap_Tasks/00_Dashboard]]  
> Audit context (read-only): PR #2 / `docs/GARBAGIN_LIFECYCLE_AUDIT.md` on `cursor/lifecycle-audit-50f5`.

This note is the vault record for **fix wave P0**. It does not reopen later waves (n8n, `history_public_until`, R2 purge, overfund refund).

**Apply on hosted Supabase:** paste [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] into the SQL Editor (CLI migration history is out of sync). Checklist: [[../supabase/manual/20260912_p0_expiry_first_donate_verify.sql]]. Redeploy contribution Edge functions after apply.

---

## P0-1 — Split crowdfunding expiry

`process_expired_crowdfunding_missions` (latest body in the P0 migration; previously [[../supabase/migrations/20260722_stabilize_crowdfunding_proof_concurrency.sql]]) now has two exits. Still `FOR UPDATE SKIP LOCKED`.

| Condition | Result |
| --- | --- |
| `reported` **or** `funding`, **raised = $0**, past expiry | `status = hidden`. **No** `city_notification_events` / Gov PDF. |
| `funding`, **0 < raised < target**, past expiry | `expired` + `crowdfunding_expired` (eco-ultimatum unchanged). |

Free civic pins get a 7-day **quiet hide** clock, not a Gov-Notice clock:

- `create_garbage_zone_report` stamps `crowdfunding_expires_at = now() + 7 days` ([[../supabase/migrations/20260826_video_proof_url_and_starter_tokens.sql]] signature kept; body replaced in the P0 file).
- Existing `$0` reports with a NULL clock are backfilled to `created_at + 7d`.

Public map / Live Market / profile marketplace lists do not treat `hidden` (or `archived`) as public: [[../components/MapPicker.tsx]], [[../components/LiveMarketFeed.tsx]], [[../components/Profile.tsx]].

Unpaid `convert_report_to_mission` may still enter `funding` at $0 for 7 days ([[../supabase/migrations/20260909_min_work_budget_2_usd.sql]]). After P0-1 that window can only **hide** — it cannot queue Gov Notice.

---

## P0-2 — First Stripe dollar wakes a `reported` pin

Preferred on-ramp is **paid**, not unpaid convert.

**Target source** (first match wins):

1. Draft `missions.expected_price` when already ≥ **$2** (floor from [[../supabase/migrations/20260909_min_work_budget_2_usd.sql]] / `CITY_MIN_PRICE`).
2. Checkout body + Stripe metadata `target_usd` (convert-at-checkout on the report briefing).

Atomic apply under the same session lock as live campaigns:

- `is_report = false`
- `crowdfunding_mode = true`
- freeze `expected_price`
- credit `current_funding`
- `GREATEST(crowdfunding_expires_at, now() + 30 days)`
- `funding`, or `available` / `in_progress` if the first payment already fills the pot

`apply_stripe_contribution(mission, contributor, amount, session_id, p_target_usd DEFAULT NULL)` — 4-arg callers still work. **service_role only.** Idempotent on `stripe_checkout_session_id`.

Checkout Edge accepts `status = reported` (garbage service, not hidden, civic window open). Creator still cannot self-fund.

---

## Code map

| Layer | Path |
| --- | --- |
| SQL (apply this) | [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] |
| Verify (SQL Editor) | [[../supabase/manual/20260912_p0_expiry_first_donate_verify.sql]] |
| Prior apply / +30d | [[../supabase/migrations/20260724_restore_crowdfunding_contribution_timer_bump.sql]] |
| Prior expiry sweep | [[../supabase/migrations/20260722_stabilize_crowdfunding_proof_concurrency.sql]] |
| Report create (pre-P0 body) | [[../supabase/migrations/20260826_video_proof_url_and_starter_tokens.sql]] |
| Unpaid convert (still exists) | [[../supabase/migrations/20260909_min_work_budget_2_usd.sql]] |
| Checkout | [[../supabase/functions/stripe-contribution-checkout/index.ts]] |
| Confirm / webhook | [[../supabase/functions/stripe-contribution-confirm/index.ts]], [[../supabase/functions/stripe-webhook/index.ts]] |
| Client checkout | [[../src/lib/contributions.ts]] |
| Helpers | [[../src/lib/crowdfunding.ts]] (`isReportFirstDonateOpen`, `resolveCampaignTargetUsd`) |
| Briefing / map | [[../components/MissionBriefing.tsx]], [[../components/MapPicker.tsx]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

Do not break: Stripe session idempotency, Hungry-Games phone lock (crowd phone always NULL), 1 token / new bid, funding-visible-with-cleaner + violet callout, rolling +30d.

---

## Still open (not this wave)

n8n eco-ultimatum webhook · `history_public_until` + R2 purge · overfund auto-refund · `amount_target` USD clobber — see [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8–9.

[[01_Architecture/Architecture_Overview]] · [[01_Architecture/Security_and_RPCs]] · [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
