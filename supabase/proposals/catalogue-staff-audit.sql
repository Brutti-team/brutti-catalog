-- REVIEW PROPOSAL ONLY. NOT APPLIED TO PRODUCTION OR STAGING DATABASE.
-- Run after schema audit and explicit owner approval. The existing two migrations
-- must not be replayed. This proposal grants no browser access to auth.users.
begin;

create table public.catalog_staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'editor')),
  assigned_at timestamptz not null default now()
);
alter table public.catalog_staff_roles enable row level security;
revoke all on public.catalog_staff_roles from public, anon, authenticated;

-- Preserve every existing approved catalog administrator as an Admin.
insert into public.catalog_staff_roles (user_id, role)
select user_id, 'admin' from public.catalog_admins
on conflict (user_id) do nothing;

-- The owner approved this exact initial administrator. Fail rather than
-- accidentally elevating a different user with a matching display name.
do $$
begin
  if not exists (
    select 1 from auth.users u
    join public.catalog_admins a on a.user_id = u.id
    where u.id = 'b38404cc-fb0a-4877-af13-8b63a765f2cf'::uuid
      and lower(u.email) = 'integrator.brutti@gmail.com'
  ) then
    raise exception 'Approved first administrator is missing. Stop and review before applying roles.';
  end if;
  update public.catalog_staff_roles set role = 'super_admin'
    where user_id = 'b38404cc-fb0a-4877-af13-8b63a765f2cf'::uuid;
end;
$$;

-- SECURITY DEFINER function accesses a restricted roles table, but derives
-- the identity ONLY from verified auth.uid(), never a browser-supplied UUID.
create function public.catalog_my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.catalog_staff_roles where user_id = (select auth.uid());
$$;
revoke all on function public.catalog_my_role() from public, anon, authenticated;
grant execute on function public.catalog_my_role() to authenticated;

-- Read-only, append-only server audit. Activity timestamps and actor identity
-- are NEVER provided by frontend code; only server triggers/RPC insert rows.
create table public.catalog_activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null default 'system',
  action text not null,
  resource_type text not null,
  resource_name text not null default '',
  resource_id uuid,
  created_at timestamptz not null default now()
);
create index catalog_activity_created_idx on public.catalog_activity(created_at desc);
alter table public.catalog_activity enable row level security;
revoke all on public.catalog_activity from public, anon, authenticated;
grant select on public.catalog_activity to authenticated;
create policy "Managers see activity and editors see their own"
  on public.catalog_activity for select to authenticated
  using (public.catalog_my_role() in ('super_admin','admin')
    or (public.catalog_my_role() = 'editor' and actor_id = auth.uid()));

create function public.catalog_record_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item_id uuid;
  item_name text;
  action_name text;
  actor_email text;
begin
  if tg_op = 'DELETE' then
    item_id := old.id;
    item_name := old.name;
    action_name := lower(tg_table_name) || '_deleted';
  elsif tg_op = 'INSERT' then
    item_id := new.id;
    item_name := new.name;
    action_name := lower(tg_table_name) || '_created';
  else
    item_id := new.id;
    item_name := new.name;
    action_name := lower(tg_table_name) || '_updated';
    if tg_table_name = 'products' then
      if old.status is distinct from new.status then
        action_name := 'product_' || new.status::text;
      end if;
    end if;
  end if;
  select coalesce(u.email, 'system') into actor_email
    from auth.users u where u.id = auth.uid();
  insert into public.catalog_activity(actor_id,actor_email,action,resource_type,resource_name,resource_id)
  values (auth.uid(),coalesce(actor_email,'system'),action_name,tg_table_name,item_name,item_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.catalog_record_change() from public, anon, authenticated;
create trigger products_catalog_activity after insert or update or delete on public.products
  for each row execute function public.catalog_record_change();
create trigger categories_catalog_activity after insert or update or delete on public.categories
  for each row execute function public.catalog_record_change();

-- Super Admin can view ONLY identity/role/last-login fields; not credentials,
-- tokens, sessions, password hashes or private auth metadata.
create function public.catalog_list_staff()
returns table(user_id uuid, email text, display_name text, role text, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.catalog_my_role() is distinct from 'super_admin' then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text,
           coalesce(nullif(left(trim(u.raw_user_meta_data->>'full_name'),80),''), split_part(u.email,'@',1)),
           s.role, u.last_sign_in_at
    from auth.users u
    left join public.catalog_staff_roles s on s.user_id = u.id
    order by u.created_at desc limit 200;
end;
$$;
revoke all on function public.catalog_list_staff() from public, anon, authenticated;
grant execute on function public.catalog_list_staff() to authenticated;

-- Only an authenticated Super Admin can grant/revoke staff catalog access.
-- No browser-side role edits, self promotion or last-owner removal.
create function public.catalog_set_staff_role(p_user_id uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  email_to_audit text;
  current_target_role text;
  actor_email text;
begin
  if public.catalog_my_role() is distinct from 'super_admin' then
    raise exception 'Super Admin required' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Cannot change your own role' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('super_admin','admin','editor') then
    raise exception 'Invalid catalog role' using errcode = '22023';
  end if;
  select u.email into email_to_audit from auth.users u where u.id = p_user_id;
  if email_to_audit is null then
    raise exception 'User must first be invited to Supabase Auth' using errcode = '22023';
  end if;
  select role into current_target_role from public.catalog_staff_roles where user_id=p_user_id for update;
  if current_target_role = 'super_admin' and p_role is distinct from 'super_admin'
     and (select count(*) from public.catalog_staff_roles where role='super_admin') <= 1 then
    raise exception 'Cannot remove the last Super Admin' using errcode = '42501';
  end if;
  if p_role is null then
    delete from public.catalog_staff_roles where user_id=p_user_id;
    delete from public.catalog_admins where user_id=p_user_id;
  else
    insert into public.catalog_admins(user_id) values(p_user_id)
      on conflict (user_id) do nothing;
    insert into public.catalog_staff_roles(user_id,role) values(p_user_id,p_role)
      on conflict (user_id) do update set role=excluded.role, assigned_at=now();
  end if;
  select coalesce(u.email,'system') into actor_email from auth.users u where u.id=auth.uid();
  insert into public.catalog_activity(actor_id,actor_email,action,resource_type,resource_name,resource_id)
    values(auth.uid(),coalesce(actor_email,'system'),
      case when p_role is null then 'staff_access_revoked' else 'staff_role_changed' end,
      'staff',email_to_audit,p_user_id);
end;
$$;
revoke all on function public.catalog_set_staff_role(uuid,text) from public, anon, authenticated;
grant execute on function public.catalog_set_staff_role(uuid,text) to authenticated;

-- Replace overly broad original catalog_admins membership policies. Members
-- remain authorized for sign-in + image upload; only Admin/Super Admin may
-- publish, delete and manage categories. Editors may change Draft products.
drop policy "Catalog administrators manage products" on public.products;
create policy "Catalog managers manage products" on public.products
  for all to authenticated
  using (public.catalog_my_role() in ('super_admin','admin'))
  with check (public.catalog_my_role() in ('super_admin','admin'));
create policy "Catalog editors can read drafts" on public.products
  for select to authenticated
  using (public.catalog_my_role() = 'editor' and status = 'draft');
create policy "Catalog editors can add drafts" on public.products
  for insert to authenticated
  with check (public.catalog_my_role() = 'editor' and status = 'draft');
create policy "Catalog editors can edit drafts only" on public.products
  for update to authenticated
  using (public.catalog_my_role() = 'editor' and status = 'draft')
  with check (public.catalog_my_role() = 'editor' and status = 'draft');

drop policy "Catalog administrators manage categories" on public.categories;
create policy "Catalog managers manage categories" on public.categories
  for all to authenticated
  using (public.catalog_my_role() in ('super_admin','admin'))
  with check (public.catalog_my_role() in ('super_admin','admin'));

-- Image operations use the pre-existing auth.uid()-scoped object policy and
-- is_catalog_admin() membership; complete real Storage/RLS tests before approval.
commit;
