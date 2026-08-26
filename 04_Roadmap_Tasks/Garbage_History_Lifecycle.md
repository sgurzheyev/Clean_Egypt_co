---
title: Garbage History Lifecycle
type: architecture
status: canonical
updated: 2026-08-26
tags: [garbagin, crowdfunding, eco-ultimatum, city-notice, r2, n8n]
---

# Garbage History — сквозной пайплайн краудфандинга и эко-ультиматума

> Каноническая логика **бесплатного civic-пина → Stripe-кампания → rolling timer → Gov Notice / медиа → публичная «История мусора» → архив**.  
> Хаб: [[🗺️ GARBAGIN Master Index]] · деньги: [[01_Architecture/Stripe_USD_Flow]] · P2P (другой мир): [[01_Architecture/P2P_Deal_Flow]] · карта: [[../.cursorrules]]

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
- `expected_price` = зафиксированная цель USD (минимум $5, как в `convert_report_to_mission`)
- `current_funding` += сумма доната
- `crowdfunding_expires_at = GREATEST(crowdfunding_expires_at, now() + 30 days)`

Каждый **последующий** успешный донат снова двигает окно: `GREATEST(expires, now()+30d)` — rolling window от последнего платежа, окно никогда не укорачивается.

### Денежный путь (уже канон Stripe)

1. Briefing → `startContributionCheckout` ([[../src/lib/contributions.ts]])
2. Edge [[../supabase/functions/stripe-contribution-checkout/index.ts]]
3. Возврат `cf_contribution=1&session_id=…`
4. `stripe-contribution-confirm` **и** `stripe-webhook` (идемпотентность по `stripe_checkout_session_id`)
5. service_role `apply_stripe_contribution` — `FOR UPDATE` на миссии, кредит, bump таймера

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

Дальше — proof / donor vote / P2P close. Это уже не эко-ультиматум. Success-PDF сегодня слушает `status = completed` ([[../supabase/migrations/20260722_city_notification_pipeline.sql]]); краудфандинг-proof пишет `approved` — это известный разрыв, чинить отдельно.

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

**Конфиг (ещё не в коде):** `private.app_config.n8n_eco_ultimatum_webhook_url` + optional `n8n_eco_ultimatum_secret`.

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
| Эко-ультиматум: публичная история | +7d от отправки Gov Notice | канон: `history_public_until` (колонка ещё не заведена) |
| P2P abandoned `in_progress` | 24h | **другой** cron, не этот пайплайн |
| P2P stuck `review` | 3d | не этот пайплайн |

UI countdown: [[../src/lib/crowdfunding.ts]] (`getCrowdfundingExpiresAt`, compact `2d 4h`).

---

## 7. Компоненты и RPC

| Шаг | Где |
| --- | --- |
| Free pin create | `create_garbage_zone_report` · [[../src/lib/garbageZoneReport.ts]] · [[../components/MapPicker.tsx]] |
| Convert / first-donate activate | сегодня ручной `convert_report_to_mission`; канон — внутри `apply_stripe_contribution` на первом платеже |
| Contribute | checkout / confirm / webhook → `apply_stripe_contribution` |
| Bid / accept during funding | `place_mission_bid` / `accept_mission_bid` |
| $0 hide sweep | **нужен** новый cron (сейчас expiry не различает $0 и частичный сбор) |
| Underfunded sweep | `process_expired_crowdfunding_missions` · [[../supabase/migrations/20260722_stabilize_crowdfunding_proof_concurrency.sql]] |
| Gov Notice | INSERT `city_notification_events` → pg_net → `city-notification-pipeline` |
| n8n | **нужен** trigger после `pdf_status = sent` |
| History 7d + R2 purge | **нужен** cron `process_garbage_history_archives` |
| Feed visibility | [[../components/LiveMarketFeed.tsx]] — `funding` всегда; `expired` history — добавить; `archived`/`hidden` — нет |

---

## 8. Реализация vs канон (снимок 2026-08-26)

| Правило | Сейчас в коде | Разрыв |
| --- | --- | --- |
| Free pin 7d | `create_garbage_zone_report` → `reported`, **без** авто-expiry | Нет sweep hide/delete при $0 |
| Первый донат включает crowd | Ручной `convert_report_to_mission` (любой auth user, цель ≥ $5, сразу `funding` + 7d) **до** денег | Stripe не принимает донат на `reported`; пин не «оживает» от первого доллара |
| Rolling +30d | Да, `apply_stripe_contribution` | OK |
| Цель собрана → work | Да, `available` / `in_progress` если cleaner locked | OK |
| Expiry без рефанда | Да | Sweep срабатывает и при **$0** и ставит `expired` + city queue — канон: $0 = hide, без Gov Notice |
| Gov Notice PDF + Telegram | Да, `city-notification-pipeline` → R2 `city-pdfs/` | Назвать/обогатить фото+видео в PDF; официальный канал муниципалитета |
| n8n соцкампания | Нет | Нужен webhook + secrets |
| История 7 дней | `expired` пины живут бессрочно | Нужны `history_public_until`, публичный фильтр, затем purge |
| Purge R2 | Нет | Нужен cron удаления ключей `reports/` / `mission-photos/` / proof / public PDF |
| Success PDF | Триггер на `completed` | Крауд proof заканчивается в `approved` — PDF успеха может не стрельнуть |

Не ломать: идемпотентность Stripe session, `FOR UPDATE SKIP LOCKED` на expiry, Hungry-Games phone lock на crowd, 1 token / bid.

---

## 9. Порядок работ (если закрывать разрыв)

1. Split expiry: `$0` → `hidden` + optional immediate R2 delete; `raised > 0` → eco-ultimatum.
2. Разрешить первый Checkout на `reported` **или** атомарно конвертить report→funding внутри `apply_stripe_contribution`.
3. Колонки `history_public_until`, `media_purged_at`, статус `hidden` / `archived`.
4. n8n webhook после `pdf_status = sent`.
5. Cron архива + R2 delete.
6. Feed/map: показывать `expired` только до `history_public_until`.

---

## Связанные ноты и исходники

- [[01_Architecture/Stripe_USD_Flow]] — Checkout, +30d, expiry queue
- [[01_Architecture/Architecture_Overview]] — модель `missions`
- [[01_Architecture/Security_and_RPCs]]
- [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] — Phase 1 timers, Phase 2 PDF
- [[04_Roadmap_Tasks/00_Dashboard]]
- [[../supabase/migrations/20260720_crowdfunding_expiry_cron.sql]]
- [[../supabase/migrations/20260722_city_notification_pipeline.sql]]
- [[../supabase/migrations/20260724_restore_crowdfunding_contribution_timer_bump.sql]]
- [[../supabase/migrations/20260724_garbage_zone_reports.sql]]
- [[../src/lib/cityNotification.ts]]
- [[../supabase/functions/city-notification-pipeline/index.ts]]
