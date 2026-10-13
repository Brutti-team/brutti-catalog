-- PROPOSAL ONLY: not an applied migration, not executed by setup/CI.
-- Inspect current-schema.sql in the existing project and review this additive
-- change BEFORE applying. The two existing migrations must not be rerun.
begin;
alter table public.products add column price_basis text not null default 'fixed'
  check (price_basis in ('fixed','starting-from'));

-- Durable ledger preserves import identity even after staff delete a product.
create table public.catalog_imports (
  source_key text primary key check (source_key ~ '^brutti-catalogue-2025:[a-z0-9][a-z0-9-]{0,79}$'),
  product_id uuid references public.products(id) on delete set null,
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  source_pages integer[] not null,
  price_source_text text not null default '',
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null
);
alter table public.catalog_imports enable row level security;
create policy catalog_imports_admin_select on public.catalog_imports for select to authenticated using (public.is_catalog_admin());
create policy catalog_imports_admin_insert on public.catalog_imports for insert to authenticated with check (public.is_catalog_admin() and imported_by = auth.uid());
grant select, insert on public.catalog_imports to authenticated;
revoke all on public.catalog_imports from anon;

-- Invoker security: product/ledger RLS and table constraints remain authoritative.
create function public.import_catalogue_draft(p_source_key text, p_document_sha256 text,
  p_source_pages integer[], p_price_source_text text, p_product jsonb)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_catalog_admin() then raise exception 'Catalog administrator required'; end if;
  if p_source_pages is null or cardinality(p_source_pages) = 0 or
     exists (select 1 from unnest(p_source_pages) as page where page < 1 or page > 104 or page is null)
     then raise exception 'Valid source pages required'; end if;
  -- Serializes concurrent runs of the same source record. Hash collisions merely serialize unrelated inserts.
  perform pg_advisory_xact_lock(hashtextextended(p_source_key, 0));
  if exists (select 1 from public.catalog_imports where source_key = p_source_key) then return 'skipped'; end if;
  v_id := (p_product->>'id')::uuid;
  -- INSERT ONLY: existing identities/SKUs fail rather than overwrite staff edits.
  insert into public.products(id,name,sku,category_id,description,materials,width,depth,height,
    price,price_basis,status,availability,featured,images)
  values(v_id,p_product->>'name',p_product->>'sku',(p_product->>'category_id')::uuid,
    p_product->>'description',p_product->>'materials',(p_product->>'width')::numeric,
    (p_product->>'depth')::numeric,(p_product->>'height')::numeric,(p_product->>'price')::numeric,
    p_product->>'price_basis','draft',(p_product->>'availability')::public.product_availability,
    false,p_product->'images');
  insert into public.catalog_imports(source_key,product_id,document_sha256,source_pages,price_source_text,imported_by)
  values(p_source_key,v_id,p_document_sha256,p_source_pages,coalesce(p_price_source_text,''),auth.uid());
  return 'inserted';
end;
$$;
revoke all on function public.import_catalogue_draft(text,text,integer[],text,jsonb) from public, anon;
grant execute on function public.import_catalogue_draft(text,text,integer[],text,jsonb) to authenticated;
commit;
