-- Run with a trusted PostgreSQL connection to a LOCAL development database.
-- All fixtures are rolled back. Never use real users or a production project.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'catalog-admin@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'catalog-member@example.invalid');
insert into public.catalog_admins (user_id)
values ('10000000-0000-4000-8000-000000000001');
insert into public.categories (id, name) values
  ('20000000-0000-4000-8000-000000000001', 'Policy test category');
insert into public.products (id, name, sku, category_id, description, materials,
                            width, depth, height, status, images) values
  ('30000000-0000-4000-8000-000000000001', 'Published policy product', 'POLICY-PUBLISHED',
   '20000000-0000-4000-8000-000000000001', 'Test description', 'Timber', 1, 2, 3, 'published',
   '[{"id":"published","url":"https://example.invalid/published.jpg","alt":"Published test image","storagePath":"10000000-0000-4000-8000-000000000001/published.jpg"}]'),
  ('30000000-0000-4000-8000-000000000002', 'Draft policy product', 'POLICY-DRAFT',
   '20000000-0000-4000-8000-000000000001', '', '', 1, 2, 3, 'draft', '[]'),
  ('30000000-0000-4000-8000-000000000003', 'Archived policy product', 'POLICY-ARCHIVED',
   '20000000-0000-4000-8000-000000000001', '', '', 1, 2, 3, 'archived', '[]');
insert into storage.objects (bucket_id, name) values
  ('product-images', '10000000-0000-4000-8000-000000000001/published.jpg'),
  ('product-images', '10000000-0000-4000-8000-000000000001/draft.jpg');

set local role anon;
set local request.jwt.claim.sub = '';
do $$ begin
  if public.is_catalog_admin() then raise exception 'Anonymous user became admin'; end if;
  if (select count(*) from public.products where sku like 'POLICY-%') <> 1 then
    raise exception 'Anonymous user can see non-published products';
  end if;
  if (select count(*) from public.categories where id = '20000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Anonymous categories are not visible';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'product-images' and name like '10000000-0000-4000-8000-000000000001/%') <> 1 then
    raise exception 'Anonymous storage metadata includes draft uploads';
  end if;
  begin
    insert into public.categories (name) values ('Anonymous forbidden');
    raise exception 'Anonymous write unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
do $$ declare affected integer; begin
  if public.is_catalog_admin() then raise exception 'Unlisted user became admin'; end if;
  if (select count(*) from public.products where sku like 'POLICY-%') <> 1 then
    raise exception 'Non-admin can see non-published products';
  end if;
  if (select count(*) from public.catalog_admins) <> 0 then
    raise exception 'Non-admin can inspect administrator memberships';
  end if;
  begin
    insert into public.catalog_admins (user_id) values ('10000000-0000-4000-8000-000000000002');
    raise exception 'A user granted themselves admin';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.categories (name) values ('Member forbidden');
    raise exception 'Non-admin category write unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('product-images', '10000000-0000-4000-8000-000000000002/forbidden.jpg');
    raise exception 'Non-admin storage upload unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  update public.products set name = 'Forbidden' where sku = 'POLICY-PUBLISHED';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin updated a product'; end if;
  delete from public.products where sku = 'POLICY-PUBLISHED';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Non-admin deleted a product'; end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$ begin
  if not public.is_catalog_admin() then raise exception 'Trusted administrator cannot access catalog'; end if;
  if (select count(*) from public.products where sku like 'POLICY-%') <> 3 then
    raise exception 'Administrator cannot see every product status';
  end if;
  if (select count(*) from public.catalog_admins) <> 1 then
    raise exception 'Administrator cannot inspect own membership';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'product-images' and name like '10000000-0000-4000-8000-000000000001/%') <> 2 then
    raise exception 'Administrator cannot see own image metadata';
  end if;
  insert into public.categories (name) values ('Admin-created category');
  update public.categories set description = 'Changed' where name = 'Admin-created category';
  delete from public.categories where name = 'Admin-created category';
  update public.products set name = 'Administrator edited' where sku = 'POLICY-DRAFT';
  if not exists (select 1 from public.products where sku = 'POLICY-DRAFT' and name = 'Administrator edited') then
    raise exception 'Administrator product update failed';
  end if;
  begin
    update public.products set status = 'published' where sku = 'POLICY-DRAFT';
    raise exception 'Incomplete product was published';
  exception when check_violation then null;
  end;
  begin
    update public.products set width = -1 where sku = 'POLICY-DRAFT';
    raise exception 'Negative dimension accepted';
  exception when check_violation then null;
  end;
  begin
    update public.products set price = -1 where sku = 'POLICY-DRAFT';
    raise exception 'Negative price accepted';
  exception when check_violation then null;
  end;
  begin
    update public.products set price = 'NaN'::numeric where sku = 'POLICY-DRAFT';
    raise exception 'Non-finite price accepted';
  exception when check_violation then null;
  end;
  begin
    update public.products set images = '{}'::jsonb where sku = 'POLICY-DRAFT';
    raise exception 'Invalid image metadata accepted';
  exception when check_violation then null;
  end;
  begin
    update public.products set images = '[{"id":"unsafe","url":"javascript:alert(1)","alt":"Invalid URL"}]'::jsonb
    where sku = 'POLICY-DRAFT';
    raise exception 'Unsafe image URL accepted';
  exception when check_violation then null;
  end;
  begin
    update public.products set sku = 'policy-published' where sku = 'POLICY-DRAFT';
    raise exception 'Case-insensitive duplicate SKU accepted';
  exception when unique_violation then null;
  end;
  begin
    delete from public.categories where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'Category with assigned products was deleted';
  exception when foreign_key_violation then null;
  end;
  insert into storage.objects (bucket_id, name)
  values ('product-images', '10000000-0000-4000-8000-000000000001/allowed.jpg');
  begin
    insert into storage.objects (bucket_id, name)
    values ('product-images', '10000000-0000-4000-8000-000000000002/wrong-namespace.jpg');
    raise exception 'Upload outside own namespace accepted';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where name = '10000000-0000-4000-8000-000000000001/allowed.jpg';
  delete from public.products where sku = 'POLICY-ARCHIVED';
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon', 'public.catalog_images_are_valid(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.catalog_set_updated_at()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.catalog_set_updated_at()', 'EXECUTE') then
    raise exception 'Helper execution grants inherited unintended project defaults';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'product-images' and public = true and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then raise exception 'Storage bucket settings are incorrect'; end if;
end $$;

rollback;
\echo 'Catalog SQL constraints and role policies passed (fixtures rolled back).'
