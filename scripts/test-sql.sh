#!/bin/sh
# Runs all database tests serially against throwaway local Postgres 17 (Docker). Nothing touches Railway.
set -eu
NAME=${SQLTEST_NAME:-bazaar-live-sqltest}
PORT=${SQLTEST_PORT:-55433}
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=localtest -p "127.0.0.1:$PORT:5432" postgres:17 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
SHOW_TEST_ADMIN_URL="postgresql://postgres:localtest@127.0.0.1:$PORT/postgres" npm run test:integration
