---
title: Lifecycle Fix Wave D
type: architecture
status: shipped
updated: 2026-09-12
tags: [garbagin, crowdfunding, garbage-history, n8n, r2, wave-d, lifecycle]
aliases: [Wave D, Garbage History window, R2 purge, n8n eco-ultimatum, P2-1, P2-1b, P2-1c, P2-2]
---

# Lifecycle Fix — Wave D (7-day Garbage History + R2 purge + n8n)

> Product close of **P2-1**, **P2-1b**, **P2-1c**, and **P2-2** from the lifecycle audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] · money: [[01_Architecture/Stripe_USD_Flow]] · security: [[01_Architecture/Security_and_RPCs]] · P2P: [[01_Architecture/P2P_Deal_Flow]] · audit: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code PR:** [Clean_Egypt_co#7](https://github.com/sgurzheyev/Clean_Egypt_co/pull/7) stacked on [Clean_Egypt_co#6](https://github.com/sgurzheyev/Clean_Egypt_co/pull/6) (Wave C). Retarget to `main` after P0 / A / B / C merge.

This note is the vault node for Wave D. It does **not** re-describe P0 or Waves A–C.

P0 lives in [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (canon: [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8).  
Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]].

---

## Plain product language

Two worlds still share `missions`. Wave D only touches the **eco-ultimatum** branch: underfunded crowdfunding that already raised money.

### P2-1 — Public Garbage History for 7 days

When the funding timer dies and `0 < raised < target`, the pin becomes `expired` (Gov Notice still queues). It now also gets `history_public_until = now() + 7 days`.

Map + Live Market **show** that pin until the window ends. Badge: **Garbage History** / **Gov Notice sent**. No bids, no phone unlock, no P2P chat.

When the city-notification pipeline marks the PDF `sent` (or `generated` — PDF exists, Telegram/email may have stubbed), SQL bumps the window to `GREATEST(existing, now()+7d)` so the 7 days count from Gov Notice delivery, not only from the sweep.

After `history_public_until`, cron sets `status = archived`. Public feeds and the map drop it. The Postgres row stays for audit (coords, raised, target, `city_notification_events`).

`$0` expiry is unchanged (P0-1): `hidden`, **no** history window, **no** Gov Notice, **no** n8n.

### P2-1b — R2 media purge after the window

SQL cannot delete Cloudflare objects. After archive:

1. `claim_garbage_history_purge_batch` — service-role, `FOR UPDATE SKIP LOCKED`
2. Edge `garbage-history-purge` deletes keys under `reports/`, `mission-photos/`, `proofs/`, `city-pdfs/` (from stored columns + prefix list)
3. `mark_garbage_history_media_purged` clears `photo_urls` / proof URLs and sets `media_purged_at`

Idempotent. If R2 env is missing, pins still archive (leave the feed); media stays until the Edge is configured. Never touches `kyc/`, `avatars/`, `chat/`, `stores/`.

### P2-1c — n8n after Gov PDF (stub-with-config)

`city-notification-pipeline` POSTs the eco-ultimatum payload when `crowdfunding_expired` PDF is `sent`/`generated`.

**Gated:** if `N8N_ECO_ULTIMATUM_WEBHOOK_URL` (Edge secret) and `private.app_config.n8n_eco_ultimatum_webhook_url` are both unset, the pipeline **skips** and still returns 200. That is intentional — n8n is wired, not required to generate the PDF.

Optional `N8N_ECO_ULTIMATUM_SECRET` / `n8n_eco_ultimatum_secret` → header `X-Garbagin-N8n-Secret`. Idempotent via `city_notification_events.n8n_dispatched_at`. Fail-soft: n8n HTTP errors are logged on the event row, they do not retry the PDF.

### P2-2 — Feed / map filters

| Status | Public map / Live Market |
| --- | --- |
| `funding` (+ locked cleaner) | Always — violet “Needs $X more” callout unchanged |
| `expired` + `history_public_until > now()` + raised > 0 | Yes — Garbage History |
| `hidden` / `archived` / `$0` / purged | No |

---

## What landed in code

| Layer | Path |
| --- | --- |
| Migration (SQL Editor) | [[supabase/migrations/20260912_wave_d_garbage_history_window.sql]] |
| Verify checklist | [[supabase/manual/20260912_wave_d_verify.sql]] |
| Purge / n8n ops | [[supabase/manual/configure_garbage_history_purge.sql]] |
| History visibility helper | [[src/lib/crowdfunding.ts]] (`isPublicGarbageHistory`) |
| Live Market + map + briefing | [[components/LiveMarketFeed.tsx]] · [[components/MapPicker.tsx]] · [[components/MissionBriefing.tsx]] · [[components/Profile.tsx]] |
| Purge Edge | [[supabase/functions/garbage-history-purge/index.ts]] |
| n8n + history bump | [[supabase/functions/city-notification-pipeline/index.ts]] · [[supabase/functions/_shared/n8nEcoUltimatum.ts]] |
| R2 key helpers | [[supabase/functions/_shared/r2.ts]] |
| EN / RU / AR / DE / IT / ES | [[src/i18n.ts]] |
| Migrations MOC | [[03_Backend_SQL/SQL_Migrations_Index]] |

### Expiry path (unchanged $0 rule)

```
funding + timer elapsed
  raised = 0     → hidden, history_public_until NULL, no city event
  0 < raised < target
                 → expired
                 → history_public_until = now()+7d
                 → city_notification_events (crowdfunding_expired)
```

### After Gov PDF

```
pdf_status = sent | generated  (crowdfunding_expired only)
  → bump_garbage_history_public_until
  → n8n POST if URL configured, else skip
```

### After 7 days

```
process_garbage_history_archives
  → archived
invoke_garbage_history_purge_edge  (fail-soft if URL unset)
garbage-history-purge
  → delete R2 keys → mark_garbage_history_media_purged
```

---

## Hosted apply

CLI history is messy — paste in the SQL Editor **after** Wave C:

1. [[supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]] (PR #3 — skip if applied)
2. [[supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]] (PR #4 — skip if applied)
3. [[supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]] (PR #5 — skip if applied)
4. [[supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]] (PR #6 — skip if applied)
5. [[supabase/migrations/20260912_wave_d_garbage_history_window.sql]]
6. [[supabase/manual/20260912_wave_d_verify.sql]]

**Redeploy Edge:** `city-notification-pipeline`, `garbage-history-purge`.

**Secrets (optional — fail-soft if unset):**

| Secret | Used by |
| --- | --- |
| `N8N_ECO_ULTIMATUM_WEBHOOK_URL` | city-notification-pipeline |
| `N8N_ECO_ULTIMATUM_SECRET` | optional n8n header |
| `GARBAGE_HISTORY_PURGE_SECRET` | optional extra auth on purge Edge |
| Existing `R2_*` | purge + PDF upload (same bucket as today) |

Then paste [[supabase/manual/configure_garbage_history_purge.sql]] so pg_cron can poke the purge Edge. Without that URL, archive still hides pins; R2 objects wait.

Client ships with the app. Apply SQL **before** the client select of `history_public_until` / `media_purged_at`.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund of a Checkout the pot never accepted · eco-ultimatum retain (expiry with money still has **no** card refund) · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE lock · `$0` quiet hide (no Gov Notice).

---

## Still open (not this PR)

From [[docs/GARBAGIN_LIFECYCLE_AUDIT]] / [[04_Roadmap_Tasks/Garbage_History_Lifecycle]] §8:

- Optional immediate R2 delete on `$0` quiet-hide (P0 leftover)
- Official municipality channel beyond Telegram / Resend ops
- Explicit crowd re-tender if a locked cleaner ghosts a full pot (notify donors — do not revive silent abandon)
- n8n social workflow itself (this PR only POSTs the webhook when configured)

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[01_Architecture/Stripe_USD_Flow]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/Architecture_Overview]]
- [[01_Architecture/P2P_Deal_Flow]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[03_Backend_SQL/SQL_Migrations_Index]]
- [[02_Frontend/Frontend_Components]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
