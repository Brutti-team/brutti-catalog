-- Apply to a dedicated development Supabase project first.
-- This migration creates no users, admin memberships, or sample products.
begin;

create type public.product_status as enum ('draft', 'published', 'archived');
create type public.product_availability as enum ('available', 'made-to-order', 'unavailable');

create table public.catalog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.catalog_admins enable row level security;
revoke all on public.catalog_admins from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.catalog_admins to authenticated;
create policy "Administrators can inspect their own membership"
  on public.catalog_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Owned by the trusted migration role. No caller-controlled arguments or
-- search path; clients cannot add themselves to catalog_admins.
create function public.is_catalog_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.catalog_admins
    where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_catalog_admin() from public, anon, authenticated;
grant execute on function public.is_catalog_admin() to anon, authenticated;

create function public.catalog_images_are_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(candidate) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(candidate) > 8 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(candidate) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item -> 'id') is distinct from 'string'
      or length(btrim(item ->> 'id')) = 0
      or jsonb_typeof(item -> 'url') is distinct from 'string'
      or (item ->> 'url') !~ '^https?://[^[:space:]]+$'
      or jsonb_typeof(item -> 'alt') is distinct from 'string'
      or (item ? 'storagePath' and (
        jsonb_typeof(item -> 'storagePath') is distinct from 'string'
        or length(btrim(item ->> 'storagePath')) = 0
      )) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.catalog_images_are_valid(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_images_are_valid(jsonb) to authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 2000)
);
create unique index categories_name_unique on public.categories (lower(btrim(name)));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  sku text not null check (char_length(btrim(sku)) between 1 and 64),
  category_id uuid not null references public.categories(id) on delete restrict,
  description text not null default '' check (char_length(description) <= 10000),
  materials text not null default '' check (char_length(materials) <= 2000),
  width numeric not null check (width > 0 and width < 100000),
  depth numeric not null check (depth > 0 and depth < 100000),
  height numeric not null check (height > 0 and height < 100000),
  price numeric(12, 2) check (price is null or (price >= 0 and price < 10000000000)),
  status public.product_status not null default 'draft',
  availability public.product_availability not null default 'available',
  featured boolean not null default false,
  images jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_product_images check (public.catalog_images_are_valid(images)),
  constraint published_product_is_complete check (
    status <> 'published'
    or (char_length(btrim(description)) > 0
      and char_length(btrim(materials)) > 0
      and jsonb_array_length(images) > 0)
  )
);
create unique index products_sku_unique on public.products (lower(btrim(sku)));
create index products_category_idx on public.products (category_id);
create index products_public_catalog_idx on public.products (status, featured, created_at desc);

create function public.catalog_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.catalog_set_updated_at() from public, anon, authenticated;
create trigger products_updated_at
before update on public.products
for each row execute function public.catalog_set_updated_at();

alter table public.categories enable row level security;
alter table public.products enable row level security;
revoke all on public.categories, public.products from public, anon, authenticated;
grant select on public.categories, public.products to anon, authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;

create policy "Categories are publicly visible"
  on public.categories for select to anon, authenticated using (true);
create policy "Catalog administrators manage categories"
  on public.categories for all to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));
create policy "Only published products are public"
  on public.products for select to anon, authenticated using (status = 'published');
create policy "Catalog administrators manage products"
  on public.products for all to authenticated
  using ((select public.is_catalog_admin()))
  with check ((select public.is_catalog_admin()));

-- Public asset bucket: public download URLs bypass SELECT RLS. Draft and
-- archived photos are therefore NOT confidential. See README before use.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp']);

-- Metadata/listing SELECT is narrower than public downloads: anonymous users
-- see only images referenced by a published product. Administrators see all.
create policy "Catalog image metadata is visible for published products"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'product-images'
    and (
      (select public.is_catalog_admin())
      or exists (
        select 1 from public.products p
        cross join lateral jsonb_array_elements(p.images) as image
        where p.status = 'published' and image ->> 'storagePath' = storage.objects.name
      )
    )
  );
create policy "Catalog administrators upload images in their namespace"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select public.is_catalog_admin())
    and (string_to_array(name, '/'))[1] = (select auth.uid())::text
  );
create policy "Catalog administrators update images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_catalog_admin()))
  with check (bucket_id = 'product-images' and (select public.is_catalog_admin()));
create policy "Catalog administrators remove images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_catalog_admin()));

commit;
