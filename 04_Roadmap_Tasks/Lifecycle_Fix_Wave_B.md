---
title: Lifecycle Fix Wave B
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, proof, abandon, p2p, wave-b, lifecycle]
aliases: [Wave B, Failed recovery, Crowd abandon exclude, P1-1, P1-2, P3-3]
---

# Lifecycle Fix — Wave B (`failed` retry + no silent crowd abandon + P2P confirm RPC)

> Product close of **P1-1**, **P1-2**, and **P3-3** from the lifecycle audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · P2P: [[01_Architecture/P2P_Deal_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · money: [[01_Architecture/Stripe_USD_Flow]] · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code PR:** stacked on [Clean_Egypt_co#4](https://github.com/sgurzheyev/Clean_Egypt_co/pull/4) (Wave A on P0). Retarget to `main` after P0 / Wave A merge.

This note is the vault node for Wave B. It does **not** re-describe P0 or Wave A.

P0 lives in [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (the `01_Architecture/P0_Split_Expiry_First_Donate` note is not in this checkout — P0 canon is [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8).  
Wave A lives in [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]].

---

## Plain product language

Two worlds still share `missions`. Wave B touches **crowdfunding proof / abandon** and restores the **P2P “work done”** RPC that greenfield databases were missing.

### P1-1 — A donor “no” is a revision request, not a funeral

Today the first donor who votes **no** on a funded video sets `status = failed` forever. The cleaner cannot re-upload. The pot is not refunded. Gov Notice does not fire. The job dies with money sitting on it.

**Chosen rule (safer + product-consistent):** treat donor reject like P2P `creator_reject_proof`.

| Vote | What happens |
| --- | --- |
| First **approve** | `awaiting_approval` → `approved` (same as before). 24h silence still auto-approves. |
| First **reject** | `awaiting_approval` → `in_progress`. Cleaner **stays locked**. Proof media is cleared. `retry_count` + 1. Cleaner gets a bell. Same donor can vote on the **next** video. |
| Already-`failed` crowd jobs with a cleaner | One-time backfill → `in_progress` (same recoverable shape). |

**Why not a real quorum?** Quorum-to-fail is still a dead end: no card refund, no Gov Notice, and donors already under-vote (that is why `auto_approve_escrow_proofs` exists). First-no-wins is too sharp for a paid pot. First-yes-wins for *completion* is fine — that is someone saying the street is clean. First-no must be “fix it,” not “kill it.”

The Stripe pot is **not** refunded on reject. Work is still owed. Eco-ultimatum / Wave A overfund refunds are a different door.

### P1-2 — Do not silently re-tender a funded crowd job

`process_abandoned_missions` used to sweep **every** `in_progress` idle 24h, including crowdfunding. That cleared `cleaner_id` and set `available` — undoing “cleaner locked after the pot filled.”

**Chosen rule:** the 24h abandon sweep is **P2P only**. Crowdfunding `in_progress` is excluded. An explicit donor-notified re-tender (if a cleaner ghosts a full pot) is a later wave — do not ship a silent undo.

### P3-3 — Greenfield can close P2P

[[components/Profile.tsx]] still calls `confirm_mission_work_done`. That function (and `confirm_mission_direct_payment`) only lived under `supabase/migrations/archive/`. New databases could not close a reviewed P2P job.

Both RPCs are recreated in the active tree with the archived security/behavior: creator-only, `review` / `pending_approval` → `completed`, no wallet move.

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]] |
| Verify checklist | [[supabase/manual/20260912_wave_b_verify.sql]] |
| Donor vote copy | [[components/DonorProofReview.tsx]] · [[src/lib/escrowProofVotes.ts]] |
| EN / RU | [[src/i18n.ts]] |
| Profile confirm (unchanged call) | [[components/Profile.tsx]] → `confirm_mission_work_done` |
| Archived originals (do not apply) | [[supabase/migrations/archive/20260614_confirm_mission_direct_payment.sql]] · [[supabase/migrations/archive/20260615_admin_delete_mission.sql]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Donor reject path

```
awaiting_approval + donor votes no
  → FOR UPDATE mission
  → delete mission_proof_votes (new proof = new vote window)
  → status = in_progress
  → clear proof media / GPS / report_submitted_at
  → rejection_reason + retry_count++
  → create_notification(cleaner, proof_rejected)
  → return { status: in_progress }
```

Approve path is unchanged (first yes → `approved` + vote row + cleaner bell).

### Abandon sweep

```
process_abandoned_missions
  WHERE status = in_progress
    AND crowdfunding_mode = false    -- P1-2
    AND status_changed_at < now() - 24h
  → available, cleaner_id = NULL
```

---

## Hosted apply

CLI history is messy — paste in the SQL Editor **after** Wave A:

1. [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (PR #3 — skip if applied)
2. [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] (PR #4 — skip if applied)
3. [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]]
4. [[supabase/manual/20260912_wave_b_verify.sql]]

No Edge redeploy. Client copy ships with the app.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain (expiry with money still has no card refund) · P2P 24h abandon still runs · 24h crowd auto-approve still runs · first-yes still closes.

---

## Still open (Wave D — not this PR)

From [[docs/GARBAGIN_LIFECYCLE_AUDIT]] / [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8:

- ~~P2-3 `amount_target` USD clobber~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- ~~P2-1 / P2-2 history window, n8n, R2 purge~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- ~~P2-4 Profile lists drop `approved`~~ — Wave C
- Explicit crowd re-tender if a locked cleaner ghosts a full pot (notify donors — do not revive silent abandon)

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
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
