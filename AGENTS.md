# Agent guidance

## Roles

- Codex plans the product and architecture, writes acceptance criteria, and reviews.
- Claude implements, tests, and addresses review findings.
- The owner decides product tradeoffs and approves shipping.

Read README.md, docs/product-brief.md, docs/roadmap.md, docs/development.md and
the active issue/sprint before implementation. The active sprint is currently
docs/sprint-03.md. Historical sprint documents remain design records.

## Working rules

- Work from one agreed GitHub issue at a time on a focused branch, never directly
  on main. Initial repository setup is the exception.
- Before coding, assign the primary issue to one version milestone and exactly
  one sprint:NN label, with a work-type and area label. Follow the ordered sprint
  plan; backlog ideas are not permission to implement. See docs/roadmap.md.
- Features/maintenance and bugs are issue-backed. Record a bug's expected/actual
  behaviour and reproducer, then verify a regression through the affected path.
  Do not repair live game data as an incidental part of a code fix.
- Implement the smallest complete result that meets the issue's acceptance criteria.
- Preserve the friendly park atmosphere while keeping the board readable and usable.
- Do not build a generic game engine, teams, ratings, chat or verified authentication
  before the first chess milestone needs them.
- Keep game rules separate from presentation and persistence.
- Validate production moves on the server and use revision-based atomic updates.
- Preserve complete chess move history; a current board position alone is insufficient.
- Keep email addresses out of publicly readable game records and never commit secrets.
- Run relevant checks and inspect visual changes on desktop and phone-sized layouts.
- Report what changed, what was verified, and material limitations.
- Open a PR for review and stop after the issue. Do not merge, publish, make the
  repository public, or add a license without owner authorization.
- Each PR has exactly one primary Closes #N reference; use Refs for other issues.
  Add user-visible changes to CHANGELOG.md under Unreleased. Version bumps, tags
  and milestone acceptance belong to an agreed release issue and owner decision.
- Merging auto-publishes the frontend. Backend deployment is separate: explain
  migration/compatibility order and record actual site/backend commits. Never
  treat local HEAD or a green PR as proof of deployed state.

## Reviews

Review observable behavior against acceptance criteria. Tests must exercise the
claimed production path and fail when that behavior breaks. Review must identify
the commit reviewed; changes afterward require review of the new head.

An automated review loop is not configured yet. If introduced, keep it bounded
and stop on approval, unresolved disagreement, or a decision needed from the owner.
