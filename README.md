# FriendlyGames

A welcoming place to play games with friends and keep the story of those games.

**First milestone: play chess with Harald.**

The first prototype uses name and email onboarding without verified login. Players
return to ongoing games or start a new chess game with a friend. The playing page
evokes friends meeting at a table in a park, with a seasonal backdrop and a clear,
comfortable board. Finished games become shared history.

This repository contains the runnable frontend foundation; the chess table follows.

- [Product brief](docs/product-brief.md)
- [First sprint](docs/sprint-01.md)
- [Development workflow](docs/development.md)
- [Agent guidance](AGENTS.md)

## Getting started

Requires Node.js 24 (see `.nvmrc`) and npm.

```bash
npm ci              # install exact dependencies from package-lock.json
npm run dev         # start the Vite dev server at http://localhost:5173
npm run build       # production build into dist/
npm run preview     # serve the production build locally
```

## Checks

CI (`.github/workflows/ci.yml`) runs these on every pull request and push to main:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript, app and tooling configs
npm run test        # Vitest unit/component tests (jsdom)
npm run build       # production build
```

`npm run check` runs all four in order. `npm run test:watch` runs Vitest in watch mode.

## Technical direction

Proposed starting point: React, TypeScript and Vite, with Supabase for the shared
backend, following the useful parts of NamWeb. Confirm dependencies and hosting
when scaffolding; keep the initial application small.

## Repository status

Private prototype. No open-source license has been granted. Public visibility,
licensing and production hosting are future owner decisions.
