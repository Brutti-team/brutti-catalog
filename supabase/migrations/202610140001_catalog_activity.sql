-- Additive, owner-approved production migration for Brutti Catalog activity history.
-- Captures future product/category INSERT, UPDATE, DELETE server-side.
-- No user, category, product, storage object or existing policy is changed.
-- User identity is obtained from authenticated JWT (auth.uid()) only.
create table public.catalog_activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  action text not null,
  resource_type text not null,
  resource_name text not null default '',
  resource_id uuid,
  created_at timestamptz not null default now()
);

create index catalog_activity_recent_idx on public.catalog_activity (created_at desc);

alter table public.catalog_activity enable row level security;
revoke all on public.catalog_activity from public, anon, authenticated;
grant select on public.catalog_activity to authenticated;

-- Access is verified by the existing secure catalog_admins membership check.
-- No browser role may forge, overwrite or delete an audit record.
create policy "Approved catalog administrators view activity"
  on public.catalog_activity
  for select to authenticated
  using ((select public.is_catalog_admin()));

create function public.catalog_capture_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_id uuid;
  v_name text;
  v_action text;
  v_actor uuid;
  v_email text;
begin
  v_actor := auth.uid();
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_name := old.name;
    v_action := tg_table_name || '_deleted';
  elsif tg_op = 'INSERT' then
    v_id := new.id;
    v_name := new.name;
    v_action := tg_table_name || '_created';
  else
    v_id := new.id;
    v_name := new.name;
    v_action := tg_table_name || '_updated';
    if tg_table_name = 'products' and old.status is distinct from new.status then
      v_action := 'product_' || new.status::text;
    end if;
  end if;

  if v_actor is not null then
    select u.email into v_email from auth.users as u where u.id = v_actor;
  end if;

  insert into public.catalog_activity
    (actor_id, actor_email, action, resource_type, resource_name, resource_id)
  values
    (v_actor, coalesce(v_email, 'System'), v_action, tg_table_name, coalesce(v_name, ''), v_id);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

-- Execute is not granted to browser roles; these triggers run as their
-- database function owner, not as caller-supplied identities.
revoke all on function public.catalog_capture_activity() from public, anon, authenticated;

create trigger products_catalog_capture_activity
  after insert or update or delete on public.products
  for each row execute function public.catalog_capture_activity();
create trigger categories_catalog_capture_activity
  after insert or update or delete on public.categories
  for each row execute function public.catalog_capture_activity();
