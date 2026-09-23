---
tags: [backend, edge, api, moc]
aliases: [Backend Edge and API]
---

# Backend — Edge Functions & API

> ← [[🗺️ GARBAGIN Master Index]] · Migrations: [[03_Backend_SQL/SQL_Migrations_Index]] · Security: [[01_Architecture/Security_and_RPCs]] · Stripe: [[01_Architecture/Stripe_USD_Flow]] · Wave I: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]

## Stripe / payments
- [[supabase/functions/stripe-contribution-checkout/index.ts]]
- [[supabase/functions/stripe-contribution-confirm/index.ts]]
- [[supabase/functions/stripe-webhook/index.ts]]
- [[supabase/functions/_shared/contributionRefund.ts]] — P0-3 paid-reject refund (confirm + webhook)
- [[supabase/functions/stripe-wallet-credit/index.ts]]
- [[supabase/functions/stripe-token-intent/index.ts]]
- [[supabase/functions/stripe-token-credit/index.ts]]
- [[supabase/functions/stripe-subscription-intent/index.ts]]
- [[supabase/functions/stripe-subscription-activate/index.ts]]
- [[supabase/functions/stripe-intent/index.ts]]
- [[supabase/functions/create-payment-intent/index.ts]]

## KYC / city / push
- [[supabase/functions/kyc-admin-signed-urls/index.ts]] — Wave H: no TG fallback
- [[supabase/functions/city-notification-pipeline/index.ts]] — Wave H fail-closed auth (`CITY_NOTIFICATION_WEBHOOK_SECRET` or service-role)
- [[supabase/functions/garbage-history-purge/index.ts]] — Wave D R2 purge after history window
- [[supabase/functions/_shared/n8nEcoUltimatum.ts]] — Wave D n8n (env-gated)
- [[supabase/functions/send-push-notification/index.ts]] — Wave H fail-closed auth (`PUSH_WEBHOOK_SECRET` or service-role)

## Vercel API routes
- [[api/_lib/requireUser.ts]] — Wave I shared user JWT + mission membership
- [[api/process-expired-crowdfunding.ts]] — Wave H: real RPC + secret equality (not user JWT)
- [[api/verify-job-payment.ts]] — Wave I: JWT on legacy no-op
- [[api/notify-mission-submitted.ts]] — Wave I: JWT + creator/cleaner/admin
- [[api/notify-dispute.ts]] — Wave I: JWT + creator/cleaner/admin
- [[api/moderate-mission-image.ts]] — Wave I: JWT + image size cap
- [[api/moderate-mission-photo-safety.ts]] — Wave I: JWT + image size cap
- [[api/analyze-mission.ts]] — Wave I: JWT + membership; still read-only
- [[api/translate.ts]] — Wave I: JWT + max text length
- [[api/opensky-states.ts]] — RUSH flights proxy (OpenSky; soft-empty on timeout)
- [[api/adsb-nearby.ts]] — RUSH flights proxy (self-contained; adsb.lol + adsb.fi; soft 200 `{ ac, error? }`)
- [[api/_lib/adsbNearbyFetch.ts]] — test helper copy (do **not** import from the ADSB handler; Vercel ESM + renameTStoJS)
- [[api/ais-nearby.ts]] — RUSH ships proxy (`ws` + permessage-deflate; binary UTF-8 frames; soft 200 `{ ships, error? }`)

## Clients
- [[services/supabase.ts]]
- [[src/lib/supabaseAuth.ts]]
- [[src/lib/supabaseFunctionError.ts]]
- [[src/lib/contributions.ts]]
- [[src/lib/cityNotification.ts]]

## Related notes
- [[03_Backend_SQL/AUDIT_phone_missions_access]]
- [[01_Architecture/KYC_Verification]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[🗺️ GARBAGIN Master Index]]
