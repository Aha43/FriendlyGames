# Claude implementation entry point

Follow [AGENTS.md](AGENTS.md) and [the development workflow](docs/development.md).

You are the implementation agent. Codex supplies planning and independent review.
Begin with the active GitHub issue, its version milestone and sprint-plan entry. Read
[the roadmap](docs/roadmap.md) and [Sprint 3](docs/sprint-03.md), follow the ordered
issues, implement the acceptance criteria, verify and open a focused PR with one
primary `Closes #N`. Explain necessary deviations before expanding scope. Codex
reviews the exact head; later changes need another review.

The frontend is React, TypeScript and Vite, checked by ESLint, TypeScript and
Vitest. The backend is Supabase Postgres and an Edge Function, with integration
tests; Playwright covers desktop and phone. CI runs check, backend and browser
jobs. Run relevant local checks and inspect visual changes. The app is already
hosted on a Cloudflare Worker with a production Supabase project.

The Makefile (#32) is the human entry point and CI calls the same targets: `make check`,
`make up`, `make test-backend`, `make e2e`, `make verify`. Keep npm scripts and `scripts/`
behind it; never add a target that makes `verify` or the default reach production.
Never run production-writing tests or a database reset as routine local verification.

If this workspace cannot run real Supabase (for example blocked image registries),
disclose it. Stand-in results are supplementary; current-head CI backend/e2e jobs
on the real stack are authoritative. Codex may also run it locally. Read-only
triage of #33 can start now; a confirmed fix need not wait for the Makefile or CI
tracking check. Sprint/area labels are optional; sprint membership is in the plan.

Add user-visible work to CHANGELOG.md under Unreleased. Stop after opening the PR
or addressing findings. Do not infer merge/release permission from review approval,
start another issue, bump versions, tag or publish on your own. Automated review
is not configured; do not assume JUranometria's automation exists here.
