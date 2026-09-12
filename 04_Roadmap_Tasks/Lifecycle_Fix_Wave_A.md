---
title: Lifecycle Fix Wave A
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, stripe, refund, convert, wave-a, lifecycle]
aliases: [Wave A, Overfund refund, Creator-only convert, P0-3, P1-4]
---

# Lifecycle Fix — Wave A (overfund refund + reporter-only convert)

> Product close of **P0-3** and **P1-4** from the lifecycle audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · money: [[01_Architecture/Stripe_USD_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code PR:** [Clean_Egypt_co#4](https://github.com/sgurzheyev/Clean_Egypt_co/pull/4)  
**Stacked on:** [PR #3](https://github.com/sgurzheyev/Clean_Egypt_co/pull/3) (P0-1 split expiry + P0-2 first-donate wake). Retarget to `main` after P0 merges.

This note is the vault node for Wave A. It does **not** re-describe P0. P0 lives in [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] and [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8.

---

## Plain product language

Two worlds still share `missions`. Wave A only touches **Garbage Removal crowdfund / civic pins**.

### P0-3 — Loser of a last-dollar race gets the card back

Two neighbors can open Stripe Checkout for the last `$N` at the same time. The database still accepts **one** contribution (no silent clip). The loser used to pay and then sit in “manual refund ops.”

Now the platform **automatically refunds** that paid Checkout Session when apply rejects it as a permanent business error (over-budget, already funded, campaign not accepting, window expired, bad metadata, …).

- The winner’s dollar stays on the campaign.
- The loser’s card is refunded. They see a toast + a bell (`contribution_refunded`).
- Ops can see every reject-refund in `stripe_contribution_refunds` (one row per Session id).
- **Expiry with money still does not refund.** That is the eco-ultimatum / processing-fee path ([[04_Roadmap_Tasks/Garbage_History_Lifecycle]]). Wave A only refunds payments the pot **never accepted**.

Auth+capture was considered and rejected: Checkout is already `mode: payment`. Capturing after apply can credit the pot and then fail to take the money.

### P1-4 — Only the reporter can launch without paying

A free civic pin (`status = reported`) used to let **any signed-in user** tap “Set bounty / launch without paying,” set the USD target, and start a `$0` campaign on someone else’s coordinates (0 tokens).

Now:

| Who | Unpaid convert | First Stripe dollar (P0-2) |
| --- | --- | --- |
| Reporter (creator) | Yes — still optional | No (creators cannot self-fund) |
| Neighbor | **No** (button hidden; RPC rejects) | **Yes** — wakes the pin, freezes target ≥ $2 |

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] |
| Verify checklist | [[supabase/manual/20260912_wave_a_refund_convert_verify.sql]] |
| Shared Edge helper | [[supabase/functions/_shared/contributionRefund.ts]] |
| Confirm | [[supabase/functions/stripe-contribution-confirm/index.ts]] |
| Webhook | [[supabase/functions/stripe-webhook/index.ts]] |
| Briefing CTA hide | [[components/MissionBriefing.tsx]] |
| Confirm toast | [[components/MapPicker.tsx]] |
| Bell type | [[components/NotificationBell.tsx]] |
| EN / RU copy | [[src/i18n.ts]] |
| Error `refunded` flag | [[src/lib/supabaseFunctionError.ts]] |
| Client RPC comment | [[src/lib/garbageZoneReport.ts]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Refund path (confirm **and** webhook)

```
paid Checkout Session
  → apply_stripe_contribution (unchanged; still FOR UPDATE + session idempotency)
  → permanent reject?
       → claim_contribution_reject_refund
            (skip if contributions already has this session_id)
       → Stripe.refunds.create
            idempotency key: cf-reject-refund:{cs_…}
       → mark_contribution_reject_refund
       → create_notification(type = contribution_refunded)
```

Webhook: refund ok → HTTP 200 `{ applied: false, refunded: true }`. Refund Stripe/API failure → HTTP 500 so Stripe retries. Transient apply errors still 500 **without** refunding.

Confirm: 409 `contribution_rejected_refunded` (do not loop); 500 if the refund itself failed.

### Convert gate

`convert_report_to_mission` (same signature, `$2` floor) now:

```
IF v_mission.creator_id IS DISTINCT FROM auth.uid()
  THEN RAISE 'Only the report creator can convert this pin'
```

Crowd unpaid convert still enters `funding` at `$0` with a 7-day **quiet-hide** clock (P0-1). Direct mode still opens `available`. Neighbors use first-donate wake, not this RPC.

---

## Hosted apply

CLI history is messy — paste in the SQL Editor **after** P0:

1. [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (PR #3 — skip if applied)
2. [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]]
3. [[supabase/manual/20260912_wave_a_refund_convert_verify.sql]]

Redeploy Edge: `stripe-contribution-confirm`, `stripe-webhook`. Checkout Edge is unchanged.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund.

---

## Still open (not Wave A)

From [[docs/GARBAGIN_LIFECYCLE_AUDIT]] / [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8:

- P1-1 crowd `failed` is terminal
- P1-2 abandon sweep re-tenders funded crowd jobs
- P2-1 / P2-2 history window, n8n, R2 purge
- P2-3 `amount_target` USD clobber

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[01_Architecture/Stripe_USD_Flow]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[02_Frontend/Frontend_Components]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
