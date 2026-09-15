---
tags: [architecture, security, rpc]
aliases: [Security and RPCs, RPC lock]
---

# Security and RPCs

> Hardened server paths: no client escrow mutation, USD-only money columns, service-role Stripe apply. Links: [[🗺️ GARBAGIN Master Index]], [[01_Architecture/Architecture_Overview]], [[01_Architecture/KYC_Verification]], [[01_Architecture/P2P_Deal_Flow]], [[01_Architecture/Stripe_USD_Flow]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]], [[04_Roadmap_Tasks/Ops_Migration_History_Repair]], [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]], [[docs/GARBAGIN_LIFECYCLE_AUDIT]], [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]].

## Principles

1. **No platform fiat escrow** for standard jobs — P2P after proof ([[P2P_Deal_Flow]]).
2. **Crowdfunding** holds Stripe contributions until target or expiry ([[Stripe_USD_Flow]]).
3. **Clients never INSERT into `contributions`** — only service-role RPC after Stripe confirm.
4. **Status transitions** go through SECURITY DEFINER RPCs, not ad-hoc client `UPDATE`.

## Critical RPCs

| RPC | Role | Notes |
| --- | --- | --- |
| `submit_mission_proof` | Worker | `in_progress` → `review`; **PostGIS GPS ≤200m**; no wallet debit. [[../supabase/migrations/20260720_proof_of_work_lifecycle_security.sql]] |
| `creator_reject_proof` | Creator | `review` → `in_progress`; clears proof; stores `rejection_reason` |
| `confirm_mission_work_done` / `confirm_mission_direct_payment` | Creator | P2P “work done”: `review` / `pending_approval` → `completed`. Active tree (P3-3) — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] |
| `process_proof_vote` | Donor | First **approve** → `approved`. First **reject** → `in_progress` retry (not `failed`) — P1-1 |
| `process_abandoned_missions` | Cron / service_role | **P2P only:** `in_progress` idle >24h → `available` (clears `cleaner_id`). Crowdfunding excluded (P1-2) |
| `process_stuck_reviews` | Cron / service_role | `review` idle >3d → `completed` + `auto_approved` |
| `apply_stripe_contribution` | **service_role only** | Idempotent on `stripe_checkout_session_id`; writes `amount_usd` only; optional `p_target_usd` wakes `reported` (P0-2) |
| `claim_contribution_reject_refund` / `mark_contribution_reject_refund` | **service_role only** | P0-3 ledger for paid-but-rejected Checkout Sessions ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]) |
| `contribute_to_mission` | Locked | Revoked from `authenticated` — Stripe path only ([[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]) |
| `convert_report_to_mission` | **Creator only** | Unpaid launch; neighbors use first Stripe dollar (P1-4). USD → `expected_price`; `amount_target` = 1 (P2-3) |
| `submit_kyc_verification` | Worker | After Storage upload ([[KYC_Verification]]) |
| `moderate_kyc_verification` | Admin | Approve / reject |
| `process_expired_crowdfunding_missions` | Cron / service_role | `$0` → `hidden`; `0 < raised < target` → `expired` + `history_public_until` + city queue (P0-1 / P2-1) |
| `process_garbage_history_archives` | Cron / service_role | expired past `history_public_until` → `archived` (P2-1) |
| `claim_garbage_history_purge_batch` / `mark_garbage_history_media_purged` | **service_role only** | R2 purge claim + clear media (P2-1b) |
| `bump_garbage_history_public_until` | **service_role only** | GREATEST(window, now()+7d) when Gov Notice PDF is sent |
| `accept_mission_bid` | Creator | `available` / `pending` / `open` / **`funding`** (lock cleaner while still raising). USD → `expected_price` only; token rank untouched (P2-3) |
| `creator_delete_mission` | Creator | `$0` / unfunded pins only. Funded pot → reject (P3-4) |
| `mission_has_retained_funds` | Shared | `current_funding > 0` or any `contributions` row |
| `admin_delete_mission` | Admin | Content moderation only (still deletes funded rows) |
| `is_platform_admin` | Shared | Email / role / telegram gates — **open risk:** TG username self-set → admin ([[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] SEC-1) |

## Currency cleanup (EGP → USD)

- Missions & contributions use **`amount_usd`**, `expected_price`, `current_funding` in whole USD.
- Legacy `contributions.amount_egp` dropped: [[../supabase/migrations/20260720_drop_contributions_amount_egp.sql]]
- Stripe session id: [[../supabase/migrations/20260720_add_contributions_stripe_session_id.sql]]
- Overview rename: [[../supabase/migrations/20260619_usd_only_currency.sql]]

## Auth helpers (frontend)

- Session resolve / refresh: [[../src/lib/supabaseAuth.ts]]
- Edge error body parse: [[../src/lib/supabaseFunctionError.ts]]
- Canonical client: [[../services/supabase.ts]]

## Dispute moderation

Supervisor / admin dispute path is P2P-aligned (no escrow reverse): [[../supabase/migrations/20260719_moderate_mission_dispute_p2p.sql]] → [[P2P_Deal_Flow]].

## Graph

- Rules: [[../.cursorrules]]
- Vault: [[🗺️ GARBAGIN Master Index]], [[04_Roadmap_Tasks/00_Dashboard]], [[01_Architecture/Architecture_Overview]], [[04_Roadmap_Tasks/Garbage_History_Lifecycle]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]], [[04_Roadmap_Tasks/Ops_Migration_History_Repair]], [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
