---
title: Garbagin E2E Audit 2026-09-15
type: architecture
status: audit
updated: 2026-09-15
tags: [garbagin, audit, security, bugs, e2e]
aliases: [E2E audit Sep 15, post-Wave-E bug search]
---

# Garbagin end-to-end audit — 2026-09-15

Read-only bug search after Waves A–E. Does **not** change product behavior.
Prior lifecycle scorecard: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] (2026-09-12, all Wave items marked **Shipped**).

## Last push to `main`

| Field | Value |
| --- | --- |
| Tip | `5747602` — *Point the Wave E vault note at PR #8.* |
| When | **2026-09-12 11:49:21 UTC** (~3 days before this audit) |
| Author | Cursor Agent |
| Gap | No commits on `main` since Wave E close |
| PR hygiene | PRs [#2](https://github.com/sgurzheyev/Clean_Egypt_co/pull/2)–[#8](https://github.com/sgurzheyev/Clean_Egypt_co/pull/8) are **CLOSED** with `mergedAt: null` — code landed on `main` via direct push / agent merge, not GitHub “Merge” |

Ops still open from Wave E: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — confirm live DB `migration list` has no Local-only `20260912_*` (never blind `db push`).

---

## Executive verdict

Lifecycle Waves A–E closed the Sep-12 crowdfunding scorecard. This pass finds **new** security and state-machine holes that Waves did not cover:

1. **Critical** — any user can self-promote to platform admin by setting `telegram_username = 'sergiogurgini'`.
2. **Critical** — mission participants can UPDATE lifecycle/economy columns (`status`, `cleaner_id`, `current_funding`, …) via PostgREST.
3. **High** — `accept_mission_bid` can start underfunded crowdfunding work after a 100% raise flipped the pin to `available`.
4. **High** — several Edge/API surfaces fail open or have no auth.

Bid token debit (1 token / new bid), Stripe webhook signature verify, and Hungry-Games phone column REVOKE for **P2P** look intact.

---

## Scorecard (new findings)

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| SEC-1 | **P0** | Admin escalation via editable `telegram_username` | **Open** |
| SEC-2 | **P0** | `missions` full-row UPDATE for participants | **Open** |
| LIFE-1 | **P0** | Accept bid on fully-raised `available` crowd pin → `in_progress` even if bid > raised | **Open** |
| SEC-3 | **P1** | `send-push-notification` / `city-notification-pipeline` auth skip when secret unset (`verify_jwt=false`) | **Open** |
| SEC-4 | **P1** | Vercel `/api/analyze-mission`, `translate`, `moderate-*`, `notify-*` unauthenticated (OpenAI / Telegram burn) | **Open** |
| SEC-5 | **P1** | `upsert_user_push_token` steals token on `ON CONFLICT` (`user_id = uid`) | **Open** |
| LIFE-2 | **P1** | `reject_mission_bid` only in `migrations/archive/` — decline path fragile on fresh apply | **Open** |
| LIFE-3 | **P1** | Expiry leaves `cleaner_id` on `expired` underfunded pot; worker stranded | **Open** |
| OPS-1 | **P1** | `api/process-expired-crowdfunding.ts` is a non-functional stub (auth checks presence, not equality) | **Open** (prod path = `pg_cron` + Edge — verify hosted) |
| UX-1 | **P2** | “Subscribe to unlock” copy implies subscription bypasses Hungry-Games | **Open** |
| SEC-6 | **P2** | Chat-photos bucket public; R2 presign for `chat` / `mission-photos` lacks mission membership check | **Open** |
| OPS-2 | **P2** | `is_platform_admin` body only in archive; Wave `20260912_*` CLI history may still be Local-only | **Open** (ops) |
| NOTE-1 | — | Crowdfunding phone always NULL | **Intentional** per vault (not a regression) — conflicts with literal `.cursorrules` unlock-after-accept |

---

## P0 detail

### SEC-1 — Admin escalation via Telegram username

**Attack:** Authenticated user `UPDATE profiles SET telegram_username = 'sergiogurgini' WHERE id = auth.uid()`.

**Why it works:**
- `profiles` grants UPDATE on `telegram_username` (`20260727_security_hardening_rls_economy.sql` safe-column list).
- `is_platform_admin` (archive `20260615_admin_delete_mission.sql`, still the live definition unless manually replaced) returns true when `lower(telegram_username) = 'sergiogurgini'`.
- Client mirror: `src/lib/platformAdmin.ts`; KYC Edge fallback also trusts TG (`kyc-admin-signed-urls`).

**Impact:** `admin_delete_mission`, `admin_factory_reset`, phone RPCs, KYC signed URLs, wallet/token admin paths.

**Fix direction:**
1. Rewrite `is_platform_admin` to **only** `profiles.role = 'admin'` (or private allowlist table) set by service role.
2. Remove `telegram_username` from client UPDATE grants **or** stop using it as an auth factor.
3. Drop email/TG hardcodes from client + Edge fallbacks.
4. Audit any row already set to `sergiogurgini` that is not the founder.

### SEC-2 — Mission lifecycle forgery via RLS UPDATE

**Evidence:** `missions_update_participants` + `GRANT UPDATE … ON public.missions TO authenticated` in `20260726_missions_schema_hardening.sql` — no column grants, no `BEFORE UPDATE` freeze trigger. Profiles got column-lock treatment on 2026-07-27; missions did not.

**Impact:** Creator or assigned cleaner can PostgREST-set `status = 'completed'`, bump `current_funding`, reassign `cleaner_id`, etc., bypassing RPCs.

**Fix direction:** Same pattern as profiles — `REVOKE UPDATE` → `GRANT UPDATE (safe cols)` + trigger that rejects economy/status mutations unless `service_role` / DEFINER. Move before-photo updates into an RPC if needed.

### LIFE-1 — Underfunded start after `available` transition

**Flow:**
1. Crowd pin hits 100% with no cleaner → `apply_stripe_contribution` sets `status = 'available'` (`20260912_split_expiry_and_first_donate_wake.sql` ~308–331).
2. Creator accepts a bid **above** `current_funding`.
3. `accept_mission_bid` only stays in `funding` when `v_status = 'funding' AND raised < budget` (Wave C). On `available`, it always sets `in_progress`.

**Expected (.cursorrules):** Stay funding / reopen funding until raised ≥ accepted bid; only then `in_progress`.

**Fix direction:** Gate on `crowdfunding_mode AND raised < budget` (ignore status string); bump `expected_price`; force `funding` until filled. Align MapPicker optimistic UI with RPC result.

---

## P1 detail (short)

| ID | Evidence | Fix |
| --- | --- | --- |
| SEC-3 | `config.toml` `verify_jwt=false`; push/city skip auth when env secret empty | Fail closed; require service-role bearer or non-empty secret match |
| SEC-4 | `api/analyze-mission.ts` etc. — no JWT | Require user JWT + participant/admin; rate-limit |
| SEC-5 | `upsert_user_push_token` conflict sets `user_id = uid` | Reject conflict unless same owner |
| LIFE-2 | `reject_mission_bid` only under `migrations/archive/` | Promote to active migration |
| LIFE-3 | Wave D expiry keeps `cleaner_id` on `expired` | Clear lock + reject bids, or recovery RPC |
| OPS-1 | Vercel stub returns 200 placeholder | Wire or delete; verify `pg_cron` + `city-notification-pipeline` on host |

---

## What still looks correct

| Area | Notes |
| --- | --- |
| 1 token / new bid | `20260826_place_mission_bid_always_one_token.sql` |
| Accept during `funding` | Locks cleaner, bumps `expected_price`, stays `funding` if under (Wave C) |
| 100% + cleaner → `in_progress` | Contribution path OK |
| P2P phone Hungry-Games | Column SELECT revoked; unlock via RPC for non-crowd |
| Chat pair-only RLS | `20260825_mission_chats_pair_only_rls.sql` |
| Funding with cleaner on market feed | LiveMarketFeed / Profile filters |
| Stripe webhook | Signature verify in `stripe-webhook` |
| Overfund / convert / abandon / history | Waves A–D shipped per prior scorecard |
| Profile economy columns | Locked from client UPDATE (2026-07-27) |

---

## Product note — crowd phone unlock

Vault + prior audit: *“Crowd pins never expose a client phone.”*  
`.cursorrules`: unlock after accept / `cleaner_id`.

Treat as **product decision**, not a silent regression. If civic pins should stay anonymous, keep NULL and update `.cursorrules`. If workers need contact after lock-in, change `get_mission_client_phone` + UI short-circuit.

---

## Recommended fix order (next waves)

1. **Wave F (security):** SEC-1 admin rewrite + SEC-2 mission column lock  
2. **Wave G (lifecycle):** LIFE-1 accept-underfund + LIFE-2 reject RPC + LIFE-3 expiry unlock  
3. **Wave H (surfaces):** SEC-3/4/5 Edge+API auth + push token conflict  
4. **Ops:** confirm Wave E migration repair on live; cron/expiry path smoke test  

Field checklist on [[04_Roadmap_Tasks/00_Dashboard]] (AR / Stripe / Waves A–E) remains unchecked — schedule a hosted smoke after F/G.

---

## Method

- Code search across `supabase/migrations`, `supabase/functions`, `api/`, `components/`, `src/`, `services/`
- Cross-check vs `.cursorrules` + vault Waves A–E + prior [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
- Git: `origin/main` tip + GitHub PR list for push timing
