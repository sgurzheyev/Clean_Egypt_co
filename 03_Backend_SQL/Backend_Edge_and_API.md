---
tags: [backend, edge, api, moc]
aliases: [Backend Edge and API]
---

# Backend — Edge Functions & API

> ← [[🗺️ GARBAGIN Master Index]] · Migrations: [[03_Backend_SQL/SQL_Migrations_Index]] · Security: [[01_Architecture/Security_and_RPCs]] · Stripe: [[01_Architecture/Stripe_USD_Flow]]

## Stripe / payments
- [[supabase/functions/stripe-contribution-checkout/index.ts]]
- [[supabase/functions/stripe-contribution-confirm/index.ts]]
- [[supabase/functions/stripe-webhook/index.ts]]
- [[supabase/functions/stripe-wallet-credit/index.ts]]
- [[supabase/functions/stripe-token-intent/index.ts]]
- [[supabase/functions/stripe-token-credit/index.ts]]
- [[supabase/functions/stripe-subscription-intent/index.ts]]
- [[supabase/functions/stripe-subscription-activate/index.ts]]
- [[supabase/functions/stripe-intent/index.ts]]
- [[supabase/functions/create-payment-intent/index.ts]]

## KYC / city / push
- [[supabase/functions/kyc-admin-signed-urls/index.ts]]
- [[supabase/functions/city-notification-pipeline/index.ts]]
- [[supabase/functions/send-push-notification/index.ts]]

## Vercel API routes
- [[api/process-expired-crowdfunding.ts]]
- [[api/verify-job-payment.ts]]
- [[api/notify-mission-submitted.ts]]
- [[api/notify-dispute.ts]]
- [[api/moderate-mission-image.ts]]
- [[api/moderate-mission-photo-safety.ts]]
- [[api/analyze-mission.ts]]
- [[api/translate.ts]]

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
- [[🗺️ GARBAGIN Master Index]]
