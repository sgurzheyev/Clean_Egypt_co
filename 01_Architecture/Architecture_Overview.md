# Garbagin — Architecture Overview

> Vault hub for the Garbagin marketplace. Master index: [[🗺️ GARBAGIN Master Index]]. Use Obsidian Graph View to navigate linked notes and source files.

## Feature notes (keep the graph dense)

- [[01_Architecture/ARCHITECTURE_MARKETPLACE_2026]] — Contractor stores, lilac map coverage, tiered bids, trust badges, missions RLS 2026-07-26
- [[01_Architecture/Security_Audit_20260727]] — Pre-release RLS / PII / token-economy audit + hardening migration
- [[01_Architecture/KYC_Verification]] — WebRTC liveness, private `kyc_documents`, admin signed URLs
- [[01_Architecture/Security_and_RPCs]] — `submit_mission_proof`, locked contribute RPC, EGP removal
- [[01_Architecture/P2P_Deal_Flow]] — USD direct payment + dispute (no fiat escrow)
- [[01_Architecture/Stripe_USD_Flow]] — Checkout crowdfunding, tokens, `crowdfunding_expires_at` timer
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] — eco-ultimatum, Gov Notice, 7-day Garbage History, R2 archive
- [[01_Architecture/Global_Location_Filtering]] — `location_catalog`, autofill trigger, multi-country filter + facets
- Frontend map: [[02_Frontend/Frontend_Components]]
- Field dashboard: [[04_Roadmap_Tasks/00_Dashboard]]
- Migrations MOC: [[03_Backend_SQL/SQL_Migrations_Index]]

## Stack

- **Frontend:** React 19 + Vite + Tailwind (neon / glassmorphism)
- **Map:** Mapbox via `react-map-gl` ([[../components/MapPicker.tsx]])
- **AR:** WebXR via `@react-three/xr` ([[../src/components/AROverlay.tsx]])
- **Backend:** Supabase (PostgreSQL + RLS + Edge Functions)
- **Economy:** USD-only fiat + platform tokens (no EGP) — [[01_Architecture/Stripe_USD_Flow]], [[01_Architecture/Security_and_RPCs]]
- **Master index:** [[🗺️ GARBAGIN Master Index]]
- **Frontend map:** [[02_Frontend/Frontend_Components]]
- **Migrations MOC:** [[03_Backend_SQL/SQL_Migrations_Index]]

## Entry & shell

| Concern | Link |
| --- | --- |
| App shell / routes / AR toggle | [[../App.tsx]] |
| Bootstrap | [[../index.tsx]] |
| Project rules | [[../.cursorrules]] |
| Field dashboard | [[04_Roadmap_Tasks/00_Dashboard]] |

## Core UI

| Surface | Link |
| --- | --- |
| Map (missions create / bid / crowdfund / stores) | [[../components/MapPicker.tsx]] |
| Store coverage editor / lilac zone | [[../components/StoreCoverageMap.tsx]] |
| Store pin preview card | [[../components/MapStorePreviewCard.tsx]] |
| Portaled storefront overlay | [[../components/StoreProfileOverlay.tsx]] |
| My Store panel | [[../components/ContractorStorePanel.tsx]] |
| Public store card | [[../components/PublicStoreCard.tsx]] |
| Shareable B2B storefront page | [[../components/StorefrontPage.tsx]] |
| Mission detail / contribute / bid | [[../components/MissionBriefing.tsx]] |
| Profile sidebar | [[../components/Profile.tsx]] |
| Auth overlay | [[../components/AuthOverlay.tsx]] |
| Live market feed | [[../components/LiveMarketFeed.tsx]] |
| WebXR AR overlay | [[../src/components/AROverlay.tsx]] |
| Admin moderation + [[01_Architecture/KYC_Verification]] queue | [[../src/components/AdminDashboard.tsx]], [[../src/components/KYCReviewDashboard.tsx]] |
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
| Global country/city filter | [[../src/lib/globalMarketplace.ts]] |
| Location catalog + facets fetch | [[../src/lib/locationCatalogSource.ts]] |
| Location catalog hook | [[../src/hooks/useLocationCatalog.ts]] |
| Contractor stores CRUD + polygon utils | [[../src/lib/contractorStore.ts]] |
| Tiered bid packages | [[../src/lib/bidPackages.ts]] |
| Mission bids + accept package | [[../src/lib/missionBids.ts]] |
| Zero-KYC trust badges + share URL | [[../src/lib/trustBadges.ts]] |
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
| Mission `country` / `city` columns | [[../supabase/migrations/20260725_mission_country_city.sql]] |
| Location catalog + autofill trigger + facets | [[../supabase/migrations/20260726_global_location_catalog.sql]] |
| Trigger border fix | [[../supabase/migrations/20260726_fix_location_trigger_border.sql]] |
| Missions RLS + spatial CHECKs | [[../supabase/migrations/20260726_missions_schema_hardening.sql]] |
| Contractor stores | [[../supabase/migrations/20260726_contractor_stores.sql]] |
| Supplies / bundles / recurrence | [[../supabase/migrations/20260726_store_supplies_bundles_recurrence.sql]] |
| Tiered bid packages | [[../supabase/migrations/20260726_tiered_bid_packages.sql]] |
| Marketplace architecture note | [[ARCHITECTURE_MARKETPLACE_2026]] |
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
  ├── country / city                → Global filter + location badges (autofilled by trigger)
  ├── status                        → funding | available | in_progress | review | completed | expired
  ├── expected_price                → USD work budget / crowdfund target
  ├── current_funding               → USD raised (crowdfunding)
  ├── crowdfunding_expires_at       → funding window (default 7d)
  ├── amount_target                 → platform token bid
  └── crowdfunding_mode             → Garbage Removal campaigns
```

**Flows**

1. **Standard ([[P2P_Deal_Flow]]):** `available` → bid → work → proof → confirm (no platform escrow)
2. **Crowdfunding ([[Stripe_USD_Flow]], [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]):** free pin 7d → first Stripe donate → `funding` + rolling +30d; target met → work; underfunded with money → eco-ultimatum (Gov Notice, n8n, 7-day history, R2 archive); $0 at 7d → hide/delete
3. **KYC ([[KYC_Verification]]):** docs + liveness → `pending` → admin approve → home missions unlocked
4. **AR:** GPS origin + mission lat/lng → local ENU → neon markers ([[../src/components/AROverlay.tsx]])
5. **Location ([[Global_Location_Filtering]]):** pin → Mapbox reverse geocode → `country`/`city` (trigger fills gaps from `location_catalog`) → multi-country filter + facet counts

## Graph convention

- Central hub: [[🗺️ GARBAGIN Master Index]]; also open [[04_Roadmap_Tasks/00_Dashboard]]
- Prefer folder wiki links: `[[01_Architecture/KYC_Verification]]`, `[[01_Architecture/Security_and_RPCs]]`, `[[01_Architecture/P2P_Deal_Flow]]`, `[[01_Architecture/Stripe_USD_Flow]]`
- Source paths relative to vault root folders (e.g. `[[../src/components/AROverlay.tsx]]` from `01_Architecture/`)
