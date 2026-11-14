-- Exercise model storage rules against a disposable database.
begin;
insert into auth.users (id, email) values
  ('90000000-0000-4000-8000-000000000051', 'model-staff@example.invalid'),
  ('90000000-0000-4000-8000-000000000052', 'model-member@example.invalid');
insert into public.catalog_admins (user_id) values ('90000000-0000-4000-8000-000000000051');
insert into public.products (id, name, sku, category_id, description, materials, width, depth, height, images, status)
select '90000000-0000-4000-8000-000000000053', 'Model policy fixture', 'TEST-MODEL-POLICY', id,
   'Fixture', 'Fixture', 1, 1, 1, '[{"id":"f","url":"https://example.invalid/test.webp","alt":"Fixture"}]', 'draft'
from public.categories limit 1;

set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000052';
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('product-models', '90000000-0000-4000-8000-000000000053/90000000-0000-4000-8000-000000000054.zip');
    raise exception 'Non-staff model upload unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000051';
insert into storage.objects (bucket_id, name) values ('product-models', '90000000-0000-4000-8000-000000000053/90000000-0000-4000-8000-000000000054.zip');
do $$ begin
  begin
    update public.products set model_path = id::text || '/90000000-0000-4000-8000-000000000099.zip', model_name = 'missing.obj' where sku = 'TEST-MODEL-POLICY';
    raise exception 'Saving a missing model unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
end $$;
update public.products set model_path = id::text || '/90000000-0000-4000-8000-000000000054.zip', model_name = 'fixture.obj' where sku = 'TEST-MODEL-POLICY';
do $$ begin
  if not exists (select 1 from storage.objects where bucket_id = 'product-models') then raise exception 'Staff cannot preview a draft model'; end if;
  delete from storage.objects where bucket_id = 'product-models';
  if found then raise exception 'Staff deleted a linked model'; end if;
end $$;

reset role;
set local request.jwt.claim.sub = '';
set local role anon;
do $$ begin
  if not public.catalog_product_models_enabled() then raise exception 'The capability is unavailable to the frontend'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'product-models') then raise exception 'Draft model leaked'; end if;
end $$;
reset role;
update public.products set status = 'published' where sku = 'TEST-MODEL-POLICY';
set local role anon;
do $$ begin
  if not exists (select 1 from storage.objects where bucket_id = 'product-models') then raise exception 'Published model unavailable'; end if;
end $$;
reset role;
update public.products set status = 'archived' where sku = 'TEST-MODEL-POLICY';
set local role anon;
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'product-models') then raise exception 'Archived model remained visible'; end if;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '90000000-0000-4000-8000-000000000051';
update public.products set model_path = null, model_name = null where sku = 'TEST-MODEL-POLICY';
do $$ begin
  delete from storage.objects where bucket_id = 'product-models';
  if not found then raise exception 'Unlinked models cannot be cleaned up'; end if;
end $$;
rollback;
