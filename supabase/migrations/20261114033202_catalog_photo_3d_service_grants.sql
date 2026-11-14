-- Edge-only access. Browser roles cannot read or mutate 3D jobs.
grant select, insert, update, delete on table public.catalog_3d_jobs to service_role;
