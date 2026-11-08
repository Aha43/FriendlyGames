# Roadmap

GitHub milestones name the **version we are working towards**. Sprints are small,
ordered steps towards that version. Every coding issue has a version milestone
and a place in the ordered sprint plan before implementation starts. Sprint and
area labels are optional navigation aids. A version may take several sprints.
One issue still means one branch and one focused PR.

## Version direction

| Version | Result | Route and evidence |
| --- | --- | --- |
| [v0.1.0 — First game with Harald](https://github.com/Aha43/FriendlyGames/milestone/3) | The deployed friends-only chess baseline. | Historical Sprints 1–2, unique email and email entry. The owner reports a game with Harald has ended; [#11](https://github.com/Aha43/FriendlyGames/issues/11) stays open until finished-game, resume and shared-history acceptance is confirmed. |
| [v0.1.1 — Correct starts and repeatable development](https://github.com/Aha43/FriendlyGames/milestone/4) | Correct starts and repeatable development. | Released; historical [Sprint 3](sprint-03.md), tag/release and actual deployments recorded separately. |
| [v0.1.2 — Captured pieces at a glance](https://github.com/Aha43/FriendlyGames/milestone/6) | Captured pieces visible in existing/new games and replay. | Released; historical [Sprint 4](sprint-04.md), with the owner's real-game observation recorded. |
| [v0.2.0 — Chess and Fischer Random](https://github.com/Aha43/FriendlyGames/milestone/5) | Two persisted game types, shared services and correct type-specific rules; first release via `make release`. | Released through owner-run `make release`; [Sprint 5](sprint-05.md), tag `v0.2.0` at `2613fec`, and actual deployments recorded separately. [Architecture](game-types.md). |
| [v0.2.1 — Play again with friends](https://github.com/Aha43/FriendlyGames/milestone/7) | Clear one-click rematches and game creation with previous opponents by name. | Proposed [Sprint 6](sprint-06.md): visible rematches, authorized previous-opponent backend, direct-start UI and patch qualification. |

`package.json` is the source version; read it rather than maintaining a second
current-version value here. It is not proof of a tag/release or first-game acceptance. Actual
site/backend commits are in [deployment.md](deployment.md). Patch work can ship
while first-game acceptance remains pending; do not close that issue just because
a patch or CI run passed.

Older GitHub milestones named Sprint 1 and Sprint 2 are historical planning
records. Do not assign new work to them. Version milestones and sprint plans are
the convention from Sprint 3 onwards; historical sprint documents stay intact.

## Planning rules

- Codex plans the next coherent result, writes acceptance criteria and orders the
  sprint. Claude codes/tests one selected issue at a time. Codex reviews the exact
  PR head. The owner decides scope, acceptance, merge and release.
- Create a feature/maintenance issue (`enhancement`) or fault issue (`bug`) before
  coding. Docs-only planning can use `documentation`. Assign a version milestone
  and list selected work in its sprint plan. `area:*` and `sprint:NN` labels can
  help navigation but do not decide whether work is allowed or make CI fail.
- Backlog ideas may remain unassigned. They cannot be implemented until selected.
  Bugs are triaged as bugs even when found during a feature; do not hide them in
  unrelated PRs. An urgent regression can have an expedited patch issue/PR with
  its own reproducer, verification and owner shipping approval.
- Read-only investigation of an active game can start before tooling or a planning
  merge. It must not issue sign-ins, create players/games, submit moves or repair
  data. A confirmed live bug need not wait for Makefile/CI improvements.
- Do not add games, ratings, clocks, park navigation or authentication to a sprint
  by inference. Email-only prototype access remains the explicit owner decision.

## Versions and releases

Use `0.MINOR.PATCH`: patches for fixes/maintenance, minors for a coherent new
product capability. Bump versions in an agreed release issue/PR, not every feature
commit. Update `package.json` and `package-lock.json` together; do not add a
competing `VERSION` file. User-visible work accumulates under `Unreleased` in
[CHANGELOG.md](../CHANGELOG.md).

At a release boundary review the integrated result, record checks and limitations,
prepare version/changelog and deployment order, then obtain the owner's decision.
A tag such as `v0.1.1` points at the accepted release commit. Tags/releases are
explicit owner-authorised actions; this roadmap creates neither.

Merging already auto-publishes the frontend through Workers Builds. Backend
deployment remains separate and guarded. Plan compatible schema/API changes and
deployment order; record separate frontend/backend commits when they differ.
A local version or green PR is not proof of deployed state.

[Release command #49](https://github.com/Aha43/FriendlyGames/issues/49) shipped
with Sprint 5: v0.2.0 was the first release published by the explicit owner-run
`make release`. It does not deploy. [Deployment orchestration #37](https://github.com/Aha43/FriendlyGames/issues/37),
[pin explanations #20](https://github.com/Aha43/FriendlyGames/issues/20) and
[colour choice #38](https://github.com/Aha43/FriendlyGames/issues/38) remain
unscheduled backlog. Keep the existing deployment procedure and disclose its gap;
no Cloudflare setting changes by inference.

## Sources

NamWeb's `docs/ops/workflow.md` supplies the short local-to-production path,
separate treatment of frontend and migrations, backups and smoke verification.
JUranometria's `docs/development.md` and Makefile supply focused issue work,
meaningful evidence, human commands and deliberate releases. FriendlyGames keeps
per-issue branches and its existing full PR checks; it does not copy sprint-sized
branches, desktop packaging, CI classification or automatic-review machinery.
