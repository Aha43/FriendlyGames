# Claude implementation entry point

Follow [AGENTS.md](AGENTS.md) and [the development workflow](docs/development.md).

You are the implementation agent. Codex supplies planning and independent review.
Begin with the active GitHub issue, its version milestone and sprint label. Read
[the roadmap](docs/roadmap.md) and [Sprint 3](docs/sprint-03.md), follow the ordered
issues, implement the acceptance criteria, verify and open a focused PR with one
primary `Closes #N`. Explain necessary deviations before expanding scope. Codex
reviews the exact head; later changes need another review.

The frontend is React, TypeScript and Vite, checked by ESLint, TypeScript and
Vitest. The backend is Supabase Postgres and an Edge Function, with integration
tests; Playwright covers desktop and phone. CI runs check, backend and browser
jobs. Run relevant local checks and inspect visual changes. The app is already
hosted on a Cloudflare Worker with a production Supabase project.

The Makefile is planned in #32, not present yet: use documented npm/Supabase
commands until it merges. Afterwards keep those scripts behind the human Makefile
entry points and use the same checks as CI. Never run production-writing tests or
a database reset as routine local verification.

Add user-visible work to CHANGELOG.md under Unreleased. Stop after opening the PR
or addressing findings. Do not infer merge/release permission from review approval,
start another issue, bump versions, tag or publish on your own. Automated review
is not configured; do not assume JUranometria's automation exists here.
