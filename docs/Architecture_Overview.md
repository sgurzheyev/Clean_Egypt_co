# CleanEgypt.co — Architecture Overview

> Vault hub for the CleanEgypt marketplace. Use Obsidian Graph View to navigate linked notes and source files.

## Feature notes (keep the graph dense)

- [[KYC_Verification]] — WebRTC liveness, private `kyc_documents`, admin signed URLs
- [[Security_and_RPCs]] — `submit_mission_proof`, locked contribute RPC, EGP removal
- [[P2P_Deal_Flow]] — USD direct payment + dispute (no fiat escrow)
- [[Stripe_USD_Flow]] — Checkout crowdfunding, tokens, `crowdfunding_expires_at` timer
- Field dashboard: [[../00_Dashboard]]

## Stack

- **Frontend:** React 19 + Vite + Tailwind (neon / glassmorphism)
- **Map:** Mapbox via `react-map-gl` ([[../components/MapPicker.tsx]])
- **AR:** WebXR via `@react-three/xr` ([[../src/components/AROverlay.tsx]])
- **Backend:** Supabase (PostgreSQL + RLS + Edge Functions)
- **Economy:** USD-only fiat + platform tokens (no EGP) — [[Stripe_USD_Flow]], [[Security_and_RPCs]]

## Entry & shell

| Concern | Link |
| --- | --- |
| App shell / routes / AR toggle | [[../App.tsx]] |
| Bootstrap | [[../index.tsx]] |
| Project rules | [[../.cursorrules]] |
| Field dashboard | [[../00_Dashboard]] |

## Core UI

| Surface | Link |
| --- | --- |
| Map (missions create / bid / crowdfund) | [[../components/MapPicker.tsx]] |
| Mission detail / contribute / bid | [[../components/MissionBriefing.tsx]] |
| Profile sidebar | [[../components/Profile.tsx]] |
| Auth overlay | [[../components/AuthOverlay.tsx]] |
| Live market feed | [[../components/LiveMarketFeed.tsx]] |
| WebXR AR overlay | [[../src/components/AROverlay.tsx]] |
| Admin moderation + [[KYC_Verification]] queue | [[../src/components/AdminDashboard.tsx]], [[../src/components/KYCReviewDashboard.tsx]] |
| KYC modal | [[../components/VerificationModal.tsx]] |

## Data clients

| Client | Link | Notes |
| --- | --- | --- |
| Canonical browser client | [[../services/supabase.ts]] | `createClient` lives here |
| Re-export alias | [[../lib/supabaseClient.ts]] | Prefer importing from services |
| Auth resolve / refresh | [[../src/lib/supabaseAuth.ts]] | Used by KYC + Stripe confirm |
| Edge error parsing | [[../src/lib/supabaseFunctionError.ts]] | Surfaces RPC/Stripe messages |

## Domain libs (`src/lib`)

| Domain | Link |
| --- | --- |
| Crowdfunding helpers + countdown | [[../src/lib/crowdfunding.ts]] |
| Stripe contribution checkout | [[../src/lib/contributions.ts]] |
| KYC signed URLs | [[../src/lib/kycDocuments.ts]] |
| Wallet top-up Stripe helper | [[../src/lib/stripe.ts]] |
| Work budget (USD) | [[../src/lib/missionBudget.ts]] |
| Money formatters | [[../src/lib/formatMoney.ts]] |
| Service → sector / pin icon | [[../src/lib/serviceSectors.ts]] |
| City PDF payload (expiry) | [[../src/lib/cityNotification.ts]] |
| Trust / home KYC gate | [[../src/lib/homeMissionAccess.ts]] |

## Database migrations

Active folder: [[../supabase/migrations]]

| Topic | Migration |
| --- | --- |
| Crowdfunding schema + expire RPC | [[../supabase/migrations/20260617_garbage_crowdfunding.sql]] |
| Stripe contribution idempotency | [[../supabase/migrations/20260618_stripe_contribution_checkout.sql]] |
| USD-only currency | [[../supabase/migrations/20260619_usd_only_currency.sql]] |
| Lock free contribute + bid gate | [[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]] |
| `submit_mission_proof` | [[../supabase/migrations/20260719_submit_mission_proof_rpc.sql]] |
| P2P dispute moderate | [[../supabase/migrations/20260719_moderate_mission_dispute_p2p.sql]] |
| KYC identity | [[../supabase/migrations/20260720_kyc_identity_verification.sql]] |
| KYC admin | [[../supabase/migrations/20260720_kyc_admin_moderation.sql]] |
| Drop `amount_egp` | [[../supabase/migrations/20260720_drop_contributions_amount_egp.sql]] |
| Crowdfunding 7d expiry + cron | [[../supabase/migrations/20260720_crowdfunding_expiry_cron.sql]] |
| Historical / archived | [[../supabase/migrations/archive]] |

Manual Storage policies (hosted): [[../supabase/manual/kyc_documents_storage_policies.sql]]

## Edge functions

| Purpose | Link | Doc |
| --- | --- | --- |
| Crowdfunding Checkout | [[../supabase/functions/stripe-contribution-checkout/index.ts]] | [[Stripe_USD_Flow]] |
| Crowdfunding confirm | [[../supabase/functions/stripe-contribution-confirm/index.ts]] | [[Stripe_USD_Flow]] |
| KYC admin signed URLs | [[../supabase/functions/kyc-admin-signed-urls/index.ts]] | [[KYC_Verification]] |
| Wallet / tokens / subscription | [[../supabase/functions]] | [[Stripe_USD_Flow]] |

## Mission model (mental map)

```
missions
  ├── location_lat / location_lng   → Map pins + AR markers
  ├── status                        → funding | available | in_progress | review | completed | expired
  ├── expected_price                → USD work budget / crowdfund target
  ├── current_funding               → USD raised (crowdfunding)
  ├── crowdfunding_expires_at       → funding window (default 7d)
  ├── amount_target                 → platform token bid
  └── crowdfunding_mode             → Garbage Removal campaigns
```

**Flows**

1. **Standard ([[P2P_Deal_Flow]]):** `available` → bid → work → proof → confirm (no platform escrow)
2. **Crowdfunding ([[Stripe_USD_Flow]]):** `funding` → Stripe contribute → target met → `available` → bid → complete; underfunded past `crowdfunding_expires_at` → `expired` + city queue
3. **KYC ([[KYC_Verification]]):** docs + liveness → `pending` → admin approve → home missions unlocked
4. **AR:** GPS origin + mission lat/lng → local ENU → neon markers ([[../src/components/AROverlay.tsx]])

## Graph convention

- This note is the hub; also open [[../00_Dashboard]]
- Prefer Obsidian wiki links: `[[KYC_Verification]]`, `[[Security_and_RPCs]]`, `[[P2P_Deal_Flow]]`, `[[Stripe_USD_Flow]]`
- Source paths relative to `docs/` (e.g. `[[../src/components/AROverlay.tsx]]`)
