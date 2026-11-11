# Changelog

Changes accumulate here before an owner-authorised versioned release. Source
versions live in `package.json`; actual deployments are recorded separately in
[docs/deployment.md](docs/deployment.md).

## Unreleased

### Development

- Yatzy rules and saved-format proof for Sprint 7: shared scoring, Forced/Free, banked throws,
  turn order for two to four players, ranking with the token tiebreak, and a proposed schema
  change rehearsed over existing chess records ([decision 0002](docs/decisions/0002-yatzy-format.md)).
  Nothing is enabled yet (#84).
- Yatzy on the server: tables for two to four previous opponents in turn order, server-rolled
  dice, throws and scores with safe retries, banked throws, finished rankings and per-table
  results kept apart from chess tallies. Additive migration
  `20261111120000_yatzy_games.sql`; the app does not offer Yatzy yet (#85).

## v0.3.0 — Play again with friends (2026-11-10)

Sprint 6. The release date is when this version was prepared; the `v0.3.0` tag marks the
accepted commit, published with `make release`.

### Added

- Start a game with someone you've played before by picking their name: no email, link or
  invitation. *Start a game* lists your previous opponents with how many games you share and
  when the last one was active; nobody is chosen until you pick someone. Choose Chess or Fischer
  Random and press *Start game*: you play White, they play Black, and it opens in both lobbies.
  *Invite someone new* keeps today's email-and-link invitation (#73, PR #79).

### Changed

- Player names are unique, ignoring case, surrounding spaces and how accented letters are
  encoded. Choosing a name someone already has says so and lets you pick another; nothing is
  created until the name is free. Existing players and names are unchanged, and an existing
  player's email still opens their own player whatever name is typed (#76, PR #77).

### Development

- `make prod-name-check`: a read-only check of the live database for player names that would
  collide, run by the owner and by `make deploy-backend` before it changes anything. Additive
  migration `20261108120000_unique_player_names.sql`, which refuses to run while names collide.
  Test players now get unique names (#76, PR #77).
- Server support for starting a game directly with someone you have played before:
  `GET /opponents` (people you have sat at a game with, by player ID and name) and
  `POST /games` with `friendPlayerId` (an active game with both seated, no invitation, safe to
  retry). No migration; old clients are unaffected (#72, PR #78).
- Sprint 6 plan and the v0.3.0 milestone (#70, PR #75); recording the v0.2.0 release (#56,
  PR #69); this release (#74).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- Either of two players who have shared a game can start another with the other at any time,
  with no request to accept and no notification; it simply appears in both lobbies (a deliberate
  prototype choice).
- The list of previous opponents loads when the lobby opens and when you come back to the tab;
  it doesn't refresh while you keep the lobby open.
- The lobby says "1 moves" for a single move.
- The top bar reads "Chess" on every page, and the lobby's "Chess history" card holds both
  types (sectioned per type).
- Rollback: the site can return to the v0.2.0 build (it never asks for previous opponents). The
  backend should stay at `1c0850a` or later while this site is live: an older backend makes the
  picker say it couldn't load the list, though invitations keep working. The unique-name index
  is forward-only; the Fischer Random rollback limit (the #53 dispatcher) still applies.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## v0.2.0 — Chess and Fischer Random (2026-11-07)

Sprint 5. The release date is when this version was prepared; the `v0.2.0` tag marks the
accepted commit and is the first one published with `make release`.

### Added

- Fischer Random (Chess960) next to chess. Choose the game when inviting a friend; the server
  draws the starting arrangement, the same for both of you. Every game is labelled Chess or
  Fischer Random in your games, at the table, in the invitation and in the history, where
  tallies are kept per game. To castle in Fischer Random, select your king and use a castle
  button, which names where king and rook will end up; a king move never castles by accident.
  Review, captured pieces and "Play again" (a new start, colours swapped) work as in chess
  (#54, PR #61; #55, PR #65).
- Local Fischer Random, with its own saved game: switching between local chess and local
  Fischer Random keeps both (#55, PR #65).

### Changed

- FriendlyGames is now free software under GPL-3.0-or-later, so the site can include chessops
  (Niklas Fiekas, GPL-3.0-or-later) for Fischer Random; standard chess still uses chess.js. The
  page footer links to the source and to every licence (#55, PR #65; decision 0001).

### Development

- `make release` tags and publishes the merged release commit of `package.json`'s version as a
  GitHub release: a preflight that writes nothing, only the missing steps on a rerun, and a precise
  report after a part-way failure. It does not deploy. `make prod-status` now fails when the site
  or backend is unhealthy. Run by the owner only (#49, PR #66).
- Proof of the Chess960 rules engine and saved format: chessops for Chess960, fixtures run in
  Node, the browser, Deno and the Supabase Edge runtime, and a decision record with the licence
  and publication proposal (#52, PR #58).
- Game-type boundary: the server picks a rules adapter by each game's stored type and version,
  and clients say which types they can show (`types`). A game a client cannot show is explained
  instead of being drawn as chess (#53, PR #59).
- Fischer Random (Chess960) on the server: a fair random start saved once per game, explicit
  castling, all chess outcomes, retries, history per type and "Play again"; clients that read
  only chess never see these games. Additive migration `20261104120000_chess960_games.sql`
  (#54, PR #61).
- Backend tests run reliably in parallel: test players get random unique emails, migration
  rehearsals that change the schema run afterwards on their own, and setup failures report
  only the operation, status and error code, never credentials or tokens (#60, PR #64).
- Sprint 5 plan, game-type architecture and the v0.2.0 milestone (#51, PR #57); Claude guidance
  points at the active sprint (#62, PR #63); this release (#56).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- The lobby says "1 moves" for a single move.
- The top bar reads "Chess" on every page, and the lobby's "Chess history" card holds both
  types (sectioned per type).
- Rollback: once Fischer Random games exist, the backend can only go back as far as the #53
  type dispatcher (it leaves unknown types out); an older backend would replay them as chess.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## v0.1.2 — Captured pieces at a glance (2026-11-03)

Sprint 4. The release date is when this version was prepared; the `v0.1.2` tag marks the
accepted commit.

### Added

- Each player's plate shows the pieces they have captured, "Captured by White" and
  "Captured by Black", on a light strip so both colours stand out against the wood. This
  works in shared and local games and when reviewing a finished game. Existing games show
  their captures straight away, from their saved moves (#44, PR #47).

### Development

- Sprint 4 plan and the v0.1.2 milestone (#43, PR #46).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- The lobby says "1 moves" for a single move.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## v0.1.1 — Correct starts and repeatable development (2026-11-01)

Sprint 3. The release date is when this version was prepared; the `v0.1.1` tag marks the
accepted commit.

### Changed

- The player who creates a game can make the opening move before their friend joins;
  the friend finds it waiting and replies. Previously the board stayed locked until the
  friend joined, which looked as if Black moved first (#33, PR #39).

### Development

- `make` commands for local work, checks, backups, deploying the backend and production
  status; CI runs the same commands. Backups now keep only complete dumps (#32, PR #40).
- A PR check requires exactly one primary `Closes #N` for an issue with a version
  milestone (#36, PR #41).
- Versioned milestones, ordered sprints, issue/PR tracking and the human command
  contract (#31, PR #35).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- The lobby says "1 moves" for a single move.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## Existing prototype baseline

The existing source version is 0.1.0. The deployed chess prototype includes shared
play, history and email entry across browsers. See the dated deployment record
for commits and evidence; this section does not invent a historical version tag
or completed first-game acceptance.
