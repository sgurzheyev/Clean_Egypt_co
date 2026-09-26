---
title: Admin P0 Hardening
type: security
status: shipped
updated: 2026-09-26
tags: [garbagin, security, admin, supabase, rpc, p0]
aliases: [Admin P0 hardening, force_cancel_mission guard, factory reset lock, admin_set_ai_verdict]
---

# Admin P0 hardening (2026-09-26)

> Hub: [[🗺️ GARBAGIN Master Index]] · dashboard: [[04_Roadmap_Tasks/00_Dashboard]] · SQL MOC: [[03_Backend_SQL/SQL_Migrations_Index]] · security: [[01_Architecture/Security_and_RPCs]] · previous security wave: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · history ops: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]

Migration: [[supabase/migrations/20260926_admin_p0_hardening.sql]] · UI: [[src/components/AdminDashboard.tsx]] · env typing: [[vite-env.d.ts]]

A code audit of the Admin console found four P0 issues. Each one was checked on the **live** DB (project `pnhdwlcxmcathgkigcys`) before the fix, then checked again after it.

## Findings and live verification (before)

| # | Issue | Live before | Evidence |
| --- | --- | --- | --- |
| 1 | `force_cancel_mission(uuid)` has no admin check | **Yes** | `pg_get_functiondef` had no guard. `proacl` = `=X, anon=X, authenticated=X`, so anyone with the public anon key could run it. A non-admin JWT test reached the body (`Mission not found` on a random id). |
| 2 | `admin_financial_metrics()` has no admin check | **Yes** | No guard. EXECUTE held by PUBLIC, anon, and authenticated. A non-admin JWT got the platform money totals. |
| 3 | Creator/worker can forge `missions.ai_verdict` / `ai_confidence_score` | **Yes** | `has_column_privilege(authenticated, …, UPDATE)` = true on both (Wave F safe-column grant). The `missions_update_participants` policy allows creator/cleaner. A direct `UPDATE … SET ai_verdict` as authenticated was allowed. |
| 4 | `admin_factory_reset()` wipes prod behind one `window.confirm` | **Yes** (UI + no server switch) | The function had an admin check, but EXECUTE was also granted to PUBLIC and anon, and nothing on the server stopped an admin click on prod. |

### Live drift found during verification

- `admin_financial_metrics` on live still has the **2026-03 return shape** (`total_donated, pending_payouts, pending_withdrawals, supervisor_bounties_total`). [[supabase/migrations/20260721_cleanup_legacy_finance_rpcs.sql]] was never applied. The Admin UI reads `active_missions` / `completed_missions`, so the "pulse" cards always showed 0. This wave **keeps the live shape** (no DROP) and only adds the guard. Switching to the new shape is left open.
- `force_cancel_mission` still uses the legacy escrow refund (`frozen_balance → wallet_balance`). On live, 0 profiles have `frozen_balance > 0` and 0 open missions have `current_funding > 0`. So the refund branch only matters for a funded mission, and there it raises `Insufficient frozen balance for refund`. The P2P model moves no wallet/frozen funds ([[supabase/migrations/20260719_moderate_mission_dispute_p2p.sql]]). The logic is **kept unchanged** (guard only) because the right refund behaviour for crowdfunded missions is a product decision.
- `is_platform_admin(uuid)` is executable by `anon`. It takes an arbitrary uuid, so anyone can check whether a user id is an admin (low-severity info leak). Not changed here.

## Fix — [[supabase/migrations/20260926_admin_p0_hardening.sql]]

The migration is idempotent and deletes or modifies no data. It is wrapped in `BEGIN … COMMIT` and ends with post-flight `DO` assertions, the same pattern as [[supabase/migrations/20260727_security_hardening_rls_economy.sql]].

1. **`force_cancel_mission(uuid)`**: same signature. Opens with `service_role OR is_platform_admin(auth.uid())`, otherwise `RAISE 'forbidden'` (42501). The body is identical to live. `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated, service_role`.
2. **`admin_financial_metrics()`**: now plpgsql with the same guard and the same (live) return columns. Same ACL lock.
3. **AI verdict columns**:
   - `REVOKE UPDATE (ai_verdict, ai_confidence_score)` from PUBLIC/anon/authenticated. This works because Wave F already removed table-level UPDATE. Other participant columns (`description`, `photo_urls`, `started_at`, `video_proof_url`, `proof_video_url`, `updated_at`) keep their grants.
   - `trg_protect_mission_ai_columns` (BEFORE UPDATE) blocks ai_* changes unless the caller is service_role or the owner (SECURITY DEFINER RPC).
   - New RPC `admin_set_ai_verdict(p_mission_id uuid, p_verdict text, p_confidence numeric)`, admin guard, writes `round(p_confidence)::integer` (live column is `integer`).
   - No Edge Function or `api/` route writes ai_* (grep). `api/analyze-mission.ts` only returns a score, and the Admin UI saves it.
4. **`admin_factory_reset()`**: keeps `Not authenticated` / `Admin only`. It now also refuses unless `private.app_config` has `allow_factory_reset = 'true'`. The table already existed (webhook config, 20260722/20260723) and is not exposed to anon/authenticated. **No row was inserted, so prod refuses.** Same ACL lock (no PUBLIC/anon).

## Frontend — [[src/components/AdminDashboard.tsx]]

- `runAiForMission` saves through `supabase.rpc('admin_set_ai_verdict', …)` instead of a direct `missions` update.
- The Danger zone (factory reset) only renders when `import.meta.env.VITE_ENABLE_FACTORY_RESET === 'true'`. Leave it unset on Vercel prod. The handler asks you to type `NUKE` in a `window.prompt`. Typed as `VITE_ENABLE_FACTORY_RESET?` in [[vite-env.d.ts]].

## Verification (after)

- `proacl` for all four admin RPCs: `{postgres=X, authenticated=X, service_role=X}`. anon = false, PUBLIC = false. SECURITY DEFINER, and each body has the `is_platform_admin` guard. The factory reset body has the `allow_factory_reset` gate.
- `missions.ai_verdict` / `ai_confidence_score`: authenticated UPDATE = false, anon = false. The other safe columns are still true. The trigger is present.
- Rolled-back JWT test as a **non-admin**: `force_cancel=forbidden; metrics=forbidden; set_ai=forbidden; direct_ai_update=permission denied for table missions`.
- Rolled-back JWT test as a **platform admin** (random mission id): `force_cancel=Mission not found; metrics=ok; set_ai=Mission not found`, so the guard lets admins through.
- `private.app_config` rows with `allow_factory_reset`: 0. `admin_factory_reset` was **never called**.

## Apply / history

- Applied with `supabase db query --linked -f supabase/migrations/20260926_admin_p0_hardening.sql`, then `supabase migration repair --linked --status applied 20260926` (history row only, per [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]).
- CLI history is still Local-only for older prefixes (`20260917`, `20260924`, and many earlier ones). **Do not `db push`.**

## Enable factory reset on a staging project (never prod)

```sql
INSERT INTO private.app_config (key, value) VALUES ('allow_factory_reset', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

Also build that frontend with `VITE_ENABLE_FACTORY_RESET=true`. To lock it again, `DELETE FROM private.app_config WHERE key = 'allow_factory_reset';`.

## Open

- Decide the `admin_financial_metrics` shape: apply the 20260721 contribution-model version (DROP + CREATE with the guard) so the pulse cards show real counts.
- Decide the admin-cancel refund semantics for funded / crowdfunded missions (the legacy `frozen_balance` path raises today).
- Consider `REVOKE EXECUTE ON is_platform_admin(uuid) FROM anon` after checking anon-side RLS policies that call it.
