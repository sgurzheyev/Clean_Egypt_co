---
tags: [moc, hub, garbagin]
aliases: [GARBAGIN Master Index, Vault Hub, Map of Content]
---

# 🗺️ GARBAGIN Master Index

> **Central gravitational hub** for the Garbagin vault.  
> Open **Graph View**, filter to this note, and expand neighbors — notes + source files should form one star cluster, not floating islands.

Every major note below links back here. Source paths are wiki-linked so they appear as graph nodes attached to this hub.

---

## Vault structure

| Folder | Hub note |
| --- | --- |
| Architecture | [[01_Architecture/Architecture_Overview]] |
| Frontend | [[02_Frontend/Frontend_Components]] |
| Backend / SQL | [[03_Backend_SQL/SQL_Migrations_Index]] |
| Edge & API | [[03_Backend_SQL/Backend_Edge_and_API]] |
| Roadmap | [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] |
| Lifecycle audit / Wave A–I | [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] · [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] · [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] |
| Map RUSH | [[04_Roadmap_Tasks/Map_Rush_Mode]] |
| Archive | [[05_Archive/Garbagin_Roadmap_Update]] |
| Field dashboard | [[04_Roadmap_Tasks/00_Dashboard]] |

---

## Core Architecture & State

### Architecture notes
- [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/ARCHITECTURE_MARKETPLACE_2026]]
- [[01_Architecture/KYC_Verification]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[01_Architecture/Stripe_USD_Flow]]
- [[01_Architecture/Global_Location_Filtering]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] — eco-ultimatum / Garbage History / Gov Notice
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] — P0-3 overfund auto-refund + P1-4 reporter-only convert
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] — P1-1 donor-reject retry + P1-2 no silent crowd abandon + P3-3 confirm RPC
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] — P2-3 token rank ≠ USD + P2-4 Profile `approved` + P3-4 funded DELETE
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] — P2-1 7-day Garbage History + P2-1b R2 purge + P2-1c n8n + P2-2 feed filters
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] — vault + CLI history hygiene (no product change)
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] — SEC-1 `platform_admins` + SEC-2 mission column freeze
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] — LIFE-1 underfund accept + LIFE-2 reject RPC + LIFE-3 expiry unlock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] — SEC-5 push token lock + fail-closed Edge + Hungry-Games subscription
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] — SEC-4 Vercel user JWT on AI / notify APIs
- [[04_Roadmap_Tasks/Map_Rush_Mode]] — RUSH live planes/ships + H2H night land
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — `supabase migration repair` for `20260912_*` / `20260917_*`
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] — P0→H + Hungry-Games SQL + Edge apply order · Wave I Vercel JWT (no SQL)
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]] — read-only lifecycle scorecard (PR #2)
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] — post–Wave E E2E bug search (F/G/H/I shipped; SEC-4 closed)

### App shell & config
- [[App.tsx]]
- [[index.tsx]]
- [[index.html]]
- [[index.css]]
- [[constants.ts]]
- [[.cursorrules]]
- [[vite.config.ts]]
- [[package.json]]
- [[README.md]]

### Clients & shared libs
- [[services/supabase.ts]]
- [[lib/supabaseClient.ts]]
- [[lib/telegram.ts]]
- [[hooks/useLocalization.ts]]
- [[src/i18n.ts]]

### Domain state / money / missions (`src/lib`)
- [[src/lib/crowdfunding.ts]]
- [[src/lib/contributions.ts]]
- [[src/lib/stripe.ts]]
- [[src/lib/tokenPricing.ts]]
- [[src/lib/walletCredit.ts]]
- [[src/lib/formatMoney.ts]]
- [[src/lib/integerUsdInput.ts]]
- [[src/lib/missionBudget.ts]]
- [[src/lib/missionBids.ts]]
- [[src/lib/submitMissionProof.ts]]
- [[src/lib/updateMissionDetails.ts]]
- [[src/lib/missionContact.ts]]
- [[src/lib/missionDescription.ts]]
- [[src/lib/missionContentPolicy.ts]]
- [[src/lib/missionFilterSort.ts]]
- [[src/lib/missionFeedVisuals.ts]]
- [[src/lib/missionEcoHeroes.ts]]
- [[src/lib/missionPhotoModeration.ts]]
- [[src/lib/missionTranslation.ts]]
- [[src/lib/garbageZoneReport.ts]]
- [[src/lib/egyptMarketplace.ts]]
- [[src/lib/globalMarketplace.ts]]
- [[src/lib/locationCatalogSource.ts]]
- [[src/lib/serviceSectors.ts]]
- [[src/lib/showFreeReports.ts]]
- [[src/lib/homeMissionAccess.ts]]
- [[src/lib/kycDocuments.ts]]
- [[src/lib/supabaseAuth.ts]]
- [[src/lib/supabaseFunctionError.ts]]
- [[src/lib/reviews.ts]]
- [[src/lib/notifications.ts]]
- [[src/lib/platformAdmin.ts]]
- [[src/lib/adminMission.ts]]
- [[src/lib/creatorDeleteMission.ts]]
- [[src/lib/cityNotification.ts]]
- [[src/lib/mutedCreators.ts]]
- [[src/lib/imageBase64.ts]]
- [[src/lib/openai.ts]]
- [[src/lib/withdrawalTax.ts]]

### Hooks
- [[src/hooks/useLocationCatalog.ts]]
- [[src/hooks/useMissionChat.ts]]
- [[src/hooks/useMissionTextTranslation.ts]]
- [[src/hooks/useMutedCreators.ts]]
- [[src/hooks/usePushNotifications.ts]]
- [[src/hooks/useRealWeather.ts]]
- [[src/hooks/useTelegram.ts]]
- [[hooks/useLocalization.ts]]

---

## Frontend Components & Map

> Detail map: [[02_Frontend/Frontend_Components]]

### Map & missions
- [[components/MapPicker.tsx]]
- [[components/MapFunModeControls.tsx]]
- [[components/MissionBriefing.tsx]]
- [[components/MissionBriefingErrorBoundary.tsx]]
- [[components/MissionFilterPanel.tsx]]
- [[components/MissionFeedCard.tsx]]
- [[components/MissionDescriptionText.tsx]]
- [[components/TranslatableMissionDescription.tsx]]
- [[components/CreateMission.tsx]]
- [[components/ReportGarbageZoneModal.tsx]]
- [[components/LiveMarketFeed.tsx]]
- [[components/BidsTerminal.tsx]]
- [[components/PhotoUploader.tsx]]
- [[components/ModeratedMissionPhoto.tsx]]
- [[components/EcoHeroesRibbon.tsx]]
- [[components/ImpactCardModal.tsx]]
- [[components/RatingReviewModal.tsx]]

### Profile, auth, chrome
- [[components/Profile.tsx]]
- [[components/DonorProofReview.tsx]]
- [[components/ProfileCard.tsx]]
- [[components/PublicProfile.tsx]]
- [[components/Auth.tsx]]
- [[components/AuthOverlay.tsx]]
- [[components/Header.tsx]]
- [[components/NotificationBell.tsx]]
- [[components/ModeToggle.tsx]]
- [[components/Slider.tsx]]
- [[components/EmailCaptureGate.tsx]]
- [[components/TryFree.tsx]]
- [[components/Privacy.tsx]]
- [[components/Terms.tsx]]

### Verification, admin, AR, weather, commerce
- [[components/VerificationModal.tsx]]
- [[components/SupervisorDashboard.tsx]]
- [[src/components/AdminDashboard.tsx]]
- [[src/components/KYCReviewDashboard.tsx]]
- [[src/components/LivenessCheck.tsx]]
- [[src/components/PhantomCapture.tsx]]
- [[src/components/AROverlay.tsx]]
- [[src/components/WeatherOverlay.tsx]]
- [[src/components/WeatherDebugPanel.tsx]]
- [[src/components/SubscriptionModal.tsx]]
- [[src/components/TokenPackModal.tsx]]
- [[src/components/chat/MissionChatPanel.tsx]]

### Map / weather libs
- [[src/lib/mapEgyptTheme.ts]]
- [[src/lib/mapFunMode.ts]]
- [[src/lib/mapLiveTraffic.ts]]
- [[src/lib/openskyFlights.ts]]
- [[src/lib/aisShips.ts]]
- [[src/lib/mapSolarAtmosphere.ts]]
- [[src/lib/mapWeather.ts]]
- [[src/lib/mapboxReverseGeocode.ts]]
- [[src/lib/openMeteoWeather.ts]]
- [[src/hooks/useMapLiveTraffic.ts]]
- [[components/MapFunModeControls.tsx]]
- [[src/services/pushNotifications.ts]]

---

## Backend & Supabase Schemas

> Migrations MOC: [[03_Backend_SQL/SQL_Migrations_Index]] · Edge/API MOC: [[03_Backend_SQL/Backend_Edge_and_API]] · Audit: [[03_Backend_SQL/AUDIT_phone_missions_access]]

### Edge functions
- [[supabase/functions/stripe-contribution-checkout/index.ts]]
- [[supabase/functions/stripe-contribution-confirm/index.ts]]
- [[supabase/functions/stripe-webhook/index.ts]]
- [[supabase/functions/_shared/contributionRefund.ts]]
- [[supabase/functions/stripe-wallet-credit/index.ts]]
- [[supabase/functions/stripe-token-intent/index.ts]]
- [[supabase/functions/stripe-token-credit/index.ts]]
- [[supabase/functions/stripe-subscription-intent/index.ts]]
- [[supabase/functions/stripe-subscription-activate/index.ts]]
- [[supabase/functions/stripe-intent/index.ts]]
- [[supabase/functions/create-payment-intent/index.ts]]
- [[supabase/functions/kyc-admin-signed-urls/index.ts]]
- [[supabase/functions/city-notification-pipeline/index.ts]]
- [[supabase/functions/garbage-history-purge/index.ts]]
- [[supabase/functions/_shared/n8nEcoUltimatum.ts]]
- [[supabase/functions/send-push-notification/index.ts]]

### Vercel / API routes
- [[api/process-expired-crowdfunding.ts]] — Wave H secret equality (not user JWT)
- [[api/_lib/requireUser.ts]] — Wave I shared JWT + membership
- [[api/verify-job-payment.ts]]
- [[api/notify-mission-submitted.ts]]
- [[api/notify-dispute.ts]]
- [[api/moderate-mission-image.ts]]
- [[api/moderate-mission-photo-safety.ts]]
- [[api/analyze-mission.ts]]
- [[api/translate.ts]]
- [[api/opensky-states.ts]] — RUSH OpenSky proxy
- [[api/adsb-nearby.ts]] — RUSH ADSB proxy
- [[api/_lib/adsbNearbyFetch.ts]]

### Manual SQL / ops
- [[supabase/manual/kyc_documents_storage_policies.sql]]
- [[supabase/manual/configure_city_notification_webhook.sql]]
- [[supabase/manual/configure_garbage_history_purge.sql]]
- [[supabase/manual/configure_push_webhook.sql]]
- [[supabase/manual/RESET_TEST_DATA.sql]]
- [[supabase/manual/AUDIT_phone_missions_access]]
- [[supabase/manual/20260912_p0_expiry_first_donate_verify.sql]]
- [[supabase/manual/20260912_wave_a_refund_convert_verify.sql]]
- [[supabase/manual/20260912_wave_b_verify.sql]]
- [[supabase/manual/20260912_wave_c_verify.sql]]
- [[supabase/manual/20260912_wave_d_verify.sql]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]

### Active migrations (canonical Jun–Jul 2026+)
- [[supabase/migrations/20260617_garbage_crowdfunding.sql]]
- [[supabase/migrations/20260618_stripe_contribution_checkout.sql]]
- [[supabase/migrations/20260619_usd_only_currency.sql]]
- [[supabase/migrations/20260719_fix_create_lead_omit_pin_fee.sql]]
- [[supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]
- [[supabase/migrations/20260719_moderate_mission_dispute_p2p.sql]]
- [[supabase/migrations/20260719_submit_mission_proof_rpc.sql]]
- [[supabase/migrations/20260720_add_contributions_stripe_session_id.sql]]
- [[supabase/migrations/20260720_crowdfunding_expiry_cron.sql]]
- [[supabase/migrations/20260720_drop_contributions_amount_egp.sql]]
- [[supabase/migrations/20260720_fix_kyc_admin_list_and_media.sql]]
- [[supabase/migrations/20260720_fix_stripe_contribution_service_role.sql]]
- [[supabase/migrations/20260720_kyc_admin_moderation.sql]]
- [[supabase/migrations/20260720_kyc_identity_verification.sql]]
- [[supabase/migrations/20260720_proof_of_work_lifecycle_security.sql]]
- [[supabase/migrations/20260721_cleanup_legacy_finance_rpcs.sql]]
- [[supabase/migrations/20260721_mission_sort_indexes_and_public_profile.sql]]
- [[supabase/migrations/20260721_ratings_reviews_notifications.sql]]
- [[supabase/migrations/20260722_stabilize_crowdfunding_proof_concurrency.sql]]
- [[supabase/migrations/20260722_dynamic_crowdfunding_timers.sql]]
- [[supabase/migrations/20260722_place_mission_bid_crowd_funding.sql]]
- [[supabase/migrations/20260722_city_notification_pipeline.sql]]
- [[supabase/migrations/20260723_city_notification_webhook_app_config.sql]]
- [[supabase/migrations/20260723_hide_client_phone_until_bid_accept.sql]]
- [[supabase/migrations/20260723_public_profile_contract_phone.sql]]
- [[supabase/migrations/20260723_p2p_chat_system.sql]]
- [[supabase/migrations/20260723_dynamic_funding_bid_acceptance.sql]]
- [[supabase/migrations/20260723_lifecycle_chat_notifications.sql]]
- [[supabase/migrations/20260723_fix_reviews_cleaner_id.sql]]
- [[supabase/migrations/20260723_push_device_tokens.sql]]
- [[supabase/migrations/20260724_creator_update_mission_details.sql]]
- [[supabase/migrations/20260724_garbage_zone_reports.sql]]
- [[supabase/migrations/20260724_list_mission_eco_heroes.sql]]
- [[supabase/migrations/20260724_restore_crowdfunding_contribution_timer_bump.sql]]
- [[supabase/migrations/20260725_mission_country_city.sql]]
- [[supabase/migrations/20260726_global_location_catalog.sql]]
- [[supabase/migrations/20260726_fix_location_trigger_border.sql]]
- [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]]
- [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]]
- [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]]
- [[supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]]
- [[supabase/migrations/20260912_wave_d_garbage_history_window.sql]]
- [[supabase/migrations/20260917_wave_f_security_hardening.sql]]
- [[supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]]
- [[supabase/migrations/20260917_wave_h_surface_hardening.sql]]
- [[supabase/migrations/20260917_hungry_games_subscription_gate.sql]]

Full history (incl. archive): [[03_Backend_SQL/SQL_Migrations_Index]]

---

## Roadmap & Tasks

- [[04_Roadmap_Tasks/00_Dashboard]] — field / active-dev checklist
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] — product roadmap to store release
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] — crowdfunding eco-ultimatum, Gov Notice, 7-day Garbage History
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] — overfund refund + creator-only unpaid convert
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] — failed retry + crowd abandon exclude + P2P confirm RPC
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] — token rank ≠ USD + Profile approved + funded DELETE
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] — 7-day Garbage History + R2 purge + n8n
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] — vault + CLI history hygiene
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] — admin allowlist + mission column lock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] — underfund accept + reject RPC + expiry unlock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] — push token lock + fail-closed Edge + Hungry-Games sub
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] — Vercel user JWT on AI / notify (SEC-4)
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — mark `20260912` / `20260917` applied (no `db push`)
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] — P0→H + Hungry-Games paste order + Edge redeploys · Wave I Vercel JWT
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]] — audit scorecard vs canon
- [[05_Archive/Garbagin_Roadmap_Update]] — superseded status report
- [[.cursorrules]] — product + UI rules of engagement

### Feature → note shortcuts
| Feature | Note | Primary code |
| --- | --- | --- |
| Crowdfunding / Stripe USD | [[01_Architecture/Stripe_USD_Flow]] | [[src/lib/contributions.ts]], [[components/MissionBriefing.tsx]] |
| Eco-ultimatum / Garbage History | [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] | [[src/lib/cityNotification.ts]], [[supabase/functions/city-notification-pipeline/index.ts]] |
| Lifecycle audit / Wave A | [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] | [[supabase/functions/_shared/contributionRefund.ts]], [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] |
| Lifecycle Wave B | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] | [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]], [[components/DonorProofReview.tsx]] |
| Lifecycle Wave C | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] | [[supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]], [[components/Profile.tsx]] |
| Lifecycle Wave D | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] | [[supabase/migrations/20260912_wave_d_garbage_history_window.sql]], [[supabase/functions/garbage-history-purge/index.ts]], [[src/lib/crowdfunding.ts]] |
| Lifecycle Wave E / CLI history | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] | [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] |
| Lifecycle Wave F | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] | [[supabase/migrations/20260917_wave_f_security_hardening.sql]], [[src/lib/platformAdmin.ts]] |
| Lifecycle Wave G | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] | [[supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]], [[src/lib/missionBids.ts]] |
| Lifecycle Wave H / Hungry-Games sub | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] | [[supabase/migrations/20260917_wave_h_surface_hardening.sql]], [[supabase/migrations/20260917_hungry_games_subscription_gate.sql]], [[components/MapPicker.tsx]] |
| Lifecycle Wave I / SEC-4 | [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] | [[api/_lib/requireUser.ts]], [[api/analyze-mission.ts]], [[src/lib/supabaseAuth.ts]] |
| Map RUSH / live craft | [[04_Roadmap_Tasks/Map_Rush_Mode]] | [[components/MapFunModeControls.tsx]], [[src/lib/mapLiveTraffic.ts]], [[api/opensky-states.ts]], [[api/adsb-nearby.ts]] |
| P2P deals (no escrow) | [[01_Architecture/P2P_Deal_Flow]] | [[src/lib/submitMissionProof.ts]], [[src/lib/missionBids.ts]] |
| Security / RPCs | [[01_Architecture/Security_and_RPCs]] | [[supabase/migrations/20260719_submit_mission_proof_rpc.sql]] |
| KYC | [[01_Architecture/KYC_Verification]] | [[components/VerificationModal.tsx]], [[src/lib/kycDocuments.ts]] |
| Map / glass UI | [[02_Frontend/Frontend_Components]] | [[components/MapPicker.tsx]], [[components/Profile.tsx]] |
| Phone privacy audit | [[03_Backend_SQL/AUDIT_phone_missions_access]] | [[supabase/migrations/20260723_hide_client_phone_until_bid_accept.sql]] |
| Multi-country filter / location facets | [[01_Architecture/Global_Location_Filtering]] | [[src/lib/globalMarketplace.ts]], [[components/MissionFilterPanel.tsx]] |

---

## Graph tips

1. Center Graph View on **this note** — degree should be highest in the vault.
2. Category notes ([[02_Frontend/Frontend_Components]], [[03_Backend_SQL/SQL_Migrations_Index]], [[01_Architecture/Architecture_Overview]]) are secondary hubs that also point here.
3. Prefer path wiki-links (`[[components/MapPicker.tsx]]`, `[[01_Architecture/KYC_Verification]]`) so renames stay unambiguous.
4. New major file? Add one bullet under the matching section above **and** a back-link line in its category note.
