---
title: Lifecycle Fix Wave H
type: architecture
status: shipped
updated: 2026-09-17
tags: [garbagin, security, push, edge, hungry-games, wave-h, lifecycle]
aliases: [Wave H, SEC-5, SEC-3, Hungry-Games subscription, push token hijack]
---

# Lifecycle Fix — Wave H (push token lock + fail-closed Edge + Hungry-Games sub)

> Surface close of **SEC-5**, **SEC-3**, and **OPS-1** from the post–Wave E E2E audit, plus the **Hungry-Games subscription gate** (same commit).  
> Hub: [[🗺️ GARBAGIN Master Index]] · security: [[01_Architecture/Security_and_RPCs]] · KYC: [[01_Architecture/KYC_Verification]] · audit: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · Wave I (SEC-4 Vercel JWT): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code:** already on `main` as [`cbf5c62`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/cbf5c62) / merge [`05d1dd7`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/05d1dd7) (author Sergio Gurgini). This vault note is hygiene only — SQL + Edge are live.

This note is the vault node for Wave H. It does **not** re-describe Waves A–G.

**SEC-4** (unauthenticated Vercel `/api/analyze-mission`, `translate`, `moderate-*`, `notify-*`) is **not** in this wave. Closed later: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] (user JWT). Edge secrets below remain ops.

---

## Plain product language

Wave H hardens **device tokens**, **cron/Edge auth**, and **who may place a new bid**.

### SEC-5 — Do not steal another user’s push token

`upsert_user_push_token` used `ON CONFLICT (token) DO UPDATE SET user_id = uid`. Registering a token already owned by someone else hijacked their device.

Now: if `token` exists for another `user_id`, RAISE. Same user may re-register (platform / `last_used_at` refresh). Conflict update is additionally `WHERE user_id = uid`.

### SEC-3 — Push + city Edge fail closed

`send-push-notification` and `city-notification-pipeline` have `verify_jwt=false` (pg_net / DB webhook, no end-user JWT). They used to **skip** auth when the env secret was empty.

Now both require **either** a matching `SUPABASE_SERVICE_ROLE_KEY` bearer **or** a non-empty webhook secret match (`x-webhook-secret` / bearer). Empty secret + no service-role → **401**. That is intentional.

Hosted ops must set `PUSH_WEBHOOK_SECRET` and `CITY_NOTIFICATION_WEBHOOK_SECRET` (and keep `private.app_config` in sync) or pg_net will 401 after redeploy.

### OPS-1 — Expiry Vercel route is a real RPC

`api/process-expired-crowdfunding.ts` was a stub that checked secret **presence**, not equality, and did not call SQL.

Now: provided secret **equals** `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`; then service-role `process_expired_crowdfunding_missions()`. Prod still prefers `pg_cron` + Edge; this route is a working backup, not a placeholder.

### KYC signed URLs — no Telegram fallback

If `is_platform_admin` RPC errors, `kyc-admin-signed-urls` used to allow founder email **or** `telegram_username = 'sergiogurgini'`. TG is gone. Fallback is **`profiles.role = 'admin'` only**. Happy path is the Wave F RPC. Optional later: drop the role fallback entirely.

---

## Hungry-Games subscription gate (same commit)

Place this product rule here so Wave G stays LIFE-1/2/3-only. Cross-link: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]].

**Rule:** a **new** bid costs 1 token **and** requires `subscription_expires_at > now()`. Updating an existing **pending** bid does not re-check subscription and does not re-debit. `is_platform_admin` is exempt (QA).

| Who | New bid |
| --- | --- |
| Worker with active subscription + ≥1 token | Yes |
| Worker with tokens, expired / null sub | No — MapPicker opens [[src/components/SubscriptionModal.tsx]] |
| Platform admin | Yes (no sub check) |
| Existing pending bid (edit amount / packages) | Yes, no second token, no sub re-check |

Phone lock until accept is unchanged. Crowd pins still never expose a client phone.

SQL: [[supabase/migrations/20260917_hungry_games_subscription_gate.sql]] — `CREATE OR REPLACE place_mission_bid`. Must apply **after** Wave F (`is_platform_admin`). Client: [[components/MapPicker.tsx]] (modal + RPC “subscription required” toast path).

Roadmap Phase 3 checkbox: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]].

---

## What landed in code

| Layer | Path |
| --- | --- |
| SEC-5 SQL | [[supabase/migrations/20260917_wave_h_surface_hardening.sql]] |
| Hungry-Games SQL | [[supabase/migrations/20260917_hungry_games_subscription_gate.sql]] |
| Push Edge | [[supabase/functions/send-push-notification/index.ts]] |
| City Edge | [[supabase/functions/city-notification-pipeline/index.ts]] |
| KYC Edge | [[supabase/functions/kyc-admin-signed-urls/index.ts]] |
| Vercel expiry | [[api/process-expired-crowdfunding.ts]] |
| Map subscription gate | [[components/MapPicker.tsx]] · [[src/components/SubscriptionModal.tsx]] |
| Decline helper (Wave G client) | [[src/lib/missionBids.ts]] |
| Admin mirror (Wave F client) | [[src/lib/platformAdmin.ts]] |

### Push token path

```
upsert_user_push_token
  → token already owned by another uid? RAISE
  → INSERT … ON CONFLICT (token) DO UPDATE
       WHERE user_id = uid
```

### Edge auth path

```
POST send-push-notification | city-notification-pipeline
  → service_role bearer? allow
  → non-empty secret AND header match? allow
  → else 401
```

---

## Hosted apply

Live already has these objects. CLI may still list `20260917_*` as **Local-only** — [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] (`repair --status applied 20260917`, never blind `db push`). All four files share that prefix; filename sort puts Hungry-Games **before** Wave F — paste order is not `ls` order.

After Wave G (full table: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]):

1. [[supabase/migrations/20260917_wave_h_surface_hardening.sql]]
2. [[supabase/migrations/20260917_hungry_games_subscription_gate.sql]] (needs Wave F `is_platform_admin`)

**Redeploy Edge:** `send-push-notification`, `city-notification-pipeline`, `kyc-admin-signed-urls`.

**Secrets (required for Edge to accept pg_net after fail-closed):**

| Secret | Used by |
| --- | --- |
| `PUSH_WEBHOOK_SECRET` | send-push-notification (or service-role bearer) |
| `CITY_NOTIFICATION_WEBHOOK_SECRET` | city-notification-pipeline (or service-role bearer) |
| `CRON_SECRET` (optional) | Vercel `api/process-expired-crowdfunding` |

Configure scripts: [[supabase/manual/configure_push_webhook.sql]] · [[supabase/manual/configure_city_notification_webhook.sql]].

Client (MapPicker modal) ships with the app. Apply Hungry-Games SQL **before** workers hit the new RPC error.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games **phone** lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund · eco-ultimatum retain · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE · Wave D 7-day history / R2 purge / gated n8n · `$0` quiet hide · Wave F admin allowlist + mission freeze · Wave G underfund accept / reject RPC / expiry unlock · pending-bid **updates** still free of a second token.

Do **not**: `db push` to “fix” Local-only `20260917` · leave Edge secrets empty after redeploy (pg_net will 401).

---

## Still open (not this wave)

- ~~**SEC-4** Vercel `/api/*` user JWT~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- Hosted Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` (and matching `private.app_config`) — code is fail-closed
- CLI `migration repair --status applied 20260917` if the list is still Local-only
- Optional: KYC Edge `role = admin` fallback if `is_platform_admin` RPC errors
- UX-1 copy (“Subscribe to unlock”) vs Hungry-Games phone lock — product copy pass
- SEC-6 chat-photos / R2 presign membership
- Optional immediate R2 delete on `$0` quiet-hide; official municipality channel; crowd re-tender on a **full** pot ghost

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/KYC_Verification]]
- [[01_Architecture/Architecture_Overview]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[02_Frontend/Frontend_Components]]
- [[src/components/SubscriptionModal.tsx]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
