---
title: Garbagin — Status Report & Roadmap
type: status-report
status: active
updated: 2026-07-21
tags: [garbagin, roadmap, status, architecture]
---

# 🚀 Garbagin — Status Report & Roadmap

> Generated from git history (`91d5d4c … 85b0a98`) and a scan of the current codebase.
> Archived status note — superseded by [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]].  
> Hubs: [[🗺️ GARBAGIN Master Index]] · [[01_Architecture/Architecture_Overview]] · [[01_Architecture/Stripe_USD_Flow]] · [[01_Architecture/Security_and_RPCs]] · [[01_Architecture/KYC_Verification]] · [[01_Architecture/P2P_Deal_Flow]] · [[04_Roadmap_Tasks/00_Dashboard]]

---

## 1. Executive Summary

The last development cycle moved Garbagin from a legacy escrow/payout mindset to a **lean, non-refundable contribution model** with a **premium, decluttered mobile UI**.

- **Finance model pivot.** Legacy fiat payout/withdrawal RPCs were removed in favour of a **crowdfunding contribution flow** (Stripe Checkout) plus a **token economy** for posting/boosting. Listing rank is now driven by **token-boost** (`amount_target`), not recency.
- **USD-only economy.** The currency layer was normalized to **USD**, dropping the legacy `contributions.amount_egp` column that was blocking Stripe inserts.
- **Server-side geo hardening.** **PostGIS** (`geography` + `ST_Distance`) now backs the proof-of-work **GPS gate**, and **`pg_cron`** drives **crowdfunding expiry** → city-notification queue.
- **UI/UX overhaul.** The map interface was cleaned up around a consistent **floating-FAB design language**: a filter FAB + bottom-sheet, a unified **3-in-1 map joystick**, and responsive admin/profile layouts.

Net effect: a tighter, mobile-first product that is type-safe (`tsc` clean) and builds cleanly, with the payment/geo backend architecturally in place.

---

## 2. Detailed Work Tree — Completed

### 💰 Finance & Backend
- **Legacy RPC removal**
	- Dropped payout/withdrawal RPCs; metrics are now **contribution-only** (`91d5d4c`, `20260721_cleanup_legacy_finance_rpcs.sql`).
	- Removed blocking `contributions.amount_egp` for USD Stripe inserts (`20260720_drop_contributions_amount_egp.sql`).
- **Stripe edge functions** (deployed under `supabase/functions/`)
	- `stripe-contribution-checkout` — starts crowdfunding Checkout session.
	- `stripe-contribution-confirm` — verifies + applies contribution (idempotent on `stripe_checkout_session_id`).
	- Supporting suite: `stripe-token-intent` / `stripe-token-credit`, `stripe-subscription-intent` / `stripe-subscription-activate`, `stripe-wallet-credit`, `kyc-admin-signed-urls`.
	- Frontend now **degrades gracefully** when the function is undeployed / Stripe keys missing (`isEdgeFunctionUnreachable` + descriptive toast, `8fd98b8`).
- **Token economy & ranking**
	- Token-boost ranking as the default sort; multi-city smart seed; contribution-model finance (`7f43fc2`).
- **Lifecycle automation**
	- `pg_cron` crowdfunding expiry → `expired` + city-notification queue (`20260720_crowdfunding_expiry_cron.sql`).
	- Ratings/reviews + notification tables and mission sort indexes (`20260721_*`).

### 🎨 Core UI/UX Polish
- **Floating FAB map filters** — replaced the bulky top bar with a `rounded-full` FAB opening an elegant **bottom-sheet** (city dropdown, sort, emerald eco-tags) via `framer-motion` (`9fed3e9`); city dropdown + eco-tag highlight restored earlier (`318d867`).
- **Unified 3-in-1 map joystick** — collapsed the vertical zoom/geolocate stack into a single `w-16 h-16` dial: **top = zoom in**, **bottom = zoom out**, **center = geolocate**, with per-zone hover/active feedback (`85b0a98`, superseding `8fd98b8`).
- **KYC review queue responsive layout** — action buttons (Load documents / Approve / Reject) now stack full-width on mobile and wrap inline on `sm+`, no longer overflowing the card (`ce8e848`).
- **Account & Security consolidation** — folded the standalone "Change Password" block into the Contact accordion, retitled **Account & Security** (`5470b58`).
- **Earlier polish** — map z-index/safe-area fixes, responsive admin card grids, WX moved bottom-left, compact panels (`0219d83`, `80f1bd3`).

### 🗺️ Mapping & Geo
- **Closest-hub city filtering** — client-side **haversine** assignment to 13 fixed Egyptian hubs (`src/lib/egyptMarketplace.ts`), wired into the feed, profile marketplace, and map pins (default *All Cities*).
- **PostGIS validation (server-side)** — `CREATE EXTENSION postgis`; mission `location` stored as `geography`; **proof-of-work GPS gate** uses `ST_Distance` between worker and mission (`20260720_proof_of_work_lifecycle_security.sql`).
- **Live weather** — Open-Meteo drives map fog/particle overlays (`4301e47`).

---

## 3. Current Project State

**Assessment: stable and demo-ready on the frontend; backend architecturally complete but requires deployment/config verification.**

- ✅ **Type-safe & builds clean** — `tsc --noEmit` passes; `vite build` succeeds (~3,160 modules).
- ✅ **No lingering `TODO`/`FIXME`** debt found in `*.ts/tsx/sql` (scan returned only an unrelated phone placeholder).
- ✅ **i18n complete** across **6 locales** (en, ar, ru, de, it, es) for all recently added keys.
- ✅ **Security posture** — RLS + service-role RPCs, GPS-gated proof-of-work, KYC admin moderation with signed media URLs.
- ⚠️ **Deployment dependency** — the graceful "payment service unavailable" path exists precisely because `stripe-contribution-checkout` / Stripe secrets must be **deployed & configured** in the hosted Supabase project to enable live contributions.
- ⚠️ **Field validation pending** — AR/WebXR, end-to-end crowdfunding, KYC, and P2P flows are coded but await the Hurghada field test (see [[04_Roadmap_Tasks/00_Dashboard]]).

---

## 4. Future Planned Work — Roadmap

### Signals from the codebase
- **No in-app messaging layer** — no conversations/`chat_messages` tables or UI exist; P2P coordination currently relies on shared contact info (WhatsApp/Telegram).
- **City-notification fallback is partial** — `api/process-expired-crowdfunding.ts` + the expiry cron/queue exist, but the **PDF report → municipal delivery** pipeline is still async/unfinished (per [[04_Roadmap_Tasks/00_Dashboard]] and `.cursorrules`).
- **AR overlay** — lazy-loaded WebXR (`src/components/AROverlay`) is wired but unvalidated in the field.
- **Notifications** — in-app bell + Telegram hooks exist; no email/web-push channel.

### Proposed next major blocks

- [ ] **Block A — Payments Go-Live Hardening**
	- Deploy & smoke-test `stripe-contribution-checkout` / `-confirm`; wire Stripe webhooks for out-of-band confirmation; add an end-to-end contribution test (contribute → funding bar → target met → `available`).
- [ ] **Block B — City-Notification / PDF Pipeline**
	- Finish `expired → PDF report → municipal delivery`, backed by `city_notification_events`; add an admin view of the queue and generated reports (aligns with the crowdfunding fallback in `.cursorrules`).
- [ ] **Block C — P2P In-App Messaging**
	- Introduce a lightweight `conversations` / `messages` schema (RLS-scoped to mission participants) with a realtime chat panel on the mission briefing, reducing reliance on external contacts.
- [ ] **Block D — Notifications & AR Field Validation**
	- Add email/web-push on top of the existing bell + Telegram hooks; complete the Hurghada AR field test (WebXR session, GPS marker accuracy, live funding progress).

---

> _Next review: after the Hurghada field test or the payments go-live, whichever lands first._
