# Audit notes — phone & missions access (Jul 2026 / post Phase 3)

## `profiles.phone_number`
- `SELECT` revoked for `anon` / `authenticated` in `20260723_hide_client_phone_until_bid_accept.sql`.
- Allowed reads: `get_own_phone_number`, `get_mission_client_phone`, `get_mission_worker_phone`, `admin_get_profile_phones` (all `SECURITY DEFINER`).
- Do not re-`GRANT SELECT (phone_number)` to `authenticated` without revisiting Phase 3 privacy.

## `missions`
- Map/briefing load missions via PostgREST without joining creator phone.
- Client phone unlock is RPC-only; crowdfunding always returns `NULL`.
- No redundant conflicting phone RLS found in-repo migrations (policies for `profiles` rows remain separate from column privileges).
