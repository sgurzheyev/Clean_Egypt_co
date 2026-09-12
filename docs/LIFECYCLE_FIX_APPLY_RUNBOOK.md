---
title: Lifecycle Fix Apply Runbook
type: ops
status: canonical
updated: 2026-09-12
tags: [garbagin, supabase, runbook, lifecycle, wave-e]
aliases: [LIFECYCLE_FIX_APPLY_RUNBOOK, P0 to D apply order]
---

# Lifecycle fix — apply order (P0 → D)

> What ops already ran on **live** Garbagin (2026-09-12). Use this to replay on a **new** project or to confirm hosted objects.  
> Vault: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · CLI history (this project): [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8 · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]]

**This project:** SQL is applied; Edge functions listed below are redeployed. Do **not** `supabase db push` these `20260912_*` files here — see [[04_Roadmap_Tasks/Ops_Migration_History_Repair]].

**New / staging project:** paste SQL in order in the SQL Editor (or `psql` as a privileged role). Each migration is written to be re-runnable (`CREATE OR REPLACE` / `IF NOT EXISTS`). Then redeploy Edge and run the verify file.

---

## 1. SQL (order is required)

Skip a row only when that file is already on the target database (green verify).

| Step | Wave | Migration (paste) | Verify (read-mostly) | Notes |
| --- | --- | --- | --- | --- |
| 1 | P0 | [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] | [[../supabase/manual/20260912_p0_expiry_first_donate_verify.sql]] | `$0` → `hidden` (no Gov Notice). First Stripe dollar wakes `reported`. |
| 2 | A | [[../supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] | [[../supabase/manual/20260912_wave_a_refund_convert_verify.sql]] | Overfund / paid-reject refund ledger. Unpaid convert = reporter only. |
| 3 | B | [[../supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]] | [[../supabase/manual/20260912_wave_b_verify.sql]] | Donor reject → `in_progress`. Crowd excluded from 24h abandon. P2P confirm RPC. |
| 4 | C | [[../supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]] | [[../supabase/manual/20260912_wave_c_verify.sql]] | `amount_target` stays token rank. Funded creator DELETE blocked. |
| 5 | D | [[../supabase/migrations/20260912_wave_d_garbage_history_window.sql]] | [[../supabase/manual/20260912_wave_d_verify.sql]] | `history_public_until` / archive cron / purge RPCs / n8n columns. |

Product notes: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]].

Verify files keep destructive fixtures **commented**. Uncomment only on staging.

---

## 2. Edge redeploy (after the matching SQL)

| After step | Function | Why |
| --- | --- | --- |
| 2 (Wave A) | `stripe-contribution-confirm` | Paid-reject → Stripe refund + ledger |
| 2 (Wave A) | `stripe-webhook` | Same refund path if the tab closes |
| 5 (Wave D) | `city-notification-pipeline` | History bump + gated n8n POST after Gov PDF |
| 5 (Wave D) | `garbage-history-purge` | R2 delete after archive |

Checkout Edge (`stripe-contribution-checkout`) is unchanged by Waves A–D (P0 already taught it `target_usd`). Redeploy it only if that box is behind P0.

`verify_jwt=false` stays as in `supabase/config.toml` for webhook / confirm / city / purge.

---

## 3. Optional config (fail-soft if skipped)

| Script / secret | Effect if missing |
| --- | --- |
| [[../supabase/manual/configure_city_notification_webhook.sql]] | No Gov PDF / Telegram poke (expiry still writes `city_notification_events`) |
| [[../supabase/manual/configure_garbage_history_purge.sql]] | Pins still **archive** (leave the feed); R2 objects wait |
| Edge `N8N_ECO_ULTIMATUM_WEBHOOK_URL` (+ optional `N8N_ECO_ULTIMATUM_SECRET`) | n8n skipped; PDF still generates |
| Edge `GARBAGE_HISTORY_PURGE_SECRET` | Optional extra auth on purge |
| Existing `R2_*` | Purge and PDF upload need the same bucket as today |

Never commit real service-role keys. The configure scripts are placeholders.

---

## 4. Client

Apply SQL **before** a client that selects `history_public_until` / `media_purged_at` (Wave D). PRs #3–#7 may still be unmerged to `main`; hosted schema is already ahead of `main`.

---

## 5. After objects exist — CLI history

On **this** hosted project, mark version `20260912` applied. Do not push:

→ [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]

---

## 6. Do not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / bid · funding-with-cleaner visible · `$2` floor · creator cannot self-fund · Wave A reject-refund (pot never accepted) · eco-ultimatum retain (accepted money, no card refund) · `$0` quiet hide.

---

## Graph

- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[🗺️ GARBAGIN Master Index]]
