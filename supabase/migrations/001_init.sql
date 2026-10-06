-- НарядAI: начальная схема. Запуск: Supabase Dashboard → SQL Editor → вставить файл целиком → Run.

-- ============ ENUMS ============
create type order_status as enum ('issued','accepted','queued','in_progress','paused','rejected','submitted','needs_rework','closed','cancelled');
create type order_type   as enum ('planned','emergency');
create type priority     as enum ('emergency','high','normal','planned');
create type employee_role as enum ('master','worker','manager','admin');
create type photo_kind   as enum ('before','after');
create type ai_verdict   as enum ('accepted','accepted_with_notes','needs_rework');

-- ============ СПРАВОЧНИКИ ============
create table sites (
  id   serial primary key,
  name text not null unique
);

create table equipment (
  id          serial primary key,
  name        text not null,
  inv_number  text not null unique,
  site_id     int  not null references sites(id),
  type        text not null,
  criticality int  not null default 2 check (criticality between 1 and 3),
  qr_code     text not null unique default gen_random_uuid()::text
);

create table employees (
  id               serial primary key,
  auth_user_id     uuid unique references auth.users(id) on delete set null,
  full_name        text not null,
  login            text not null unique,
  specialty        text not null,
  grade            int  not null default 4,
  brigade          text,
  role             employee_role not null,
  shift            text not null default 'day' check (shift in ('day','night')),
  on_shift         boolean not null default true,
  telegram_chat_id bigint unique
);

create table fault_codes (
  code       text primary key,
  category   text not null check (category in ('М','Э','Г','П','С')),
  name       text not null,
  norm_hours numeric(5,2) not null
);

create table materials (
  id          serial primary key,
  name        text not null unique,
  unit        text not null,
  typical_qty numeric(10,2) not null default 1
);

-- ============ НАРЯДЫ ============
create table orders (
  id           serial primary key,
  number       serial unique,
  type         order_type not null,
  description  text not null,
  site_id      int not null references sites(id),
  equipment_id int not null references equipment(id),
  assignee_id  int references employees(id),
  master_id    int not null references employees(id),
  priority     priority not null default 'normal',
  deadline     timestamptz not null,
  status       order_status not null default 'issued',
  is_overdue   boolean not null default false,
  fault_code   text references fault_codes(code),
  work_done    text,
  comment      text,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  started_at   timestamptz,
  submitted_at timestamptz,
  closed_at    timestamptz,
  -- служебные поля для cron (напоминания и эскалации)
  reminded_at   timestamptz,
  overdue_notified_at timestamptz,
  escalated_at  timestamptz
);
create index on orders (status);
create index on orders (assignee_id, status);
create index on orders (equipment_id, created_at);
create index on orders (deadline) where status not in ('closed','cancelled');

create table order_events (
  id          bigserial primary key,
  order_id    int not null references orders(id) on delete cascade,
  actor_id    int references employees(id),
  action      text not null,
  from_status order_status,
  to_status   order_status,
  comment     text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index on order_events (order_id, created_at);

create table order_photos (
  id           bigserial primary key,
  order_id     int not null references orders(id) on delete cascade,
  kind         photo_kind not null,
  storage_path text not null,
  taken_at     timestamptz,
  phash        text,
  author_id    int references employees(id),
  created_at   timestamptz not null default now()
);
create index on order_photos (order_id);

create table order_materials (
  id          bigserial primary key,
  order_id    int not null references orders(id) on delete cascade,
  material_id int not null references materials(id),
  qty         numeric(10,2) not null check (qty > 0)
);
create index on order_materials (order_id);

create table ai_reviews (
  id                  bigserial primary key,
  order_id            int not null references orders(id) on delete cascade,
  verdict             ai_verdict not null,
  score               int not null check (score between 1 and 5),
  photo_score         int check (photo_score between 1 and 5),
  explanation         text not null,
  worker_feedback     text not null,
  checks              jsonb not null default '[]',
  needs_master_review boolean not null default false,
  master_score        int check (master_score between 1 and 5),
  master_comment      text,
  model               text not null,
  created_at          timestamptz not null default now()
);
create index on ai_reviews (order_id, created_at desc);

create table ai_insights (
  id             bigserial primary key,
  kind           text not null,
  title          text not null,
  text           text not null,
  recommendation text,
  data           jsonb not null default '{}',
  period_from    timestamptz,
  period_to      timestamptz,
  created_at     timestamptz not null default now()
);

create table notifications (
  id          bigserial primary key,
  employee_id int not null references employees(id) on delete cascade,
  order_id    int references orders(id) on delete cascade,
  kind        text not null,
  text        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index on notifications (employee_id, created_at desc);

-- ============ ХЕЛПЕРЫ ============
create or replace function current_employee_id() returns int
language sql stable security definer set search_path = public as $$
  select id from employees where auth_user_id = auth.uid()
$$;

create or replace function current_role_name() returns employee_role
language sql stable security definer set search_path = public as $$
  select role from employees where auth_user_id = auth.uid()
$$;

create or replace function is_service() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role'
$$;

-- Лог события «создан» и master_id по умолчанию
create or replace function trg_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.master_id is null then new.master_id := current_employee_id(); end if;
  return new;
end $$;
create trigger orders_before_insert before insert on orders
  for each row execute function trg_orders_before_insert();

create or replace function trg_orders_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_events(order_id, actor_id, action, to_status, created_at)
  values (new.id, new.master_id, 'create', new.status, new.created_at);
  return new;
end $$;
create trigger orders_after_insert after insert on orders
  for each row execute function trg_orders_after_insert();

-- ============ RPC: смена статуса ============
-- Единственный способ менять статус наряда. Пишет order_events.
create or replace function change_order_status(p_order_id int, p_action text, p_payload jsonb default '{}')
returns orders
language plpgsql security definer set search_path = public as $$
declare
  o       orders;
  me      int  := coalesce(current_employee_id(), (p_payload->>'actor_id')::int);
  my_role employee_role := current_role_name();
  svc     boolean := is_service();
  is_boss boolean := svc or my_role in ('master','manager','admin');
  new_st  order_status;
  old_st  order_status;
  m       jsonb;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Наряд % не найден', p_order_id; end if;
  if me is null and not svc then raise exception 'Нет доступа'; end if;

  -- действия исполнителя: только свой наряд (руководитель и сервис тоже могут)
  if p_action in ('accept','queue','reject','start','pause','resume','submit')
     and not is_boss and o.assignee_id is distinct from me then
    raise exception 'Это не ваш наряд';
  end if;
  if p_action in ('rework','close','cancel','reassign','set_priority') and not is_boss then
    raise exception 'Действие доступно только мастеру';
  end if;

  new_st := case p_action
    when 'accept'       then case when o.status = 'issued' then 'accepted' end
    when 'queue'        then case when o.status in ('issued','accepted') then 'queued' end
    when 'reject'       then case when o.status in ('issued','accepted','queued') then 'rejected' end
    when 'start'        then case when o.status in ('accepted','queued','needs_rework','issued') then 'in_progress' end
    when 'pause'        then case when o.status = 'in_progress' then 'paused' end
    when 'resume'       then case when o.status = 'paused' then 'in_progress' end
    when 'submit'       then case when o.status = 'in_progress' then 'submitted' end
    when 'rework'       then case when o.status = 'submitted' then 'needs_rework' end
    when 'close'        then case when o.status = 'submitted' then 'closed' end
    when 'cancel'       then case when o.status not in ('closed','cancelled') then 'cancelled' end
    when 'reassign'     then case when o.status in ('issued','accepted','queued','rejected') then 'issued' end
    when 'set_priority' then case when o.status not in ('closed','cancelled') then o.status::text end
  end::order_status;

  if new_st is null then
    raise exception 'Нельзя выполнить «%» для наряда в статусе %', p_action, o.status;
  end if;
  if p_action in ('reject','pause') and coalesce(p_payload->>'reason','') = '' then
    raise exception 'Укажите причину';
  end if;

  if p_action = 'submit' then
    if coalesce(p_payload->>'work_done','') = '' or coalesce(p_payload->>'fault_code','') = '' then
      raise exception 'Заполните выполненные работы и шифр неисправности';
    end if;
    delete from order_materials where order_id = o.id;
    for m in select * from jsonb_array_elements(coalesce(p_payload->'materials','[]'::jsonb)) loop
      insert into order_materials(order_id, material_id, qty)
      values (o.id, (m->>'material_id')::int, (m->>'qty')::numeric);
    end loop;
  end if;

  old_st := o.status;

  update orders set
    status       = new_st,
    accepted_at  = case when p_action = 'reassign' then null
                        when p_action in ('accept','queue') and accepted_at is null then now() else accepted_at end,
    started_at   = case when p_action = 'start' and started_at is null then now() else started_at end,
    submitted_at = case when p_action = 'submit' then now() else submitted_at end,
    closed_at    = case when p_action = 'close' then now() else closed_at end,
    is_overdue   = case when p_action in ('close','cancel') then false else is_overdue end,
    escalated_at = case when p_action = 'reassign' then null else escalated_at end,
    work_done    = case when p_action = 'submit' then p_payload->>'work_done' else work_done end,
    fault_code   = case when p_action = 'submit' then p_payload->>'fault_code' else fault_code end,
    comment      = coalesce(p_payload->>'comment', comment),
    assignee_id  = case when p_action = 'reassign' then (p_payload->>'assignee_id')::int else assignee_id end,
    priority     = case when p_action = 'set_priority' then (p_payload->>'priority')::priority else priority end
  where id = o.id
  returning * into o;

  insert into order_events(order_id, actor_id, action, from_status, to_status, comment, reason)
  values (o.id, me, p_action, old_st, new_st, p_payload->>'comment', p_payload->>'reason');
  return o;
end $$;

-- Мастер меняет оценку ИИ (финальное слово за человеком)
create or replace function master_override_review(p_review_id bigint, p_score int, p_comment text default null)
returns ai_reviews
language plpgsql security definer set search_path = public as $$
declare r ai_reviews;
begin
  if not (is_service() or current_role_name() in ('master','manager','admin')) then
    raise exception 'Действие доступно только мастеру';
  end if;
  update ai_reviews set master_score = p_score, master_comment = p_comment
  where id = p_review_id returning * into r;
  insert into order_events(order_id, actor_id, action, comment)
  values (r.order_id, current_employee_id(), 'master_override', format('Оценка изменена на %s. %s', p_score, coalesce(p_comment,'')));
  return r;
end $$;

-- ============ VIEWS ============
create or replace view v_employee_status with (security_invoker = true) as
select
  e.id as employee_id,
  case
    when not e.on_shift then 'off_shift'
    when exists (select 1 from orders o where o.assignee_id = e.id and o.status in ('in_progress','paused')) then 'busy'
    when exists (select 1 from orders o where o.assignee_id = e.id and o.status in ('issued','accepted','queued','needs_rework')) then 'has_queue'
    else 'free'
  end as status,
  (select o.id from orders o where o.assignee_id = e.id and o.status in ('in_progress','paused')
   order by o.started_at desc nulls last limit 1) as current_order_id,
  (select count(*)::int from orders o where o.assignee_id = e.id and o.status in ('issued','accepted','queued','needs_rework')) as queue_count
from employees e
where e.role = 'worker';

-- Рейтинг за период: 35% качество + 25% в срок + 20% без возвратов/повторов за 7 дней + 15% сложность − 5% штраф за отказы
create or replace function worker_rating(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns table (
  employee_id int, closed_count int, quality numeric, on_time_rate numeric, rework_rate numeric,
  complexity numeric, unjustified_rejects int, rating numeric
)
language sql stable security definer set search_path = public as $$
with done as (
  select o.*,
    (select coalesce(r.master_score, r.score) from ai_reviews r where r.order_id = o.id order by r.created_at desc limit 1) as q,
    case o.priority when 'emergency' then 1.0 when 'high' then 0.75 when 'normal' then 0.5 else 0.4 end as w,
    (exists (select 1 from order_events ev where ev.order_id = o.id and ev.action = 'rework')
     or exists (select 1 from orders o2 where o2.equipment_id = o.equipment_id and o2.id <> o.id
                and o2.type = 'emergency' and o2.fault_code = o.fault_code
                and o2.created_at > o.closed_at and o2.created_at <= o.closed_at + interval '7 days')) as bad
  from orders o
  where o.status = 'closed' and o.closed_at between p_from and p_to and o.assignee_id is not null
),
rej as (
  select ev.actor_id as employee_id, count(*)::int as n
  from order_events ev
  where ev.action = 'reject' and ev.created_at between p_from and p_to
    and coalesce(ev.reason,'') not in ('Нет материалов','Нет допуска','Занят аварийным','Не на смене','Нет инструмента')
  group by ev.actor_id
),
agg as (
  select d.assignee_id as employee_id,
    count(*)::int as closed_count,
    round(coalesce(avg(d.q), 3) / 5 * 100, 1) as quality,
    round(100.0 * avg(case when d.submitted_at <= d.deadline then 1 else 0 end), 1) as on_time_rate,
    round(100.0 * avg(case when d.bad then 1 else 0 end), 1) as rework_rate,
    sum(d.w) as load
  from done d group by d.assignee_id
)
select a.employee_id, a.closed_count, a.quality, a.on_time_rate, a.rework_rate,
  round(100 * a.load / nullif(max(a.load) over (), 0), 1) as complexity,
  coalesce(r.n, 0) as unjustified_rejects,
  round(greatest(0,
      0.35 * a.quality + 0.25 * a.on_time_rate + 0.20 * (100 - a.rework_rate)
    + 0.15 * (100 * a.load / nullif(max(a.load) over (), 0))
    - 0.05 * least(100, coalesce(r.n, 0) * 25)), 1) as rating
from agg a left join rej r on r.employee_id = a.employee_id
order by rating desc
$$;

create or replace view v_worker_rating with (security_invoker = true) as
select * from worker_rating();

-- ============ RLS ============
alter table sites           enable row level security;
alter table equipment       enable row level security;
alter table employees       enable row level security;
alter table fault_codes     enable row level security;
alter table materials       enable row level security;
alter table orders          enable row level security;
alter table order_events    enable row level security;
alter table order_photos    enable row level security;
alter table order_materials enable row level security;
alter table ai_reviews      enable row level security;
alter table ai_insights     enable row level security;
alter table notifications   enable row level security;

-- Чтение: все авторизованные (MVP)
do $$ declare t text; begin
  foreach t in array array['sites','equipment','employees','fault_codes','materials','orders','order_events',
                           'order_photos','order_materials','ai_reviews','ai_insights'] loop
    execute format('create policy read_all on %I for select to authenticated using (true)', t);
  end loop;
end $$;

create policy read_own on notifications for select to authenticated using (employee_id = current_employee_id());
create policy mark_read on notifications for update to authenticated using (employee_id = current_employee_id());

-- Создание наряда: мастер/руководитель. Смена статуса — только через RPC.
create policy master_insert on orders for insert to authenticated
  with check (current_role_name() in ('master','manager','admin'));

create policy photo_insert on order_photos for insert to authenticated
  with check (author_id = current_employee_id());

-- Справочники может править админ
do $$ declare t text; begin
  foreach t in array array['sites','equipment','employees','fault_codes','materials'] loop
    execute format('create policy admin_write on %I for all to authenticated using (current_role_name() = ''admin'') with check (current_role_name() = ''admin'')', t);
  end loop;
end $$;

-- ============ STORAGE ============
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy photos_read   on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy photos_upload on storage.objects for insert to authenticated with check (bucket_id = 'photos');

-- ============ REALTIME ============
alter publication supabase_realtime add table orders, order_events, notifications, ai_reviews, employees;
