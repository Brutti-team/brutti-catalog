-- Disposable LOCAL PostgreSQL harness only. Never run on a live project.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
  ('81000000-0000-4000-8000-000000000001','management-admin@example.invalid'),
  ('81000000-0000-4000-8000-000000000002','management-member@example.invalid');
insert into public.catalog_admins(user_id) values ('81000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name) values
  ('product-images','management/shared.webp'), ('product-images','management/unused.webp');
insert into public.products(id,name,sku,category_id,width,depth,height,images) values
  ('82000000-0000-4000-8000-000000000001','Shared draft photo A','MANAGEMENT-A',
    (select id from public.categories limit 1),0,0,0,
    '[{"id":"a","alt":"A","storagePath":"management/shared.webp","url":"https://example.supabase.co/storage/v1/object/public/product-images/management/shared.webp"}]'),
  ('82000000-0000-4000-8000-000000000002','Shared draft photo B','MANAGEMENT-B',
    (select id from public.categories limit 1),0,0,0,
    '[{"id":"b","alt":"B","url":"https://example.supabase.co/storage/v1/object/public/product-images/management/shared.webp"}]');

set local role anon;
set local request.jwt.claim.sub = '';
do $$ begin
  if not (public.catalog_capabilities()->>'ordering')::boolean
    or not (public.catalog_capabilities()->>'imageCleanup')::boolean then
    raise exception 'Public feature flags unavailable';
  end if;
  if (public.catalog_capabilities()->>'priceBasis')::boolean is distinct from exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.products'::regclass and attname = 'price_basis' and attnum > 0 and not attisdropped
  ) then raise exception 'Optional price schema flag does not match installed columns'; end if;
  if has_function_privilege('anon','public.can_remove_catalog_image(text)','execute') then
    raise exception 'Anonymous callers can invoke the removal helper';
  end if;
  if (select count(*) from public.products where sku like 'MANAGEMENT-%') <> 0 then
    raise exception 'Management proposal exposed draft products';
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000002';
do $$ begin
  begin
    perform public.can_remove_catalog_image('management/unused.webp');
    raise exception 'Non-admin removal helper succeeded';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';
do $$ declare affected integer; begin
  if public.can_remove_catalog_image('management/shared.webp') then
    raise exception 'Shared image was considered removable';
  end if;
  -- LOCAL MOCK storage table only: the policy itself must stop direct deletion.
  -- Production application always uses the Storage API, never SQL deletion.
  delete from storage.objects where name = 'management/shared.webp';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Existing permissive policy bypassed restrictive protection'; end if;
  update public.products set images = '[]' where sku = 'MANAGEMENT-A';
  if public.can_remove_catalog_image('management/shared.webp') then
    raise exception 'Canonical URL-only shared reference was ignored';
  end if;
  delete from public.products where sku = 'MANAGEMENT-B';
  if not public.can_remove_catalog_image('management/shared.webp') then
    raise exception 'Unreferenced image is still blocked';
  end if;
  delete from storage.objects where name = 'management/shared.webp';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Unreferenced image deletion is blocked'; end if;
  begin
    update public.products set images = '[{"id":"late","alt":"Late duplicate","storagePath":"management/shared.webp","url":"https://example.supabase.co/storage/v1/object/public/product-images/management/shared.webp"}]'
      where sku = 'MANAGEMENT-A';
    raise exception 'An edit re-added a deleted Storage photo';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.products(name,sku,category_id,width,depth,height,images)
      values ('Late duplicate','MANAGEMENT-LATE',(select id from public.categories limit 1),0,0,0,
        '[{"id":"late","alt":"Late duplicate","url":"https://example.supabase.co/storage/v1/object/public/product-images/management/shared.webp"}]');
    raise exception 'A duplicate persisted a deleted URL-only Storage photo';
  exception when foreign_key_violation then null; end;
  insert into storage.objects(bucket_id,name)
    values ('product-images','81000000-0000-4000-8000-000000000001/replacement.webp');
  update public.products set images = '[{"id":"replacement","alt":"Replacement","storagePath":"81000000-0000-4000-8000-000000000001/replacement.webp","url":"https://example.supabase.co/storage/v1/object/public/product-images/81000000-0000-4000-8000-000000000001/replacement.webp"}]'
    where sku = 'MANAGEMENT-A';
  if public.can_remove_catalog_image('../secret.webp')
    or public.can_remove_catalog_image('management/../secret.webp')
    or public.can_remove_catalog_image('management/%2e%2e/secret.webp')
    or public.can_remove_catalog_image('management//secret.webp') then
    raise exception 'Unsafe image paths accepted';
  end if;
  update public.products set display_order = 1000000 where sku = 'MANAGEMENT-A';
  begin
    update public.products set display_order = -1 where sku = 'MANAGEMENT-A';
    raise exception 'Negative display order accepted';
  exception when check_violation then null; end;
  begin
    update public.products set display_order = 1000001 where sku = 'MANAGEMENT-A';
    raise exception 'Oversized display order accepted';
  exception when check_violation then null; end;
end $$;

reset role;
-- LOCAL MOCK ONLY: simulate an unchanged legacy reference whose object was
-- already missing before this proposal. The trusted harness bypasses RLS here.
delete from storage.objects where name = '81000000-0000-4000-8000-000000000001/replacement.webp';
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';
update public.products set images = jsonb_set(images, '{0,alt}', '"Edited legacy alt text"'), description = 'Legacy product remains editable'
  where sku = 'MANAGEMENT-A';
do $$ begin
  if not exists (select 1 from public.products where sku = 'MANAGEMENT-A'
    and images->0->>'alt' = 'Edited legacy alt text') then
    raise exception 'Unchanged legacy storage references cannot be edited';
  end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from pg_catalog.pg_policy
    where polname = 'Referenced catalog images cannot be removed' and polpermissive = false) then
    raise exception 'Storage deletion protection is not restrictive';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.products'::regclass and relreplident = 'f')
    or not exists (select 1 from pg_catalog.pg_class where oid = 'public.categories'::regclass and relreplident = 'f') then
    raise exception 'Realtime DELETE configuration absent';
  end if;
end $$;
rollback;
begin isolation level repeatable read;
insert into auth.users(id,email) values ('81000000-0000-4000-8000-000000000001','isolation-admin@example.invalid');
insert into public.catalog_admins(user_id) values ('81000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '81000000-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.can_remove_catalog_image('management/unused.webp');
    raise exception 'Cleanup accepted an isolation level with stale snapshots';
  exception when invalid_transaction_state then null; end;
end $$;
rollback;
\echo 'Catalog management ordering, reference protection, legacy edits and isolation checks passed (fixtures rolled back).'
