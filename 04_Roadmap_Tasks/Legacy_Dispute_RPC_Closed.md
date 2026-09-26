# Legacy dispute RPC closed (2026-09-27)

> Hub: [[04_Roadmap_Tasks/00_Dashboard]] · [[🗺️ GARBAGIN Master Index]] · SQL: [[03_Backend_SQL/SQL_Migrations_Index]] · Follows: [[04_Roadmap_Tasks/Admin_P1_Upgrade]] ("Left open") · [[04_Roadmap_Tasks/Admin_P0_Hardening]]

## The hole

Live had two overloads of `public.resolve_mission_dispute`:

| Signature | Auth | EXECUTE | Money |
|---|---|---|---|
| `resolve_mission_dispute(p_mission_id uuid, p_verdict boolean, p_supervisor_comment text) RETURNS void` (oid 40877, legacy) | **none** (SECURITY DEFINER, owner postgres) | PUBLIC, anon, authenticated, service_role | credited `profiles.balance_egp`, debited `frozen_balance`, inserted `city_eco_fund_logs`, set mission `completed` / `collecting` |
| `resolve_mission_dispute(p_mission_id uuid, p_decision text, p_supervisor_comment text, p_supervisor_verified boolean DEFAULT false, p_supervisor_user_id uuid DEFAULT NULL) RETURNS void` | admin or supervisor, audited | authenticated, service_role (anon denied) | none (P2P moderation only) |

Anyone holding the public anon key could call the legacy one and move balances for any mission.

## Callers checked

- App: the only caller is `src/components/AdminDashboard.tsx` → `resolveDispute`. It passes `p_mission_id, p_decision, p_supervisor_comment, p_supervisor_verified, p_supervisor_user_id`, so PostgREST resolves to the 5-arg overload. No caller passes `p_verdict` to this RPC (the `p_verdict` hit in that file is `admin_set_ai_verdict`).
- `api/`, `supabase/functions/`: no references. Android wrapper (`~/garbagin-android`): only a mention in `scratch/notes.md`.
- DB: no function body (any schema), trigger, public view, `cron.job` command or `pg_depend` row refers to it.

## Fix: DROP

- Migration [[20260927110000_drop_legacy_resolve_dispute.sql]]: `DROP FUNCTION IF EXISTS public.resolve_mission_dispute(uuid, boolean, text)` in one transaction, then a post-check that raises if the legacy overload still exists, the 5-arg one is missing, anon can execute the 5-arg one, or any other overload remains. Ends with `NOTIFY pgrst, 'reload schema'`. Idempotent.
- The 5-arg overload was not touched.
- Dry run (ROLLBACK) first: post-check passed, both overloads still present afterwards.
- Applied 2026-09-27 ~00:54 Cairo with `supabase db query --linked -f …`, then `supabase migration repair --linked --status applied 20260927110000`.
- After: only `resolve_mission_dispute(uuid,text,text,boolean,uuid)` exists. ACL `postgres, authenticated, service_role`; anon and PUBLIC have no EXECUTE.

## Verification (simulated roles, rolled back)

| Role | Call | Result |
|---|---|---|
| anon | old, named (`p_verdict`) | `42883 function … does not exist` |
| anon | old, positional `(uuid, bool, text)` | `42883 function … does not exist` |
| anon | 5-arg | `42501 permission denied for function resolve_mission_dispute` |
| authenticated non-admin (`530ac789…`) | old, named | `42883 does not exist` |
| authenticated non-admin | 5-arg | `P0001 Moderator access required` |
| authenticated admin (`260afcbd…`) | old, named | `42883 does not exist` |
| authenticated admin | 5-arg `approve` | OK: mission → `completed` in txn, 1 new `admin_audit_log` row, `sum(balance_egp + frozen_balance)` unchanged |

After ROLLBACK the test mission (`74e0a793…`) is still `available` with 0 audit rows.

No frontend change, so no build needed.
