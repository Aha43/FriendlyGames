# Sprint 3 — Correct starts and repeatable development

Target: [v0.1.1](https://github.com/Aha43/FriendlyGames/milestone/4).
Optional navigation label: `sprint:03`. This ordered plan records membership;
labels do not gate work. A coherent result, not a time box.

## Result

The owner can run common development and release commands through a Makefile,
every coding PR belongs to an issue/sprint/version, and a new chess game correctly
shows White moving first. The current game with Harald continues intact.

## Ordered issues

| Order | Issue | Result |
| --- | --- | --- |
| 1 | [#31 — Planning and guidance](https://github.com/Aha43/FriendlyGames/issues/31) | Version roadmap, sprint contract, current agent instructions and issue/PR templates. Codex prepares this planning PR. |
| 2 | [#33 — Opening while waiting](https://github.com/Aha43/FriendlyGames/issues/33) | Triage showed correct seats and turns: the creator was blocked because the friend hadn't joined. Owner decision: the creator may make a legal move on their colour's turn while waiting. No Makefile dependency. |
| 3 | [#32 — Makefile commands](https://github.com/Aha43/FriendlyGames/issues/32) | Human commands delegate to existing scripts; existing CI uses the same check commands. No metadata gate in this PR. |
| 4 | [#36 — Minimal PR tracking check](https://github.com/Aha43/FriendlyGames/issues/36) | Require one primary closing issue and a version milestone, without weakening application checks or gating labels. |
| 5 | [#34 — Release qualification](https://github.com/Aha43/FriendlyGames/issues/34) | Review the combined result, prepare 0.1.1/version notes and owner commands, and record actual commits after authorised deployment. |

Read-only #33 triage may start immediately, before this planning PR merges. It
must not create sessions, players or games, submit moves or repair the live game.
Merge the accepted plan before implementation; fix a confirmed bug before tooling,
using existing commands. Finish/review/merge one implementation issue at a time.
The owner approves merges and shipping; Codex approval alone is not authorisation.

## Opening-turn report

On 2026-11-01 the owner reported: “I started a game with Harald, I am white but
first move is his but white always start in chess.” They continue dogfooding; it
is not a show stopper. Do not infer whether Black actually moved first, the
plates are wrong, or a rematch colour was misunderstood. Establish the path in
the issue. Never reset or rewrite the live game to make the fix pass.

**Outcome (read-only triage, [#33](https://github.com/Aha43/FriendlyGames/issues/33#issuecomment-6560316442)):**
seats, moves and turn were correct; Harald had not joined yet, and a waiting game refused
every move, so White's ready-looking board would not move. The owner chose to let the
creator move while waiting, on their own colour's turn. Colour choice is backlog #38.

## Human commands

Implemented by [#32](https://github.com/Aha43/FriendlyGames/issues/32); the README has the
full command table.

| Need | Command |
| --- | --- |
| Discover commands / prerequisites | `make help`, `make doctor` |
| Install / start / stop local work | `make setup`, `make up`, `make down` |
| Run locally / test on a phone | `make dev`, `make phone` |
| Check / qualify the local result | `make check`, `make test-backend`, `make e2e`, `make verify` |
| Build / inspect source version | `make build`, `make preview`, `make version` |
| Read production state | `make prod-status` |
| Back up / deploy / verify production | `make backup`, `make deploy-backend`, `make prod-e2e` |

Default `make` shows help only. `up`/`down` affect this project's local stack and
preserve data. `verify` runs local checks sequentially, never reset or production
actions. The last row is deliberate owner-run production work; `prod-e2e` writes
throwaway test players/games. No credentials belong in a Makefile or its output.
Do not add redundant confirmation flags for commands the owner deliberately runs;
existing deployment guards and owner authorisation remain.

## Exit evidence

- Every coding PR has its primary issue and target version, and belongs to this
  ordered sprint plan. Labels are optional.
- Command/help/CI behaviour is verified, including failure paths.
- On two devices, a new game's actual White player gets the first legal turn, also
  before Black joins; Black is rejected server-side until White moves. Seats,
  orientation and labels agree after refresh. Relevant rematch behaviour stays correct.
- Existing games, identities, moves, histories and tallies survive.
- Relevant checks pass, the integrated result is reviewed and the owner accepts
  the patch. Report failed/flaky runs honestly.
- If the implementer cannot run real Supabase, disclose the limitation. Stand-in
  evidence is supplementary; current-head real-stack CI backend/e2e jobs are
  authoritative. Codex may also verify locally.
- Version/changelog and actual deployed commits are recorded. If the original game
  is unfinished, keep #11 open and say so.

Pin explanations (#20) are the next proposed feature sprint. Deployment
orchestration (#37) is future work, not Sprint 3. Games, clocks, ratings,
authentication, park navigation and review automation are outside this one.
