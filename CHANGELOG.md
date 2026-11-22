# Changelog

Changes accumulate here before an owner-authorised versioned release. Source
versions live in `package.json`; actual deployments are recorded separately in
[docs/deployment.md](docs/deployment.md).

## Unreleased

### Added

- **Invite a friend** on *Your games*, without choosing a game or typing their email. You get
  a link to send yourself. One link is for one friend and works for 30 days. Your friend sees
  who invites them, enters their email if they are new, and accepts. You then find each other
  under *Play with* and can start Chess, Fischer Random or Yatzy; accepting starts no game. A
  friend you haven't played yet shows as "No games together yet" (#111).
- Your waiting invitations are listed with when they were made and when they expire. A link is
  shown only when it is made, so a lost one is replaced: you get a new link for the same
  invitation, valid for 30 days, and the old link stops working. You can have 20 waiting at a
  time (#111).
- **Player details.** Your name in the top bar opens your own details, with the email you
  entered; only you see it. *Details* beside a name under *Play with* shows that player's name,
  whether you are connected by invitation and since when, and how many games you share. It
  never shows another player's email (#113).
- A game that is still waiting for the friend you invited by email now says who you invited,
  in *Games in progress* and on the game's page. Only you, the game's creator, see it, also on
  another device and for games created earlier; it goes away when someone joins (#113).

### Changed

- Opening the app from an iPhone or iPad Home Screen icon now starts on *Your games*, also for
  an icon that was added while a game was open (it used to open that same old game every
  time). Links to a game or an invitation, reloading, and coming back to a game from the
  background are unchanged. A new Home Screen icon on any phone starts on *Your games*. An
  existing Android shortcut made on a game page has to be removed and added again from *Your
  games* (#112, [launch paths](docs/launch-paths.md)).
- Game invitations by email work as before. A friend invitation has its own kind of link, and
  pasting either under *Got an invitation?* opens the right page (#111).

### Development

- Backend failures are traceable in CI: the function logs one safe line per unexpected error
  and puts its ID in the `500` answer; `make backend-errors` reads the whole runtime log after
  the backend tests and fails on any unexpected error other than the one a test makes on
  purpose (#120, first step of #116).
- Backend for inviting a friend before choosing a game: single-use friend links that expire
  after 30 days (at most 20 unused per player), a pending list with replacement, lasting
  connections that count for *Play with*, direct starts, tables and the deletion warning, and
  creator-only access to the recipient email of a pending game invitation. Nothing changes on
  the site yet; older clients get the picker exactly as before (#110).

## v0.5.0 — Finished game cleanup (2026-11-20)

Sprint 8. The release date is when this version was prepared; the `v0.5.0` tag marks the
accepted commit, published with `make release`.

### Added

- Delete a finished game. On a finished Chess, Fischer Random or Yatzy game, any player who
  took part can choose *Delete game…*. A confirmation names the game and says that it
  disappears for everyone, including from history and results, and can't be undone. If it is
  the last game you share with someone, it names them and says they leave *Play with* until
  you share another game. A rematch of the deleted game stays as a game of its own. Games
  still waiting or being played can't be deleted. The button appears once the backend
  supports it (#93).

### Changed

- "Local game" is now **Play on one device**, in the top bar and the lobby. The page says
  what it is: you take turns on this device, and the game is saved only in this browser, so it
  isn't one of your games with friends. Nothing else about it changes; saved games on a device
  are still there. On a narrow phone the top-bar link moves to its own line so your name stays
  readable (#82).

### Fixed

- When a friend accepted an invitation at the very moment White made the opening move, the
  move could be refused with an error about the game's seats. White is now told the game has
  changed and can make the move again; or, if the move was saved first, the friend finds it
  on joining (#100).

### Known limitations

- A deleted game cannot be brought back from the site. Any player who took part can delete
  it, for everyone; there is no private archive copy yet.
- An invitation nobody has accepted stays waiting; the inviter cannot withdraw it yet.
- A Yatzy table someone stops playing still stays in progress (as in v0.4.0), so it cannot be
  deleted either.

## v0.4.0 — Yatzy with friends (2026-11-12)

Sprint 7. The release date is when this version was prepared; the `v0.4.0` tag marks the
accepted commit, published with `make release`.

### Added

- Yatzy with friends, for two to four players. Under *Start a game*, choose Yatzy, Forced or
  Free order, and one to three people you've already played, in the order they take their
  turns; everyone is seated at once. The server throws the dice. Keep dice between throws, see
  what each row would score, and score with one explicit press. Scoring on your first or second
  throw banks extra throws for later; the table says what a throw costs and what a score banks
  before you commit. Works by keyboard and on a 320px phone with four players. A turn resumes
  on any device with the same dice, and a lost reply is retried without a second roll.
  Finished tables show the full scorecard, the places, and how a tie was settled, and are
  listed under *Yatzy results*, apart from the chess tallies (#86, PR #91).
- People who have shared a Yatzy table can start chess or Fischer Random with each other from
  *Play with* (#85, #86).

### Changed

- The top bar reads "Chess & Yatzy".
- While a new game is being created, the game choice is held until the server answers, so a
  start can't be sent twice (#86).

### Development

- Sprint 7 plan and the v0.4.0 milestone (#83, PR #88).
- Yatzy rules and saved-format proof: shared scoring, Forced/Free, banked throws, turn order
  for two to four players, ranking with the token tiebreak, and the schema change rehearsed
  over existing chess records ([decision 0002](docs/decisions/0002-yatzy-format.md); #84,
  PR #89).
- Yatzy on the server: tables for two to four previous opponents in turn order, server-rolled
  dice, throws and scores with safe retries, banked throws, finished rankings and per-table
  results kept apart from chess tallies. Seats are validated wherever a game is read, played,
  counted or continued; a chess game needs both seats once active. Additive migration
  `20261111120000_yatzy_games.sql` (#85, PR #90).
- This release (#87).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- A Yatzy table stays in progress for everyone at it when someone stops playing: there is no
  leave, abandon, resign or "play again" for tables in this version.
- Everyone who has sat at a table with you can start a game with you directly, with no request
  to accept and no notification (a deliberate prototype choice, now reaching co-players too).
- Yatzy needs people you have already played: someone new joins through a chess invitation
  first.
- Other players see a throw on their next refresh (every few seconds), not as it happens.
- Guests take their turns in the order they were picked; to change it, unpick and pick again.
- Long names are shortened in the scorecard's column headers (the full name is in the standings).
- The lobby says "1 moves" for a single move, and its "Chess history" card holds both chess
  types.
- Rollback: the site can return to the v0.3.0 build, which never asks for Yatzy; tables then
  stay stored and hidden. The backend may go back to `1c0850a` (chess keeps working, tables
  are unavailable and untouched), never before the Fischer Random dispatcher (#53). The Yatzy
  migration and the unique-name index are forward-only.
- The first real chess game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

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
