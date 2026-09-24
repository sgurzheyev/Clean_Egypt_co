---
title: Телефонный прод — отзывы, пин, шит
type: architecture
status: pending-ship
updated: 2026-09-24
tags: [garbagin, reviews, r2, mobile, safe-area]
aliases: [Phone prod reviews pin sheet, ОТЗЫВЫ пустые, Failed to fetch]
---

# Телефонный прод: пустые отзывы, «Failed to fetch», шит за экраном

> Хаб: [[🗺️ GARBAGIN Master Index]] · архитектура: [[01_Architecture/Architecture_Overview]] · фронт: [[02_Frontend/Frontend_Components]] · SQL: [[03_Backend_SQL/SQL_Migrations_Index]] · Edge: [[03_Backend_SQL/Backend_Edge_and_API]] · дорожная карта: [[04_Roadmap_Tasks/Roadmap_to_GooglePlay]] · дашборд: [[04_Roadmap_Tasks/00_Dashboard]]

Заметки с телефона (живой Stripe, не тест). Карта `****4242` — историческая тестовая; живой режим Stripe **не менялся**.

## 1. Профиль «Пока нет отзывов»

Экран — [[components/PublicProfile.tsx]]. Счётчики «создано / завершено» считают только миссии, где человек **создатель**. Ноль завершённых не значит, что о нём нет отзывов: исполнитель мог закрыть чужие задания.

Блок **ОТЗЫВЫ** — это отзывы **об этом человеке** (он `reviewee`), а не отзывы, которые он сам написал. Текст «The worker is very good…» от `test0theam` / stas должен быть на профиле **исполнителя**. На профиле автора его быть не должно.

Почему блок был пуст, хотя отзыв где-то виден:

- `get_profile_reviews` смотрел в основном `reviewee_id`. Старые строки с обязательным `cleaner_id` и пустым `reviewee_id` не попадали в выборку.
- Ошибка RPC глоталась в `catch`, и UI показывал ту же пустую заглушку, что и при нуле строк.
- Колокол уведомлений (если текст уже лежит в `notifications.message`) — другой экран, не список профиля.

Исправление: [[src/lib/reviews.ts]] читает RPC и, если он пуст или упал, публичную таблицу `reviews` с тем же правилом. Миграция [[supabase/migrations/20260924_profile_reviews_about_user.sql]] чинит функцию (`row_security = off`, `service_type` в карточке) и кладёт имя автора и комментарий в уведомление `new_review`.

## 2. «ОПЛАТИТЬ И ПОСТАВИТЬ ПИН» → Failed to fetch

Кнопка не ходит в Stripe. [[components/MapPicker.tsx]] `handleSubmit` списывает токены через RPC `create_lead_mission_with_token`. Жёлтая плашка «Проверка фото временно недоступна» — это отдельно упавший `/api/moderate-mission-image` (fail-open, фото всё равно прикрепляются).

Красный `Failed to fetch` — сырой `TypeError` браузера. С фото на форме запрос до RPC часто не доходит: [[src/lib/r2Media.ts]] делает `PUT` на presigned URL R2. Подпись включала `Content-Length` и `x-amz-meta-*`, а `fetch()` эти заголовки не повторяет. R2 отвечает 403 без CORS, и WebKit показывает именно «Failed to fetch».

Исправление в [[supabase/functions/r2-presign-media/index.ts]] и [[supabase/functions/r2-presign-proof/index.ts]]: подписывается только `Content-Type`, checksum SDK `WHEN_REQUIRED`. Пока в проде ещё старая функция, клиент ([[src/lib/r2Media.ts]]) повторяет `x-amz-meta-*` только если они есть в `X-Amz-SignedHeaders` — `Content-Length` браузер ставит сам. Если прямой PUT всё равно падает (нет CORS на бакете), файлы до 4 МБ пишет сама Edge-функция (`file_base64`, JWT как и раньше). Текст ошибки на форме — «Сеть оборвала запрос…», а не сырой `Failed to fetch`. Бизнес-ошибки вроде `Insufficient tokens` по-прежнему показываются как есть.

**4242.** Тестовая карта на живом ключе не проводится и токены за неё не начисляются. Это другой симптом: RPC ответил бы `Insufficient tokens`, а не оборвал сеть. Режим live/test в коде не переключался.

Нужен деплой Edge `r2-presign-media` (и `r2-presign-proof`) вместе с фронтом. Один только фронт без функции даст понятную ошибку, но файл в R2 не положит.

## 3. Первый шит уезжает под челку / ниже сгиба

`100dvh` на первом кадре iOS и Telegram больше видимой области. Шит миссии (`absolute` к низу карты) уезжал, кнопки не нажимались; после закрытия и повторного открытия viewport уже совпадал.

[[src/lib/visualViewport.ts]] пишет `--vv-height` и `--vv-offset-top`. Оверлеи карты — класс `ce-viewport-overlay`. Высота `.ce-bottom-sheet` вычитает `safe-area-inset-top`. Тултип пина зажимается в видимый прямоугольник.

## Применить

1. SQL: [[supabase/migrations/20260924_profile_reviews_about_user.sql]] в SQL Editor (не `db push` пачкой со старыми `20260912` / `20260917`).
2. Задеплоить Edge `r2-presign-media` и `r2-presign-proof`.
3. Задеплоить фронт.
