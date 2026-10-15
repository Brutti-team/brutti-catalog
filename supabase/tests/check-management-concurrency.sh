#!/usr/bin/env sh
set -eu
# Called ONLY with the disposable local container created by check-schema.sh.
CATALOG_CONCURRENCY_CONTAINER=$1
CATALOG_CONCURRENCY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CATALOG_CONCURRENCY_LOG=$(mktemp /tmp/brutti-catalog-concurrency.XXXXXX)
CATALOG_CONCURRENCY_WRITER_LOG=$(mktemp /tmp/brutti-catalog-concurrency-writer.XXXXXX)
trap 'rm -f "$CATALOG_CONCURRENCY_LOG" "$CATALOG_CONCURRENCY_WRITER_LOG"' EXIT INT TERM
docker exec -i "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$CATALOG_CONCURRENCY_ROOT/catalog_concurrency.sql"

wait_for_lock() {
  CATALOG_LOCK_ATTEMPTS=0
  until [ "$(docker exec "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -tAc \
    "select exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid where a.application_name='$1' and l.locktype='advisory' and l.granted=$2)")" = t ]; do
    CATALOG_LOCK_ATTEMPTS=$((CATALOG_LOCK_ATTEMPTS + 1))
    if [ "$CATALOG_LOCK_ATTEMPTS" -ge 100 ]; then
      cat "$CATALOG_CONCURRENCY_LOG" "$CATALOG_CONCURRENCY_WRITER_LOG"
      echo 'Expected cross-transaction advisory lock was not observed.' >&2
      exit 1
    fi
    sleep 0.05
  done
}

# Cleanup owns the path lock first. A late writer blocks, then rejects the
# removed object instead of committing a broken product image reference.
docker exec -i "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 > "$CATALOG_CONCURRENCY_LOG" 2>&1 <<'SQL' &
set application_name = 'catalog-management-cleanup-first';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '83000000-0000-4000-8000-000000000001';
select public.can_remove_catalog_image('concurrency/photo.webp');
select public.catalog_management_test_wait('cleanup-release');
-- LOCAL MOCK only: simulate the Storage API's final protected DELETE transaction.
delete from storage.objects where bucket_id = 'product-images' and name = 'concurrency/photo.webp';
commit;
SQL
CATALOG_CLEANUP_PID=$!
wait_for_lock catalog-management-cleanup-first true
docker exec -i "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 > "$CATALOG_CONCURRENCY_WRITER_LOG" 2>&1 <<'SQL' &
set application_name = 'catalog-management-writer-waiter';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '83000000-0000-4000-8000-000000000001';
update public.products set images = '[{"id":"late","alt":"Late writer","storagePath":"concurrency/photo.webp","url":"https://example.supabase.co/storage/v1/object/public/product-images/concurrency/photo.webp"}]'
  where sku = 'CONCURRENCY-1';
commit;
SQL
CATALOG_WRITER_PID=$!
wait_for_lock catalog-management-writer-waiter false
docker exec "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 \
  -c "insert into public.catalog_management_test_barrier values ('cleanup-release');" >/dev/null
if ! wait "$CATALOG_CLEANUP_PID"; then cat "$CATALOG_CONCURRENCY_LOG"; exit 1; fi
if wait "$CATALOG_WRITER_PID"; then echo 'Late writer unexpectedly succeeded.' >&2; exit 1; fi
case "$(cat "$CATALOG_CONCURRENCY_WRITER_LOG")" in
  *'Catalog image no longer exists'*) ;;
  *) cat "$CATALOG_CONCURRENCY_WRITER_LOG"; exit 1 ;;
esac

# Restore the object in this local mock, then let the product writer win first.
# Cleanup starts its statement before that commit and must see the fresh reference
# after its advisory-lock wait, rather than delete using its initial snapshot.
docker exec "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 \
  -c "insert into storage.objects(bucket_id,name) values ('product-images','concurrency/photo.webp');" >/dev/null
docker exec -i "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 > "$CATALOG_CONCURRENCY_WRITER_LOG" 2>&1 <<'SQL' &
set application_name = 'catalog-management-writer-first';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '83000000-0000-4000-8000-000000000001';
update public.products set images = '[{"id":"first","alt":"First writer","url":"https://example.supabase.co/storage/v1/object/public/product-images/concurrency/photo.webp"}]'
  where sku = 'CONCURRENCY-1';
select public.catalog_management_test_wait('writer-release');
commit;
SQL
CATALOG_WRITER_PID=$!
wait_for_lock catalog-management-writer-first true
docker exec -i "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 > "$CATALOG_CONCURRENCY_LOG" 2>&1 <<'SQL' &
set application_name = 'catalog-management-cleanup-waiter';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '83000000-0000-4000-8000-000000000001';
do $$ declare affected integer; begin
  if public.can_remove_catalog_image('concurrency/photo.webp') then
    raise exception 'Cleanup used a stale pre-lock product snapshot';
  end if;
  -- LOCAL MOCK only: the same restrictive policy must prevent final deletion.
  delete from storage.objects where bucket_id = 'product-images' and name = 'concurrency/photo.webp';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cleanup deleted a newly referenced image'; end if;
end $$;
commit;
SQL
CATALOG_CLEANUP_PID=$!
wait_for_lock catalog-management-cleanup-waiter false
docker exec "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 \
  -c "insert into public.catalog_management_test_barrier values ('writer-release');" >/dev/null
if ! wait "$CATALOG_WRITER_PID"; then cat "$CATALOG_CONCURRENCY_WRITER_LOG"; exit 1; fi
if ! wait "$CATALOG_CLEANUP_PID"; then cat "$CATALOG_CONCURRENCY_LOG"; exit 1; fi
docker exec "$CATALOG_CONCURRENCY_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -c \
  "do \$\$ begin if not exists(select 1 from storage.objects where bucket_id='product-images' and name='concurrency/photo.webp') or not exists(select 1 from public.products where sku='CONCURRENCY-1' and jsonb_array_length(images)=1) then raise exception 'Concurrent reference integrity failed'; end if; end \$\$;" >/dev/null
echo 'Concurrent cleanup-first and writer-first transactions preserved image integrity.'
