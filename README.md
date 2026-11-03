# FriendlyGames

A welcoming place to play games with friends and keep the story of those games.

**First milestone: play chess with Harald.**

The first prototype uses email entry without verified login: entering an email opens that
player from any browser (email ownership isn't checked yet; see docs/backend.md). Players
return to ongoing games or start a new chess game with a friend. The playing page
evokes friends meeting at a table in a park, with a seasonal backdrop and a clear,
comfortable board. Finished games become shared history.

Two friends can play chess from their own devices at a table in an autumn park:
name-and-email onboarding, manually shared invitation links, server-checked moves, and a
shared history of finished games with a win/draw tally, replay and "play again".
Local play on one device remains available separately.

- [Product brief](docs/product-brief.md)
- [First sprint](docs/sprint-01.md)
- [Sprint 2 — Across the table from Harald](docs/sprint-02.md)
- [Future park ideas](docs/future-ideas.md)
- [Development workflow](docs/development.md)
- [Version roadmap](docs/roadmap.md)
- [Sprint 3 — Correct starts and repeatable development](docs/sprint-03.md)
- [Sprint 4 — Captured pieces at a glance](docs/sprint-04.md)
- [Changelog](CHANGELOG.md)
- [Agent guidance](AGENTS.md)

## Getting started

Requires Node.js 24 (see `.nvmrc`) and npm; the local backend needs Docker and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
`make` lists every command; each one runs the npm/Supabase commands named beside it.

| Command | What it does | Runs |
| --- | --- | --- |
| `make setup` | Install exact dependencies | `npm ci` |
| `make doctor` | Check Node 24, npm, Supabase CLI, Docker and the project link | |
| `make up` / `make down` | Start / stop this project's local backend; `down` keeps local data | `supabase start` / `stop` |
| `make dev` | App at http://localhost:5173 | `npm run dev` |
| `make phone` | Same, reachable from a phone on your Wi-Fi | `npm run dev -- --host` |
| `make check` | Lint, types, unit/component tests, build | `npm run check` |
| `make test-backend` | Backend integration tests (needs `make up`) | `npm run test:backend` |
| `make e2e` | Browser journeys, desktop and phone (needs `make up`) | `npm run e2e` |
| `make verify` | `check`, `test-backend`, `e2e` in order, stopping at the first failure | |
| `make build` / `make preview` | Production build / serve it locally | `npm run build` / `preview` |
| `make version` | The checked-out version and commit (local, **not** what is deployed) | |

Production commands, run deliberately by the owner (docs/deployment.md):

| Command | What it does |
| --- | --- |
| `make prod-status` | Read-only: the live site, and the backend's deployed commit, database and pooler status |
| `make backup` | Back up the production database into `backups/` (private, git-ignored); only complete dumps are kept |
| `make deploy-backend` | Back up, apply migrations and deploy the function, from a clean, up-to-date `main` (`scripts/deploy-backend.sh`) |
| `make prod-e2e` | Browser journeys against the live site; they create throwaway `@example.test` players |

The npm scripts keep working directly. The app talks to the game API at
`VITE_GAME_API_URL` (see `.env.example`). Unset, it uses the local stack on the same host
as the page, which is how `make phone` works. Local play (`#/local`) needs no backend.

## Checks

CI (`.github/workflows/ci.yml`) runs the same make commands on every pull request and push
to main, in three jobs: `make check` (ESLint, TypeScript, Vitest including the Makefile's own
tests, build), and `make up` followed by `make test-backend` or `make e2e` on a fresh local
backend. `npm run test:watch` runs Vitest in watch mode.

Browser journeys (Playwright, desktop and phone) build the app and run against
`vite preview`; they need Chromium once per machine: `npx playwright install chromium`.

## Technical direction

Proposed starting point: React, TypeScript and Vite, with Supabase for the shared
backend, following the useful parts of NamWeb. Confirm dependencies and hosting
when scaffolding; keep the initial application small.

## Shared-game backend

A Supabase database and Edge Function for playing across devices. Setup, API and
identity limits: [docs/backend.md](docs/backend.md). With Docker running:

```bash
supabase start
npm run test:backend
```

## Deployment

A Cloudflare Worker serving the static site (`wrangler.jsonc`) and a hosted Supabase project
(API and database). Setup, secrets,
releasing, verification and rollback: [docs/deployment.md](docs/deployment.md).

## Third-party assets

External code and artwork, their sources and licenses are recorded in
[docs/third-party-assets.md](docs/third-party-assets.md).

## Repository status

Private prototype. No open-source license has been granted. Public visibility and
licensing are future owner decisions.
