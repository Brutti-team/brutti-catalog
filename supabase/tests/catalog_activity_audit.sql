-- Isolated PostgreSQL fixture only. Production tables are NOT touched by this test.
do $$
begin
  if has_table_privilege('anon', 'public.catalog_activity', 'SELECT') then
    raise exception 'Anonymous catalog activity access must be denied';
  end if;
  if has_table_privilege('authenticated', 'public.catalog_activity', 'INSERT')
      or has_table_privilege('authenticated', 'public.catalog_activity', 'UPDATE')
      or has_table_privilege('authenticated', 'public.catalog_activity', 'DELETE') then
    raise exception 'Authenticated users must not forge/alter audit history';
  end if;
end;
$$;
set role authenticated;
select set_config('request.jwt.claim.sub','b38404cc-fb0a-4877-af13-8b63a765f2cf',false);
insert into public.categories (id,name,description)
values ('22222222-2222-4222-8222-222222222222','Local Audit Test Category','Test category');
insert into public.products (id,name,sku,category_id,width,depth,height)
values ('33333333-3333-4333-8333-333333333333',
        'Local Audit Test Product','LOCAL-AUDIT-ONLY',
        '22222222-2222-4222-8222-222222222222',10,10,10);
update public.products set status='archived'
 where id='33333333-3333-4333-8333-333333333333';
delete from public.products where id='33333333-3333-4333-8333-333333333333';
update public.categories set description='Updated locally'
 where id='22222222-2222-4222-8222-222222222222';
delete from public.categories where id='22222222-2222-4222-8222-222222222222';
do $$
declare
  n integer;
begin
  select count(*) into n from public.catalog_activity
   where actor_id='b38404cc-fb0a-4877-af13-8b63a765f2cf'
     and actor_email='integrator.brutti@gmail.com';
  if n <> 6 then raise exception 'Expected 6 real trigger-generated events, got %',n; end if;
  if not exists (select 1 from public.catalog_activity where action='product_archived'
    and resource_name='Local Audit Test Product' and created_at is not null) then
    raise exception 'Product status change was not captured by the database';
  end if;
end;
$$;
-- A signed-in but unapproved user must see no records.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare
  n integer;
  denied boolean := false;
begin
  select count(*) into n from public.catalog_activity;
  if n <> 0 then raise exception 'Non-admin could read activity history'; end if;
  begin
    insert into public.catalog_activity(actor_email,action,resource_type)
    values('spoof@example.invalid','fake','products');
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'Non-admin could forge activity history'; end if;
end;
$$;
reset role;
