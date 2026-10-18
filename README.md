# FriendlyGames

A welcoming place to play games with friends and keep the story of those games.

**First milestone: play chess with Harald.**

The first prototype uses name and email onboarding without verified login. Players
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
- [Agent guidance](AGENTS.md)

## Getting started

Requires Node.js 24 (see `.nvmrc`) and npm.

```bash
npm ci              # install exact dependencies from package-lock.json
supabase start      # local game backend (needs Docker); see docs/backend.md
npm run dev         # start the Vite dev server at http://localhost:5173
npm run build       # production build into dist/
npm run preview     # serve the production build locally
```

The app talks to the game API at `VITE_GAME_API_URL` (see `.env.example`). Unset, it uses
the local stack on the same host as the page, so a phone on the same Wi-Fi works with
`npm run dev -- --host`. Local play (`#/local`) needs no backend.

## Checks

CI (`.github/workflows/ci.yml`) runs these on every pull request and push to main:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript, app and tooling configs
npm run test        # Vitest unit/component tests (jsdom)
npm run build       # production build
```

`npm run check` runs all four in order. `npm run test:watch` runs Vitest in watch mode.

Browser journeys (Playwright, desktop and phone) build the app and run against
`vite preview`; the shared-play journeys also need `supabase start`. CI runs them as
a separate job:

```bash
npx playwright install chromium   # once per machine
npm run e2e
```

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
