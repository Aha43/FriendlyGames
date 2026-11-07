# FriendlyGames: human entry points. Each target delegates to the npm/Supabase commands in
# package.json and scripts/, so local runs and CI use the same logic. `make` alone shows help.
# Works with the GNU Make 3.81 that ships with macOS.

.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory
.PHONY: help setup doctor up down dev phone check test-backend e2e verify build preview version \
        backup prod-status deploy-backend prod-e2e release

# Public addresses (no secrets). The API address comes from the linked project unless set.
SITE_ORIGIN ?= https://friendlygames.arne-halvorsen.workers.dev
PROJECT_REF := $(shell cat supabase/.temp/project-ref 2>/dev/null)
FG_API_URL ?= $(if $(PROJECT_REF),https://$(PROJECT_REF).supabase.co/functions/v1/game-api,)
SUPABASE_CLI_VERSION := 2.105.0

help:
	@echo "FriendlyGames: make <command>"
	@echo ""
	@echo "Local work (needs Node 24 and npm; the backend needs Docker running and the Supabase CLI):"
	@echo "  setup           Install exact dependencies (npm ci)"
	@echo "  doctor          Check Node, npm, Supabase CLI and Docker"
	@echo "  up / down       Start / stop this project's local backend (down keeps local data)"
	@echo "  dev             Run the app at http://localhost:5173 (with 'make up' for shared play)"
	@echo "  phone           Same, reachable from a phone on your Wi-Fi"
	@echo ""
	@echo "Checks (local only, never production):"
	@echo "  check           Lint, types, unit/component tests and build"
	@echo "  test-backend    Backend integration tests (needs 'make up')"
	@echo "  e2e             Browser journeys, desktop and phone (needs 'make up')"
	@echo "  verify          check, test-backend and e2e in order; stops at the first failure"
	@echo "  build / preview Production build / serve it locally"
	@echo "  version         The checked-out version and commit (local, not what is deployed)"
	@echo ""
	@echo "Production (you run these deliberately):"
	@echo "  prod-status     Read-only: what the live site and backend run"
	@echo "  backup          Back up the production database into backups/ (private, git-ignored)"
	@echo "  deploy-backend  Back up, migrate and deploy the backend from main; the site deploys on merge"
	@echo "  prod-e2e        Browser journeys against the live site; creates throwaway @example.test players"
	@echo "  release         Tag and publish the merged release commit of package.json's version (no deploy)"

setup:
	npm ci
	@echo ""
	@echo "Browser journeys also need Chromium once per machine: npx playwright install chromium"

doctor:
	@problems=0; \
	node_v=$$(node -v 2>/dev/null); \
	case "$$node_v" in \
	  v24.*) echo "ok    Node $$node_v";; \
	  "") echo "FAIL  Node is not installed. Install Node 24 (see .nvmrc)."; problems=1;; \
	  *) echo "FAIL  Node $$node_v: this project uses Node 24 (see .nvmrc). Try 'nvm use'."; problems=1;; \
	esac; \
	if npm_v=$$(npm -v 2>/dev/null); then echo "ok    npm $$npm_v"; \
	else echo "FAIL  npm is not installed (it comes with Node)."; problems=1; fi; \
	if sb_v=$$(supabase --version 2>/dev/null); then \
	  if [ "$$sb_v" = "$(SUPABASE_CLI_VERSION)" ]; then echo "ok    Supabase CLI $$sb_v"; \
	  else echo "note  Supabase CLI $$sb_v (CI uses $(SUPABASE_CLI_VERSION); newer usually works)"; fi; \
	else echo "FAIL  Supabase CLI not found: https://supabase.com/docs/guides/local-development/cli/getting-started"; problems=1; fi; \
	if docker info >/dev/null 2>&1; then echo "ok    Docker is running"; \
	else echo "FAIL  Docker isn't running (or not installed). Start Docker Desktop: the local backend and backups need it."; problems=1; fi; \
	if [ -f supabase/.temp/project-ref ]; then echo "ok    Linked to a Supabase project (for production commands)"; \
	else echo "note  Not linked to a Supabase project: production commands need 'supabase link --project-ref <ref>'"; fi; \
	exit $$problems

up:
	supabase start

down:
	supabase stop

dev:
	@echo "Shared play needs the local backend: run 'make up' first. Local play (#/local) works without it."
	npm run dev

phone:
	@echo "Open the Network address below on a phone on the same Wi-Fi. Shared play needs 'make up'."
	npm run dev -- --host

check:
	npm run check

test-backend:
	npm run test:backend

e2e:
	npm run e2e

# Sequential on purpose: one run at a time, stopping at the first failure.
verify:
	$(MAKE) check
	$(MAKE) test-backend
	$(MAKE) e2e

build:
	npm run build

preview:
	npm run preview

version:
	@echo "Local checkout (not proof of what is deployed; see 'make prod-status'):"
	@echo "  version  $$(node -p "require('./package.json').version")"
	@echo "  branch   $$(git rev-parse --abbrev-ref HEAD)"
	@echo "  commit   $$(git rev-parse --short HEAD)$$(git diff --quiet HEAD -- 2>/dev/null || echo ' (with uncommitted changes)')"

backup:
	scripts/backup-production.sh

prod-status:
	@[ -n "$(FG_API_URL)" ] || { echo "Unknown API address: run 'supabase link --project-ref <ref>' or set FG_API_URL." >&2; exit 1; }
	@echo "Site     $(SITE_ORIGIN)"
	@site=$$(curl -s -o /dev/null -w '%{http_code}' "$(SITE_ORIGIN)/"); \
	  if [ "$$site" = 200 ]; then echo "         answers (the page footer shows its build commit)"; \
	  else echo "         did not answer normally (HTTP $$site)"; fi
	@echo "Backend  $(FG_API_URL)"
	@health=$$(curl -fsS --max-time 20 "$(FG_API_URL)/health") || { echo "         health check failed: the backend is down, paused or unreachable" >&2; exit 1; }; \
	  printf '%s' "$$health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);console.log("         commit "+(h.commit||"unknown")+", database "+(h.ok?"ok":"NOT ok")+", pooler "+(h.pooled?"yes":"NO"))})'
	@echo "Local    $$(git rev-parse --short HEAD) on $$(git rev-parse --abbrev-ref HEAD) (your checkout, for comparison)"

deploy-backend:
	SITE_ORIGIN=$(SITE_ORIGIN) scripts/deploy-backend.sh

prod-e2e:
	@[ -n "$(FG_API_URL)" ] || { echo "Unknown API address: run 'supabase link --project-ref <ref>' or set FG_API_URL." >&2; exit 1; }
	@echo "Running the browser journeys against $(SITE_ORIGIN). They create throwaway @example.test players and games."
	PLAYWRIGHT_BASE_URL=$(SITE_ORIGIN) FG_API_URL=$(FG_API_URL) npm run e2e

# Owner-run publication (#49): annotated tag + GitHub release for the release commit of the
# version in package.json. Not part of any other target; does not deploy.
release:
	node scripts/release.ts
