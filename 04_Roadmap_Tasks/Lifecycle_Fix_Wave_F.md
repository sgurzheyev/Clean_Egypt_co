---
title: Lifecycle Fix Wave F
type: architecture
status: shipped
updated: 2026-09-17
tags: [garbagin, security, admin, rls, wave-f, lifecycle]
aliases: [Wave F, SEC-1, SEC-2, platform_admins, mission column lock]
---

# Lifecycle Fix — Wave F (admin allowlist + mission column lock)

> Security close of **SEC-1** and **SEC-2** from the post–Wave E E2E audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · security: [[01_Architecture/Security_and_RPCs]] · audit: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · Wave E: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · CLI repair: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code:** already on `main` as [`cbf5c62`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/cbf5c62) / merge [`05d1dd7`](https://github.com/sgurzheyev/Clean_Egypt_co/commit/05d1dd7) (author Sergio Gurgini). This vault note is hygiene only — SQL is live.

This note is the vault node for Wave F. It does **not** re-describe P0 or Waves A–E.

Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · Wave H (incl. Hungry-Games subscription): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · Wave I (SEC-4 Vercel JWT): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]].

---

## Plain product language

Two worlds still share `missions`. Wave F does not move money or status. It stops **self-promotion to admin** and **PostgREST forgery of lifecycle columns**.

### SEC-1 — Telegram username is not an admin key

Any signed-in user could `UPDATE profiles.telegram_username = 'sergiogurgini'` and pass `is_platform_admin`. That unlocked `admin_delete_mission`, KYC signed URLs, factory reset, phone RPCs, wallet/token admin paths.

Now:

| Check | Still admin? |
| --- | --- |
| `service_role` JWT | Yes |
| Row in `public.platform_admins` | Yes (service-role writes only; RLS on, grants revoked from `anon` / `authenticated`) |
| Founder email in `auth.users` (`sgurzheyev@gmail.com` / `tg_6618910143`) | Yes |
| `profiles.role::text = 'admin'` | Yes (text cast — no enum mutation) |
| `telegram_username = 'sergiogurgini'` | **No** |

Founder is seeded into `platform_admins` from `auth.users`. Client mirror [[src/lib/platformAdmin.ts]] dropped the TG username test. KYC Edge TG fallback is gone (Wave H).

### SEC-2 — Participants cannot UPDATE `status` / funds / cleaner

`missions` had a full-row `GRANT UPDATE` for `authenticated`. Creator or assigned cleaner could PostgREST-set `status = completed`, bump `current_funding`, reassign `cleaner_id`, skip RPCs.

Now:

1. `REVOKE UPDATE` from `PUBLIC` / `anon` / `authenticated`.
2. `GRANT UPDATE` only on safe UI columns that exist: `description`, `photo_urls`, `started_at`, `video_proof_url`, `proof_video_url`, `ai_confidence_score`, `ai_verdict`, `updated_at`.
3. `BEFORE UPDATE` trigger `trg_protect_mission_lifecycle_columns` rejects changes to `status`, `cleaner_id`, `creator_id`, `current_funding`, `expected_price`, `amount_target`, `target_funding`, `crowdfunding_mode`, `crowdfunding_expires_at`, `accepted_bid_id`, `is_report` unless the caller is `service_role` / `postgres` / `supabase_admin` (SECURITY DEFINER RPCs).

Before-photos and creator description edits stay on the column grant. Status still moves only through RPCs.

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260917_wave_f_security_hardening.sql]] |
| Client admin mirror | [[src/lib/platformAdmin.ts]] (no TG username) |
| KYC Edge (TG fallback dropped) | [[supabase/functions/kyc-admin-signed-urls/index.ts]] — see [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Admin path

```
is_platform_admin(uid)
  → service_role JWT?
  → platform_admins.user_id?
  → auth.users founder email?
  → profiles.role::text = 'admin'?
  → else false
  (no telegram_username)
```

### Mission UPDATE path

```
authenticated UPDATE missions
  → column GRANT: description / photos / proof URLs / AI verdict / updated_at
  → trigger: lifecycle/economy columns unchanged
       else RAISE 'Use designated RPCs'
  DEFINER RPC / service_role: trigger allows
```

---

## Hosted apply

Live already has `platform_admins` and the freeze trigger. CLI may still show `20260917_*` as **Local-only** — same pattern as `20260912_*`. Mark applied: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] (`supabase migration repair --status applied 20260917`). Never blind `db push`.

Paste order on a **new** project (full list: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]):

1. P0→D `20260912_*` (skip if applied)
2. [[supabase/migrations/20260917_wave_f_security_hardening.sql]] **before** Hungry-Games (that RPC calls `is_platform_admin`)
3. Wave G → Wave H → Hungry-Games

All four `20260917_*` files share CLI version `20260917`. Filename sort puts Hungry-Games **first** — do not rely on `db push` order.

No Edge redeploy required for Wave F SQL. Redeploy `kyc-admin-signed-urls` with Wave H.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE · Wave D 7-day history / R2 purge / gated n8n · `$0` quiet hide · `admin_delete_mission` on funded rows · DEFINER RPCs still UPDATE `status` / `cleaner_id` / funds.

Do **not**: `supabase db reset` on remote · `supabase db push` while Local-only `20260917_*` rows remain · `migration repair --status reverted` for a version whose SQL is already on live.

---

## Still open (not this wave)

From [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]:

- ~~SEC-1 / SEC-2~~ — this wave
- ~~LIFE-1 / LIFE-2 / LIFE-3~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- ~~SEC-3 / SEC-5 / OPS-1~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- ~~**SEC-4** Vercel `/api/*` JWT~~ — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` must be set (fail-closed — empty secret + no service-role bearer → 401)
- CLI repair for `20260917_*` if `migration list` is still Local-only
- KYC Edge still falls back to `profiles.role = 'admin'` if the `is_platform_admin` RPC errors (no TG; optional to drop)

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/KYC_Verification]]
- [[01_Architecture/Architecture_Overview]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
