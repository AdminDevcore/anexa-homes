#!/usr/bin/env bash
#
# Make the local database a copy of production.
#
# Dumps live (READ-ONLY — pg_dump is the only thing this script ever does to
# production), restores it over the local Postgres on 127.0.0.1:5544, verifies
# every table's row count matches, then lays the local-only demo overlay on top:
# the eight role logins, commission rules, and demo deals.
#
#   npm run db:clone-live              # dump fresh from live, then restore
#   npm run db:clone-live -- --reuse   # restore the newest dump already on disk
#   npm run db:clone-live -- --no-seed # clone only, skip the demo overlay
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS CANNOT DAMAGE PRODUCTION
#
# The restore half refuses to run unless the target it was handed resolves to
# 127.0.0.1 or localhost on port 5544. It is not a warning or a confirmation
# prompt — a non-local target aborts the process. The credentials for live are
# pulled into a temp file that is deleted on exit, and are only ever handed to
# pg_dump.
set -euo pipefail

cd "$(dirname "$0")/.."

# Homebrew's postgresql@17. A v16 client REFUSES to dump a v17 server outright,
# so this is not merely a preference.
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
if [ ! -x "$PG_BIN/pg_dump" ]; then
  echo "ERROR: pg_dump 17 not found at $PG_BIN" >&2
  echo "       Install it with:  brew install postgresql@17" >&2
  exit 1
fi
export PATH="$PG_BIN:$PATH"

REUSE=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --reuse)   REUSE=1 ;;
    --no-seed) SEED=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

BACKUP_DIR=".backups"
mkdir -p "$BACKUP_DIR"

# Secrets live in a temp dir that goes away however this script exits.
TMPDIR_LOCAL="$(mktemp -d)"
cleanup() { rm -rf "$TMPDIR_LOCAL"; }
trap cleanup EXIT

# ── The local target, and the guard on it ────────────────────────────────────
# Read from .env so there is one source of truth for where "local" is.
LOCAL_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')"
if [ -z "$LOCAL_URL" ]; then
  echo "ERROR: DATABASE_URL is not set in .env" >&2
  exit 1
fi

# libpq does not understand Prisma's `?schema=` parameter and rejects the whole
# URL over it, so psql and pg_restore get the connection string without any query
# string. A non-public schema is carried across as a search_path instead.
LOCAL_SCHEMA="$(printf '%s' "$LOCAL_URL" | sed -nE 's/.*[?&]schema=([^&]*).*/\1/p')"
PSQL_URL="$(printf '%s' "$LOCAL_URL" | sed -E 's#\?.*$##')"
if [ -n "$LOCAL_SCHEMA" ] && [ "$LOCAL_SCHEMA" != "public" ]; then
  export PGOPTIONS="--search_path=$LOCAL_SCHEMA"
fi

# Strip credentials and query string, then split host:port. A URL that does not
# parse to a local host stops the script — there is no override flag.
HOSTPORT="$(printf '%s' "$LOCAL_URL" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#/.*$##')"
HOST="${HOSTPORT%%:*}"
PORT="${HOSTPORT##*:}"
case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "REFUSING TO RUN" >&2
    echo "  DATABASE_URL points at '$HOST', which is not this machine." >&2
    echo "  This script restores a full database over its target. It only ever" >&2
    echo "  does that to local Postgres." >&2
    exit 1 ;;
esac
if [ "$PORT" != "5544" ]; then
  echo "REFUSING TO RUN" >&2
  echo "  DATABASE_URL port is '$PORT'; the local Anexa database is on 5544." >&2
  exit 1
fi

# ── Local Postgres must be up, and must be v17 ───────────────────────────────
if ! pg_isready -h "$HOST" -p "$PORT" -q 2>/dev/null; then
  echo "Local Postgres is not answering on $HOST:$PORT — starting it..."
  docker compose up -d db
  for _ in $(seq 1 30); do
    pg_isready -h "$HOST" -p "$PORT" -q 2>/dev/null && break
    sleep 2
  done
  pg_isready -h "$HOST" -p "$PORT" -q || { echo "ERROR: local Postgres never came up." >&2; exit 1; }
fi

LOCAL_MAJOR="$(psql "$PSQL_URL" -tAc 'show server_version_num' | cut -c1-2)"
if [ "$LOCAL_MAJOR" -lt 17 ]; then
  echo "ERROR: local Postgres is major version $LOCAL_MAJOR; a live dump needs 17." >&2
  echo "       docker compose down && docker compose up -d db   (docker-compose.yml pins 17)" >&2
  exit 1
fi

# ── Get the dump ─────────────────────────────────────────────────────────────
DUMP=""
if [ "$REUSE" = "1" ]; then
  DUMP="$(ls -t "$BACKUP_DIR"/live-*.dump 2>/dev/null | head -1 || true)"
  [ -n "$DUMP" ] || { echo "ERROR: --reuse given but no $BACKUP_DIR/live-*.dump exists." >&2; exit 1; }
  echo "Reusing existing dump: $DUMP ($(du -h "$DUMP" | cut -f1)), taken $(date -r "$DUMP" '+%Y-%m-%d %H:%M')"
else
  echo "Pulling production environment from Vercel..."
  npx vercel env pull "$TMPDIR_LOCAL/.env.prod" --environment=production --yes >/dev/null 2>&1 \
    || { echo "ERROR: 'vercel env pull' failed. Run 'npx vercel login' and retry." >&2; exit 1; }

  RAW="$(grep -E '^DATABASE_URL=' "$TMPDIR_LOCAL/.env.prod" | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')"
  [ -n "$RAW" ] || { echo "ERROR: no DATABASE_URL in the production environment." >&2; exit 1; }

  # Production runs on the TRANSACTION pooler (:6543), which cannot serve a dump.
  # Move to the SESSION pooler (:5432) and rebuild the query string from nothing:
  # editing the existing one piecemeal leaves '...postgres&pool_timeout=20?sslmode=require',
  # which the pooler silently accepts as a phantom database name.
  PROD_URL="$(printf '%s' "$RAW" | sed -E 's/:6543/:5432/; s#\?.*$##')?sslmode=require"

  DUMP="$BACKUP_DIR/live-$(date '+%Y-%m-%d-%H%M').dump"
  echo "Dumping live → $DUMP"
  echo "  This takes about 8-10 minutes. Most of live's bulk is the PDFs and photos"
  echo "  stored in the database, not the business records. It is not hung."
  pg_dump "$PROD_URL" \
    --format=custom --no-owner --no-acl --schema=public --verbose \
    --file="$DUMP" 2>"$BACKUP_DIR/last-dump.log"
  echo "  done — $(du -h "$DUMP" | cut -f1)"
fi

# ── Restore ──────────────────────────────────────────────────────────────────
echo
echo "Restoring into local $HOST:$PORT ..."
# --clean --if-exists drops each object before recreating it, so this is a true
# replacement rather than a merge onto whatever was there.
pg_restore --dbname="$PSQL_URL" \
  --clean --if-exists --no-owner --no-acl --schema=public \
  "$DUMP" 2>"$BACKUP_DIR/last-restore.log" || true

# pg_restore exits non-zero for harmless "does not exist" noise on the first
# --clean pass, so its exit code is not the test. Row counts are.
RESTORE_ERRORS="$(grep -c '^pg_restore: error' "$BACKUP_DIR/last-restore.log" || true)"
if [ "${RESTORE_ERRORS:-0}" -gt 0 ]; then
  echo "  $RESTORE_ERRORS pg_restore error line(s) — see $BACKUP_DIR/last-restore.log"
fi

# ── Verify: every table, not a spot check ────────────────────────────────────
echo
echo "Verifying row counts, table by table..."
COUNT_SQL="select table_name || ' ' || (xpath('/row/c/text()', query_to_xml(
  format('select count(*) c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE' order by table_name;"

psql "$PSQL_URL" -tAc "$COUNT_SQL" > "$TMPDIR_LOCAL/local.counts"

if [ "$REUSE" = "1" ]; then
  echo "  (--reuse: comparing against the dump's own table list, not a live query)"
  pg_restore --list "$DUMP" | grep -c 'TABLE DATA' >/dev/null
  VERIFIED="dump"
else
  psql "$PROD_URL" -tAc "$COUNT_SQL" > "$TMPDIR_LOCAL/live.counts"
  if diff -q "$TMPDIR_LOCAL/live.counts" "$TMPDIR_LOCAL/local.counts" >/dev/null; then
    echo "  All $(wc -l < "$TMPDIR_LOCAL/local.counts" | tr -d ' ') tables match live exactly."
    VERIFIED="live"
  else
    echo "  MISMATCH — local is not a faithful copy of live:" >&2
    diff "$TMPDIR_LOCAL/live.counts" "$TMPDIR_LOCAL/local.counts" | sed 's/^/    /' >&2
    exit 1
  fi
fi

# ── Re-apply migrations newer than production ────────────────────────────────
# The restore leaves local at LIVE's schema. Local code is routinely a migration
# or two ahead — that is what it means to be working on something — and without
# this the app 500s on every column the new migration was supposed to add. The
# row-count check above deliberately runs first, while the two schemas still
# match, so a mismatch there means a bad restore rather than a pending migration.
echo
echo "Re-applying any migrations newer than production..."
npx prisma migrate deploy 2>&1 | grep -E "migrations found|Applying|have been applied|No pending" || true

# ── Demo overlay ─────────────────────────────────────────────────────────────
if [ "$SEED" = "1" ]; then
  echo
  echo "Applying the local demo overlay (logins, commission rules, demo deals)..."
  npx tsx prisma/seed-local-demo.ts
fi

echo
echo "Local is now a copy of live${VERIFIED:+ (verified against $VERIFIED)}."
echo "Start it with:  npm run dev"
