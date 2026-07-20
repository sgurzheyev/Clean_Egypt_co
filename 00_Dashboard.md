# 🚀 CleanEgypt Dashboard

## Architecture hub
- [[docs/Architecture_Overview]] — full system map (Graph View)
- [[docs/KYC_Verification]] — liveness + private `kyc_documents` + admin signed URLs
- [[docs/Security_and_RPCs]] — `submit_mission_proof`, USD-only, locked crowdfunding RPCs
- [[docs/P2P_Deal_Flow]] — direct payment deal lifecycle + disputes
- [[docs/Stripe_USD_Flow]] — Checkout contribute, tokens, crowdfunding expiry

## 1. Активная разработка
- [[AROverlay]]: Статус внедрения WebXR → [[docs/Architecture_Overview]]
- [[docs/Stripe_USD_Flow]]: Экономика в USD + crowdfunding timer (`crowdfunding_expires_at`)
- [[docs/KYC_Verification]]: Admin KYC queue + signed media
- [[docs/P2P_Deal_Flow]]: Proof → review → P2P confirm (no escrow)

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
Open Graph View and center on [[docs/Architecture_Overview]] — wiki-links fan out to [[docs/KYC_Verification]], [[docs/Security_and_RPCs]], [[docs/P2P_Deal_Flow]], and [[docs/Stripe_USD_Flow]].
