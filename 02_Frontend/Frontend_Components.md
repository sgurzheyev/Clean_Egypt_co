---
tags: [frontend, ui, map, moc]
aliases: [Frontend Components, UI Map]
---

# Frontend Components

> UI / map surface map for CleanEgypt. Hub: [[🗺️ GARBAGIN Master Index]] · Architecture: [[01_Architecture/Architecture_Overview]]

## Primary surfaces

| Surface | Link |
| --- | --- |
| Map (create / bid / crowdfund) | [[components/MapPicker.tsx]] |
| Mission briefing / contribute / bid | [[components/MissionBriefing.tsx]] |
| Filters bottom sheet | [[components/MissionFilterPanel.tsx]] |
| Profile floating glass card | [[components/Profile.tsx]] |
| Report garbage zone | [[components/ReportGarbageZoneModal.tsx]] |
| Live market feed | [[components/LiveMarketFeed.tsx]] |
| Auth overlay | [[components/AuthOverlay.tsx]] |
| KYC modal | [[components/VerificationModal.tsx]] |
| WebXR AR overlay | [[src/components/AROverlay.tsx]] |
| Admin + KYC queue | [[src/components/AdminDashboard.tsx]], [[src/components/KYCReviewDashboard.tsx]] |

## Styling & theme

| Concern | Link |
| --- | --- |
| Global CSS (sheets, glass, water) | [[index.css]] |
| Steel / profile glass tokens | [[constants.ts]] |
| Map Egypt theme | [[src/lib/mapEgyptTheme.ts]] |
| Project UI rules | [[.cursorrules]] |

## Related flows

- Crowdfunding UI → [[01_Architecture/Stripe_USD_Flow]]
- P2P briefing CTAs → [[01_Architecture/P2P_Deal_Flow]]
- KYC gate → [[01_Architecture/KYC_Verification]]
- Field checklist → [[04_Roadmap_Tasks/00_Dashboard]]
