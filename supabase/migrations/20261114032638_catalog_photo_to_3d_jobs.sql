-- AI 3D task bookkeeping. Provider credentials are NEVER stored in the database.
-- Only the Edge Function's service-role connection can access these rows.
create table public.catalog_3d_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  provider_task_id text unique,
  image_ids text[] not null,
  status text not null default 'creating' check (status in ('creating', 'processing', 'ready', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_3d_jobs_photos_check check (array_length(image_ids, 1) between 1 and 4)
);
create index catalog_3d_jobs_product_created on public.catalog_3d_jobs(product_id, created_at desc);
create index catalog_3d_jobs_actor_created on public.catalog_3d_jobs(requested_by, created_at desc);
create unique index catalog_3d_jobs_one_active_per_product
  on public.catalog_3d_jobs(product_id) where status in ('creating', 'processing');
alter table public.catalog_3d_jobs enable row level security;
revoke all on table public.catalog_3d_jobs from public, anon, authenticated;
-- No client RLS policies by design. The server validates Auth and catalog_admins
-- before acting; only service_role can read/update these task records.
