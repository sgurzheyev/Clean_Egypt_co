# 🚀 Garbagin Dashboard

> Vault hub: [[🗺️ GARBAGIN Master Index]]

## Architecture hub
- [[01_Architecture/Architecture_Overview]] — full system map (Graph View)
- [[01_Architecture/KYC_Verification]] — liveness + private `kyc_documents` + admin signed URLs
- [[01_Architecture/Security_and_RPCs]] — `submit_mission_proof`, USD-only, locked crowdfunding RPCs
- [[01_Architecture/P2P_Deal_Flow]] — direct payment deal lifecycle + disputes
- [[01_Architecture/Stripe_USD_Flow]] — Checkout contribute, tokens, crowdfunding expiry
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] — free pin → rolling crowdfund → Gov Notice / n8n → 7-day history → R2 archive
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] — overfund auto-refund + reporter-only unpaid convert
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] — donor-reject retry + no silent crowd abandon + P2P confirm RPC
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] — token rank ≠ USD + Profile `approved` + funded DELETE lock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] — 7-day Garbage History + R2 purge + n8n
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]] — canon vs code scorecard
- [[02_Frontend/Frontend_Components]] — UI / map component map
- [[03_Backend_SQL/SQL_Migrations_Index]] — migrations MOC
- [[03_Backend_SQL/Backend_Edge_and_API]] — edge functions & API routes

## 1. Активная разработка
- [[AROverlay]]: Статус внедрения WebXR → [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/Stripe_USD_Flow]]: Экономика в USD + crowdfunding timer (`crowdfunding_expires_at`)
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]: Эко-ультиматум, Gov Notice, «История мусора»
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]: P0-3 refund / P1-4 convert lock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]: P1-1 reject-retry / P1-2 crowd abandon exclude / P3-3 confirm RPC
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]: P2-3 token rank / P2-4 Profile `approved` / P3-4 funded DELETE
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]: P2-1 history 7d / P2-1b R2 purge / P2-1c n8n / P2-2 feed filters
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]: аудит стейт-машины
- [[01_Architecture/KYC_Verification]]: Admin KYC queue + signed media
- [[01_Architecture/P2P_Deal_Flow]]: Proof → review → P2P confirm (no escrow)

## 2. Инфраструктура
- **База**: Supabase (RLS, Edge Functions, optional `pg_cron`)
- **Деплой**: Vercel
- **Rules**: [[.cursorrules]]
- **Key libs**: [[src/lib/contributions]], [[src/lib/crowdfunding]], [[src/lib/kycDocuments]], [[src/lib/supabaseAuth]]

## 3. План действий (Полевой тест)
- [ ] Тест AR в Хургаде:
    - [ ] Запуск сессии WebXR
    - [ ] GPS-позиционирование маркеров
    - [ ] Корректность отображения прогресса сбора средств
- [ ] Crowdfunding: Stripe contribute → funding bar → expiry countdown → `expired` + city queue
- [ ] Wave A: two Checkouts for last `$N` → loser auto-refund; neighbor cannot unpaid-convert another user’s report ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]])
- [ ] Wave B: donor reject on crowd proof → cleaner re-uploads (`in_progress`); funded crowd survives 24h abandon; Profile P2P confirm RPC exists ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]])
- [ ] Wave C: map sort is token rank (not USD); Profile History shows `approved`; funded creator DELETE is rejected ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]])
- [ ] Wave D: underfunded expiry stays on map/feed 7 days then archives; R2 purge cron; n8n fires only when webhook URL is set ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]])
- [ ] KYC: submit → admin signed preview → approve/reject
- [ ] P2P: bid → proof → creator confirm

## Graph tips
Open Graph View and center on [[🗺️ GARBAGIN Master Index]] or [[01_Architecture/Architecture_Overview]] — wiki-links fan out to [[01_Architecture/KYC_Verification]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/P2P_Deal_Flow]], [[01_Architecture/Stripe_USD_Flow]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]], and [[docs/GARBAGIN_LIFECYCLE_AUDIT]].
