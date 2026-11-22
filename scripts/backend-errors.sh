#!/usr/bin/env bash
# make backend-errors (#120): save the local Edge runtime's whole log, then check it.
#
# Two steps, so a failure names its own cause:
# 1. `docker logs -t` into a temporary file. If that fails there is no log to check.
# 2. scripts/backend-errors.ts on that file. If the checker itself dies from a signal (it once
#    aborted in CI with a memory error before printing anything), that says nothing about the
#    backend: it is run once more on the same saved log, and the crash is reported either way.
#
# Reading a saved log again cannot hide a backend failure: the log is the same file. Backend
# tests are never repeated here. Flags are passed on (--expect-controlled, --report-only).
set -uo pipefail

CONTAINER="${BACKEND_RUNTIME_CONTAINER:-supabase_edge_runtime_friendlygames}"
REPORT_ONLY=0
for flag in "$@"; do [ "$flag" = "--report-only" ] && REPORT_ONLY=1; done

# In the browser job this only reports: say it as a warning and do not fail.
give_up() {
  if [ "$REPORT_ONLY" = 1 ]; then
    echo "::warning::$1"
    exit 0
  fi
  echo "FAIL  $1"
  exit 1
}

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

docker logs -t "$CONTAINER" >"$log" 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  give_up "Could not read the runtime's log: 'docker logs $CONTAINER' exited $status. Nothing was checked."
fi

for attempt in 1 2; do
  node scripts/backend-errors.ts --file "$log" "$@"
  status=$?
  # 0: nothing unexplained. 1: the checker's own verdict. Above 128: the checker was killed.
  if [ "$status" -le 128 ]; then exit "$status"; fi
  echo "The log check itself crashed (exit $status, attempt $attempt of 2). That is a fault in the check, not evidence about the backend."
done
give_up "The log check crashed twice on the same saved log (last exit $status). Nothing was checked."
