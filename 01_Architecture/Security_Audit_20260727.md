---
tags: [security, audit, rls, privacy]
aliases: [Security Audit 2026-07-27, Pre-release Security Hardening]
---

# Security & Data Leak Audit — 2026-07-27

> Pre-production / App Store review. Companion patch: [[../supabase/migrations/20260727_security_hardening_rls_economy.sql]] · Vault: [[🗺️ GARBAGIN Master Index]]

## Executive verdict

Phone unlock RPCs and crowdfunding write locks were largely designed correctly, but **live DB grants had drifted** into several CRITICAL holes: open `mission_bids`, self-mintable `token_balance`/`role`, re-exposed `phone_number`, and client-callable money RPCs. Frontend secrets were mostly clean (anon key only), with a Gemini Vite `define` footgun removed.

**Apply migration `20260727_security_hardening_rls_economy.sql` to production immediately**, then rotate any secrets that ever lived in git history.

---

## Findings (by severity)

| Severity | Finding | Status |
| --- | --- | --- |
| CRITICAL | `mission_bids` RLS off + anon TRUNCATE/UPDATE | **Patched** in migration |
| CRITICAL | Own-row UPDATE allowed `token_balance` / `wallet_balance` / `role` / `is_banned` | **Patched** (column REVOKE UPDATE) |
| CRITICAL | `phone_number` SELECT revoke had drifted | **Re-asserted** |
| CRITICAL | `credit_tokens_*` / `apply_stripe_contribution` EXECUTE for anon/auth | **Revoked** → service_role only |
| CRITICAL | notifications INSERT `WITH CHECK (true)` | **Dropped** |
| CRITICAL | `.env` with `SUPABASE_SERVICE_ROLE_KEY` in git history | **Ops: rotate keys** (not fixable by migration) |
| HIGH | AdminDashboard direct profile UPDATE/SELECT of finance PII | **Patched** → admin RPCs + TS |
| HIGH | `contributions` SELECT all authenticated | **Scoped** to donor/creator/admin |
| HIGH | TRUNCATE grants on sensitive tables | **Revoked** for API roles |
| MEDIUM | Telegram on pending bids (Hungry-Games gap) | **UI redaction** in `missionBids.ts` |
| MEDIUM | `token_balance` still SELECT-able (UPDATE locked) | Residual — consider own-RPC later |
| MEDIUM | Hardcoded admin identities in `is_platform_admin` | Residual — config/secrets later |

---

## Pillar notes

### 1. PII
- Phones: gated RPCs (`get_mission_client_phone`, etc.) remain the unlock path; column SELECT revoked again.
- Emails / wallet / GPS: SELECT revoked for API roles; `get_own_contact_email` + `admin_list_profiles_finance`.
- Feeds / store cards / `get_public_profile`: no phone/email/wallet — OK.

### 2. RLS
- `missions`, stores, supplies, chats, push tokens: previously solid; TRUNCATE revoked.
- `mission_bids`: RLS ON + participant SELECT only; writes via DEFINER RPCs.

### 3. Frontend secrets
- Browser client: `VITE_SUPABASE_URL` + anon key only (`services/supabase.ts`).
- Removed `GEMINI_API_KEY` from Vite `define`.
- **Rotate** service_role / Telegram / Paymob if they ever appeared in committed `.env`.

### 4. Token economy
- Bids / lead create remain SECURITY DEFINER RPCs.
- Clients can no longer `UPDATE profiles.token_balance`.
- Stripe contribution / credit-token RPCs are service_role-only again.

---

## Deploy checklist

1. `supabase db push` (or apply `20260727_security_hardening_rls_economy.sql` in SQL editor).
2. Confirm post-flight assertions succeed.
3. Smoke-test: place bid, accept bid, publish store, admin wallet edit, own profile email/phone.
4. Rotate compromised secrets; scrub git history if the repo was ever public.
