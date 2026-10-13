-- READ ONLY. Run in the existing Brutti project's trusted SQL editor.
-- Share structural results only; never export credentials or auth user emails.
begin transaction read only;
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('products','categories','catalog_admins','catalog_imports')
order by table_name, ordinal_position;
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('products','categories','catalog_admins','catalog_imports');
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where (schemaname = 'public' and tablename in ('products','categories','catalog_admins','catalog_imports'))
or (schemaname = 'storage' and tablename = 'objects');
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.products'::regclass,'public.categories'::regclass,'public.catalog_admins'::regclass);
select p.proname, p.prosecdef as security_definer, p.provolatile, p.proconfig,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('is_catalog_admin','catalog_capabilities','can_remove_catalog_image','catalog_image_paths','import_catalogue_product','catalog_guard_image_references');
select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in ('products','categories','catalog_admins','catalog_imports');
select c.relname as table_name, t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public' and c.relname in ('products','categories','catalog_imports');
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('products','categories','catalog_admins','catalog_imports')
order by table_name, grantee, privilege_type;
select pubname, schemaname, tablename from pg_publication_tables
where schemaname = 'public' and tablename in ('products','categories');
select id, name from public.categories order by name;
select status, count(*) from public.products group by status;
select count(*) as administrator_count from public.catalog_admins;
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images';
rollback;
