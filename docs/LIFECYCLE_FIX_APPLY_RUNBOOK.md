---
title: Lifecycle Fix Apply Runbook
type: ops
status: canonical
updated: 2026-09-19
tags: [garbagin, supabase, runbook, lifecycle, wave-h, wave-i]
aliases: [LIFECYCLE_FIX_APPLY_RUNBOOK, P0 to H apply order]
---

# Lifecycle fix — apply order (P0 → H)

> What ops already ran on **live** Garbagin (P0–D 2026-09-12; F/G/H + Hungry-Games 2026-09-17). Use this to replay on a **new** project or to confirm hosted objects.  
> Vault: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · F/G/H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · Wave I (Vercel JWT, no SQL): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] · CLI history: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8 · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · E2E: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]

**This project:** SQL is applied; Edge functions listed below are redeployed. Do **not** `supabase db push` these `20260912_*` or `20260917_*` files here — see [[04_Roadmap_Tasks/Ops_Migration_History_Repair]].

**New / staging project:** paste SQL in order in the SQL Editor (or `psql` as a privileged role). Each migration is written to be re-runnable (`CREATE OR REPLACE` / `IF NOT EXISTS`). Then redeploy Edge and run the verify file.

`20260917_*` share one CLI timestamp. Filename sort puts Hungry-Games **before** Wave F. **Paste order below is required** (Hungry-Games calls `is_platform_admin` from Wave F).

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
| 6 | F | [[../supabase/migrations/20260917_wave_f_security_hardening.sql]] | — (live: `platform_admins` exists; `is_platform_admin` has no `telegram_username`) | SEC-1 allowlist + SEC-2 column GRANT + `trg_protect_mission_lifecycle_columns`. |
| 7 | G | [[../supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]] | — | LIFE-1 underfund stay `funding`; LIFE-2 `reject_mission_bid`; LIFE-3 expiry clears `cleaner_id` + rejects bids + backfill. |
| 8 | H | [[../supabase/migrations/20260917_wave_h_surface_hardening.sql]] | — | SEC-5 `upsert_user_push_token` rejects hijack. |
| 9 | Hungry-Games | [[../supabase/migrations/20260917_hungry_games_subscription_gate.sql]] | — | Active subscription required for **new** bids; admins exempt. **After** step 6. |

Product notes: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] (no SQL — Vercel JWT).

Verify files (P0–D) keep destructive fixtures **commented**. Uncomment only on staging. F/G/H have no separate verify file — confirm objects (`platform_admins`, trigger, RPC comments) in the SQL Editor.

---

## 2. Edge redeploy (after the matching SQL)

| After step | Function | Why |
| --- | --- | --- |
| 2 (Wave A) | `stripe-contribution-confirm` | Paid-reject → Stripe refund + ledger |
| 2 (Wave A) | `stripe-webhook` | Same refund path if the tab closes |
| 5 (Wave D) | `city-notification-pipeline` | History bump + gated n8n POST after Gov PDF |
| 5 (Wave D) | `garbage-history-purge` | R2 delete after archive |
| 8 (Wave H) | `city-notification-pipeline` | Fail-closed auth (service-role **or** non-empty secret) |
| 8 (Wave H) | `send-push-notification` | Same fail-closed auth |
| 8 (Wave H) | `kyc-admin-signed-urls` | Dropped TG username fallback |

Checkout Edge (`stripe-contribution-checkout`) is unchanged by Waves A–H (P0 already taught it `target_usd`). Redeploy it only if that box is behind P0.

`verify_jwt=false` stays as in `supabase/config.toml` for webhook / confirm / city / purge / push. After Wave H the **function body** fails closed — empty `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` plus no service-role bearer → 401. Set those secrets (and matching `private.app_config`) before relying on pg_net.

**Wave I (no SQL, no Edge):** redeploy Vercel so `/api/translate`, `moderate-*`, `analyze-mission`, `notify-*` require a user JWT. `api/process-expired-crowdfunding` stays Wave H secret-equality. See [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]].

---

## 3. Optional config (fail-soft if skipped)

| Script / secret | Effect if missing |
| --- | --- |
| [[../supabase/manual/configure_city_notification_webhook.sql]] | No Gov PDF / Telegram poke (expiry still writes `city_notification_events`) |
| [[../supabase/manual/configure_garbage_history_purge.sql]] | Pins still **archive** (leave the feed); R2 objects wait |
| [[../supabase/manual/configure_push_webhook.sql]] | After Wave H, missing secret **and** no service-role bearer → push Edge 401s |
| Edge `N8N_ECO_ULTIMATUM_WEBHOOK_URL` (+ optional `N8N_ECO_ULTIMATUM_SECRET`) | n8n skipped; PDF still generates |
| Edge `GARBAGE_HISTORY_PURGE_SECRET` | Optional extra auth on purge |
| Edge `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` | **Required** for fail-closed pg_net after Wave H (or pass service-role bearer) |
| Existing `R2_*` | Purge and PDF upload need the same bucket as today |

Never commit real service-role keys. The configure scripts are placeholders.

---

## 4. Client

Apply SQL **before** a client that selects `history_public_until` / `media_purged_at` (Wave D) or that calls Hungry-Games `place_mission_bid` (Wave H). Code for P0→H is on `main` (`cbf5c62` / `05d1dd7`). Hosted schema already has the SQL markers (`platform_admins`, etc.).

---

## 5. After objects exist — CLI history

On **this** hosted project, mark versions `20260912` and `20260917` applied. Do not push:

→ [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]

`supabase migration list` may still show `20260917_*` as Local-only even though live has the objects. `repair --status applied 20260917` — history table only, no SQL replay.

---

## 6. Do not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / bid · funding-with-cleaner visible · `$2` floor · creator cannot self-fund · Wave A reject-refund (pot never accepted) · eco-ultimatum retain (accepted money, no card refund) · `$0` quiet hide · Wave F DEFINER RPCs still mutate lifecycle columns · Wave G underfund stay `funding` · pending-bid updates still skip a second token.

---

## Graph

- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[🗺️ GARBAGIN Master Index]]
