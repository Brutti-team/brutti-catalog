-- Disposable test only. No production data or migrations applied.
do $$
begin
  if has_function_privilege('anon', 'public.catalog_my_role()', 'EXECUTE') then
    raise exception 'Anonymous role must not call catalog_my_role';
  end if;
  if has_table_privilege('authenticated', 'public.catalog_staff_roles', 'UPDATE') then
    raise exception 'Browser users must not write roles directly';
  end if;
  if has_table_privilege('authenticated', 'public.catalog_activity', 'INSERT') then
    raise exception 'Browser users must not forge audit entries';
  end if;
end;
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'b38404cc-fb0a-4877-af13-8b63a765f2cf', false);
do $$
declare
  self_denied boolean := false;
  staff_count integer;
begin
  if public.catalog_my_role() is distinct from 'super_admin' then
    raise exception 'Approved bootstrap admin is not Super Admin';
  end if;
  select count(*) into staff_count from public.catalog_list_staff();
  if staff_count < 2 then raise exception 'Staff directory excludes invited accounts'; end if;
  perform public.catalog_set_staff_role('11111111-1111-4111-8111-111111111111'::uuid,'editor');
  begin
    perform public.catalog_set_staff_role('b38404cc-fb0a-4877-af13-8b63a765f2cf'::uuid,'editor');
  exception when insufficient_privilege then
    self_denied := true;
  end;
  if not self_denied then raise exception 'Super Admin self-demotion must fail'; end if;
  if not exists(select 1 from public.catalog_activity where action='staff_role_changed'
    and actor_id='b38404cc-fb0a-4877-af13-8b63a765f2cf'::uuid) then
    raise exception 'Role mutation lacked an authoritative audit entry';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
declare
  denied boolean := false;
  directory_denied boolean := false;
begin
  if public.catalog_my_role() is distinct from 'editor' then
    raise exception 'Server did not assign editor role';
  end if;
  begin
    perform public.catalog_set_staff_role('b38404cc-fb0a-4877-af13-8b63a765f2cf'::uuid,'editor');
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'Editor was allowed to grant roles'; end if;
  begin
    perform 1 from public.catalog_list_staff();
  exception when insufficient_privilege then
    directory_denied := true;
  end;
  if not directory_denied then raise exception 'Editor could inspect the user directory'; end if;
end;
$$;
reset role;
