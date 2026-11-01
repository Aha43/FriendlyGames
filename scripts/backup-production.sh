#!/usr/bin/env bash
# Back up the linked production database: schema and data dumps into backups/ (git-ignored,
# private: they contain players' emails). Used by `make backup` and the backend deploy.
#
# Dumps are written to a temporary folder first and moved into place only when both are
# complete, so a failed attempt (Docker not running, network, login) leaves nothing that looks
# like a backup. Docker must be running: `supabase db dump` runs pg_dump in a container.
set -euo pipefail
cd "$(dirname "$0")/.."

dir="${BACKUP_DIR:-backups}"
[ -f supabase/.temp/project-ref ] || { echo "Not linked: run 'supabase link --project-ref <ref>' first." >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$dir"
partial=$(mktemp -d "$dir/.partial-XXXXXX")
trap 'rm -rf "$partial"' EXIT

supabase db dump --linked -f "$partial/schema.sql"
supabase db dump --linked --data-only -f "$partial/data.sql"

# A dump that "succeeded" but is empty or has no tables is not a backup.
[ -s "$partial/schema.sql" ] && grep -q 'CREATE TABLE' "$partial/schema.sql" || {
  echo "Backup failed: the schema dump is empty or has no tables. Nothing was saved." >&2; exit 1; }
[ -s "$partial/data.sql" ] || { echo "Backup failed: the data dump is empty. Nothing was saved." >&2; exit 1; }

mv "$partial/schema.sql" "$dir/$stamp-schema.sql"
mv "$partial/data.sql" "$dir/$stamp-data.sql"
echo "Backed up to $dir/$stamp-schema.sql ($(wc -c < "$dir/$stamp-schema.sql" | tr -d ' ') bytes)" \
  "and $dir/$stamp-data.sql ($(wc -c < "$dir/$stamp-data.sql" | tr -d ' ') bytes)."
