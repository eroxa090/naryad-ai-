-- Быстрая очистка демо-данных со сбросом счётчиков (номера нарядов снова с №1). Вызывает только сид-скрипт (service_role).
create or replace function reset_demo() returns void
language sql security definer set search_path = public as $$
  truncate notifications, ai_insights, ai_reviews, order_materials, order_photos, order_events, orders,
           employees, equipment, sites, materials, fault_codes restart identity cascade;
$$;
revoke execute on function reset_demo() from public, anon, authenticated;
