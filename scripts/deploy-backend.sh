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
commit=$(git rev-parse HEAD)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
echo "Deploying $commit to project $ref"

# Backups stay on this machine (backups/ is git-ignored): they contain players' private emails.
mkdir -p backups
supabase db dump --linked -f "backups/$stamp-schema.sql"
supabase db dump --linked --data-only -f "backups/$stamp-data.sql"

supabase db push --linked
supabase secrets set --project-ref "$ref" ALLOWED_ORIGINS="$SITE_ORIGIN" GAME_API_COMMIT="$commit"
supabase functions deploy game-api --project-ref "$ref" --no-verify-jwt

health=$(curl -fsS "https://$ref.supabase.co/functions/v1/game-api/health")
echo "Health: $health"
case "$health" in
  *"\"commit\":\"$commit\""*) echo "Backend is live at $commit." ;;
  *) echo "Health check does not report $commit." >&2; exit 1 ;;
esac
