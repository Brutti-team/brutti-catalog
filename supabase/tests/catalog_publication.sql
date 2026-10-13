-- Local cloned database only: publication already included products before proposal.
\set ON_ERROR_STOP on
do $$ begin
  if (select count(*) from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('products','categories')) <> 2 then
    raise exception 'Proposal did not safely add missing realtime table';
  end if;
end $$;
\echo 'Existing realtime publication preserved; only missing table added.'
