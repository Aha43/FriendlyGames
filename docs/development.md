# Development workflow

The [roadmap](roadmap.md) names version destinations. The active route is
proposed [Sprint 6](sprint-06.md), v0.2.1 — Play again with friends. Merge its
planning PR before implementation. Sprint 5 and its reviewed engine/format
decision remain the baseline; this sprint improves existing game flows.
See [game-type boundaries](game-types.md). Keep the process small enough to use
between moves of a real game.

## Planning and implementation

Codex plans product/architecture, writes acceptance criteria and reviews. Claude
implements and tests. The owner chooses tradeoffs and approves acceptance, merge
and release. Those are distinct decisions: a Codex approval does not merge or
ship anything by itself.

1. Record a feature, bug or maintenance result as a GitHub issue before coding.
2. Assign a version milestone and list it in the ordered sprint plan. Use a work
   type (`enhancement`, `bug` or `documentation`) for clarity. Sprint/area labels
   are optional navigation aids; the sprint plan records membership and order.
3. Start a focused issue branch from current main. Use another worktree if the
   owner's checkout is serving a phone; explain any checkout change.
4. Implement the smallest complete acceptance result. New discoveries become
   separate issues unless needed for this one. Urgent fixes can be expedited,
   but still have an issue, meaningful regression and review.
5. Verify the affected path, update relevant docs and add user-visible work to
   CHANGELOG.md under Unreleased.
6. Open a PR with exactly one primary `Closes #N`; use `Refs #N` for other links.
   Report checks, data/deployment impact and limitations. Stop for review.
7. Codex reviews the current head. Fix findings and report the new head: approval
   of an older commit does not approve the update. The owner authorises merge.

Read-only investigation of a live-game fault can start before the planning PR or
tooling work merges. It must not create sessions/players/games, submit moves or
edit data. A confirmed bug can be fixed first under its existing issue/milestone,
using existing commands; Makefile and CI improvements are not prerequisites.

Exact-head review remains the default for every update, including deployment-log
edits. Re-review can be a short diff check with no repeat of unaffected suites;
there is no automatic documentation exception unless the owner later chooses one.

GitHub issues are the live execution record. The short sprint document records
order, integrated result and acceptance, not daily status. Historical Sprint 1/2
milestones remain records rather than destinations for new work.

## Human commands and checks

The Makefile (#32) is the human entry point; the README lists every command. `make`
alone shows help. Each target delegates to an npm script or `scripts/`, and CI calls
the same targets (`make check`, `make up`, `make test-backend`, `make e2e`), so local
and CI logic cannot drift. Typical local loop:

```bash
make setup && make up        # once, then whenever Docker was restarted
make dev                     # or make phone
make verify                  # check, backend and browser tests, stopping at the first failure
make down                    # keeps local data
```

`make verify` never touches production or resets a database. Production commands
(`prod-status`, `backup`, `deploy-backend`, `prod-e2e`) are separate, named targets the
owner runs deliberately. `tests/tooling/makefile.test.ts` runs the Makefile with stub
tools to keep these properties.

Keep existing check/backend/e2e CI jobs and meaningful assertions. Backend and
browser jobs start fresh local Supabase stacks in CI, never production. Add a
regression through the actual failing path: a green test with no observed event
is not evidence. Inspect visual changes on desktop and phone. Report failures
and flaky reruns honestly. Run checks appropriate to the change; do not repeat
broad suites after sufficient evidence unless something changes.

When an implementer cannot run real Supabase (for example blocked image
registries), say exactly what ran and what did not. A Node/Postgres stand-in can
help development but is supplementary; the current-head CI backend/e2e jobs on
real Supabase are authoritative. Codex may verify on a real local stack too.
Do not weaken real-stack CI or repeatedly retry a known inaccessible registry.

**PR tracking** (`.github/workflows/pr-tracking.yml`, #36) checks every pull request:
exactly one primary closing reference (`Closes #N`, or GitHub's other closing words) to an
issue in this repository, and that issue has a version milestone (`v0.1.1 — …`, not an old
`Sprint N — …` one). Other issues use `Refs #N`. Comments and code in the description are
ignored, so the template's guidance doesn't count. Labels, sprint and area are not
checked; sprint membership stays in the plan and review. The check runs when a PR is
opened, its description is edited or its branch is updated. **It does not rerun when the
issue's milestone changes**: re-run the failed job afterwards (Actions → the run →
Re-run jobs, or `gh run rerun <run-id>`). It has only read access; the logic is in
`scripts/pr-tracking.ts`, with fixture tests in `tests/tooling/`.

Do not claim branch protection or automated Codex review is configured when it has not
been verified. Any future review loop must be bounded and tied to the current head.

## Releases and production

`package.json` is the source version. A release issue prepares a patch/minor bump,
matching lockfile, changelog, integrated checks and deployment order. The owner
authorises tags, publishing and milestone acceptance. #74 prepares v0.2.1;
#56 qualified the released v0.2.0, the first owner-run `make release` (#49).
Version acceptance does not by itself close the original real-game acceptance
#11; check its finished-game, resume and history criteria separately.

Merging to main **auto-deploys the frontend** through Workers Builds. Treat merge
approval accordingly. Backend/function/schema changes are a separate deliberate
deployment: back up first, prefer additive compatible migrations, rehearse
existing-data cases and plan the site/backend order. The prototype has one hosted
backend and local development; do not provision staging or paid services by inference.

Future #37 will prepare an explicit backup → backend → site release path and
review the corresponding publishing settings. It remains outside Sprint 6;
no current Cloudflare setting is changed by this plan. For previous-opponent
creation, owner-deploy the reviewed #72 backend before merging the #73 UI that
exposes the new path.

Use [deployment.md](deployment.md) for actual commands, secrets, rollback and the
deployed-version log. Local version/HEAD, green CI or a preview does not prove
what production runs. Verify actual site/backend commits; they may differ for
frontend-only work. Production journeys write fresh throwaway players/games and
are explicitly owner-authorised, never part of routine local verify.

Do not reset or rewrite the live dogfooding game as a code fix. A data repair gets
a concrete reviewed proposal and owner approval, preserving players, moves and
history. Never log private emails, credentials or invitations.

## Hosting and repository decisions

The owner made the repository public and approved GPL-3.0-or-later for #55;
see LICENSE and [source-publication.md](source-publication.md). Third-party
assets retain their recorded licences. Supabase hosts the backend and Cloudflare
Workers hosts the site. Future licence/visibility/access changes and new cloud
resources remain owner decisions; a tooling limitation is not authorization.
Never put backups, credentials, private emails or player data in public history.
