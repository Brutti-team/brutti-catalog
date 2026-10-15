-- Disposable LOCAL harness only. Fixtures persist only in its throwaway container.
\set ON_ERROR_STOP on
insert into auth.users(id,email) values ('83000000-0000-4000-8000-000000000001','concurrency-admin@example.invalid');
insert into public.catalog_admins(user_id) values ('83000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name) values ('product-images','concurrency/photo.webp');
insert into public.products(id,name,sku,category_id,width,depth,height)
  values ('84000000-0000-4000-8000-000000000001','Concurrent reference fixture','CONCURRENCY-1',
    (select id from public.categories limit 1),0,0,0);

-- Deterministic cross-connection barrier: no fixed sleep decides the winner.
create table public.catalog_management_test_barrier(signal text primary key);
create function public.catalog_management_test_wait(p_signal text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare deadline timestamptz := clock_timestamp() + interval '25 seconds';
begin
  loop
    if exists (select 1 from public.catalog_management_test_barrier where signal = p_signal) then return; end if;
    if clock_timestamp() > deadline then raise exception 'Concurrent test barrier timed out'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;
revoke all on function public.catalog_management_test_wait(text) from public, anon, authenticated;
grant execute on function public.catalog_management_test_wait(text) to authenticated;
