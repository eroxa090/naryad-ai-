# НарядAI

Интеллектуальная система выдачи и контроля нарядов. Хакатон Qostanai AI Industry Hackathon 2026, кейс 1 (АО «Костанайские минералы»).
Правила команды и контракт: [AGENTS.md](AGENTS.md). Промпты для агентов: [PROMPTS.md](PROMPTS.md).

## Запуск локально
1. `npm install`
2. Скопировать `.env.example` в `.env` и заполнить ключи.
3. База данных: Supabase Dashboard → SQL Editor → выполнить `supabase/migrations/001_init.sql`.
4. Тестовые данные: `npm run seed`
5. Только фронтенд: `npm run dev`. Фронтенд вместе с `/api`: `npx vercel dev`.

## Деплой
Vercel → Import Git Repository → добавить переменные из `.env.example` → Deploy.

## Cron и Telegram (один раз после деплоя)
1. В `supabase/migrations/002_cron.sql` замените `APP_URL` и `CRON_SECRET`, выполните в SQL Editor.
2. Webhook бота:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook&secret_token=<CRON_SECRET>"`
3. Каждый сотрудник пишет боту `/start <логин>`.
