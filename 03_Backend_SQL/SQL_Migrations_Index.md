---
tags: [backend, database, migrations, moc]
aliases: [Database Migrations MOC, SQL Migrations Index]
---

# 🗄️ Database Migrations MOC

> Central index of all Supabase SQL migrations for **Garbagin.Co**.  
> Product goals: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] · Vault hub: [[🗺️ GARBAGIN Master Index]]

This Map of Content (MOC) clusters every migration file into one Obsidian graph hub so the vault graph stays readable. Each row links the `.sql` note and summarizes what that change did in plain English.

**Related audit:** [[03_Backend_SQL/AUDIT_phone_missions_access]]

**Layout on disk:** active migrations live in `supabase/migrations/`; historical / superseded scripts live under `supabase/migrations/archive/`.

---

## Active migrations (canonical)

Chronological — June–July 2026 token / crowdfunding / privacy stack.

| Date | Migration | Summary |
|------|-----------|---------|
| 2026-06-17 | [[20260617_garbage_crowdfunding.sql]] | Adds crowdfunding mode, expiry, and `city_notification_events` for Garbage Removal campaigns. |
| 2026-06-18 | [[20260618_stripe_contribution_checkout.sql]] | Stripe Checkout idempotency for USD crowdfunding contributions. |
| 2026-06-19 | [[20260619_usd_only_currency.sql]] | Pivots economy columns/RPCs from EGP to USD-only. |
| 2026-07-19 | [[20260719_fix_create_lead_omit_pin_fee.sql]] | Fixes lead-create RPC for live USD schema drift; enforces $5 minimum budget. |
| 2026-07-19 | [[20260719_lock_crowdfunding_and_accept_bids.sql]] | Locks contribute path to service-role; tightens `accept_mission_bid` status gate. |
| 2026-07-19 | [[20260719_moderate_mission_dispute_p2p.sql]] | P2P dispute moderation without escrow wallet payouts. |
| 2026-07-19 | [[20260719_submit_mission_proof_rpc.sql]] | Secure `submit_mission_proof` path (`in_progress` → `review`). |
| 2026-07-20 | [[20260720_add_contributions_stripe_session_id.sql]] | Ensures Stripe session id column exists for contribution idempotency. |
| 2026-07-20 | [[20260720_crowdfunding_expiry_cron.sql]] | Expiry sweep: underfunded funding → `expired` + city notification queue. |
| 2026-07-20 | [[20260720_drop_contributions_amount_egp.sql]] | Drops legacy `amount_egp` blocking USD Stripe inserts. |
| 2026-07-20 | [[20260720_fix_kyc_admin_list_and_media.sql]] | Enriches pending KYC admin list with auth email / media helpers. |
| 2026-07-20 | [[20260720_fix_stripe_contribution_service_role.sql]] | Lets Edge Functions call `apply_stripe_contribution` with service role. |
| 2026-07-20 | [[20260720_kyc_admin_moderation.sql]] | Admin approve/reject KYC RPCs and rejection reason column. |
| 2026-07-20 | [[20260720_kyc_identity_verification.sql]] | Worker KYC status fields + private `kyc_documents` storage RLS. |
| 2026-07-20 | [[20260720_proof_of_work_lifecycle_security.sql]] | GPS gate, reject-proof, abandoned/stuck review cron automations. |
| 2026-07-21 | [[20260721_cleanup_legacy_finance_rpcs.sql]] | Removes legacy payout/withdrawal RPCs after token-only pivot. |
| 2026-07-21 | [[20260721_mission_sort_indexes_and_public_profile.sql]] | Mission sort indexes + safe `get_public_profile` (no phone). |
| 2026-07-21 | [[20260721_ratings_reviews_notifications.sql]] | Reviews, rating aggregates, and in-app notifications tables. |
| 2026-07-22 | [[20260722_stabilize_crowdfunding_proof_concurrency.sql]] | Hardens contribution concurrency, expiry races, and GPS audit. |
| 2026-07-22 | [[20260722_dynamic_crowdfunding_timers.sql]] | Phase 1: 7-day create timer; +30 days on each successful pay. |
| 2026-07-22 | [[20260722_place_mission_bid_crowd_funding.sql]] | Phase 1.2: bid during `funding`; 1-token stake on crowdfunding. |
| 2026-07-22 | [[20260722_city_notification_pipeline.sql]] | Phase 2: PDF pipeline columns, storage bucket, completion enqueue, pg_net trigger. |
| 2026-07-23 | [[20260723_city_notification_webhook_app_config.sql]] | Stores Edge URL/key in `private.app_config` (no `ALTER DATABASE`). |
| 2026-07-23 | [[20260723_hide_client_phone_until_bid_accept.sql]] | Phase 3: phone column lockdown + RPCs until accepted bid. |
| 2026-07-23 | [[20260723_public_profile_contract_phone.sql]] | Public profile member_since + contract-gated client phone RPC. |
| 2026-07-23 | [[20260723_p2p_chat_system.sql]] | Phase 4: `mission_chats` table, participant RLS, Realtime publication. |
| 2026-07-23 | [[20260723_dynamic_funding_bid_acceptance.sql]] | Accept bids during `funding`; bump `expected_price` to market bid; pre-lock cleaner until funds catch up. |
| 2026-07-23 | [[20260723_lifecycle_chat_notifications.sql]] | Bell feed: title/message + Realtime; triggers for chat, bids, funding lifecycle. |
| 2026-07-23 | [[20260723_fix_reviews_cleaner_id.sql]] | `submit_review` always sets legacy `cleaner_id`; profile reviews include comments. |
| 2026-07-23 | [[20260723_push_device_tokens.sql]] | Phase 5: `user_push_tokens` + RLS + pg_net bridge to `send-push-notification`. |
| 2026-07-25 | [[20260725_mission_country_city.sql]] | Adds `missions.country` / `missions.city`; create RPCs accept and normalize them. |
| 2026-07-26 | [[20260726_global_location_catalog.sql]] | `location_catalog` (54 countries / 318 cities), `haversine_km()`, NULL backfill, autofill trigger, and `list_mission_location_facets()`. |
| 2026-07-26 | [[20260726_missions_schema_hardening.sql]] | Enable RLS on missions, spatial CHECKs, reassert location trigger. |
| 2026-07-26 | [[20260726_contractor_stores.sql]] | Contractor storefronts: office pin, coverage polygon, services, materials, photos + RLS + `get_contractor_store()`. |

### Roadmap phase quick links

- **Phase 1 (timers + crowd-bid):** [[20260722_dynamic_crowdfunding_timers.sql]] · [[20260722_place_mission_bid_crowd_funding.sql]]
- **Phase 2 (city PDF):** [[20260722_city_notification_pipeline.sql]] · [[20260723_city_notification_webhook_app_config.sql]]
- **Phase 3 (privacy):** [[20260723_hide_client_phone_until_bid_accept.sql]]
- **Global location filter:** [[20260725_mission_country_city.sql]] · [[20260726_global_location_catalog.sql]] · [[20260726_fix_location_trigger_border.sql]] → [[01_Architecture/Global_Location_Filtering]]

---

## Archive migrations (historical)

Superseded or pre–token-economy scripts. Kept for archaeology; prefer active files above for live schema.

### March 2026 — escrow / payouts / disputes

| Migration | Summary |
|-----------|---------|
| [[20260317_completion_audit_trail.sql]] | Completion audit trail for mission finishes. |
| [[20260317_manual_payouts.sql]] | Manual payout plumbing (pre–token pivot). |
| [[20260318_add_ai_vision.sql]] | AI vision columns / hooks for mission media. |
| [[20260318_add_payout_details.sql]] | Payout destination fields on profiles. |
| [[20260318_admin_panel_pro.sql]] | Admin financial metrics and panel RPCs. |
| [[20260318_mission_status_cooldown.sql]] | Cooldown rules between mission status changes. |
| [[20260318_secure_storage_limits.sql]] | Storage bucket size / mime hardening. |
| [[20260319_add_liveness_coords.sql]] | Liveness check coordinate fields. |
| [[20260319_allow_liveness_video_mime.sql]] | Allows liveness video MIME types in storage. |
| [[20260319_dispute_resolution_retries.sql]] | Dispute retry / resolution flow. |
| [[20260319_fix_dispute_rpc.sql]] | Fixes dispute resolution RPC edge cases. |
| [[20260319_fix_reject_invalid_funding.sql]] | Rejects invalid crowdfunding / funding states. |
| [[20260319_liveness_video_report.sql]] | Liveness video report persistence. |
| [[20260319_liveness_webrtc_bucket.sql]] | Storage bucket for WebRTC liveness clips. |
| [[20260320_escrow_payout_split_90_051_049.sql]] | Legacy escrow payout split (90 / 5.1 / 4.9). |
| [[20260321_double_spend_escrow_lock.sql]] | Locks escrow to prevent double-spend. |
| [[20260322_cleaner_cannot_mark_completed.sql]] | Prevents cleaners from self-completing missions. |
| [[20260323_fix_escrow_cents_normalization.sql]] | Normalizes escrow amounts to integer cents. |
| [[20260324_supervisor_split_trust_metrics.sql]] | Supervisor share + trust metrics. |
| [[20260325_withdrawal_exit_tax.sql]] | Withdrawal exit-tax / cash-out RPCs. |
| [[20260326_platform_fee_exit_supervisor_ledger.sql]] | Platform fee ledger for supervisor exits. |
| [[20260327_withdrawal_frozen_cap_platform_reserve.sql]] | Caps withdrawals by frozen balance / reserve. |
| [[20260328_mission_bid_security_deposit.sql]] | Legacy 50% bid security-deposit trigger (later dropped). |
| [[20260330_internal_egp_economy.sql]] | Internal EGP economy rules (pre–USD-only). |
| [[20260331_complete_funding_and_assign.sql]] | Completes funding and assigns worker in one path. |

### April–May 2026 — public missions, wallet, tokens

| Migration | Summary |
|-----------|---------|
| [[20260401_resolve_mission_skip_frozen_when_funded.sql]] | Resolve mission without frozen hold when already funded. |
| [[20260401_transactions_status_column_if_missing.sql]] | Adds `transactions.status` if missing. |
| [[20260402_resolve_mission_integer_egp.sql]] | Integer EGP resolve / payout path. |
| [[20260407_create_public_mission_with_fee_49.sql]] | Public mission create with fixed pin fee. |
| [[20260408_create_public_mission_with_fee_integer_amount.sql]] | Public mission create with integer fee amounts. |
| [[20260409_cancel_pending_payment_mission.sql]] | Cancels unpaid pending-payment missions. |
| [[20260410_complete_public_mission_with_report.sql]] | Completes public mission with report payload. |
| [[20260411_pay_mission_from_wallet.sql]] | Pay mission pin/budget from wallet balance. |
| [[20260412_platform_settings_usd_rate.sql]] | Platform USD/EGP rate settings. |
| [[20260413_secure_wallet_topup_stripe.sql]] | Secures Stripe wallet top-up credit path. |
| [[20260430_tokens_and_subscriptions.sql]] | Introduces token balances + SaaS subscriptions. |
| [[20260505_fix_lead_mission_defaults.sql]] | Fixes default fields when creating lead missions. |

### June 2026 — SaaS bid model (archived precursors)

| Migration | Summary |
|-----------|---------|
| [[20260611_drop_security_deposit_trigger.sql]] | Removes legacy security-deposit trigger (SaaS pivot). |
| [[20260611_mission_token_bid.sql]] | Early token-aware mission bid RPC. |
| [[20260612_mission_expected_price.sql]] | Expected price / work budget on missions. |
| [[20260613_accept_mission_bid.sql]] | Accept / reject mission bid RPCs. |
| [[20260614_confirm_mission_direct_payment.sql]] | Confirms direct P2P mission payment. |
| [[20260615_admin_delete_mission.sql]] | Admin-only mission delete RPC. |
| [[20260616_mission_category_from_service.sql]] | Derives mission category from service type. |

---

## Edge functions & API (linked from Master Index)

Full list lives on [[🗺️ GARBAGIN Master Index]] under **Backend & Supabase Schemas**. Primary touchpoints:

- [[supabase/functions/stripe-contribution-checkout/index.ts]]
- [[supabase/functions/stripe-contribution-confirm/index.ts]]
- [[supabase/functions/stripe-webhook/index.ts]]
- [[supabase/functions/kyc-admin-signed-urls/index.ts]]
- [[supabase/functions/city-notification-pipeline/index.ts]]
- [[supabase/functions/send-push-notification/index.ts]]
- [[api/process-expired-crowdfunding.ts]]
- [[03_Backend_SQL/AUDIT_phone_missions_access]]

---

## How to use in Obsidian

1. Open graph view → center on [[🗺️ GARBAGIN Master Index]], then expand this MOC for SQL density.
2. Prefer linking new migrations from this MOC when you add files under `supabase/migrations/`.
3. Keep product narrative in [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]; keep schema history here.
4. Always add a back-link from new backend notes to [[🗺️ GARBAGIN Master Index]].
