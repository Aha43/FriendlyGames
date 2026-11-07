# Sprint 5 — Chess and Fischer Random

Target: [v0.2.0](https://github.com/Aha43/FriendlyGames/milestone/5).
Owner direction, 2026-11-03: make the practical step from one game type to two as
the foundation for more. The selected second type is **Fischer Random (Chess960)**.
Reuse the chess-family board while separating game lifecycle from type-specific
rules/records. The [architecture contract](game-types.md) and linked issues define
scope; do not begin downstream work until the engine/format proof is reviewed.

## Order and review points

| Order | Issue | Complete result |
| --- | --- | --- |
| 1 | [#51 — Planning](https://github.com/Aha43/FriendlyGames/issues/51) | This plan, roadmap/guidance, issue contracts and owner/Claude review. |
| 2 | [#52 — Engine and record proof](https://github.com/Aha43/FriendlyGames/issues/52) | Executable browser/Edge-runtime proof of all Chess960 castling/start/record cases, with a reviewed dependency/format decision. Stop for review before downstream code. |
| 3 | [#53 — Type boundary](https://github.com/Aha43/FriendlyGames/issues/53) | Registry/adapters and compatible API/client boundary, with only standard chess enabled and existing behaviour preserved. |
| 4 | [#54 — Chess960 backend](https://github.com/Aha43/FriendlyGames/issues/54) | Additive storage and complete authoritative second-type creation/actions/history/rematch; owner-deployed before UI exposure. |
| 5 | [#62 — Active implementation guidance](https://github.com/Aha43/FriendlyGames/issues/62) | Documentation housekeeping: align CLAUDE.md with the active route in AGENTS.md and remove completed #33 triage instructions. |
| 6 | [#60 — Reliable backend fixtures](https://github.com/Aha43/FriendlyGames/issues/60) | Prevent parallel fixture identity collisions, isolate schema-changing tests and redact failure diagnostics; verify on real Supabase before expanding UI journeys. |
| 7 | [#55 — Two-type UI](https://github.com/Aha43/FriendlyGames/issues/55) | Selector, shared chess board, explicit castle controls, local save isolation and mixed-game desktop/phone journeys. |
| 8 | [#49 — make release](https://github.com/Aha43/FriendlyGames/issues/49) | Owner-run publication of the exact accepted version commit with real notes and bounded partial-failure recovery; no deploy. |
| 9 | [#56 — Qualify v0.2.0](https://github.com/Aha43/FriendlyGames/issues/56) | Integrated review, version/lockfile/changelog, actual deployed evidence and owner acceptance; first release via `make release`. |

Merge the planning PR before Claude starts #52. One issue/branch/PR at a time;
Codex reviews each exact head and the owner approves merges/deploys/releases.
If the proof reveals a material tradeoff or changes feasibility, revise the plan
before implementing; a shuffled board with incomplete castling is not a release.
The owner accepts making the source public and adopting a compatible open-source
licence if needed for the selected library. #52 evaluates that route first and
prepares concrete publication/licence steps; no custom castling exception or
repository visibility change is authorized by this planning PR.

## Acceptance

- Chess and Chess960 are distinguishable persisted types from creation through
  invitation, resume, legal play, finish, review, same-type rematch and per-type tally.
- Both use common identity/invitation/transaction/persistence/history services.
  Correct rules are selected from type/version; no silent chess fallback. The
  two chess-family presentations reuse the board rather than duplicate the app.
- Starts are legal, server-generated once and stable through retries. Full
  initial rights and actions replay identically on browser/server. Castling
  handles all forms, safety checks and ambiguity, with clear keyboard/touch controls.
- Existing standard-chess games, payloads, actions, credentials, invitations,
  captures, history and local saves survive; cached old clients remain safe even
  after new type records exist. No production game repair or reset.
- New local Chess960 saves are separate. Confirmed capture semantics, review,
  promotion focus, coordinates, park atmosphere and 320px usability are preserved.
- `make check`, real-stack backend tests and desktop/phone journeys cover both
  types, mixed lobbies, replay/castling/rights and post-commit lost-response/race
  paths. Regression evidence must fail when dispatch or castle semantics break.
  Disclose stand-ins/flakes; they do not replace current-head real Supabase CI.
- Owner verifies actual deployed versions and accepts v0.2.0. #49 is in place
  before tagging/publishing with `make release`; milestone closing stays manual.
  The original first-game acceptance #11 remains separate until actually met.

## Rollout and limits

Use additive, rehearsed migrations and a compatible type dispatcher. Deploy the
reviewed backend before merging the UI that admits the new type. Merging still
auto-publishes the site; no Cloudflare publishing setting is changed by this plan.
Document rollback boundaries: do not run the original chess-only decoder over
Chess960 rows. Record site/backend commits and authorized smoke evidence separately.

Pin explanations #20, deployment orchestration #37 and colour choice #38 remain
unscheduled backlog. No teams, more player counts, third game, authentication,
ratings, chat, navigation, dynamic plugin system or rules-engine project. #49
tags/publishes; it does not deploy or imply the owner authorized a real test release.

## Integrated result (#56, prepared 2026-11-07)

Delivered in order: #51 (PR #57), #52 (PR #58), #53 (PR #59), #54 (PR #61), #60 (PR #64,
added during the sprint), #62 (PR #63, guidance), #55 (PR #65), #49 (PR #66). The backend was
deployed before the UI (#54 at `f81cf02`, then #55 merged); the live site runs `cf028f4`. Version
0.2.0 and its changelog section are prepared in the #56 release PR. Evidence and limits are in
that PR and [deployment.md](deployment.md). Owner acceptance, `make release` and closing the
milestone remain the owner's; the first-game acceptance #11 stays separate.
