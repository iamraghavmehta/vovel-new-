#!/usr/bin/env bash
# Applies the migration to a throwaway local Postgres (with a stubbed auth schema) and runs the RLS checks.
# Usage: PGBIN=/usr/lib/postgresql/16/bin bash supabase/tests/run_rls.sh   (run as a non-root user)
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
T="$(mktemp -d)"; trap '"$PGBIN/pg_ctl" -D "$T/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$T"' EXIT
"$PGBIN/initdb" -D "$T/data" -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$T/data" -o "-p 54330 -k $T -c listen_addresses=''" -l "$T/log" -w start >/dev/null
P=(psql -h "$T" -p 54330 -d postgres -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f supabase/tests/stub_supabase.sql
"${P[@]}" -f supabase/migrations/20261030000000_vovel_init.sql
"${P[@]}" -f supabase/tests/rls_test.sql
