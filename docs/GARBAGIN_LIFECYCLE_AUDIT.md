---
title: Garbagin Lifecycle Audit
type: architecture
status: audit
updated: 2026-09-12
tags: [garbagin, audit, crowdfunding, lifecycle]
aliases: [Lifecycle audit, GARBAGIN_LIFECYCLE_AUDIT, P0 P1 scorecard]
---

# Garbagin marketplace lifecycle audit (vault node)

> Read-only comparison of vault canon vs shipped SQL / Edge / client.  
> Full write-up + repros: [PR #2](https://github.com/sgurzheyev/Clean_Egypt_co/pull/2) (`cursor/lifecycle-audit-50f5`).  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · money: [[01_Architecture/Stripe_USD_Flow]] · P2P: [[01_Architecture/P2P_Deal_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · dashboard: [[04_Roadmap_Tasks/00_Dashboard]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]

This note is the **vault graph node** for the audit. It does not change product behavior. Implementations land in later PRs and link back here.

---

## Two worlds (do not mix money rules)

```
WORLD 1 — P2P          [[01_Architecture/P2P_Deal_Flow]]
  Token pin → available → accept → in_progress → proof → review → completed
  No platform fiat escrow.

WORLD 2 — Civic / crowd   [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
  reported ($0, 7d)
    ├─ nobody donates → hidden (no Gov Notice)
    └─ first Stripe dollar → funding + rolling +30d
         ├─ target met → available / in_progress
         └─ timer + 0 < raised < target → expired → Gov Notice / history
```

Hungry-Games: 1 token per *new* bid; creator phone locked until accept. Crowd pins never expose a client phone.

---

## Scorecard (2026-09-12)

| # | Finding | Status |
| --- | --- | --- |
| P0-1 | `$0` funding / aged `reported` must **hide**, not Gov-Notice | **Shipped** — [PR #3](https://github.com/sgurzheyev/Clean_Egypt_co/pull/3) · [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] |
| P0-2 | First Stripe dollar wakes `reported` (atomic convert+credit) | **Shipped** — PR #3 · same migration + Checkout/confirm/webhook `target_usd` |
| P0-3 | Overfund race charges the loser; webhook 200 + “manual refund ops” | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [PR #4](https://github.com/sgurzheyev/Clean_Egypt_co/pull/4) |
| P1-1 | Crowd `failed` is a dead end | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] (donor reject → `in_progress` retry, not quorum) |
| P1-2 | `process_abandoned_missions` re-tenders funded crowd jobs | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] (crowd excluded from silent abandon) |
| P1-4 | Any auth user can unpaid-convert another user’s report | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] (reporter-only; neighbors use P0-2) |
| P2-1 / P2-2 | No `history_public_until`, n8n, R2 purge; expired not on feed/map | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] |
| P2-3 | `amount_target` overwritten with USD (rank pollution) | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] |
| P2-4 | Profile lists drop `approved` | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] |
| P3-3 | `confirm_mission_work_done` only in `migrations/archive/` | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] |
| P3-4 | Creator DELETE allowed on funded rows | **Shipped** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] |
| Success PDF on `approved` | Vault §8 (2026-08-26) said missing | **Discarded** — enqueue includes `approved` since `20260826_status_changed_at_approved_reviews.sql` |

Do not break: Stripe session idempotency, `FOR UPDATE SKIP LOCKED` on expiry, crowd phone = NULL, 1 token / new bid, funding-visible-with-cleaner.

---

## Wave D close (P2-1 + P2-1b + P2-1c + P2-2)

Product language and file pointers: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]].

- **Expired + raised > 0** stays public 7 days (`history_public_until`), then `archived`.
- **R2 purge** is a service-role Edge + RPC after the window (fail-soft if R2/cron URL unset).
- **n8n** fires after Gov PDF `sent`/`generated` when the webhook secret/URL is set; otherwise skip.
- **Feeds/maps** show funding-with-cleaner and in-window `expired`; hide `$0` / `hidden` / `archived`.

## Wave C close (P2-3 + P2-4 + P3-4)

Product language and file pointers: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]].

- **Token rank** stays `amount_target` (usually 1). USD lives in `expected_price` / bids.
- **Profile** History includes crowd `approved` (and rare/legacy `failed`). Active work includes `awaiting_approval`.
- **Creator DELETE** is blocked when `current_funding > 0` or any `contributions` row exists. Admin moderation is unchanged.

## Wave B close (P1-1 + P1-2 + P3-3)

Product language and file pointers: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]].

- **Donor reject** returns crowd work to `in_progress` (cleaner kept, pot intact). First-no-wins `failed` is gone. Quorum-to-fail was not chosen.
- **Abandon sweep** is P2P-only. Funded crowd cleaner lock is not silently cleared.
- **`confirm_mission_work_done`** is in the active migration tree (Profile P2P close).

## Wave A close (P0-3 + P1-4)

Product language and file pointers: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]].

- **Refund** only when a **paid** Checkout was **rejected** (pot never accepted the dollar). Eco-ultimatum retain is unchanged.
- **Convert** is the reporter’s optional unpaid launch. Neighbors start the campaign with the first Stripe dollar.

---

## Suggested remaining order

1. ~~Split expiry~~ (P0-1)
2. ~~Atomic first donate~~ (P0-2)
3. ~~Overfund refund~~ (P0-3) — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
4. ~~`failed` recovery (P1-1)~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
5. ~~Exclude crowdfunding from abandon retender (P1-2)~~ — Wave B
6. ~~Stop writing USD into `amount_target` (P2-3)~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
7. ~~History columns + n8n + R2 purge (after 1–2)~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
8. ~~Profile / map list hygiene (P2-4)~~ — Wave C
9. ~~Creator DELETE on funded rows (P3-4)~~ — Wave C

P3-3 (`confirm_mission_work_done` in the active tree) shipped with Wave B.

Canon snapshot table: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8.

---

## Graph

- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[01_Architecture/Stripe_USD_Flow]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/Architecture_Overview]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[🗺️ GARBAGIN Master Index]]
