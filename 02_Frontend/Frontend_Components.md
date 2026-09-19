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
| Store pin preview | [[components/MapStorePreviewCard.tsx]] · `.map-store-preview-card` light frost (service zone stays visible through the sheet) |
| Portaled store profile | [[components/StoreProfileOverlay.tsx]] |
| My Store panel | [[components/ContractorStorePanel.tsx]] |
| Public store card | [[components/PublicStoreCard.tsx]] |
| B2B storefront page | [[components/StorefrontPage.tsx]] |
| Trust badge pills | [[components/TrustBadgeRow.tsx]] |
| Store showcase sections | [[components/StoreShowcaseSections.tsx]] |
| Mission briefing / contribute / bid / reporter-only convert | [[components/MissionBriefing.tsx]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] |
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
| Project UI rules | [[.cursorrules]] |

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
