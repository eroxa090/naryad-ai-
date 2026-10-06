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
