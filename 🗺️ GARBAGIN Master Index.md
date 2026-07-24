---
tags: [moc, hub, garbagin, cleanegypt]
aliases: [GARBAGIN Master Index, Vault Hub, Map of Content]
---

# 🗺️ GARBAGIN Master Index

> Central Map of Content for the CleanEgypt / GARBAGIN Obsidian vault.  
> Open **Graph View** and center on this note — categories and core docs should cluster around it.

## Vault structure

| Folder | Purpose |
| --- | --- |
| [[01_Architecture/Architecture_Overview\|01_Architecture]] | System design, APIs, deal & money flows |
| [[02_Frontend/Frontend_Components\|02_Frontend]] | UI surfaces, map, styling notes |
| [[03_Backend_SQL/SQL_Migrations_Index\|03_Backend_SQL]] | Migrations, RPCs, SQL audits |
| [[04_Roadmap_Tasks/Roadmap_to_GooglePlay\|04_Roadmap_Tasks]] | Sprints, field dashboard, feature plans |
| [[05_Archive/CleanEgypt_Roadmap_Update\|05_Archive]] | Superseded status notes |

## Core hubs

- [[01_Architecture/Architecture_Overview]] — full system map
- [[04_Roadmap_Tasks/00_Dashboard]] — field / active-dev dashboard
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] — product roadmap to store release
- [[03_Backend_SQL/SQL_Migrations_Index]] — database migrations MOC
- [[02_Frontend/Frontend_Components]] — UI & map component map

## 01 — Architecture

- [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/KYC_Verification]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[01_Architecture/Stripe_USD_Flow]]

## 02 — Frontend

- [[02_Frontend/Frontend_Components]]
- [[components/MapPicker.tsx]]
- [[components/MissionBriefing.tsx]]
- [[components/Profile.tsx]]
- [[components/MissionFilterPanel.tsx]]
- [[src/components/AROverlay.tsx]]

## 03 — Backend / SQL

- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[03_Backend_SQL/AUDIT_phone_missions_access]]
- [[supabase/migrations]]

## 04 — Roadmap & tasks

- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[.cursorrules]]

## 05 — Archive

- [[05_Archive/CleanEgypt_Roadmap_Update]] — prior status report (superseded by Google Play roadmap)

## Graph tips

1. Start here → fan out to a category hub → drill into a feature note.
2. Prefer wiki links with folder paths (`[[01_Architecture/KYC_Verification]]`) so the graph stays clustered.
3. Source files (`components/…`, `supabase/…`) remain in the repo; notes only point at them.
