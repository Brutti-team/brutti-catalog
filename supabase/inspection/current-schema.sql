-- READ ONLY. Run in the existing Brutti project's trusted SQL editor.
-- Share structural results only; never export credentials or auth user emails.
begin transaction read only;
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('products','categories','catalog_admins')
order by table_name, ordinal_position;
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('products','categories','catalog_admins');
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where (schemaname = 'public' and tablename in ('products','categories','catalog_admins'))
or (schemaname = 'storage' and tablename = 'objects');
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in ('public.products'::regclass,'public.categories'::regclass,'public.catalog_admins'::regclass);
select pg_get_functiondef('public.is_catalog_admin()'::regprocedure);
select id, name from public.categories order by name;
select status, count(*) from public.products group by status;
select count(*) as administrator_count from public.catalog_admins;
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images';
rollback;
