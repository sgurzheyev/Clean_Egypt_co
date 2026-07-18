# CleanEgypt.co — Architecture Overview

> Vault hub for the CleanEgypt marketplace. Use Obsidian Graph View to navigate linked source files.

## Stack

- **Frontend:** React 19 + Vite + Tailwind (neon / glassmorphism)
- **Map:** Mapbox via `react-map-gl` ([[../components/MapPicker.tsx]])
- **AR:** WebXR via `@react-three/xr` ([[../src/components/AROverlay.tsx]])
- **Backend:** Supabase (PostgreSQL + RLS + Edge Functions)
- **Economy:** USD-only fiat + platform tokens (no EGP)

## Entry & shell

| Concern | Link |
| --- | --- |
| App shell / routes / AR toggle | [[../App.tsx]] |
| Bootstrap | [[../index.tsx]] |
| Project rules | [[../.cursorrules]] |
| Field dashboard | [[../00_Dashboard.md]] |

## Core UI

| Surface | Link |
| --- | --- |
| Map (missions create / bid / crowdfund) | [[../components/MapPicker.tsx]] |
| Mission detail / contribute / bid | [[../components/MissionBriefing.tsx]] |
| Profile sidebar | [[../components/Profile.tsx]] |
| Auth overlay | [[../components/AuthOverlay.tsx]] |
| Live market feed | [[../components/LiveMarketFeed.tsx]] |
| WebXR AR overlay | [[../src/components/AROverlay.tsx]] |
| Admin moderation | [[../src/components/AdminDashboard.tsx]] |

## Data clients

| Client | Link | Notes |
| --- | --- | --- |
| Canonical browser client | [[../services/supabase.ts]] | `createClient` lives here |
| Re-export alias | [[../lib/supabaseClient.ts]] | Prefer importing from services; this file re-exports |

## Domain libs (`src/lib`)

| Domain | Link |
| --- | --- |
| Crowdfunding helpers | [[../src/lib/crowdfunding.ts]] |
| Stripe contribution checkout | [[../src/lib/contributions.ts]] |
| Wallet top-up Stripe helper | [[../src/lib/stripe.ts]] |
| Work budget (USD) | [[../src/lib/missionBudget.ts]] |
| Money formatters | [[../src/lib/formatMoney.ts]] |
| Service → sector / pin icon | [[../src/lib/serviceSectors.ts]] |

## Database migrations

Active (repo root of migrations folder):

- Folder: [[../supabase/migrations]]
- Crowdfunding schema + `contribute_to_mission`: [[../supabase/migrations/20260617_garbage_crowdfunding.sql]]
- Stripe contribution idempotency: [[../supabase/migrations/20260618_stripe_contribution_checkout.sql]]
- USD-only currency rename: [[../supabase/migrations/20260619_usd_only_currency.sql]]
- Historical / archived: [[../supabase/migrations/archive]]

## Edge functions (Stripe)

| Purpose | Link |
| --- | --- |
| Crowdfunding Checkout | [[../supabase/functions/stripe-contribution-checkout/index.ts]] |
| Crowdfunding confirm | [[../supabase/functions/stripe-contribution-confirm/index.ts]] |
| Wallet PaymentIntent | [[../supabase/functions/stripe-intent/index.ts]] |
| Wallet credit | [[../supabase/functions/stripe-wallet-credit/index.ts]] |

## Mission model (mental map)

```
missions
  ├── location_lat / location_lng   → Map pins + AR markers
  ├── status                        → available | funding | …
  ├── expected_price                → USD work budget / crowdfund target
  ├── current_funding               → USD raised (crowdfunding)
  ├── amount_target                 → platform token bid
  └── crowdfunding_mode             → Garbage Removal campaigns
```

**Flows**

1. **Standard:** `available` → bid → work → confirm (P2P, no platform escrow)
2. **Crowdfunding:** `funding` → Stripe contribute → target met → `available` → bid → complete
3. **AR:** GPS origin + mission lat/lng → local ENU meters → neon 3D markers ([[../src/components/AROverlay.tsx]])

## Graph convention

- This note is the hub: `[[Architecture_Overview.md]]`
- Core source files carry a top-of-file comment backlink: `[[Architecture_Overview.md]]`
- Prefer Obsidian wiki links with paths relative to `docs/` (e.g. `[[../src/components/AROverlay.tsx]]`)
