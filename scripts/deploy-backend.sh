#!/usr/bin/env bash
# Deploy the game backend to the linked hosted Supabase project: back up, apply migrations,
# configure and deploy the game-api function, then check it answers with this commit.
# Usage: SITE_ORIGIN=https://friendlygames.<subdomain>.workers.dev npm run deploy:backend
# Prerequisites and rollback: docs/deployment.md.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SITE_ORIGIN:?Set SITE_ORIGIN to the site origin, e.g. https://friendlygames.example.workers.dev}"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "Deploy from main." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "The working tree has changes." >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Local main differs from origin/main." >&2; exit 1; }
[ -f supabase/.temp/project-ref ] || { echo "Not linked: run 'supabase link --project-ref <ref>' first." >&2; exit 1; }

ref=$(cat supabase/.temp/project-ref)
# Production must reach the database through the pooler (docs/deployment.md, "Database connection").
supabase secrets list --project-ref "$ref" | grep -q 'GAME_DB_POOLER_URL' || {
  echo "Missing function secret GAME_DB_POOLER_URL: set it first (docs/deployment.md)." >&2; exit 1; }
commit=$(git rev-parse HEAD)
echo "Deploying $commit to project $ref"

# Player names must be unique before the #76 migration can apply (scripts/prod-name-check.ts).
# Read-only; collisions or an incomplete check stop here, before anything in production changes.
node scripts/prod-name-check.ts || { echo "Deploy stopped by the player-name check: nothing was changed." >&2; exit 1; }

# Back up first; stops the deploy if the backup isn't complete (scripts/backup-production.sh).
scripts/backup-production.sh

supabase db push --linked
supabase secrets set --project-ref "$ref" ALLOWED_ORIGINS="$SITE_ORIGIN" GAME_API_COMMIT="$commit"
supabase functions deploy game-api --project-ref "$ref" --no-verify-jwt

health=$(curl -fsS "https://$ref.supabase.co/functions/v1/game-api/health")
echo "Health: $health"
case "$health" in
  *"\"commit\":\"$commit\""*'"pooled":true'*) echo "Backend is live at $commit, using the pooler." ;;
  *) echo "Health check does not report $commit with the pooler." >&2; exit 1 ;;
esac
