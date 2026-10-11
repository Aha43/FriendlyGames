# Claude implementation entry point

Follow [AGENTS.md](AGENTS.md) and [the development workflow](docs/development.md).

You are the implementation agent. Codex supplies planning and independent review.
Begin with the active GitHub issue, implement its acceptance criteria, verify the
result and open a PR. Explain any necessary deviation before expanding scope.

The frontend is React, TypeScript and Vite, checked by ESLint, TypeScript and
Vitest. CI runs lint, type checking, tests and production build on every PR; run
them locally with `npm run check` (see the README). No backend, hosting or browser
tests are installed yet; add them only when an issue calls for them.
