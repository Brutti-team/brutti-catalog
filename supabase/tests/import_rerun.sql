-- Disposable local database ONLY. No connection to the real Supabase project.
begin;
insert into auth.users(id,email) values ('70000000-0000-4000-8000-000000000001','import-test@example.invalid');
insert into public.catalog_admins(user_id) values ('70000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-4000-8000-000000000001';
do $$
declare row_data jsonb := '{"id":"80000000-0000-4000-8000-000000000001","name":"Local import test","sku":"IMPORT-TEST-1","category_id":"30000000-0000-4000-8000-000000000001","description":"","materials":"","width":0,"depth":0,"height":0,"price":1000.50,"price_basis":"starting-from","availability":"unavailable","images":[]}';
begin
  if (select count(*) from public.categories where id::text like '30000000-%') <> 7 then raise exception 'Seven official categories missing'; end if;
  if public.import_catalogue_draft('brutti-catalogue-2025:local-test',repeat('a',64),array[12],'Starting from RM1000.50',row_data) <> 'inserted' then raise exception 'Draft import failed'; end if;
  if (select status from public.products where sku = 'IMPORT-TEST-1') <> 'draft' then raise exception 'Import published a product'; end if;
  update public.products set name = 'Staff edit preserved' where sku = 'IMPORT-TEST-1';
  if public.import_catalogue_draft('brutti-catalogue-2025:local-test',repeat('b',64),array[13],'Changed source',row_data) <> 'skipped' then raise exception 'Repeat import not skipped'; end if;
  if (select name from public.products where sku = 'IMPORT-TEST-1') <> 'Staff edit preserved' then raise exception 'Staff edit overwritten'; end if;
  begin
    update public.products set status = 'published' where sku = 'IMPORT-TEST-1';
    raise exception 'Incomplete import was published';
  exception when check_violation then null;
  end;
  delete from public.products where sku = 'IMPORT-TEST-1';
  if public.import_catalogue_draft('brutti-catalogue-2025:local-test',repeat('a',64),array[12],'Source',row_data) <> 'skipped' then raise exception 'Deleted product recreated'; end if;
end;
$$;
reset role;
delete from auth.users where id = '70000000-0000-4000-8000-000000000001';
do $$ begin
  if not exists (
    select 1 from public.catalog_imports
    where source_key = 'brutti-catalogue-2025:local-test'
      and product_id is null and imported_by is null
      and document_sha256 = repeat('a',64) and source_pages = array[12]
      and price_source_text = 'Starting from RM1000.50' and imported_at is not null
  ) then raise exception 'Admin deletion lost import tombstone or provenance'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-4000-8000-000000000002';
do $$ begin
  begin
    perform public.import_catalogue_draft('brutti-catalogue-2025:forbidden',repeat('a',64),array[1],'','{}');
    raise exception 'Non-admin imported a product';
  exception when raise_exception then
    if sqlerrm <> 'Catalog administrator required' then raise; end if;
  end;
  if (select count(*) from public.catalog_imports) <> 0 then raise exception 'Non-admin sees import ledger'; end if;
end $$;
rollback;
