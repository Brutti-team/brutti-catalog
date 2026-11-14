-- One private model package per product. Public downloads follow publication status.
create schema if not exists brutti_internal;
revoke all on schema brutti_internal from public, anon, authenticated;

alter table public.products
  add column model_path text,
  add column model_name text,
  add constraint products_model_package_check check (
    (model_path is null and model_name is null) or (
      model_path is not null and model_name is not null
      and char_length(model_name) between 1 and 200
      and model_name !~ '[[:cntrl:]]'
      and model_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]zip$')
    )
  );
create unique index products_model_path_unique on public.products (model_path) where model_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-models', 'product-models', false, 52428800, array['application/zip']);

create function public.catalog_product_models_enabled()
returns boolean language sql stable security invoker set search_path = '' as $$ select true; $$;
revoke all on function public.catalog_product_models_enabled() from public, anon, authenticated;
grant execute on function public.catalog_product_models_enabled() to anon, authenticated;

-- Product links and Storage removals share a transaction lock so neither can
-- silently leave a saved product pointing to a deleted package.
create function brutti_internal.guard_product_model()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.model_path is not distinct from new.model_path then return new; end if;
  if new.model_path is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brutti:product-models:' || new.model_path, 0));
  perform 1 from storage.objects where bucket_id = 'product-models' and name = new.model_path for key share;
  if not found then
    raise exception 'The model file is missing. Choose the model files again.' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function brutti_internal.guard_product_model() from public, anon, authenticated;
create trigger products_guard_model before insert or update of model_path on public.products
  for each row execute function brutti_internal.guard_product_model();

create function brutti_internal.can_remove_product_model(object_path text)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
begin
  if not public.is_catalog_admin() or current_setting('transaction_isolation') <> 'read committed' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('brutti:product-models:' || object_path, 0));
  return not exists (select 1 from public.products where model_path = object_path);
end;
$$;
revoke all on function brutti_internal.can_remove_product_model(text) from public, anon, authenticated;
grant execute on function brutti_internal.can_remove_product_model(text) to authenticated;

create policy "Published products and staff can read catalog models"
  on storage.objects for select to anon, authenticated using (
    bucket_id = 'product-models' and (
      (select public.is_catalog_admin()) or exists (
        select 1 from public.products where status = 'published' and model_path = storage.objects.name
      )
    )
  );
create policy "Catalog staff can upload model packages"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'product-models' and (select public.is_catalog_admin())
      and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]zip$'
  );
create policy "Catalog staff can remove unused model packages"
  on storage.objects for delete to authenticated using (
    case when bucket_id = 'product-models' then brutti_internal.can_remove_product_model(name) else false end
  );
