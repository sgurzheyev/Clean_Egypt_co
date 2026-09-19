---
tags: [frontend, ui, map, moc]
aliases: [Frontend Components, UI Map]
---

# Frontend Components

> ← [[🗺️ GARBAGIN Master Index]] · Architecture: [[01_Architecture/Architecture_Overview]] · Roadmap: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] · Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · Wave E: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · Wave I: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]

## Primary surfaces

| Surface | Link |
| --- | --- |
| Map (create / bid / crowdfund / stores / Hungry-Games sub modal) | [[components/MapPicker.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] |
| Store coverage map (lilac zone) | [[components/StoreCoverageMap.tsx]] |
| Store pin preview | [[components/MapStorePreviewCard.tsx]] · `.map-store-preview-card` light frost (service zone stays visible through the sheet). Hero swipes all `contractor_stores.store_photos` (cover first); bio expands in-place. |
| Portaled store profile | [[components/StoreProfileOverlay.tsx]] |
| My Store panel | [[components/ContractorStorePanel.tsx]] |
| Public store card | [[components/PublicStoreCard.tsx]] |
| B2B storefront page | [[components/StorefrontPage.tsx]] |
| Trust badge pills | [[components/TrustBadgeRow.tsx]] |
| Store showcase sections | [[components/StoreShowcaseSections.tsx]] |
| Mission briefing / contribute / bid / reporter-only convert | [[components/MissionBriefing.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Map pin card matches store preview: hero is photos + X / count / dots only; category, price, location, status, token hint, description, and reporter chip sit in the dark body below. |
| Briefing error boundary | [[components/MissionBriefingErrorBoundary.tsx]] |
| Filters bottom sheet | [[components/MissionFilterPanel.tsx]] |
| Feed card | [[components/MissionFeedCard.tsx]] |
| Create mission | [[components/CreateMission.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] |
| Report garbage zone | [[components/ReportGarbageZoneModal.tsx]] |
| Live market feed (funding + 7-day Garbage History) | [[components/LiveMarketFeed.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] |
| Bids terminal | [[components/BidsTerminal.tsx]] |
| Profile floating glass card / P2P confirm + donor vote + approved history | [[components/Profile.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] |
| Donor proof review (approve / reject-retry) | [[components/DonorProofReview.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] |
| Public profile | [[components/PublicProfile.tsx]] |
| Auth overlay | [[components/AuthOverlay.tsx]] |
| Notification bell | [[components/NotificationBell.tsx]] |
| KYC modal | [[components/VerificationModal.tsx]] |
| Rating / review | [[components/RatingReviewModal.tsx]] |
| Impact card | [[components/ImpactCardModal.tsx]] |
| WebXR AR overlay | [[src/components/AROverlay.tsx]] |
| Mission chat | [[src/components/chat/MissionChatPanel.tsx]] |
| Admin + KYC queue | [[src/components/AdminDashboard.tsx]], [[src/components/KYCReviewDashboard.tsx]] |
| Token / subscription modals | [[src/components/TokenPackModal.tsx]], [[src/components/SubscriptionModal.tsx]] |

## Styling & theme

| Concern | Link |
| --- | --- |
| Global CSS (sheets, glass, water, store-pin frost) | [[index.css]] |
| Steel / profile glass tokens | [[constants.ts]] |
| Map Egypt theme | [[src/lib/mapEgyptTheme.ts]] |
| Map weather layers | [[src/lib/mapWeather.ts]] |
| PWA / home-screen app icon | [[public/brand/garbagin-app-icon-1024.png]] · [[scripts/export-app-icons.py]] |
| Project UI rules | [[.cursorrules]] |

### App icon (PWA install)

Home-screen / favicon artwork is a 3D glass-metal **G** (same silhouette family as the old ring-G: rounded C + mid-bar) on a full-bleed navy plate. Colors are pulled from the live UI, not a generic neon pair:

| Token | Hex | Where it already lives |
| --- | --- | --- |
| Navy glass | `#020617` `#0A0A12` `#05060a` | `index.css` `--uv-bg`, html/body, MapPicker night space |
| Violet / magenta CTA | `#8b5cf6` `#a855f7` `#c026ff` | Store / funding CTAs, MapBootSplash wordmark |
| Cyan map accent | `#22d3ee` | Glass neon, service-zone pins, splash gradient |
| Emerald eco tag | `#10b981` `#34d399` | `--uv-accent`, approve CTAs, history chips |

**Master:** `public/brand/garbagin-app-icon-1024.png` (1024×1024, square, no pre-drawn squircle — iOS/Android apply their own mask).

**Install copies** (rewritten by `python3 scripts/export-app-icons.py`):

| Path | Role |
| --- | --- |
| `public/icon-1024.png` | High-res `any` |
| `public/icon-512.png` / `public/icon-192.png` | Manifest + favicon `any` |
| `public/icon-512-maskable.png` / `public/icon-192-maskable.png` | Manifest `maskable` (G inset ~72% so a circular crop does not clip the letter) |
| `public/apple-touch-icon.png` | 180×180, `index.html` |

Wired in `public/manifest.json` and `index.html` (`theme-color` / `background_color` `#020617`). No Capacitor / Android `mipmap` / iOS `AppIcon` tree exists in this repo yet — when Play packaging lands, reuse the 1024 master. Do not change this mark to Paranoic cyan; keep the violet–magenta body + cyan rim.

## Hooks & helpers

- [[src/hooks/useLocationCatalog.ts]]
- [[src/hooks/useMissionChat.ts]]
- [[src/hooks/useMissionTextTranslation.ts]]
- [[src/hooks/usePushNotifications.ts]]
- [[src/hooks/useRealWeather.ts]]
- [[src/lib/missionFilterSort.ts]]
- [[src/lib/missionFeedVisuals.ts]]
- [[src/lib/garbageZoneReport.ts]]
- [[src/lib/globalMarketplace.ts]]
- [[src/lib/locationCatalogSource.ts]]
- [[src/lib/contractorStore.ts]]
- [[src/lib/bidPackages.ts]]
- [[src/lib/missionBids.ts]]
- [[src/lib/creatorDeleteMission.ts]]
- [[src/lib/trustBadges.ts]]

## Related flows

- Marketplace stores / bids / map UX → [[01_Architecture/ARCHITECTURE_MARKETPLACE_2026]]
- Crowdfunding UI → [[01_Architecture/Stripe_USD_Flow]]
- Reporter-only unpaid convert / first-donate form → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
- Donor reject retry / P2P confirm RPC → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- Token rank vs USD / Profile `approved` / funded DELETE → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- Garbage History 7d / expired pins → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · [[src/lib/crowdfunding.ts]]
- Vault / CLI history hygiene → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- Admin allowlist / mission column freeze → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- Underfund accept / reject bid RPC / expiry unlock → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- Push token lock / fail-closed Edge / Hungry-Games subscription → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- Vercel `/api/*` user JWT (translate / moderate / analyze / notify) → [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]
- P2P briefing CTAs → [[01_Architecture/P2P_Deal_Flow]]
- Country / city filter + map camera sync → [[01_Architecture/Global_Location_Filtering]]
- KYC gate → [[01_Architecture/KYC_Verification]]
- Field checklist → [[04_Roadmap_Tasks/00_Dashboard]]
- Full file list → [[🗺️ GARBAGIN Master Index]]
