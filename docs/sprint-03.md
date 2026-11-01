# Sprint 3 — Correct starts and repeatable development

Target: [v0.1.1](https://github.com/Aha43/FriendlyGames/milestone/4).
Tracking label: `sprint:03`. A coherent result, not a time box.

## Result

The owner can run common development and release commands through a Makefile,
every coding PR belongs to an issue/sprint/version, and a new chess game correctly
shows White moving first. The current game with Harald continues intact.

## Ordered issues

| Order | Issue | Result |
| --- | --- | --- |
| 1 | [#31 — Planning and guidance](https://github.com/Aha43/FriendlyGames/issues/31) | Version roadmap, sprint contract, current agent instructions and issue/PR templates. Codex prepares this planning PR. |
| 2 | [#32 — Makefile and issue-backed CI](https://github.com/Aha43/FriendlyGames/issues/32) | Human commands delegate to existing scripts; CI verifies issue/milestone/sprint tracking without weakening check/backend/browser gates. Claude implements. |
| 3 | [#33 — Opening-turn bug](https://github.com/Aha43/FriendlyGames/issues/33) | Reproduce the real create/join path, establish whether seats, display or authoritative turn disagree, and fix it with a meaningful regression. |
| 4 | [#34 — Release qualification](https://github.com/Aha43/FriendlyGames/issues/34) | Review the combined result, prepare 0.1.1/version notes and owner commands, and record actual commits after authorised deployment. |

Merge planning before tooling. Finish/review/merge one issue before the next. The
owner approves merges and shipping; Codex approval alone is not authorisation.

## Opening-turn report

On 2026-11-01 the owner reported: “I started a game with Harald, I am white but
first move is his but white always start in chess.” They continue dogfooding; it
is not a show stopper. Do not infer whether Black actually moved first, the
plates are wrong, or a rematch colour was misunderstood. Establish the path in
the issue. Never reset or rewrite the live game to make the fix pass.

## Human commands

The Makefile is **not installed by this planning PR**; [#32](https://github.com/Aha43/FriendlyGames/issues/32)
implements it. Until then, the README's npm/Supabase commands remain supported.

| Need | Planned command |
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

- Every coding PR has its primary issue, target version and sprint label.
- Command/help/CI behaviour is verified, including failure paths.
- On two devices, a new game's actual White player gets the first legal turn;
  Black is rejected server-side until White moves. Seats, orientation and labels
  agree after refresh. Relevant rematch behaviour stays correct.
- Existing games, identities, moves, histories and tallies survive.
- Relevant checks pass, the integrated result is reviewed and the owner accepts
  the patch. Report failed/flaky runs honestly.
- Version/changelog and actual deployed commits are recorded. If the original game
  is unfinished, keep #11 open and say so.

Pin explanations (#20) are the next proposed feature sprint. Games, clocks,
ratings, authentication, park navigation and review automation are outside this one.
