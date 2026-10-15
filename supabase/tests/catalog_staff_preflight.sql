-- Disposable PostgreSQL test harness only. NEVER apply this fixture to Supabase.
alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
alter table auth.users add column if not exists last_sign_in_at timestamptz;
alter table auth.users add column if not exists created_at timestamptz not null default now();
insert into auth.users(id,email,raw_user_meta_data) values
  ('b38404cc-fb0a-4877-af13-8b63a765f2cf','integrator.brutti@gmail.com','{"full_name":"Brutti Integrator"}'),
  ('11111111-1111-4111-8111-111111111111','editor-fixture@example.invalid','{"full_name":"Test Editor"}')
on conflict (id) do nothing;
insert into public.catalog_admins(user_id) values
  ('b38404cc-fb0a-4877-af13-8b63a765f2cf')
on conflict (user_id) do nothing;
