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
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] — vault + CLI history hygiene (no product change)
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] — SEC-1 `platform_admins` + SEC-2 mission column freeze
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] — LIFE-1 underfund accept + LIFE-2 reject RPC + LIFE-3 expiry unlock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] — SEC-5 push token + fail-closed Edge + Hungry-Games subscription
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]] — SEC-4 Vercel user JWT on AI / notify APIs
- [[04_Roadmap_Tasks/Map_Rush_Mode]] — RUSH live planes/ships + H2H night land
- [[04_Roadmap_Tasks/Map_Rush_Idle_Chip]] — idle RUSH chip matches collapsed WX
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — `migration repair` for `20260912_*` / `20260917_*` (no `db push`)
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] — P0→H + Hungry-Games SQL + Edge apply order · Wave I Vercel JWT (no SQL)
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]] — canon vs code scorecard (Waves A–I)
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] — post–Wave E security + lifecycle bug search (F/G/H/I shipped; SEC-4 closed)
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
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]: docs sync + CLI history repair (no product change)
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]: SEC-1 admin allowlist / SEC-2 mission UPDATE lock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]: LIFE-1 accept-underfund / LIFE-2 reject RPC / LIFE-3 expiry unlock
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]: SEC-5 push token / fail-closed Edge / Hungry-Games subscription
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]]: SEC-4 Vercel `/api/*` user JWT + membership
- [[04_Roadmap_Tasks/Map_Rush_Mode]]: RUSH live planes/ships + H2H night land
- [[04_Roadmap_Tasks/Map_Rush_Idle_Chip]]: idle RUSH matches the WX chip; color and craft count only while ships/planes are on
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]: `supabase migration repair --status applied 20260912` / `20260917`
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]: P0→H + Hungry-Games paste order (live already applied)
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]: аудит стейт-машины
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]: E2E bug search 2026-09-15 (F/G/H/I shipped; SEC-4 closed)
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
- [ ] Wave E (ops): `supabase migration list` no longer shows Local-only `20260912`; do **not** `db push` to “fix” it ([[04_Roadmap_Tasks/Ops_Migration_History_Repair]])
- [ ] Wave F: TG username does not grant admin; participant cannot PostgREST-set `status` / `cleaner_id` / funds ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]])
- [ ] Wave G: accept bid above raised on an `available` crowd pin stays `funding`; expiry clears `cleaner_id` ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]])
- [ ] Wave H / Hungry-Games: new bid without subscription opens the MapPicker modal; push token conflict does not hijack; Edge 401s without secret ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]])
- [ ] Wave I: unauthenticated POST `/api/translate` / `moderate-*` / `analyze-mission` / `notify-*` is 401; non-member cannot analyze/notify ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]])
- [ ] RUSH: idle chip matches WX (small, faint); tap cycles ships → planes → off with accent + count; peek slides back; off restores steel land ([[04_Roadmap_Tasks/Map_Rush_Idle_Chip]])
- [ ] Wave F–H (ops): `migration list` no Local-only `20260917`; Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` set
- [ ] KYC: submit → admin signed preview → approve/reject
- [ ] P2P: bid → proof → creator confirm

## Graph tips
Open Graph View and center on [[🗺️ GARBAGIN Master Index]] or [[01_Architecture/Architecture_Overview]] — wiki-links fan out to [[01_Architecture/KYC_Verification]], [[01_Architecture/Security_and_RPCs]], [[01_Architecture/P2P_Deal_Flow]], [[01_Architecture/Stripe_USD_Flow]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]], [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_I]], [[04_Roadmap_Tasks/Ops_Migration_History_Repair]], and [[docs/GARBAGIN_LIFECYCLE_AUDIT]].
