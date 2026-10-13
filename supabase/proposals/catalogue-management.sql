-- OWNER-REVIEW PROPOSAL ONLY. Not an applied migration and never applied by setup.
-- Review against the inspected existing Brutti project before running separately.
-- Adds the missing ordering field; keeps existing tables, data, roles and policies.
-- Storage bytes are removed ONLY through the Storage API, never by this SQL.
begin;

alter table public.products add column display_order integer not null default 0
  constraint products_display_order_range check (display_order between 0 and 1000000);
create index products_curated_order_idx
  on public.products (status, featured desc, display_order, created_at desc);

-- The public flags reveal feature availability, never administrator membership.
-- price_basis belongs to the separate import proposal and can remain absent.
create function public.catalog_capabilities()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'ordering', true,
    'imageCleanup', true,
    'priceBasis', exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.products'::regclass and attname = 'price_basis'
        and attnum > 0 and not attisdropped
    )
  );
$$;
revoke all on function public.catalog_capabilities() from public, anon, authenticated;
grant execute on function public.catalog_capabilities() to anon, authenticated;

-- Extract safe owned-bucket references consistently from explicit metadata and
-- canonical public URLs. URLs outside this bucket's public route stay untouched.
create function public.catalog_image_paths(candidate jsonb)
returns table(storage_path text) language sql immutable set search_path = '' as $$
  with images as (
    select value from jsonb_array_elements(case when jsonb_typeof(candidate) = 'array' then candidate else '[]'::jsonb end)
  ), paths as (
    select value ->> 'storagePath' as path from images
    union
    select substring(value ->> 'url' from '^https?://[^/?#[:space:]]+/storage/v1/object/public/product-images/([^?#[:space:]]+)$') from images
  )
  select distinct path from paths
  where length(path) between 1 and 1024
    and path ~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
    and not exists (select 1 from unnest(string_to_array(path, '/')) part where part in ('.', '..'));
$$;
revoke all on function public.catalog_image_paths(jsonb) from public, anon, authenticated;

-- Product changes and Storage deletion serialize on the same per-path lock.
-- A late duplicate or edit cannot re-add a photo whose object was already removed.
create function public.catalog_guard_image_references()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
declare
  previous_images jsonb := '[]'::jsonb;
  path text;
begin
  if tg_op = 'UPDATE' then previous_images := old.images; end if;
  -- Lock the union before validation, in a consistent order for multi-photo edits.
  for path in
    select storage_path from (
      select storage_path from public.catalog_image_paths(previous_images)
      union select storage_path from public.catalog_image_paths(new.images)
    ) paths
    order by storage_path collate "C"
  loop
    perform pg_advisory_xact_lock(hashtextextended('brutti:product-images:' || path, 0));
  end loop;
  for path in
    select storage_path from (
      select storage_path from public.catalog_image_paths(new.images)
      except select storage_path from public.catalog_image_paths(previous_images)
    ) paths
    order by storage_path collate "C"
  loop
    -- Locking reads also reject stale repeatable-read snapshots after deletion.
    perform 1 from storage.objects where bucket_id = 'product-images' and name = path for key share;
    if not found then
      raise exception 'Catalog image no longer exists. Upload the photo again before saving.' using errcode = '23503';
    end if;
  end loop;
  -- Existing legacy references, alt-text edits and image reordering stay editable.
  return new;
end;
$$;
revoke all on function public.catalog_guard_image_references() from public, anon, authenticated;
create trigger products_guard_image_references
  before insert or update of images on public.products
  for each row execute function public.catalog_guard_image_references();

-- Owned by the trusted SQL owner so draft, archived and shared image references
-- are checked even when product RLS would hide them from the caller.
create function public.can_remove_catalog_image(p_storage_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_catalog_admin() then
    raise exception 'Catalog administrator required' using errcode = '42501';
  end if;
  -- PostgREST uses READ COMMITTED. Higher isolation retains an old snapshot even
  -- inside a VOLATILE function, so cleanup must fail closed there.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Image cleanup requires read committed isolation' using errcode = '25000';
  end if;
  if not exists (select 1 from public.catalog_image_paths(jsonb_build_array(jsonb_build_object('storagePath', p_storage_path))))
  then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('brutti:product-images:' || p_storage_path, 0));
  -- VOLATILE obtains a fresh statement snapshot after any preceding lock wait.
  return not exists (
    select 1 from public.products p
    cross join lateral public.catalog_image_paths(p.images) image
    where image.storage_path = p_storage_path
  );
end;
$$;
revoke all on function public.can_remove_catalog_image(text) from public, anon, authenticated;
grant execute on function public.can_remove_catalog_image(text) to authenticated;

-- Restrictive policies AND with all existing permissive DELETE policies, so a
-- legacy broad admin policy cannot bypass the active-reference check. Other
-- buckets retain their existing policy behavior. Anonymous callers cannot
-- execute the helper, and authenticated non-admin callers are rejected there.
create policy "Referenced catalog images cannot be removed"
  on storage.objects as restrictive for delete to public
  using (case when bucket_id = 'product-images'
    then public.can_remove_catalog_image(name) else true end);

-- Availability varies by project. Add tables only to an existing publication
-- that does not already publish them; never create or replace a publication.
do $$
declare table_name text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['products', 'categories'] loop
      if not exists (select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name)
      then execute format('alter publication supabase_realtime add table public.%I', table_name); end if;
    end loop;
  end if;
end;
$$;
alter table public.products replica identity full;
alter table public.categories replica identity full;
-- The browser discards all event payloads, including DELETE, and reloads via RLS.
commit;
