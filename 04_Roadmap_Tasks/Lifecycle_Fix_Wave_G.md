---
title: Lifecycle Fix Wave G
type: architecture
status: shipped
updated: 2026-09-17
tags: [garbagin, crowdfunding, bids, expiry, wave-g, lifecycle]
aliases: [Wave G, LIFE-1, LIFE-2, LIFE-3, accept underfund, reject_mission_bid]
---

# Lifecycle Fix — Wave G (underfund accept + reject RPC + expiry unlock)

> Lifecycle close of **LIFE-1**, **LIFE-2**, and **LIFE-3** from the post–Wave E E2E audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · P2P: [[01_Architecture/P2P_Deal_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · money: [[01_Architecture/Stripe_USD_Flow]] · audit: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code:** already on `main` as [`cbf5c62`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/cbf5c62) / merge [`05d1dd7`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/05d1dd7) (author Sergio Gurgini). This vault note is hygiene only — SQL is live.

This note is the vault node for Wave G. It does **not** re-describe P0, Waves A–E, or Wave F.

Hungry-Games **subscription** gate (active sub + 1 token / new bid, MapPicker modal) shipped on the same commit — documented on [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]], not here.

---

## Plain product language

Two worlds still share `missions`. Wave G only tightens **crowdfunding accept / decline / expiry**.

### LIFE-1 — Do not start work on an underfunded crowd pin

After a 100% raise with no cleaner, `apply_stripe_contribution` sets `status = available`. Creator could then accept a bid **above** `current_funding`. Old `accept_mission_bid` only stayed in `funding` when the **status string** was already `funding`. On `available` it always wrote `in_progress`.

**.cursorrules** expected: stay (or re-enter) `funding` until raised ≥ accepted bid; only then `in_progress`.

**Chosen gate:** `crowdfunding_mode AND raised < budget` — ignore the previous status string.

| Crowd pin | After accept |
| --- | --- |
| Raised < accepted USD | `cleaner_id` locked, `expected_price` = bid, **`status = funding`** (violet “Needs $X more” still on the feed) |
| Raised ≥ accepted USD, or P2P | `in_progress` + `started_at` |

Token rank (`amount_target`) stays untouched (Wave C). Funding-with-cleaner stays visible.

### LIFE-2 — Creator can decline a pending bid on a fresh database

`reject_mission_bid` lived only under `supabase/migrations/archive/`. Greenfield apply had accept but a fragile decline path.

Promoted to the active tree: creator-only, pending → `rejected`, SECURITY DEFINER. Client: [[src/lib/missionBids.ts]] `rejectMissionBid`.

### LIFE-3 — Expiry must not strand a locked cleaner

Underfunded expiry used to keep `cleaner_id` on `expired` / `hidden`. The worker stayed assigned to a pot that will never start.

Now `process_expired_crowdfunding_missions`:

- `$0` → `hidden`, **`cleaner_id = NULL`**, pending+accepted bids → `rejected` (P0-1 quiet hide unchanged: no Gov Notice)
- `0 < raised < target` → `expired` + 7-day history + city queue, **`cleaner_id = NULL`**, bids rejected
- One-time backfill: already `expired` / `hidden` / `archived` rows drop `cleaner_id` and reject leftover pending/accepted bids

Funded crowd (`raised ≥ target`) is not expired by this sweep. 24h abandon remains P2P-only (Wave B).

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]] |
| Decline client | [[src/lib/missionBids.ts]] (`rejectMissionBid`) |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Accept path (LIFE-1)

```
accept_mission_bid
  → creator + pending bid + status in available|pending|open|funding
  → crowdfunding_mode AND raised < accepted USD
       → status = funding, expected_price = bid, cleaner locked
  → else
       → status = in_progress, started_at, cleaner locked
  → amount_target untouched
```

### Expiry path (LIFE-3)

```
funding + timer elapsed
  raised = 0     → hidden, cleaner_id NULL, bids rejected, no city event
  0 < raised < target
                 → expired, cleaner_id NULL, bids rejected
                 → history_public_until = now()+7d
                 → city_notification_events (crowdfunding_expired)
```

---

## Hosted apply

Live already has the underfund gate, reject RPC, and expiry unlock. CLI may still show `20260917_*` as **Local-only** — [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] (`repair --status applied 20260917`, never `db push`).

Paste **after** Wave F (full order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]):

1. [[supabase/migrations/20260917_wave_f_security_hardening.sql]] (skip if applied)
2. [[supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]]
3. Wave H + Hungry-Games

Expiry RPC is the same name as P0/Wave D; this file `CREATE OR REPLACE`s it. No Edge redeploy for Wave G SQL. Client `rejectMissionBid` ships with the app.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain (expiry with money still has **no** card refund) · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE · Wave D 7-day history / R2 purge / gated n8n · `$0` quiet hide · Wave F admin allowlist + mission column freeze (DEFINER expiry still clears `cleaner_id`).

---

## Still open (not this wave)

- Hungry-Games **subscription** (same commit) — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- **SEC-4** Vercel `/api/*` unauthenticated
- Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET`
- CLI repair for `20260917_*`
- Explicit crowd re-tender if a locked cleaner ghosts a **full** pot (notify donors — do not revive silent abandon). LIFE-3 only unlocks **underfunded expiry**.

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[01_Architecture/Stripe_USD_Flow]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[02_Frontend/Frontend_Components]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
