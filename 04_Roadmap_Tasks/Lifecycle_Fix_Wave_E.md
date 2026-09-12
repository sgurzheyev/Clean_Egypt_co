---
title: Lifecycle Fix Wave E
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, docs, ops, migration-history, wave-e, hygiene]
aliases: [Wave E, Lifecycle hygiene, Docs sync, Migration history repair]
---

# Lifecycle Fix — Wave E (vault + CLI history hygiene)

> Docs-and-ops close after **P0 → Wave D**. No product behavior change.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · CLI repair: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] · money: [[01_Architecture/Stripe_USD_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**This PR is hygiene only.** Live Supabase already has P0→D SQL and the relevant Edge functions redeployed. Frontend/PRs #3–#7 may still be unmerged to `main`. Wave E makes the vault match that shipped stack and records how to fix CLI migration history **without** `db push` or a remote reset.

This note does **not** re-describe P0 or Waves A–D.

P0 lives in [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8).  
Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]].

---

## Plain language

Two worlds still share `missions`. Wave E does not touch money, status, or UI.

1. **Canon matches code.** [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8, [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] Phase 1, and the architecture notes no longer claim that shipped timers / crowd-bid / eco-ultimatum / history window are future work.
2. **Ops can replay apply order.** [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] lists P0→D SQL, Edge redeploys, and verify files (what live already ran).
3. **CLI history can be marked applied.** The `20260912_*` files were pasted in the SQL Editor. `supabase migration list` therefore shows them as **Local** only. [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] is the runbook for `supabase migration repair --status applied` — history table only, no SQL replay, no remote reset.

---

## What landed in this wave

| Artifact | Path |
| --- | --- |
| This vault node | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] |
| CLI history repair | [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] |
| Apply-order runbook | [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] |
| Canon snapshot | [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8 |
| Play roadmap Phase 1 | [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] |
| RPC / Stripe / overview | [[01_Architecture/Security_and_RPCs]] · [[01_Architecture/Stripe_USD_Flow]] · [[01_Architecture/Architecture_Overview]] |
| Graph hubs | [[🗺️ GARBAGIN Master Index]] · [[04_Roadmap_Tasks/00_Dashboard]] · [[03_Backend_SQL/SQL_Migrations_Index]] |

No new RPC, Edge function, or client path.

---

## Hosted apply

**None.** Do not paste a new migration for Wave E.

If a later operator needs to re-apply P0→D on a **new** project, use [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]. If this project’s CLI list still shows Local-only `20260912` versions, use [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — not `supabase db push`.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE · Wave D 7-day history / R2 purge / gated n8n · `$0` quiet hide.

Do **not**: `supabase db reset` on remote · `supabase db push` while Local-only `20260912_*` rows remain · `migration repair --status reverted` for a version whose SQL is already on live.

---

## Still open (not this PR)

From [[docs/GARBAGIN_LIFECYCLE_AUDIT]] / [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8:

- Optional immediate R2 delete on `$0` quiet-hide (P0 leftover)
- Official municipality channel beyond Telegram / Resend ops
- Explicit crowd re-tender if a locked cleaner ghosts a full pot (notify donors — do not revive silent abandon)
- n8n social workflow itself (Edge only POSTs when a URL is set)
- Merge PRs #3–#7 to `main` so git `main` matches live SQL
- Future migrations: unique `YYYYMMDDHHMMSS_` prefixes (see [[04_Roadmap_Tasks/Ops_Migration_History_Repair]])

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
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
