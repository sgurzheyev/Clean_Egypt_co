---
title: Lifecycle Fix Wave C
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, amount-target, profile, rls, wave-c, lifecycle]
aliases: [Wave C, amount_target rank, Profile approved, Funded delete lock, P2-3, P2-4, P3-4]
---

# Lifecycle Fix — Wave C (token rank ≠ USD + Profile `approved` + funded DELETE lock)

> Product close of **P2-3**, **P2-4**, and **P3-4** from the lifecycle audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · money: [[01_Architecture/Stripe_USD_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · P2P: [[01_Architecture/P2P_Deal_Flow]] · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code PR:** [Clean_Egypt_co#6](https://github.com/sgurzheyev/Clean_Egypt_co/pull/6) stacked on [Clean_Egypt_co#5](https://github.com/sgurzheyev/Clean_Egypt_co/pull/5) (Wave B). Retarget to `main` after P0 / Wave A / Wave B merge.

This note is the vault node for Wave C. It does **not** re-describe P0, Wave A, or Wave B.

P0 lives in [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8).  
Wave A lives in [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]].  
Wave B lives in [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]].

---

## Plain product language

Two worlds still share `missions`. Wave C only un-mixes **token listing rank** from **USD**, shows crowd **success** on Profile, and stops a creator from **API-deleting a pot**.

### P2-3 — A $50 campaign must not outrank a 1-token pin

`amount_target` is token-boost / map sort. `expected_price` (and bid `bid_amount`) is USD.

`convert_report_to_mission` and `accept_mission_bid` used to write the USD price into `amount_target`. A $50 unpaid convert then sat above every 1-token broom on the map and Live Market.

| Field | Meaning |
| --- | --- |
| `amount_target` | Token pin / boost (usually **1**) |
| `expected_price` | USD work budget / crowd goal |
| `bid_amount` / packages | Worker USD offer |

Convert now sets rank **1** and keeps the dollar in `expected_price`. Accept bumps `expected_price` only. First-donate wake (P0-2) already left rank alone (reports stay **0** until someone pays a token pin).

**Backfill (safe, idempotent):** if `amount_target` equals `expected_price` and that value is ≥ $2, reset rank to 1. If a legacy row still has fiat only in `amount_target` (≥ 100, `expected_price` empty), copy USD into `expected_price` then reset rank. Rare collision: a genuine N-token boost on a $N mission (N≥2) would also reset to 1.

### P2-4 — Crowd success belongs in History

Worker fetch + History only asked for `completed` / `finished`. Crowd proof close writes **`approved`**, so a finished street job vanished from Orders/History for the cleaner.

| Surface | Statuses |
| --- | --- |
| Worker **active** (Orders) | `in_progress`, `review`, `pending_approval`, **`awaiting_approval`** |
| History (creator or cleaner) | `completed`, `finished`, **`approved`**, **`failed`** |

`approved` is success → History (same as P2P `completed`). `awaiting_approval` is still work → Orders. `failed` is rare/legacy after Wave B retry (donor reject no longer writes it); leftover rows without a cleaner stay visible in History.

### P3-4 — Creator cannot DELETE a funded row

RLS still allowed `DELETE` when `creator_id = auth.uid()`, including Stripe-funded campaigns. The Profile button is mostly unwired; the API was not.

Now:

- Helper `mission_has_retained_funds` — `current_funding > 0` **or** any `contributions` row.
- RLS DELETE: creator only when **not** retained; `is_platform_admin` unchanged.
- RPC `creator_delete_mission` — same gate, clear error. Admins stay on `admin_delete_mission`.

`$0` unpaid convert and P2P with no pot remain deletable. Eco-ultimatum `expired` with money is **not**.

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]] |
| Verify checklist | [[supabase/manual/20260912_wave_c_verify.sql]] |
| Profile lists + history badges | [[components/Profile.tsx]] · [[src/lib/platformAdmin.ts]] |
| Creator delete client | [[src/lib/creatorDeleteMission.ts]] |
| Optimistic accept / bid default | [[components/MapPicker.tsx]] |
| Remaining-$ helper | [[src/lib/crowdfunding.ts]] · [[src/lib/missionBudget.ts]] |
| EN / RU / AR / DE / IT / ES | [[src/i18n.ts]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Convert / accept

```
convert_report_to_mission
  → expected_price = USD (≥ $2)
  → amount_target = 1
  → Wave A creator gate + P0-1 7d quiet-hide unchanged

accept_mission_bid
  → expected_price = accepted USD
  → amount_target untouched
  → funding-with-cleaner / in_progress rules unchanged
```

### Funded DELETE

```
authenticated DELETE missions
  → admin? allow
  → creator AND NOT mission_has_retained_funds? allow
  → else 0 rows (RLS)

creator_delete_mission
  → RAISE 'Cannot delete a mission that has received funds'
```

No BEFORE DELETE trigger — `admin_delete_mission` clears `contributions` first and must keep working.

---

## Hosted apply

CLI history is messy — paste in the SQL Editor **after** Wave B:

1. [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (PR #3 — skip if applied)
2. [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] (PR #4 — skip if applied)
3. [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]] (PR #5 — skip if applied)
4. [[supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]]
5. [[supabase/manual/20260912_wave_c_verify.sql]]

No Edge redeploy. Client ships with the app.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · admin `admin_delete_mission` on funded rows.

---

## Still open (Wave D — not this PR)

From [[docs/GARBAGIN_LIFECYCLE_AUDIT]] / [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8:

- P2-1 / P2-2 `history_public_until`, n8n, R2 purge
- Feed/map: show `expired` only until history window
- Explicit crowd re-tender if a locked cleaner ghosts a full pot (notify donors — do not revive silent abandon)

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
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
