---
title: Garbage History Lifecycle
type: architecture
status: canonical
updated: 2026-09-17
tags: [garbagin, crowdfunding, eco-ultimatum, city-notice, r2, n8n]
---

# Garbage History — сквозной пайплайн краудфандинга и эко-ультиматума

> Каноническая логика **бесплатного civic-пина → Stripe-кампания → rolling timer → Gov Notice / медиа → публичная «История мусора» → архив**.  
> Хаб: [[🗺️ GARBAGIN Master Index]] · деньги: [[01_Architecture/Stripe_USD_Flow]] · P2P (другой мир): [[01_Architecture/P2P_Deal_Flow]] · карта: [[../.cursorrules]] · аудит: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · E2E: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]] · Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] · Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] · Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] · Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] · Wave E (гигиена): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] · apply: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] · CLI history: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]

Этот документ описывает **целевой** сквозной пайплайн. Блок «Реализация vs канон» в конце явно отделяет уже живущий SQL/Edge от шагов, которые ещё нужно дописать.

---

## 1. Зачем это существует

Garbagin не держит внутренний fiat-escrow для обычных задач ([[P2P_Deal_Flow]]). Для **Garbage Removal** (улица / пляж / junk) сообщество скидывается через Stripe. Если цель не собрана, платформа **не возвращает** донорам деньги: публичная оферта покрывает расходы на эко-аудит и эскалацию к муниципалитету.

**Эко-ультиматум** — терминальная ветка, когда окно сбора закрылось, цель не достигнута, но **уже есть собранные средства**. Тогда:

1. Юридический Gov Notice уходит властям (координаты, медиа, цифры сбора).
2. Автоматическая медиа-кампания фиксирует бездействие чиновников.
3. Пин остаётся в публичной «Истории мусора» ровно **7 дней**, после чего тяжёлые файлы стираются из R2, а запись архивируется.

Без донатов ультиматум **не запускается**. Бесплатный пин просто исчезает.

---

## 2. Сквозная машина состояний

```
reported (free pin, $0, 7d)
  ├── no donation by T+7d ────────────► hidden / deleted   (no Gov Notice, no n8n)
  └── first Stripe donation ──────────► funding (crowdfunding_mode=true)
                                          │
                                          │ each successful contribution:
                                          │   current_funding += amount
                                          │   expires_at = GREATEST(expires_at, now()+30d)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                 target met                        timer elapsed AND
            (current_funding >= expected_price)    0 < raised < target
                          │                               │
                          ▼                               ▼
              available / in_progress              ECO-ULTIMATUM
              (bid / work / proof)                 status = expired
                          │                               │
                          ▼                               ├─ no Stripe refund
                     completed                            ├─ Gov Notice PDF → municipality
                     (success PDF)                        ├─ n8n social campaign (video)
                                                          └─ Garbage History public 7d
                                                                │
                                                                ▼
                                                         R2 media purge + archive
```

Легаси-алиасы статусов те же, что в [[P2P_Deal_Flow]]: `pending` ≈ `available`, `finished` ≈ `completed`.

---

## 3. Фаза A — бесплатный пин (7 дней)

### Правило

Бесплатный civic-пин живёт **ровно 7 суток** с `created_at`. Если за это время **нет ни одного успешного Stripe-доната** (`current_funding = 0` и нет строк в `contributions`), пин **автоматически скрывается / удаляется**. Gov Notice, PDF и n8n **не вызываются**.

### Данные

| Поле | Значение на старте |
| --- | --- |
| `is_report` | `true` |
| `status` | `reported` |
| `crowdfunding_mode` | `false` |
| `current_funding` | `0` |
| `expected_price` | `0` (цель ещё не зафиксирована) или черновик цели в UI |
| `crowdfunding_expires_at` | `created_at + 7 days` |
| `photo_urls` | ключи R2 `reports/…` (минимум 1 фото) |

Создание: RPC `create_garbage_zone_report` · клиент [[../src/lib/garbageZoneReport.ts]] · медиа `uploadToR2({ folder: 'reports' })` ([[../src/lib/r2Media.ts]]).

### Sweep

Cron / RPC (канон): выбрать `is_report = true AND status = 'reported' AND current_funding = 0 AND created_at + 7d < now()` → `status = 'hidden'` **или** hard-delete строки + сразу purge R2 `reports/` для этого пина.

Скрытие предпочтительнее мгновенного DELETE, если нужна анти-абьюз аналитика; публичная карта и Live Market **не показывают** `hidden`.

---

## 4. Фаза B — первый донат включает краудфандинг

### Правило

Первый успешный платёж Stripe **переводит** пин в кампанию:

- `is_report = false`
- `crowdfunding_mode = true`
- `status = 'funding'`
- `expected_price` = зафиксированная цель USD (минимум **$2**, как в `convert_report_to_mission` / first-donate)
- `current_funding` += сумма доната
- `crowdfunding_expires_at = GREATEST(crowdfunding_expires_at, now() + 30 days)`

Каждый **последующий** успешный донат снова двигает окно: `GREATEST(expires, now()+30d)` — rolling window от последнего платежа, окно никогда не укорачивается.

### Денежный путь (уже канон Stripe)

1. Briefing → `startContributionCheckout` ([[../src/lib/contributions.ts]])
2. Edge [[../supabase/functions/stripe-contribution-checkout/index.ts]]
3. Возврат `cf_contribution=1&session_id=…`
4. `stripe-contribution-confirm` **и** `stripe-webhook` (идемпотентность по `stripe_checkout_session_id`)
5. service_role `apply_stripe_contribution` — `FOR UPDATE` на миссии, кредит, bump таймера; на `reported` — атомарный wake (P0-2)
6. Постоянный business-reject после оплаты → auto Stripe refund (P0-3) — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]

Прямой клиентский `contribute_to_mission` **запрещён** ([[../supabase/migrations/20260719_lock_crowdfunding_and_accept_bids.sql]]).

### Пока цель не собрана

- Пин **всегда** виден в «Рынке услуг», даже если `cleaner_id` уже назначен ([[../.cursorrules]], [[../components/LiveMarketFeed.tsx]]).
- Создатель **может принять ставку** во время `funding`: cleaner лочится, `expected_price` может подняться до суммы ставки, статус остаётся `funding`, пока донаты не закроют новую цель ([[../supabase/migrations/20260726_tiered_bid_packages.sql]]).
- Ставка клинера стоит **1 токен** всегда ([[../supabase/migrations/20260826_place_mission_bid_always_one_token.sql]]).

### Когда цель собрана

| Условие | Новый статус |
| --- | --- |
| `current_funding >= expected_price` и `cleaner_id IS NOT NULL` | `in_progress` (без повторного тендера) |
| цель собрана, cleaner не выбран | `available` (открыт тендер) |

Дальше — proof / donor vote / P2P close. Это уже не эко-ультиматум. **P1-1:** donor reject → `in_progress` retry (cleaner остаётся; банк не рефандится), не терминальный `failed`. **P1-2:** funded crowd `in_progress` не уходит в silent 24h abandon. Success-PDF сегодня слушает `status = completed` ([[../supabase/migrations/20260722_city_notification_pipeline.sql]]); краудфандинг-proof пишет `approved` — это известный разрыв, чинить отдельно.

---

## 5. Фаза C — эко-ультиматум (цель не собрана, деньги есть)

### Вход

Sweep (`process_expired_crowdfunding_missions`, pg_cron hourly):

```
crowdfunding_mode = true
status = funding
crowdfunding_expires_at < now()
0 < current_funding < expected_price
```

Тогда:

1. `status → expired` (не `hidden`: история должна остаться публичной).
2. Деньги **не** рефандятся в Stripe. Платформа удерживает их как processing fee / эко-аудит (оферта).
3. Вставляется `city_notification_events` с `event_type = 'crowdfunding_expired'` (`pdf_status = pending`).
4. pg_net дергает Edge `city-notification-pipeline`.
5. Параллельно — n8n медиа-кампания (см. §5.3).
6. Стартует 7-дневное окно «Истории мусора» (`history_public_until = now() + 7 days`).

`$0` на этом входе **не бывает**: нулевой баланс уже ушёл в Фазу A (hide/delete).

### 5.1 Gov Notice (юридический отчёт властям)

Артефакт: PDF A4 через pdf-lib в [[../supabase/functions/city-notification-pipeline/index.ts]].

Обязательный payload:

| Поле | Источник |
| --- | --- |
| Mission ID | `missions.id` |
| Координаты | `location_lat` / `location_lng` |
| City / country | `missions.city` / `country` (autofill [[01_Architecture/Global_Location_Filtering]]) |
| Фото / видео | `photo_urls`, `proof_video_url` (R2 keys → public URL) |
| Цель / собрано | `expected_price` / `current_funding` |
| Описание | `description` |
| Окно сбора | `crowdfunding_expires_at`, `expired_at` |
| Оферта | «Funds retained as processing fee — no card refunds» |

Доставка сегодня: upload `city-pdfs/{missionId}/{eventId}.pdf` в R2 → Telegram `sendDocument` (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) → Resend email, если заданы ключи. Канон: тот же PDF = **Gov Notice** для муниципалитета; Telegram/email — операционный канал, не замена официальной подачи.

Конфиг URL Edge: `private.app_config` (`city_notification_pipeline_url` / `_key` / `_webhook_secret`) · [[../supabase/manual/configure_city_notification_webhook.sql]].

### 5.2 Деньги

- Нет `Stripe.refunds.create` на expiry.
- `contributions` остаются источником правды «кто сколько дал».
- Доноры не получают контакты создателя (crowdfunding phone RPC всегда NULL).

### 5.3 Медиа-кампания (n8n)

После успешной генерации Gov Notice (или сразу после INSERT события, если PDF ещё в очереди — идемпотентный retry) платформа POST-ит webhook n8n.

**Конфиг (Wave D):** Edge secrets `N8N_ECO_ULTIMATUM_WEBHOOK_URL` + optional `N8N_ECO_ULTIMATUM_SECRET`, иначе `private.app_config.n8n_eco_ultimatum_webhook_url` / `_secret`. URL не задан → skip (fail-soft).

Пример тела:

```json
{
  "event": "eco_ultimatum",
  "mission_id": "<uuid>",
  "event_id": "<city_notification_events.id>",
  "city": "Hurghada",
  "country": "Egypt",
  "lat": 27.2579,
  "lng": 33.8116,
  "raised_usd": 40,
  "target_usd": 120,
  "expired_at": "2026-08-26T12:00:00Z",
  "gov_notice_pdf_url": "https://…/city-pdfs/…/….pdf",
  "media": {
    "photos": ["https://…/reports/…"],
    "videos": ["https://…/proof/…"]
  },
  "public_history_url": "https://garbagin.com/?mission=<uuid>&history=1",
  "history_public_until": "2026-09-02T12:00:00Z"
}
```

n8n публикует ролики / карточки (координаты + видео бездействия) в соцсети. Клиент приложения **не** ходит в соцсети напрямую — только webhook, по тому же паттерну, что FCM (`send-push-notification` + pg_net).

### 5.4 «История мусора» — 7 дней публично

С момента **отправки** Gov Notice (`city_notification_events.pdf_status = 'sent'` или `processed_at`):

| Правило | Значение |
| --- | --- |
| Публичный доступ | карта + briefing + feed; статус `expired`; бейдж «Gov Notice sent» |
| Срок | ровно **7 дней** (`history_public_until`) |
| Что видно | координаты, описание, фото/видео, цель vs сбор, PDF notice |
| Чего нет | телефоны, P2P-чат, ставки |

UI-имя: **История мусора** / Garbage History. Deep-link с уведомления колокольчика ведёт в briefing.

### 5.5 Purge R2 + архив

Cron после `history_public_until < now()`:

1. Удалить объекты R2: `reports/`, `mission-photos/`, proof video, `city-pdfs/` этого `mission_id` (кроме того, что юротдел обязан хранить вне публичного CDN — если PDF нужно хранить дольше, перенести в private legal bucket, не в public custom domain).
2. Обнулить `photo_urls`, `after_photo_urls`, `proof_video_url` (или заменить на placeholder).
3. `status → archived` (или `expired` + `media_purged_at`).
4. Строка миссии **остаётся** в Postgres: id, lat/lng, city, raised, target, timestamps, `city_notification_events` metadata. Это архив для аудита, не публичная галерея.

Публичная карта / Live Market **не показывают** `archived`.

---

## 6. Таймеры — одна таблица правды

| Событие | Таймер | Колонка |
| --- | --- | --- |
| Создан бесплатный пин | +7d | `crowdfunding_expires_at` или `created_at + 7d` |
| Первый и каждый следующий Stripe-донат | rolling +30d | `GREATEST(expires, now()+30d)` в `apply_stripe_contribution` |
| Эко-ультиматум: публичная история | +7d от expiry; bump от отправки Gov Notice | `history_public_until` (Wave D) |
| P2P abandoned `in_progress` | 24h | **другой** cron (`process_abandoned_missions`) — **только P2P** (P1-2). Crowd funded lock не снимается |
| P2P stuck `review` | 3d | не этот пайплайн |

UI countdown: [[../src/lib/crowdfunding.ts]] (`getCrowdfundingExpiresAt`, compact `2d 4h`).

---

## 7. Компоненты и RPC

| Шаг | Где |
| --- | --- |
| Free pin create | `create_garbage_zone_report` · [[../src/lib/garbageZoneReport.ts]] · [[../components/MapPicker.tsx]] |
| Convert / first-donate activate | **Канон в коде (P0-2):** первый Stripe-доллар внутри `apply_stripe_contribution` будит `reported`. **Опционально:** `convert_report_to_mission` — **только автор** пина (P1-4, [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]) |
| Contribute | checkout / confirm / webhook → `apply_stripe_contribution` · overfund loser → auto-refund (P0-3) |
| Bid / accept during funding | `place_mission_bid` / `accept_mission_bid` — underfund stay `funding` (LIFE-1, [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]); new bid needs active sub ([[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]) |
| $0 hide sweep | **Есть (P0-1 / LIFE-3):** `process_expired_crowdfunding_missions` → `hidden`, `cleaner_id` NULL, без `city_notification_events` |
| Underfunded sweep | `process_expired_crowdfunding_missions` · 0 < raised < target → `expired` + Gov Notice + **unlock cleaner** (LIFE-3) |
| Gov Notice | INSERT `city_notification_events` → pg_net → `city-notification-pipeline` |
| n8n | **Есть (P2-1c):** `city-notification-pipeline` после `sent`/`generated`; fail-soft если URL не задан |
| History 7d + R2 purge | **Есть (P2-1 / P2-1b):** `process_garbage_history_archives` + Edge `garbage-history-purge` |
| Feed visibility | [[../components/LiveMarketFeed.tsx]] — `funding` всегда; `expired` до `history_public_until`; `archived`/`hidden` — нет |

---

## 8. Реализация vs канон (снимок 2026-09-17, через Wave H)

Аудит: [[docs/GARBAGIN_LIFECYCLE_AUDIT]] · E2E: [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]. Wave A: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]]. Wave B: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]]. Wave C: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]. Wave D: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]. Wave E (docs/ops only): [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]]. Wave F: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]]. Wave G: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]]. Wave H: [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]. Apply order: [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]]. CLI history: [[04_Roadmap_Tasks/Ops_Migration_History_Repair]].

Таблица ниже — **текущий** снимок (P0→H на live SQL + Edge). Снимок 2026-08-26 больше не канон.

| Правило | Сейчас в коде | Разрыв |
| --- | --- | --- |
| Free pin 7d | `create_garbage_zone_report` ставит `crowdfunding_expires_at = now()+7d`. Sweep: `$0` `reported`/`funding` → `hidden` (P0-1) | OK для hide. Опциональный сразу-purge R2 `reports/` ещё нет |
| Первый донат включает crowd | `apply_stripe_contribution(..., p_target_usd)` атомарно будит `reported` (P0-2). Checkout принимает report + `target_usd` | OK |
| Unpaid convert | `convert_report_to_mission` — **только creator**, цель ≥ **$2**. Соседи — first-donate (P1-4) | OK. `$0` funding после convert может только hide (P0-1), не Gov Notice |
| Overfund race | Loser Checkout → auto Stripe refund (confirm + webhook, идемпотентно) (P0-3) | OK. Expiry **с деньгами** по-прежнему без card-refund |
| Rolling +30d | Да, `apply_stripe_contribution` | OK |
| Цель собрана → work | Да, `available` / `in_progress` если cleaner locked. Accept выше raised **остаётся `funding`** (LIFE-1). 24h abandon sweep **не** трогает crowd (P1-2) | OK |
| Donor reject proof | `process_proof_vote(false)` → `in_progress` retry, cleaner kept, pot intact (P1-1) | OK. `failed` больше не пишется. Старые `failed` с cleaner backfill-нуты |
| P2P confirm RPC | `confirm_mission_work_done` в active tree (P3-3) | OK для greenfield |
| Expiry без рефанда (есть сбор) | Да — 0 < raised < target → `expired` + city queue; **`cleaner_id` NULL** (LIFE-3) | OK vs оферта. Не путать с P0-3 |
| Gov Notice PDF + Telegram | Да, `city-notification-pipeline` → R2 `city-pdfs/` | Назвать/обогатить фото+видео в PDF; официальный канал муниципалитета |
| n8n соцкампания | **Есть (P2-1c):** webhook после PDF `sent`/`generated`; skip если URL не задан | Сам n8n workflow — ops, не этот репозиторий |
| История 7 дней | `history_public_until`; feed/map до окна; затем `archived` (P2-1 / P2-2) | OK |
| Purge R2 | Edge `garbage-history-purge` + `media_purged_at` (P2-1b) | Нужны R2 secrets + configure script; без Edge пин уже скрыт |
| Success PDF | Триггер на `completed` **или** `approved` (`20260826_status_changed_at_approved_reviews.sql`) | OK |
| `amount_target` = token rank | Convert / accept больше не пишут USD (P2-3). Backfill: rank == USD budget → 1 | OK. First-donate wake оставляет 0 на free pin |
| Profile `approved` / `failed` | Worker active + History включают crowd close (P2-4) | OK |
| Creator DELETE funded | RLS + `creator_delete_mission` блокируют pot (P3-4) | OK. Admin `admin_delete_mission` без изменений |

Не ломать: идемпотентность Stripe session, `FOR UPDATE SKIP LOCKED` на expiry, Hungry-Games phone lock на crowd, 1 token / bid, funding-with-cleaner visible.

---

## 9. Порядок работ (если закрывать разрыв)

1. ~~Split expiry: `$0` → `hidden`; `raised > 0` → eco-ultimatum.~~ **P0-1 shipped** (optional immediate R2 delete still open).
2. ~~Первый Checkout / атомарный convert внутри `apply_stripe_contribution`.~~ **P0-2 shipped.**
3. ~~Overfund auto-refund + convert только автор.~~ **Wave A / P0-3 + P1-4** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]].
4. ~~`failed` retry + crowd abandon exclude + P2P confirm RPC.~~ **Wave B / P1-1 + P1-2 + P3-3** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]].
5. ~~Колонки `history_public_until`, `media_purged_at`; n8n после `pdf_status = sent`.~~ **Wave D / P2-1 + P2-1c** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]]
6. ~~Cron архива + R2 delete.~~ **Wave D / P2-1b**
7. ~~Feed/map: показывать `expired` только до `history_public_until`.~~ **Wave D / P2-2**
8. ~~Wave C: `amount_target` не писать USD; Profile `approved`; funded DELETE lock.~~ **Wave C / P2-3 + P2-4 + P3-4** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]]
9. ~~Vault / Roadmap / CLI-history hygiene.~~ **Wave E** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] · [[04_Roadmap_Tasks/Ops_Migration_History_Repair]]
10. ~~Admin TG / missions UPDATE / underfund accept / expiry unlock / push hijack.~~ **Waves F/G/H** — [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] · [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]]

Ещё открыто: optional сразу-purge R2 на `$0` hide; официальный канал муниципалитета; явный re-tender если cleaner бросил **полный** pot; сам n8n workflow; **SEC-4** Vercel `/api/*`; Edge secrets `PUSH_WEBHOOK_SECRET` / `CITY_NOTIFICATION_WEBHOOK_SECRET`; CLI repair `20260917_*`.

---

## Связанные ноты и исходники

- [[01_Architecture/Stripe_USD_Flow]] — Checkout, +30d, expiry queue, reject-refund
- [[01_Architecture/Architecture_Overview]] — модель `missions`
- [[01_Architecture/Security_and_RPCs]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] — Phase 1 timers, Phase 2 PDF
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_A]] — P0-3 / P1-4
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_B]] — P1-1 / P1-2 / P3-3
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_C]] — P2-3 / P2-4 / P3-4
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_D]] — P2-1 / P2-1b / P2-1c / P2-2
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_E]] — docs + CLI history hygiene
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_F]] — SEC-1 / SEC-2
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_G]] — LIFE-1 / LIFE-2 / LIFE-3
- [[04_Roadmap_Tasks/Lifecycle_Fix_Wave_H]] — SEC-5 / fail-closed Edge / Hungry-Games sub
- [[04_Roadmap_Tasks/Ops_Migration_History_Repair]] — `migration repair` / no `db push`
- [[docs/LIFECYCLE_FIX_APPLY_RUNBOOK]] — P0→H paste order + Edge
- [[docs/GARBAGIN_LIFECYCLE_AUDIT]]
- [[docs/GARBAGIN_E2E_AUDIT_2026-09-15]]
- [[../supabase/migrations/20260720_crowdfunding_expiry_cron.sql]]
- [[../supabase/migrations/20260722_city_notification_pipeline.sql]]
- [[../supabase/migrations/20260724_restore_crowdfunding_contribution_timer_bump.sql]]
- [[../supabase/migrations/20260724_garbage_zone_reports.sql]]
- [[../supabase/migrations/20260912_split_expiry_and_first_donate_wake.sql]]
- [[../supabase/migrations/20260912_overfund_refund_and_creator_convert.sql]]
- [[../supabase/migrations/20260912_wave_b_failed_recovery_abandon_confirm.sql]]
- [[../supabase/migrations/20260912_wave_c_amount_target_profile_delete.sql]]
- [[../supabase/migrations/20260912_wave_d_garbage_history_window.sql]]
- [[../supabase/migrations/20260917_wave_g_lifecycle_hardening.sql]]
- [[../src/lib/cityNotification.ts]]
- [[../src/lib/crowdfunding.ts]]
- [[../supabase/functions/city-notification-pipeline/index.ts]]
- [[../supabase/functions/garbage-history-purge/index.ts]]
