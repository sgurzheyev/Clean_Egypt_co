---
title: Lifecycle Fix Wave I
type: architecture
status: pending-ship
updated: 2026-09-19
tags: [garbagin, security, vercel, jwt, openai, telegram, wave-i, sec-4]
aliases: [Wave I, SEC-4, Vercel JWT, analyze-mission auth]
---

# Lifecycle Fix — Wave I (Vercel user JWT on AI / notify APIs)

> Surface close of **SEC-4** from the post–Wave E E2E audit.  
> Hub: [[🗺️ GARBAGIN Master Index]] · security: [[01_Architecture/Security_and_RPCs]] · Edge sibling: [[03_Backend_SQL/Backend_Edge_and_API]] · audit: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · field list: [[04_Roadmap_Tasks/00_Dashboard]]

**Code PR:** [Clean_Egypt_co#11](https://github.com/sgurzheyev/Clean_Egypt_co/pull/11) (`cursor/sec-4-vercel-jwt-wave-i-2bc0` → `main`).

**This wave is Vercel-only.** No SQL migrations. Wave H already fail-closed **Edge** push/city secrets (`PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET`) and gated `api/process-expired-crowdfunding` with **secret equality**. Those stay cron/secret auth. **SEC-4** is the remaining public `/api/*` burn of `OPENAI_API_KEY` and Telegram.

This note is the vault node for Wave I. It does **not** re-describe Waves A–H.

---

## Plain product language

Anyone who could `POST` the Vercel AI or Telegram routes could spend the OpenAI key or spam operator Telegram. There is no Hungry-Games / bid cost on those URLs.

Now every user-facing route below requires `Authorization: Bearer <Supabase access_token>`. GoTrue `auth.getUser(token)` (anon key) runs **before** any service-role read or provider call.

| Route | After JWT | Extra guard |
| --- | --- | --- |
| `api/translate` | Any signed-in user | Max text 8k chars / 32 KiB body |
| `api/moderate-mission-image` | Any signed-in user | Max image ~4 MiB decoded / 6 MiB body |
| `api/moderate-mission-photo-safety` | Any signed-in user | Same image cap |
| `api/analyze-mission` | Creator **or** assigned cleaner **or** `is_platform_admin` | Service role loads the mission **only after** JWT; still **read-only** (score/verdict — no wallet / status write) |
| `api/notify-mission-submitted` | Same membership | Telegram only after member/admin |
| `api/notify-dispute` | Same membership (`jobId` = mission id) | Telegram only after member/admin |
| `api/verify-job-payment` | Signed-in user (legacy no-op) | Consistency only |
| `api/process-expired-crowdfunding` | **Unchanged** | Wave H cron/`CRON_SECRET` / service-role equality — not user JWT |

Anonymous translate still shows source text in the feed hook. Logged-in clients attach the session token via [[src/lib/supabaseAuth.ts]] `authHeaders`.

### Auth path

```
POST /api/translate | moderate-* | analyze-mission | notify-*
  → missing/invalid Bearer? 401
  → (mission-scoped) service-role SELECT missions
       → not found? 404
       → not creator / cleaner? is_platform_admin(user JWT client)
            → no? 403
  → then OpenAI / Telegram
```

`is_platform_admin` is called on the **user** anon client (Bearer = access token). The service-role client must not run that RPC — Wave F short-circuits `service_role` to true.

---

## What landed in code

| Layer | Path |
| --- | --- |
| Shared helper | [[api/_lib/requireUser.ts]] |
| Translate | [[api/translate.ts]] |
| Vision moderate | [[api/moderate-mission-image.ts]] · [[api/moderate-mission-photo-safety.ts]] |
| Read-only AI audit | [[api/analyze-mission.ts]] |
| Telegram | [[api/notify-mission-submitted.ts]] · [[api/notify-dispute.ts]] |
| Legacy no-op | [[api/verify-job-payment.ts]] |
| Client token | [[src/lib/supabaseAuth.ts]] `authHeaders` · [[src/lib/openai.ts]] · [[src/lib/missionTranslation.ts]] · [[components/CreateMission.tsx]] · [[components/Profile.tsx]] |
| Self-test | [[scripts/sec4-api-auth-selftest.mjs]] |

Wave H expiry route is **not** in this table. Secret-equality stays.

---

## Hosted apply

**No SQL.** Redeploy the Vercel project so `/api/*` picks up the handlers.

Client ships with the app: logged-in `fetch('/api/...')` must send the access token (already wired). Old anonymous callers get **401**.

Edge secrets from Wave H remain **ops**: `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET`. Do not confuse those with this user-JWT gate.

---

## Must not break

Stripe session idempotency · `FOR UPDATE SKIP LOCKED` on expiry · Hungry-Games phone lock · 1 token / new bid · funding-with-cleaner still visible · `$2` floor · creator cannot self-fund · Wave A auto-refund · eco-ultimatum retain · Wave B donor-reject retry · crowd excluded from 24h abandon · P2P confirm RPC · Wave C token rank / Profile `approved` / funded DELETE · Wave D 7-day history / R2 purge / gated n8n · `$0` quiet hide · Wave F admin allowlist + mission freeze · Wave G underfund accept / reject RPC / expiry unlock · Wave H fail-closed Edge + expiry secret equality · **analyze-mission stays read-only** (no wallet / status mutation).

Do **not**: change `api/process-expired-crowdfunding` to user JWT · commit `supabase/.temp` · `db push` for this wave.

---

## Still open (not this wave)

- Hosted Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET` (Wave H fail-closed — ops)
- CLI `migration repair --status applied 20260917` if Local-only
- UX-1 copy (“Subscribe to unlock”) vs Hungry-Games phone lock
- SEC-6 chat-photos / R2 presign membership
- Optional immediate R2 delete on `$0` quiet-hide; official municipality channel; crowd re-tender on a **full** pot ghost

---

## Graph

- [[🗺️ GARBAGIN Master Index]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]
- [[04_Roadmap_Tasks/Garbage_History_Lifecycle]]
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]]
- [[01_Architecture/Security_and_RPCs]]
- [[01_Architecture/Architecture_Overview]]
- [[03_Backend_SQL/Backend_Edge_and_API]]
- [[02_Frontend/Frontend_Components]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
