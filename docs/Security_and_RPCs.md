# Security and RPCs

> Hardened server paths: no client escrow mutation, USD-only money columns, service-role Stripe apply. Links: [[Architecture_Overview]], [[KYC_Verification]], [[P2P_Deal_Flow]], [[Stripe_USD_Flow]].

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
| `confirm_mission_*` / client confirm | Creator | P2P “work done” — see [[P2P_Deal_Flow]] |
| `process_abandoned_missions` | Cron / service_role | `in_progress` idle >24h → `available` (clears `cleaner_id`) |
| `process_stuck_reviews` | Cron / service_role | `review` idle >3d → `completed` + `auto_approved` |
| `apply_stripe_contribution` | **service_role only** | Idempotent on `stripe_checkout_session_id`; writes `amount_usd` only |
| `contribute_to_mission` | Locked | Revoked from `authenticated` — Stripe path only ([[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]) |
| `submit_kyc_verification` | Worker | After Storage upload ([[KYC_Verification]]) |
| `moderate_kyc_verification` | Admin | Approve / reject |
| `process_expired_crowdfunding_missions` | Cron / service_role | `funding` → `expired` + city notification queue |
| `accept_mission_bid` | Creator | Only `available` / `pending` |
| `admin_delete_mission` | Admin | Content moderation only |
| `is_platform_admin` | Shared | Email / role / telegram gates |

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
- Vault: [[../00_Dashboard]], [[Architecture_Overview]]
