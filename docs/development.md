# Development workflow

## Planning and implementation

Use GitHub milestones for small, coherent sprints and ordered issues for work.
Each issue states the observable result, scope, acceptance criteria and verification.
Codex plans and reviews; Claude implements. The owner approves product choices and
shipping. One issue and one focused branch/PR at a time.

Begin from current main, implement on a branch, run the relevant checks and inspect
visual changes. Open a PR linking the issue with `Closes #N`. Include the result,
verification evidence and remaining limitations. Stop for review before starting
the next issue. Merge only with owner authorization.

## Checks

The first implementation issue installs executable checks. Until then there is no
application build or test suite. After scaffolding, CI should gate PRs with lint,
type checking, unit/integration tests and production build. Add a focused browser
journey for the playing flow. The multiplayer milestone also needs real backend
verification through two independent player sessions.

## Review handoff

Identify the PR head commit in the review. Claude addresses actionable findings and
reports verification; Codex reviews the new head. Stop on approval or when a product
decision or disagreement requires the owner. An automated handoff can later adapt
JUranometria's bounded loop; no automated reviewer or secrets are configured yet.

## Hosting and release

Use preview deployments when hosting is selected and deliberate production updates
after review. Keep credentials in the host/GitHub secret stores, never in source.
Confirm the private repository's available CI, protection and hosting features
during setup; do not change visibility to solve a tooling limitation automatically.

No license is selected. Record third-party code and artwork licenses as assets are
introduced. Publishing the repository or granting an open-source license requires
an explicit owner decision.
