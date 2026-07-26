---
tags: [frontend, ui, map, moc]
aliases: [Frontend Components, UI Map]
---

# Frontend Components

> ← [[🗺️ GARBAGIN Master Index]] · Architecture: [[01_Architecture/Architecture_Overview]] · Roadmap: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]

## Primary surfaces

| Surface | Link |
| --- | --- |
| Map (create / bid / crowdfund / stores) | [[components/MapPicker.tsx]] |
| Store coverage map (lilac zone) | [[components/StoreCoverageMap.tsx]] |
| Store pin preview | [[components/MapStorePreviewCard.tsx]] |
| Portaled store profile | [[components/StoreProfileOverlay.tsx]] |
| My Store panel | [[components/ContractorStorePanel.tsx]] |
| Public store card | [[components/PublicStoreCard.tsx]] |
| B2B storefront page | [[components/StorefrontPage.tsx]] |
| Trust badge pills | [[components/TrustBadgeRow.tsx]] |
| Store showcase sections | [[components/StoreShowcaseSections.tsx]] |
| Mission briefing / contribute / bid | [[components/MissionBriefing.tsx]] |
| Briefing error boundary | [[components/MissionBriefingErrorBoundary.tsx]] |
| Filters bottom sheet | [[components/MissionFilterPanel.tsx]] |
| Feed card | [[components/MissionFeedCard.tsx]] |
| Create mission | [[components/CreateMission.tsx]] |
| Report garbage zone | [[components/ReportGarbageZoneModal.tsx]] |
| Live market feed | [[components/LiveMarketFeed.tsx]] |
| Bids terminal | [[components/BidsTerminal.tsx]] |
| Profile floating glass card | [[components/Profile.tsx]] |
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
| Global CSS (sheets, glass, water) | [[index.css]] |
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
- [[src/lib/trustBadges.ts]]

## Related flows

- Marketplace stores / bids / map UX → [[01_Architecture/ARCHITECTURE_MARKETPLACE_2026]]
- Crowdfunding UI → [[01_Architecture/Stripe_USD_Flow]]
- P2P briefing CTAs → [[01_Architecture/P2P_Deal_Flow]]
- Country / city filter + map camera sync → [[01_Architecture/Global_Location_Filtering]]
- KYC gate → [[01_Architecture/KYC_Verification]]
- Field checklist → [[04_Roadmap_Tasks/00_Dashboard]]
- Full file list → [[🗺️ GARBAGIN Master Index]]
