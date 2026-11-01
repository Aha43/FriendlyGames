# Roadmap

GitHub milestones name the **version we are working towards**. Sprints are small,
ordered steps towards that version. Every coding issue has a version milestone
and a place in the ordered sprint plan before implementation starts. Sprint and
area labels are optional navigation aids. A version may take several sprints.
One issue still means one branch and one focused PR.

## Version direction

| Version | Result | Route and evidence |
| --- | --- | --- |
| [v0.1.0 — First game with Harald](https://github.com/Aha43/FriendlyGames/milestone/3) | The deployed friends-only chess baseline. | Historical Sprints 1–2, unique email and email entry. The real game is underway; [#11](https://github.com/Aha43/FriendlyGames/issues/11) stays open until its finished-game, resume and shared-history acceptance is confirmed. |
| [v0.1.1 — Correct starts and repeatable development](https://github.com/Aha43/FriendlyGames/milestone/4) | Correct first-turn/player presentation, repeatable human commands and a traceable release. | Active [Sprint 3](sprint-03.md): read-only [bug triage #33](https://github.com/Aha43/FriendlyGames/issues/33) and a confirmed fix first, then separate Makefile/CI issues and release qualification. |
| [v0.2.0 — Learn the board while playing](https://github.com/Aha43/FriendlyGames/milestone/5) | The next small chess learning aid. | Proposed Sprint 4 starts with [pin explanations #20](https://github.com/Aha43/FriendlyGames/issues/20). Refine scope after the first-game findings; do not start before Sprint 3 is accepted. |

`package.json` currently says `0.1.0`. That is the baseline source version, not a
claim that a version tag/release or every first-game acceptance step exists. Actual
site/backend commits are in [deployment.md](deployment.md). Patch work can ship
while the long-running first game continues; do not close its acceptance issue
just because a patch or CI run passed.

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

[Deployment orchestration #37](https://github.com/Aha43/FriendlyGames/issues/37)
is future v0.2.0 candidate work, not Sprint 3: prepare one explicit backup →
backend → site release path before changing automatic publishing. Until then,
keep the current owner-approved deployment procedure and disclose its gap.

## Sources

NamWeb's `docs/ops/workflow.md` supplies the short local-to-production path,
separate treatment of frontend and migrations, backups and smoke verification.
JUranometria's `docs/development.md` and Makefile supply focused issue work,
meaningful evidence, human commands and deliberate releases. FriendlyGames keeps
per-issue branches and its existing full PR checks; it does not copy sprint-sized
branches, desktop packaging, CI classification or automatic-review machinery.
