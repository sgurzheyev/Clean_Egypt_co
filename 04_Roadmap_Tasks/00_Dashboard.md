# 🚀 Garbagin Dashboard

> Vault hub: [[🗺️ GARBAGIN Master Index]]

## Architecture hub
- [[01_Architecture/Architecture_Overview]] — full system map (Graph View)
- [[01_Architecture/KYC_Verification]] — liveness + private `kyc_documents` + admin signed URLs
- [[01_Architecture/Security_and_RPCs]] — `submit_mission_proof`, USD-only, locked crowdfunding RPCs
- [[01_Architecture/P2P_Deal_Flow]] — direct payment deal lifecycle + disputes
- [[01_Architecture/Stripe_USD_Flow]] — Checkout contribute, tokens, crowdfunding expiry
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] — free pin → rolling crowdfund → Gov Notice / n8n → 7-day history → R2 archive
- [[02_Frontend/Frontend_Components]] — UI / map component map
- [[03_Backend_SQL/SQL_Migrations_Index]] — migrations MOC
- [[03_Backend_SQL/Backend_Edge_and_API]] — edge functions & API routes

## 1. Активная разработка
- [[AROverlay]]: Статус внедрения WebXR → [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/Stripe_USD_Flow]]: Экономика в USD + crowdfunding timer (`crowdfunding_expires_at`)
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]: Эко-ультиматум, Gov Notice, «История мусора»
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
- [ ] KYC: submit → admin signed preview → approve/reject
- [ ] P2P: bid → proof → creator confirm

## Graph tips
Open Graph View and center on [[🗺️ GARBAGIN Master Index]] or [[01_Architecture/Architecture_Overview]] — wiki-links fan out to [[01_Architecture/KYC_Verification]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/P2P_Deal_Flow]], and [[01_Architecture/Stripe_USD_Flow]].
