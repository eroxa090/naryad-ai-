# НарядAI — общий контракт команды (AGENTS.md читают Codex и Claude Code)

Хакатон Qostanai AI Industry Hackathon 2026, кейс 1 (АО «Костанайские минералы»).
**Дедлайн сдачи: 8 октября 2026, 23:59.** Делаем MVP, без перфекционизма.

Этот файл — единый источник правды. Каждый участник работает ТОЛЬКО в своих папках.
Нужно изменить чужую зону или контракт ниже → написать владельцу в чат команды, не править самому.

## Стек
- Фронтенд: React + TypeScript + Vite, PWA (vite-plugin-pwa), Tailwind + shadcn/ui, React Router, TanStack Query
- БД / авторизация / realtime / фото / cron: Supabase (Postgres, Auth, Realtime, Storage, pg_cron + pg_net)
- Серверные функции: Vercel Functions в папке `/api` (TypeScript, Node)
- ИИ: Anthropic SDK `@anthropic-ai/sdk`; Whisper через Groq
- Аналитика: Python (pandas, scikit-learn) в `/analytics`, запускается скриптом, пишет результат в таблицу `ai_insights`
- Уведомления: Telegram-бот (grammY) + звук/баннер в приложении через Supabase Realtime

## Зоны ответственности (кто какие файлы трогает)
| Зона | Владелец | Папки / файлы |
|---|---|---|
| Бэкенд и данные | **Человек 1** | `supabase/**`, `shared/**`, `api/_lib/**`, `api/orders/**`, `api/cron/**`, `api/telegram/**`, `api/notify/**`, `package.json`, `vercel.json`, `.env.example` |
| Фронтенд | **Человек 2** | `src/**`, `public/**`, `index.html`, `vite.config.ts`, `tailwind.config.*` |
| ИИ и аналитика | **Человек 3** | `api/ai/**`, `analytics/**` |

Правила git:
- Ветки: `backend`, `frontend`, `ai`. Мержим в `main` через PR маленькими кусками, минимум 2–3 раза в день.
- Перед началом работы всегда `git pull origin main` и мерж `main` в свою ветку.
- Новую npm-зависимость добавляем отдельным коммитом. Конфликт в `package-lock.json` → взять версию из `main`, затем `npm install`.
- `.env` никогда не коммитим. Новая переменная → строка в `.env.example` (пишет Человек 1 по просьбе).

## Переменные окружения (.env.example)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=      # только сервер (api/, analytics/), НИКОГДА во фронт
ANTHROPIC_API_KEY=              # только сервер
GROQ_API_KEY=                   # только сервер
TELEGRAM_BOT_TOKEN=             # только сервер
CRON_SECRET=                    # общий секрет для /api/cron/*
AI_MOCK=true                    # true = ИИ-эндпоинты отдают заглушки и не тратят деньги
AI_MODEL_FAST=claude-haiku-4-5
AI_MODEL_SMART=claude-haiku-4-5 # на финальное демо и видео переключить на claude-sonnet-5-5
```

## Бюджет на ИИ: $8 на всё
- По умолчанию `AI_MOCK=true`. Реальные вызовы включаем только для отладки промптов и для демо.
- Разработка идёт на Haiku 4.5. Sonnet 5.5 включаем только на запись видео и Demo Day.
- Исторические 500+ нарядов НЕ прогоняем через ИИ: их оценки генерирует сид-скрипт.
- Фото перед отправкой в ИИ сжимаем до ≤1000 px. Системные промпты со справочниками кэшируем (prompt caching).
- Сообщения о просрочке шлём по шаблону, без LLM.

## Модель данных (владелец схемы — Человек 1)
Enum-ы:
- `order_status`: `issued` (выдан), `accepted` (принят), `queued` (в очереди), `in_progress` (в работе), `paused` (приостановлен), `rejected` (отклонён), `submitted` (исполнен, ждёт проверки), `needs_rework` (на доработке), `closed` (закрыт мастером), `cancelled` (отменён). Это 10 статусов. Просрочка хранится отдельным флагом `is_overdue`.
- `order_type`: `planned`, `emergency`
- `priority`: `emergency`, `high`, `normal`, `planned`
- `employee_role`: `master`, `worker`, `manager`, `admin`
- `photo_kind`: `before`, `after`
- `ai_verdict`: `accepted`, `accepted_with_notes`, `needs_rework`

Таблицы:
- `sites(id, name)`
- `equipment(id, name, inv_number, site_id, type, criticality 1..3, qr_code)`
- `employees(id, auth_user_id, full_name, login, specialty, grade, brigade, role, shift, on_shift bool, telegram_chat_id)`
- `fault_codes(code PK, category М|Э|Г|П|С, name, norm_hours)`
- `materials(id, name, unit, typical_qty)`
- `orders(id, number serial, type, description, site_id, equipment_id, assignee_id, master_id, priority, deadline, status, is_overdue, fault_code, work_done, comment, created_at, accepted_at, started_at, submitted_at, closed_at)`
- `order_events(id, order_id, actor_id, action, from_status, to_status, comment, reason, created_at)`
- `order_photos(id, order_id, kind, storage_path, taken_at, phash, author_id, created_at)`
- `order_materials(id, order_id, material_id, qty)`
- `ai_reviews(id, order_id, verdict, score 1..5, photo_score 1..5 null, explanation, worker_feedback, checks jsonb, needs_master_review bool, master_score null, master_comment null, model, created_at)`
- `ai_insights(id, kind, title, text, recommendation, data jsonb, period_from, period_to, created_at)`
- `notifications(id, employee_id, order_id, kind, text, created_at, read_at)`

Представления (views):
- `v_employee_status`: `employee_id, status ('free'|'busy'|'has_queue'|'off_shift'), current_order_id, queue_count`
- `v_worker_rating` (за 30 дней) и функция `worker_rating(p_from, p_to)` для любого периода: `employee_id, closed_count, quality, on_time_rate, rework_rate, complexity, unjustified_rejects, rating 0..100`

Формула рейтинга:
`35% качество + 25% в срок + 20% без возвратов и повторов за 7 дней + 15% сложность − 5% штраф за необоснованные отказы`

Смена статусов — ТОЛЬКО через RPC `change_order_status(order_id, action, payload jsonb)`. Функция проверяет допустимость перехода, ставит временные метки и пишет `order_events`.
Значения `action`: `accept`, `queue`, `reject`, `start`, `pause`, `resume`, `submit`, `rework`, `close`, `cancel`, `reassign`, `set_priority`.
Вызов с фронта: `supabase.rpc('change_order_status', { p_order_id, p_action, p_payload })`. Для `reject` и `pause` обязателен `p_payload.reason`.
Мастер меняет оценку ИИ: `supabase.rpc('master_override_review', { p_review_id, p_score, p_comment })`.
Создание наряда: обычный `insert` в `orders` (разрешён мастеру; событие `create` пишется триггером), затем фронт вызывает `POST /api/orders/notify-new { order_id }`.
Payload для `submit`: `{ work_done, fault_code, comment, materials:[{material_id, qty}] }`.

Авторизация: Supabase Auth, email = `<login>@naryad.local`, пароль = 6-значный ПИН. Строка в `employees` связана через `auth_user_id`.
Фото: Storage bucket `photos`, путь `orders/<order_id>/<kind>-<uuid>.jpg`.
EXIF `taken_at` фронт читает ДО сжатия (сжатие стирает EXIF) и передаёт при вставке в `order_photos`.

## API-контракт ИИ (владелец — Человек 3, вызывает фронт Человека 2)
Все эндпоинты: `POST`, JSON, заголовок `Authorization: Bearer <supabase access token>`. При `AI_MOCK=true` возвращают правдоподобную заглушку той же формы.
| Эндпоинт | Запрос | Ответ |
|---|---|---|
| `/api/ai/transcribe` | `{ audio_base64, mime }` | `{ text }` |
| `/api/ai/parse-order` | `{ text }` | `{ description, type, priority, site_id, equipment_id, fault_code, norm_hours, confidence }` |
| `/api/ai/suggest-worker` | `{ equipment_id, fault_code? }` | `{ candidates: [{ employee_id, score, reason }] }` |
| `/api/ai/check-order` | `{ order_id }` | строка `ai_reviews` (и сохраняет её; при `needs_rework` переводит наряд в `needs_rework` через RPC) |
| `/api/ai/shift-report` | `{ from, to, site_id? }` | `{ stats, summary }` |
| `/api/ai/assistant` | `{ question }` | `{ answer }` |

`/api/ai/assistant` также вызывается Telegram-ботом от сервера: без Bearer, с заголовком `x-internal-secret: <CRON_SECRET>` и полем `employee_id` в теле. Такой вызов нужно принимать.

Аналитика: `python analytics/run.py` считает аномалии и прогнозы и пишет строки в `ai_insights`. Фронт читает таблицу напрямую.

## Эндпоинты Человека 1
- `POST /api/orders/notify-new { order_id }`: push исполнителю о новом наряде (Telegram с кнопками «Принять» и «В очередь», плюс запись в `notifications`).
- `POST /api/cron/check-deadlines` (заголовок `x-cron-secret`): раз в минуту вызывается pg_cron. Делает напоминания за 30 минут, флаг просрочки, сообщения исполнителю и мастеру, эскалацию непринятых (10 минут, аварийные 3 минуты).
- `POST /api/telegram/webhook`: бот. `/start <login> <ПИН>` привязывает chat_id (ПИН проверяется, сообщение с ПИН удаляется). Вопросы мастера пересылает в `/api/ai/assistant`.
- `api/_lib/notify.ts`: функция `notify(employee_id, order_id, kind, text)` пишет в `notifications` и шлёт в Telegram. Человек 3 может её импортировать.

## Безопасность (для защиты)
- ФИО в LLM не отправляем, только ID сотрудника.
- ИИ только рекомендует. Мастер может изменить оценку (`master_score`) и закрывает наряд сам.
- Ключи Supabase service, Anthropic, Groq и Telegram живут только в `/api` и `/analytics`.

## Демо-данные (сид, Человек 1)
4 участка, 25 единиц оборудования, 2 мастера, 15 исполнителей в 3 бригадах, 20 шифров, 40 материалов, 600 нарядов за 3 месяца.
Заложенные закономерности:
1. Конвейер К-3 ломается в 3 раза чаще остальных, в основном шифр М-02 (подшипник).
2. Исполнитель Иванов: около 40% нарядов с повторной поломкой в течение 7 дней.
3. Дробилка КМД-1750 ломается через 3–5 дней после каждого планового ремонта (ППР).
4. Ночная смена на участке обогащения: время реакции в 2 раза выше.

Тестовые аккаунты: `master1`, `worker1`, `worker2`, `manager1`, ПИН у всех `111111`.

## Код
- Общие TS-типы: `shared/types.ts` (без импортов). В `api/**` относительные импорты пишем с расширением `.js` (Node ESM), например `import { admin } from '../_lib/supabase.js'`.
- Готовые хелперы сервера: `api/_lib/supabase.ts` (`admin`), `api/_lib/auth.ts` (`requireEmployee`, `requireCronSecret`, `onlyPost`), `api/_lib/notify.ts` (`notify`), `api/_lib/telegram.ts` (`sendTelegram`).
- Проверка перед PR: `npm run typecheck && npm run build`.
