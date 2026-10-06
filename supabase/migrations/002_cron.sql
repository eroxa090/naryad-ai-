-- Проверка сроков раз в минуту: pg_cron вызывает /api/cron/check-deadlines на Vercel.
-- ПЕРЕД ЗАПУСКОМ замените APP_URL и CRON_SECRET на реальные значения.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('check-deadlines') where exists (select 1 from cron.job where jobname = 'check-deadlines');

select cron.schedule(
  'check-deadlines',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'APP_URL/api/cron/check-deadlines',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', 'CRON_SECRET'),
    body    := '{}'::jsonb
  );
  $$
);

-- Проверить: select * from cron.job_run_details order by start_time desc limit 5;
-- Ответы Vercel: select status_code, content from net._http_response order by created desc limit 5;
