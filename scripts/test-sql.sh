#!/bin/sh
# Runs db/show.test.ts, db/learn.test.ts, db/agent_decisions.test.ts, db/game.test.ts, db/history.test.ts, db/strategy.test.ts, db/rival_albums.test.ts and db/injections.test.ts (one after the other: each creates and drops the role) against a throwaway local Postgres 17 (docker). Nothing here touches Railway.
set -eu
NAME=bazaar-live-sqltest
PORT=${SQLTEST_PORT:-55433}
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=localtest -p "127.0.0.1:$PORT:5432" postgres:17 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
SHOW_TEST_ADMIN_URL="postgresql://postgres:localtest@127.0.0.1:$PORT/postgres" npx vitest run --no-file-parallelism db/show.test.ts db/learn.test.ts db/agent_decisions.test.ts db/game.test.ts db/history.test.ts db/strategy.test.ts db/rival_albums.test.ts db/injections.test.ts
