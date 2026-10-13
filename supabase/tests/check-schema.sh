#!/usr/bin/env sh
set -eu

# Disposable database, no published ports, and no connection to Supabase.
# Docker's trusted official image is required; checks never modify a real project.
SCRIPT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CATALOG_TEST_CONTAINER="brutti-catalog-schema-test-$$"
cleanup() { docker rm -f "$CATALOG_TEST_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run --rm --name "$CATALOG_TEST_CONTAINER" --network none --memory 512m --cpus 1 \
  -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine >/dev/null
CATALOG_WAIT_ATTEMPTS=0
# The image briefly starts a socket-only initialization server. Wait for TCP
# readiness so we do not race that server's shutdown before the real startup.
until docker exec "$CATALOG_TEST_CONTAINER" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
  CATALOG_WAIT_ATTEMPTS=$((CATALOG_WAIT_ATTEMPTS + 1))
  if [ "$CATALOG_WAIT_ATTEMPTS" -ge 30 ]; then
    docker logs "$CATALOG_TEST_CONTAINER"
    exit 1
  fi
  sleep 1
done
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/mock_platform.sql"
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/../migrations/202610120001_phase_one_catalog.sql"
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/../migrations/202610130001_real_catalog_categories.sql"
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/catalog_rls.sql"
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/../proposals/catalogue-import.sql"
docker exec -i "$CATALOG_TEST_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 < "$SCRIPT_ROOT/import_rerun.sql"
