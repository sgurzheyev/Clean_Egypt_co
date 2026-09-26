---
title: Admin P1 Upgrade
type: feature
status: ready-to-apply
updated: 2026-09-26
tags: [garbagin, admin, supabase, rpc, audit, p1]
aliases: [Admin P1 upgrade, admin audit log, mission soft-hide]
---

# Admin P1 upgrade

> Hub: [[🗺️ GARBAGIN Master Index]] · dashboard: [[04_Roadmap_Tasks/00_Dashboard]] · SQL MOC: [[03_Backend_SQL/SQL_Migrations_Index]] · previous: [[04_Roadmap_Tasks/Admin_P0_Hardening]]

Migration: [[supabase/migrations/20260927_admin_p1_upgrade.sql]] · UI: [[src/components/AdminDashboard.tsx]]

The admin console was a single profile card with client-side filters, `alert()` / `confirm()`, a hardcoded browser admin check, and hard deletes. This wave makes it a full-screen lazy panel with server search and an audit trail. P0 guards stay: `force_cancel_mission` still uses the legacy `frozen_balance → wallet_balance` refund, and `admin_financial_metrics` is not replaced (live still returns `pending_payouts` / `pending_withdrawals`).

## Apply the SQL

One new file. Apply it **after** [[supabase/migrations/20260926_admin_p0_hardening.sql]]. The filename version is `20260927` so it does not collide with the history row already repaired as `20260926`.

**Do not `supabase db push`.** Paste the file in the SQL editor (or `supabase db query --linked -f …` if you accept that it runs on the linked project). Then record history only:

```bash
supabase migration repair --linked --status applied 20260927
```

Order:

1. `supabase/migrations/20260926_admin_p0_hardening.sql` — already applied on prod (do not re-run unless you know it is missing).
2. `supabase/migrations/20260927_admin_p1_upgrade.sql` — this wave. Idempotent, one transaction, post-flight checks roll the whole file back on failure.

Ship the frontend after the SQL. The new panel calls `admin_search_missions`, `admin_search_profiles`, `admin_set_mission_hidden`, and `admin_hide_stale_ghost_pins`. Those RPCs do not exist until step 2. Public map and feed queries do **not** select `hidden_at`, so the marketplace still loads if the frontend ships first; hide/search in the panel will error until the SQL is applied. After the SQL, `missions_select_all` hides rows with `hidden_at` set from anon and non-admin clients.

## What changed

### Audit log

`public.admin_audit_log`: `actor_id`, `action`, `target_type`, `target_id`, `before_state`, `after_state`, `created_at`. RLS is enabled and forced. `authenticated` may SELECT only when `is_platform_admin(auth.uid())`. No insert/update/delete grant for client roles. Inserts go through `private.write_admin_audit`, which is not executable by `anon` or `authenticated`.

Mutations that write a row: hide/unhide, ghost-pin hide, `force_cancel_mission`, `admin_set_ai_verdict`, `admin_factory_reset` (logged before the wipe; the log table is not deleted), token grant / set balance, wallet balance, ban, verify, KYC moderate, `resolve_mission_dispute`, and `admin_delete_mission` (still a hard delete, now audited). The panel has an Audit tab with server-side search and pagination.

### Soft-hide

`missions.hidden_at` / `missions.hidden_by`. The panel, Profile, and map admin buttons call `admin_set_mission_hidden` instead of `admin_delete_mission`. Unhide is on Mission control (visibility filter: hidden). Ghost pins (`pending_payment` older than 24h) are soft-hidden by `admin_hide_stale_ghost_pins`, not deleted.

`missions_select_all` is `hidden_at IS NULL OR is_platform_admin(auth.uid())`. That covers the map, live feed, and profile lists because they use the user JWT. Service-role Edge Functions still see hidden rows (RLS does not apply). `admin_delete_mission` remains for an operator who really needs a cascade delete; the UI does not call it.

`trg_protect_mission_lifecycle_columns` now also blocks client writes to `hidden_at` / `hidden_by`. Column UPDATE is revoked from anon and authenticated. `photo_urls` UPDATE for participants is unchanged.

### Search, filters, stuck queue

`admin_search_missions(p_query, p_status, p_hidden, p_queue, p_limit, p_offset)` returns `{ rows, total }`. Blank `p_status` is every status (no whitelist). `p_queue = 'stuck'` is review / pending approval / awaiting approval / pending verification / disputed / dispute, plus `in_progress` that already has after photos. It **excludes** `completed`, `finished`, `approved`, `cancelled`, `expired`, and `failed`. The old stuck list included every `completed` mission that had a cleaner; that was the bug.

`admin_search_profiles` searches name, email, phone, telegram, id, and store name, with the same `{ rows, total }` shape. Page size in the panel is 25.

`admin_marketplace_counts()` feeds the pulse cards (visible active vs completed). It does not change `admin_financial_metrics`. If the new RPC is missing, the panel falls back to the old metrics call, which still reads `active_missions` / `completed_missions` and therefore still shows 0 until this SQL is applied.

### Panel shell

`AdminDashboard` is `React.lazy` from Profile and renders in a `document.body` portal (`fixed inset-0`) so the profile card's transform does not trap it. Browser admin gates (the panel, the crown button, and the map admin action) call `supabase.rpc('is_platform_admin', { p_uid })`. The old email / telegram check in `src/lib/platformAdmin.ts` is gone.

`alert()`, `confirm()`, and the factory-reset `prompt()` in the admin panel (including KYC review) are an in-panel toast plus a confirm dialog. Factory reset still requires typing `NUKE`, `VITE_ENABLE_FACTORY_RESET=true`, and `private.app_config allow_factory_reset = 'true'`.

## SupervisorDashboard

Removed `components/SupervisorDashboard.tsx`. Nothing imported it. Dispute moderation for platform admins is the Disputes tab (`resolve_mission_dispute`). The file also depended on `profiles.is_supervisor`, which this repo never creates (only a conditional SELECT grant and the dispute RPC). Mounting it would have added a second moderation screen on a column we cannot assume exists.

## Chosen not to do

- Did not change `force_cancel_mission` refund logic (product decision still open; see [[04_Roadmap_Tasks/Admin_P0_Hardening]]).
- Did not replace `admin_financial_metrics` or depend on the unapplied 20260721 columns (`active_missions` is a new RPC instead).
- Did not drop `admin_delete_mission`. Operators can still hard-delete; the panel will not.
- Did not add `.is('hidden_at', null)` to public client selects. That would break the map if the frontend deployed before the column existed. RLS is the exclusion.
- Did not filter hidden missions inside service-role Edge Functions (checkout, city PDF). A caller who already has the mission id can still hit those paths. The map and feeds cannot.
- Did not `db push`. (The file was later applied to prod on 2026-09-27; see below.)

## Applied to prod (2026-09-27)

Applied from the Mac with `supabase db query --linked -f supabase/migrations/20260927_admin_p1_upgrade.sql`, then `supabase migration repair --linked --status applied 20260927` (history row only, no `db push`). PR #31 squash-merged to `main` as `44cf836`.

**Drift check (live vs this file, before apply).** Every replaced function was dumped with `pg_get_functiondef` and diffed against the migration:

- `force_cancel_mission`: live body identical (legacy frozen→wallet refund, `Insufficient frozen balance` check); only the audit call is added.
- `admin_set_ai_verdict`, `admin_factory_reset`, `admin_grant_tokens`, `admin_set_token_balance`, `admin_set_wallet_balance`, `admin_set_profile_banned`, `admin_set_profile_verified`, `moderate_kyc_verification`, `resolve_mission_dispute(uuid,text,text,boolean,uuid)`, `admin_delete_mission`: live business logic identical. The file adds before-state reads (`SELECT … FOR UPDATE`, with the `NOT FOUND` check moved before the UPDATE, which behaves the same) plus the audit call.
- `protect_mission_lifecycle_columns`: live Wave F body plus `hidden_at` / `hidden_by`.
- **One drift, fixed:** the file narrowed `search_path` from live `public, extensions, net, pg_temp` to `public, pg_temp` on 8 functions (`admin_delete_mission`, `admin_grant_tokens`, `admin_set_token_balance`, `admin_set_wallet_balance`, `admin_set_profile_banned`, `admin_set_profile_verified`, `moderate_kyc_verification`, `resolve_mission_dispute`). Restored the live value (commit `7f2b3c2` on the PR branch). It was harmless in practice because every trigger those functions fire sets its own search_path, but the rule is to keep the live body.
- Policies: live missions already had exactly one SELECT policy, `missions_select_all` with `USING (true)` for anon + authenticated. The old "Allow users to read all missions" policy was already gone. No other permissive SELECT policy exists, so hidden rows really are hidden, and no creator or cleaner read path loses access. The UPDATE and DELETE policies are unchanged.
- Every column the new RPCs use exists on live (`profiles.contact_email`, `phone_number`, `first_gps_track` jsonb, `token_balance` int4; `contractor_stores.owner_id` / `updated_at`; `missions.after_photo_urls` text[]). `private.app_config` and `public.is_platform_admin` exist. The views `admin_user_monitor` and `mission_donors_view` are `security_invoker`, so they follow the new policy too.

**Dry run.** Ran the whole file inside `BEGIN … ROLLBACK` together with the role tests below. The post-flight DO block passed, and after the rollback nothing had changed.

**Verification on live (role simulation, rolled back).**

| Check | Result |
| --- | --- |
| anon / non-admin missions visible | 5 / 5 (total 5, same as before) |
| anon `admin_search_missions` | `permission denied` (no EXECUTE) |
| non-admin `admin_search_missions` / `admin_search_profiles` / `admin_marketplace_counts` / `admin_set_mission_hidden` / `admin_hide_stale_ghost_pins` | `42501 forbidden` |
| non-admin UPDATE `missions.hidden_at` | `permission denied for table missions` |
| non-admin SELECT / INSERT `admin_audit_log` | 0 rows / `permission denied` |
| admin search missions / stuck / profiles | 5 / 0 / 20 |
| admin `admin_marketplace_counts` | 1 active / 0 completed |
| admin hides 1 mission → anon & non-admin see | 4 (admin still sees 5, 1 audit row) |

The `npm run build` passes. `tsc` shows only the 2 known `LiveMarketFeed.tsx` errors.

**Left open**

- A legacy overload, `resolve_mission_dispute(p_mission_id uuid, p_verdict boolean, p_supervisor_comment text)`, is still live with **no auth check** and EXECUTE for PUBLIC/anon. It writes `profiles.balance_egp` / `frozen_balance` and reads `public.bids`. This migration does not touch it. Revoke or drop it in a follow-up once confirmed unused.
- `sum(profiles.frozen_balance)` on live is negative (−4113). This was already the case before P1 and has not been investigated.
