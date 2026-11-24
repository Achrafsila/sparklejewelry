#!/usr/bin/env bash
# Local backend for development and tests: Postgres 17 (Homebrew) + PostgREST.
#   bash dev/stack.sh start   start both (creates the cluster on first run)
#   bash dev/stack.sh stop    stop both
#   bash dev/stack.sh reset   recreate the "sparkle" database: shim + migrations + dev seed
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"
DATA="$LOCAL/pgdata"
PORT=54329
PGBIN="$(brew --prefix postgresql@17)/bin"
export PGHOST=localhost PGPORT=$PORT PGUSER=postgres LANG=C LC_ALL=C

mkdir -p "$LOCAL"

pg_running() { "$PGBIN/pg_isready" -q -h localhost -p $PORT; }

start_pg() {
  if [ ! -d "$DATA" ]; then
    "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 \
      --locale-provider=builtin --builtin-locale=C.UTF-8 > "$LOCAL/initdb.log"
  fi
  if ! pg_running; then
    "$PGBIN/pg_ctl" -D "$DATA" -l "$LOCAL/postgres.log" -o "-p $PORT -c listen_addresses=localhost" -w start > /dev/null
  fi
  if ! "$PGBIN/psql" -d postgres -tAc "select 1 from pg_database where datname = 'sparkle'" | grep -q 1; then
    "$PGBIN/createdb" sparkle
    apply_schema
  fi
}

apply_schema() {
  "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -d sparkle -f "$ROOT/dev/auth-shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -1 -d sparkle -f "$f"
  done
  if [ -f "$ROOT/dev/seed-dev.sql" ]; then
    "$PGBIN/psql" -q -v ON_ERROR_STOP=1 -d sparkle -f "$ROOT/dev/seed-dev.sql"
  fi
}

stop_postgrest() {
  if [ -f "$LOCAL/postgrest.pid" ]; then
    kill "$(cat "$LOCAL/postgrest.pid")" 2> /dev/null || true
    rm -f "$LOCAL/postgrest.pid"
  fi
}

start_postgrest() {
  stop_postgrest
  postgrest "$ROOT/dev/postgrest.conf" > "$LOCAL/postgrest.log" 2>&1 &
  echo $! > "$LOCAL/postgrest.pid"
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null http://127.0.0.1:54331/; then return 0; fi
    sleep 0.1
  done
  echo "PostgREST did not start; see .local/postgrest.log" >&2
  return 1
}

case "${1:-}" in
  start)
    start_pg
    start_postgrest
    echo "Postgres on localhost:$PORT, PostgREST on 127.0.0.1:54331"
    ;;
  stop)
    stop_postgrest
    if pg_running; then "$PGBIN/pg_ctl" -D "$DATA" -w stop > /dev/null; fi
    echo "Local stack stopped"
    ;;
  reset)
    start_pg
    stop_postgrest
    "$PGBIN/dropdb" --if-exists --force sparkle
    "$PGBIN/createdb" sparkle
    apply_schema
    rm -rf "$LOCAL/storage"
    start_postgrest
    echo "Database sparkle recreated"
    ;;
  *)
    echo "usage: bash dev/stack.sh start|stop|reset" >&2
    exit 1
    ;;
esac
