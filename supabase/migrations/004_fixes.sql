-- Исправления после ревью бэкенда. Запускать один раз в SQL Editor.

-- 1. Время назначения исполнителя: от него считается эскалация «не принят за N минут»
--    (раньше считалось от created_at, и после переназначения эскалация срабатывала повторно через минуту).
alter table orders add column if not exists assigned_at timestamptz;

-- 2. Смена статуса.
--    - actor_id из payload принимается ТОЛЬКО от сервера (service_role). Раньше аноним мог подставить
--      чужой actor_id и менять любые наряды.
--    - поле orders.comment (комментарий мастера при выдаче) больше не перезаписывается при паузе/отказе —
--      комментарии к действиям живут в order_events.
--    - reassign требует assignee_id и обнуляет служебные отметки напоминаний/эскалации.
create or replace function change_order_status(p_order_id int, p_action text, p_payload jsonb default '{}')
returns orders
language plpgsql security definer set search_path = public as $$
declare
  o       orders;
  svc     boolean := is_service();
  me      int  := case when svc then (p_payload->>'actor_id')::int else current_employee_id() end;
  my_role employee_role := current_role_name();
  is_boss boolean := svc or my_role in ('master','manager','admin');
  new_st  order_status;
  old_st  order_status;
  m       jsonb;
begin
  if me is null and not svc then raise exception 'Нет доступа'; end if;

  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Наряд % не найден', p_order_id; end if;

  -- действия исполнителя: только свой наряд (мастер и сервер — любой)
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
  if p_action = 'reassign' and (p_payload->>'assignee_id') is null then
    raise exception 'Укажите нового исполнителя';
  end if;
  if p_action = 'set_priority' and (p_payload->>'priority') is null then
    raise exception 'Укажите приоритет';
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
    reminded_at  = case when p_action = 'reassign' then null else reminded_at end,
    assigned_at  = case when p_action = 'reassign' then now() else assigned_at end,
    work_done    = case when p_action = 'submit' then p_payload->>'work_done' else work_done end,
    fault_code   = case when p_action = 'submit' then p_payload->>'fault_code' else fault_code end,
    comment      = case when p_action = 'submit' then coalesce(p_payload->>'comment', comment) else comment end,
    assignee_id  = case when p_action = 'reassign' then (p_payload->>'assignee_id')::int else assignee_id end,
    priority     = case when p_action = 'set_priority' then (p_payload->>'priority')::priority else priority end
  where id = o.id
  returning * into o;

  insert into order_events(order_id, actor_id, action, from_status, to_status, comment, reason)
  values (o.id, me, p_action, old_st, new_st, p_payload->>'comment', p_payload->>'reason');
  return o;
end $$;

-- 3. Создание наряда мастером: нельзя сразу создать «закрытый» наряд задним числом;
--    участок всегда берётся из оборудования (фронт не может прислать несовпадающий).
create or replace function trg_orders_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.master_id is null then new.master_id := current_employee_id(); end if;
  select site_id into new.site_id from equipment where id = new.equipment_id;
  if not is_service() then
    new.master_id    := current_employee_id();
    new.status       := 'issued';
    new.created_at   := now();
    new.is_overdue   := false;
    new.accepted_at  := null;
    new.started_at   := null;
    new.submitted_at := null;
    new.closed_at    := null;
  end if;
  if new.assigned_at is null then new.assigned_at := new.created_at; end if;
  return new;
end $$;

-- 4. Анониму (без входа) функции недоступны.
revoke execute on function change_order_status(int, text, jsonb) from public, anon;
revoke execute on function master_override_review(bigint, int, text) from public, anon;
revoke execute on function worker_rating(timestamptz, timestamptz) from public, anon;
grant  execute on function change_order_status(int, text, jsonb) to authenticated, service_role;
grant  execute on function master_override_review(bigint, int, text) to authenticated, service_role;
grant  execute on function worker_rating(timestamptz, timestamptz) to authenticated, service_role;
