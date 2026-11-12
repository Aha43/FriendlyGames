# Shared-game backend

The backend lets two players on separate devices play one chess game. It is a
Supabase Postgres database plus one Edge Function, `game-api`, which is the only
way in: clients send actions, the server checks them with the same chess rules the
app uses, and stores the result atomically.

```
browser ──HTTPS──▶ game-api (Edge Function, Deno) ──SQL──▶ Postgres
                    │ device credential check            │ RLS on, no policies,
                    │ chess.js rules (shared code)        │ no grants to anon/authenticated
```

## Runtime decision

Sprint 2 proposed Supabase Edge Functions if the existing TypeScript chess model runs
there. Checked on 2026-10-11 with Supabase CLI 2.105.0 (edge runtime, Deno 2):

- `chess.js` 1.4.0 loads from npm and plays moves.
- The app's own rules module runs unchanged. It lives in
  `supabase/functions/_shared/chess/` so deployments bundle it; the frontend imports it
  through the `@shared` alias.
- The function receives `SUPABASE_DB_URL` and connects with
  [postgres.js](https://github.com/porsager/postgres), which gives real transactions
  and row locks for the atomic checks below.

No alternative runtime is needed.

## Local setup

Requires Docker (Docker Desktop running) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
CI pins CLI 2.105.0.

```bash
supabase start          # database + API gateway + edge runtime; applies migrations
npm run test:backend    # integration tests against the running stack
supabase db reset       # recreate the database from migrations
supabase stop
```

`npm run test:backend` runs `tests/backend/` in parallel, then the migration rehearsals in
`tests/backend/migrations/` one file at a time. Those drop and recreate schema objects inside
rolled-back transactions, which would deadlock parallel signups; any new test that changes the
schema belongs there (a tooling test enforces this). Test players get random unique emails
(`uniqueSuffix` in `tests/backend/client.ts`), and setup failures name only the operation,
HTTP status and error code: never print response bodies, credentials or tokens (#60).

- Only the services the API needs run (`supabase/config.toml` disables Studio, Auth,
  Realtime, Storage, mail capture and analytics).
- Ports are in the 563xx range so the stack can run beside other local Supabase
  projects: API `http://127.0.0.1:56321`, database `127.0.0.1:56322`. The function
  is at `http://127.0.0.1:56321/functions/v1/game-api`.
- Tests can target another stack with `FG_API_URL` and `FG_DB_URL`.
- After editing function code, if a change does not show up, restart the runtime:
  `docker restart supabase_edge_runtime_friendlygames`.
- In production the function connects through the pooler secret `GAME_DB_POOLER_URL`
  (docs/deployment.md, "Database connection"). Otherwise it connects with Supabase's `SUPABASE_DB_URL`. Locally its host is the
  container name `supabase_db_<project>`, which Deno's resolver rejects because of the
  underscores, so `databaseUrl.ts` swaps in the container's alias `db.supabase.internal`.
  Hosted URLs are used unchanged. (An earlier `GAME_DB_URL` in `config.toml` was uploaded
  to production by `supabase secrets set` and broke it; never put local values in
  `[edge_runtime.secrets]`.)

## Identity: email entry (prototype)

Owner decision for the friends-only prototype (#29, superseding #27's "email never grants
access"): **entering an email opens that player.** Email ownership is not checked, so anyone
who knows a player's email can act as them. The onboarding screen says so. Verified
authentication is future work.

- `POST /players { email }` opens the player whose normalised email matches, in this browser.
  If no player has the email, it answers `404 player_not_found`; the client then asks for a
  name and sends `{ email, displayName }`, which creates the player (`201`). An existing
  player keeps their own name whatever name is sent.
- Every successful call returns a fresh **device credential** for this browser only: 32
  random bytes, base64url (43 characters). The server stores only its SHA-256 hash, in
  `player_credentials`, one row per browser. A player's other browsers stay signed in.
- The client keeps the credential in `localStorage` and sends it as `X-Device-Credential`
  on every other request; that credential, not the email, authorises reads and actions.
  If the browser's storage is cleared, entering the email again opens the same player.
- Simultaneous first entries for one new email resolve to one player: the unique email index
  lets one transaction win, the others roll back completely and join the winner's player.
- Repeating a call (e.g. after a lost response) reaches the same player again and only adds
  another credential, so the client repeats it after momentary failures like other safe
  requests. Unused credentials from lost responses are harmless.
- Email is private: it is stored apart from games and never returned to other players.
  Entering an email returns only that player (id, name, email). There is no player directory.
- A player whose email was detached (reconciling duplicates below) keeps its browsers but
  can't be entered by email; that email is never silently reattached to it.

## One player per email

Email identifies one player (#27): the database has a unique index on the normalised email
(`lower(btrim(email))`, matching how the API stores it; no provider-specific rules), so an
email entered again always reaches the same player instead of creating a second one.

The migration that adds the index (`20261018200000_unique_player_email.sql`) refuses to run
while any email is shared, with a count but no emails, so nothing is dropped or merged
silently. Reconcile existing duplicates first:

1. **Preflight** (SQL editor; shows no emails):
   ```sql
   select dense_rank() over (order by lower(btrim(c.email))) as email_group,
          left(p.id::text, 8) as player, p.created_at as signed_up,
          (select count(*) from game_participants gp where gp.player_id = p.id) as games,
          (select count(*) from game_actions a where a.player_id = p.id) as actions,
          (select count(*) from games g where g.created_by = p.id) as created_games
     from player_contacts c join players p on p.id = c.player_id
    where lower(btrim(c.email)) in (
            select lower(btrim(email)) from player_contacts group by 1 having count(*) > 1)
    order by 1, p.created_at;
   ```
2. **Decide with the owner**, per group, which player is the person's real one, on evidence
   such as which browser holds which player and which one has the games. Matching email
   alone proves nothing.
3. **Detach the email from the other player(s)** by deleting only their `player_contacts`
   row, with guards: the player keeps its row (its browser still opens it), and the statement
   refuses if that player has any games, actions or created games. Games, history and
   participant rows are never deleted or merged.
4. Run the preflight again (expect no rows), then deploy the migration.

## Unique player names

Since #76 no two players share a name. Player IDs stay the identity; names are only what
friends recognise and, from #72/#73, pick each other by. Names are not credentials.

- **The rule**, in one place, the database: trim surrounding spaces, Unicode NFC (a
  precomposed "Å" and "A" + combining ring are the same), then lowercase with ICU's Unicode
  case rules (`collate "und-x-icu"`; the database's own `C.UTF-8` collation would leave "Å"
  as it is). Index `players_display_name_unique` in
  `20261108120000_unique_player_names.sql`. Stored names keep the spelling chosen
  (capitalization, accents, inner spaces); inner spaces count ("Åse Ø" ≠ "Åse  Ø").
- **Sign-up**: a new email proposing a taken name gets `409 name_taken`, and no player, contact
  or credential is created. It never says who has the name. An existing email still opens its
  own player whatever name is typed. Two new emails racing for one name: one wins, the other
  gets `409`. One new email racing with itself (a retry): every request opens the same player.
- **Old cached pages** keep working; for a taken name they show their generic "Something went
  wrong" message instead of the specific one, and nothing is created.
- **Collisions before the migration**: `make prod-name-check` (read-only) lists players whose
  names collide by player ID, stored name, number of games and creation date, never emails.
  The migration refuses to apply while any collide (it rolls back and changes nothing), and
  `make deploy-backend` runs the check before it backs up or changes anything. Nothing is ever
  renamed, merged or deleted automatically: the owner decides each case (for example, renaming
  an old `@example.test` test player in the dashboard), then runs the check again.

## Games with previous opponents (#72)

A **previous opponent** is anyone who has had a seat in a game with you: ongoing or finished,
chess or Fischer Random, including games of a type or stored version your client cannot show.
It comes from actual seats, never from emails, names or unused invitations: someone you invited
who never joined is not one. There is no contact list, friend request or search.

- **Listing** (`GET /opponents`): each previous opponent once (by player ID), with their name,
  `sharedGames` (how many distinct games you have shared) and `lastSharedGameUpdatedAt` (the
  latest time any of those games was created, joined or had an action: a move, castle or
  resignation; it does not mean a move was played). Both count only your games with them. It is
  a list of people, so `types` does not filter it, and it never returns or decodes games. No
  emails, credentials or tokens, and nobody else's relationships.
- **Starting a game** (`POST /games` with `friendPlayerId`, instead of `friendEmail`): the server
  itself checks that you and that player share a seated game. Then it creates an active game
  with both seated: no invitation, link or acceptance step. Either player can start any number of
  games with the other, without approval (deliberate for this friends-only prototype). The other
  player finds it in their game list on the next refresh. Fischer Random draws its start once.
- **Retries**: a `requestId` stands for one exact intent: game type, target mode (email or
  player) and recipient. Reusing it for anything else is `409 request_id_reused`, before anything
  changes. This needs no migration: an email game always keeps its invitation row (with the
  invited email), and a direct game never has one; its Black seat is the chosen player.
- **Compatibility**: the email invitation path, rematches (colours swapped), old clients and
  `types` filtering are unchanged. Old clients simply never send `friendPlayerId`; a direct game
  of a type they read appears in their list like any other active game.
- **Deployment**: function only, no migration. Deploy the backend (owner, `make deploy-backend`)
  before merging the UI that uses it (#73). Rollback to the previous function is safe: games
  created directly are ordinary two-seat games every version reads.

## Games and invitations

- Creating a game seats the creator as White and returns an **invitation token** once.
  The token is stored hashed, beside the friend's email (private metadata).
- Creation takes an optional client `requestId`. If the response is lost after the
  server committed, retrying with the same ID returns the same game instead of a second
  one. Because only the token's hash is stored, the retry cannot return the lost token:
  it issues a new one and the old link stops working (`invitation` is `null` once the
  friend has joined). The same `requestId` with another friend or game type is a different
  game: `409 request_id_reused`, and nothing is changed. `POST /games/:id/invitation` does the same for the creator at any
  time while nobody has joined, e.g. from a device that never received the link. Issuing
  and redeeming lock the same invitation row, so they cannot interleave.
- The creator shares the token as a link by hand. Possession of it lets one player
  claim the Black seat, once. The seat claim is serialised with a row lock, so two
  racing players cannot both get it. The same player redeeming again gets the game back;
  anyone else gets `invitation_used`.
- **Opening while waiting (#33).** Before the friend joins, the creator may make a legal
  move if it is their colour's turn: the creator plays White, so that is the opening move.
  The game stays `waiting` (revision + 1), the invitation stays usable and the empty seat is
  then to move, so nothing else can happen until someone joins. Joining keeps the moves and
  activates the game as usual, so the friend can reply at once. Resigning while waiting is
  refused (`not_started`).
- Every game read and action requires being a participant. For anyone else, a game is
  indistinguishable from a missing one (`404 game_not_found`).

## History and rematches

- `GET /history` lists the player's finished games per game type and opponent, newest
  first, with a tally computed over all of them (not a page of recent games). Only the
  player's own games of the types the client reads appear (see Game types).
- `POST /games/:id/rematch` ("Play again") starts a new, active game for the same two
  players with colours swapped. No invitation is needed. `games.rematch_of` is unique,
  so whichever player asks first creates it and the other is given the same game; each
  game view carries `rematchGameId`.
- Finished games are archived records: a database trigger
  (`keep_finished_games_unchanged`) rejects any update to a game whose status is
  `finished`, so neither a bug nor a direct SQL update can rewrite history.

## Actions, revisions and retries

Each game has a `revision` that increases by one with every change (join, move,
resignation). An action names the revision it was based on and a client-generated
`requestId`. In one transaction the server:

1. locks the game row (actions on a game are serialised),
2. if this player already used `requestId` on this game: returns the current game with
   `duplicate: true` when it was the same action, or `409 request_id_reused` otherwise,
3. rejects a stale `expectedRevision` with `409 stale_revision` and the current game,
4. rejects games that are over (`game_finished`); while waiting, rejects anything but a move by
   the creator (`not_started`; see "Opening while waiting"),
5. for anything but a resignation: checks the action has the game type's shape, that it
   is the player's turn and that the type's adapter accepts it (for standard chess,
   by replaying the stored moves with chess.js; a promotion must name its piece, and only a
   promotion may),
6. stores the new move list, revision and any outcome, and records the action.

So two actions at the same revision yield exactly one accepted update, and a retried
request after a timeout never plays a move twice.

Outcomes are derived from the moves: checkmate, stalemate, insufficient material,
threefold repetition and the fifty-move rule end the game automatically. Resignation
ends it as a win for the other player. Draw offers, undo and clocks are deferred.

## Game types (#53)

The common service (`game-api/api.ts`) owns players, credentials, membership, invitations,
transactions and row locks, revisions, request IDs, results, archives, rematches and
history. A small adapter per stored `(game_type, schema_version)` owns that type's start,
saved payload, actions, turn, move count, view and outcome (`game-api/gameTypes.ts`). A
static registry picks the adapter from the stored row; nothing falls back to chess.

- **Types**: `chess` (schema 1, chess.js, unchanged), `chess960`, Fischer Random
  (schema 1, chessops; #54, see below) and `yatzy` (schema 1; #85, see below). The web client
  offers the two chess types since #55.
- **Which types a client reads**: every game request may carry `?types=chess,chess960`.
  Omitted means `chess` only, which is what every client before #53 expects (it reads
  `.chess.moves`). Unknown names are ignored. This is compatibility metadata, never
  authorization: membership rules are unchanged.
- **Lists and history** leave out games the client does not read, and games no adapter
  on this server reads (an unknown type or schema version). A mixed lobby still loads.
- **Direct requests** (`GET /games/:id`, actions, rematch, invitation renewal and redeem,
  and a creation retry whose request ID finds such a game) get `422 unsupported_game` before anything is written or returned; the
  record is kept as it is. For a non-participant it stays `404 game_not_found`.
- **Creation** takes an optional `type` (omitted means `chess`); a type that is not
  enabled, or that the client does not read, gets `400 unsupported_game_type`.
- **A request ID** found again is compared with what the request asks for, before the turn,
  revision or rules are looked at (see Actions): a retry may arrive after the game moved on.
- Each adapter belongs to a **family**. `chess`: White/Black seats, white/black/draw results,
  email or single-opponent creation, resignation, rematch and per-opponent history. `table`
  (Yatzy): ordered seats `p1`–`p4`, a roster of previous opponents, one ranking per table and
  none of those chess flows. See [game-types.md](game-types.md).

## Yatzy tables (#85)

Yatzy is the first game that is not chess-family: a **table** of two to four players in turn
order, with one ranking for everyone at it. Rules, record and the reasons are in
[decision 0002](decisions/0002-yatzy-format.md); the rules module is
`supabase/functions/_shared/yatzy/rules.ts`. Only clients that ask for `types=…,yatzy` see or
create tables. The web client does since #86.

- **Creating** (`POST /games` with `type: "yatzy"`, `mode`, `friendPlayerIds`): the host and one
  to three **previous opponents**, each checked on the server exactly as for a direct chess
  start. All are seated at once as `p1` (the host), `p2`… in the order given, the table is
  `active` immediately and there is no invitation. Names, emails and repeated or unknown IDs are
  refused; yourself, an unknown ID and a stranger all get the same `404 opponent_not_found`.
  A `requestId` stands for the type, mode and ordered roster; anything else under the same ID is
  `409 request_id_reused`.
- **Throwing** (`{ type: "throw", keep: [positions] }`): the server rolls. The first throw of a
  turn rolls five dice; a later one keeps the named positions (0–4, at most four) and rolls the
  rest. The fourth and later throws of a turn each spend one banked token, and are refused
  without one. The dice, kept positions and throw number are saved with the action. A request
  that carries dice, points or tokens is refused (`400`), never trusted or ignored.
- **Scoring** (`{ type: "score", row }`): needs at least one throw. The server calculates the
  points from the saved dice, banks 2, 1 or 0 tokens for scoring on the first, second or third
  throw (nothing after a paid throw), and passes the turn or finishes the table, all in one
  commit. Forced mode takes only the next row on the card; Free any empty row.
- **Retries**: as for every action, a request ID seen before is compared with what the request
  asks for (the kept positions, or the row) before the revision, turn or rules. The same
  intent gets the current table with `duplicate: true`: the committed dice, no new roll, no
  second token or score. A different intent under that ID is `409 request_id_reused`.
- **Turns and membership**: only the seated player whose turn it is may act (`409
  not_your_turn`); a stale `expectedRevision` gets `409 stale_revision` with the current table;
  anyone not seated gets `404 game_not_found`.
- **What everyone seated sees** on their usual refresh (`GET /games`, `GET /games/:id`): the
  mode, the seats with names, whose turn it is, the latest committed throw (dice, kept
  positions, throw number), every player's scores, bonus, total and tokens, and, once finished,
  the standings (by total, then unused tokens; equal on both share a place) and the winners.
- **Finished**: `result: "scored"`, `termination: "scorecards-complete"`, frozen like every
  finished game. `GET /history` lists finished tables under `tables`, each with its own
  ranking. They never enter the per-opponent chess tallies under `history`, which stay pairwise
  and chess-family only.
- **Not for tables**: resigning, "Play again", and renewing or redeeming an invitation get
  `422 unsupported_action`, before anything is written. A table someone stops playing stays in progress (accepted for v0.4.0).
- **Previous opponents**: everyone seated at a table becomes a previous opponent of everyone
  else there (owner's decision), so two guests may afterwards start chess, Fischer Random or a
  table with each other.
- **Seats are validated** wherever a game is read, played, counted or continued: lists, single
  reads, actions, history tallies, finished tables, rematches and invitation renewal and
  redeem. A chess-family game holds only White while its invitation is open (`waiting`) and
  exactly White and Black once active or finished. A table needs a record the rules can
  replay, exactly `p1`…`pN` for its `N` players, and its creator (the host) in `p1`. A game that
  does not fit (only possible by writing rows outside this API) is left out of lists and
  tallies and gets `409 invalid_seats` on direct requests, untouched. One such row never breaks
  a player's list.
- **Finished tables** in `GET /history` are selected as finished by the query (newest 200), so
  unfinished tables never crowd a result out.
- **Deployment**: migration `20261111120000_yatzy_games.sql` (widens checks only; no existing
  row changes) and the function, by the owner with `make deploy-backend`, before the UI that
  offers Yatzy (#86) merges. Until then no client asks for Yatzy and nothing changes for
  players. **Rollback** of the function is supported to `1c0850a` (#72), where chess keeps
  working and tables are simply unavailable (rehearsed in #84); never before the #53
  dispatcher. Keep the migration: it is forward-only and harmless to `1c0850a`.

## Fischer Random (Chess960, #54)

Rules and format: [decision 0001](decisions/0001-chess960-engine.md) and
[game-types.md](game-types.md).

- **Start**: drawn by the server once per new game, uniformly from the 960 starts, and saved
  with the game before the reply. Retried creations, joins, refreshes and concurrent rematches
  read the saved start; nothing rerolls it. "Play again" is Chess960 again, with a new start
  (which may by chance be the same one), colours swapped.
- **Saved** like chess: `payload = { initialFen, moves }`, the version in `schema_version`.
  `initialFen` is Shredder-FEN (castling rights name the rooks' files, e.g. `HAha`); moves are
  UCI, a castle as the king onto its own rook (`b1h1`).
- **Actions**: `move` as for chess, plus `{ "type": "castle", "side": "kingside" | "queenside" }`.
  Kingside is the rook to the king's right (higher file), wherever it started. A `move` that
  would castle (two squares, or onto its own rook) is refused with `use_castle_action`, so a
  king step is never a castle by accident; Kb1→c1 is a step even though O-O-O also ends there.
- **Stored actions**: a castle is `kind = 'castle'`, `move` = its king-onto-rook UCI. A retried
  castle is recognised by its side, read from that saved move (the rook to the right of the
  king's start means kingside), not by resolving the castle again on the current board.
- **Outcomes** as for chess: checkmate, stalemate, insufficient material, threefold
  repetition (castling rights count) and the fifty-move rule end the game; resignation too.
- A view carries `chess960: { initialFen, moves, turn }` instead of `chess`.

## API

Base URL: `<project>/functions/v1/game-api`. Requests and responses are JSON. All
endpoints except `GET /health` and `POST /players` need `X-Device-Credential`. All game
endpoints accept the `types` query parameter described under Game types.

| Method and path | Body | Success |
|---|---|---|
| `GET /health` | | `200 { ok: true, commit, pooled }` (no credential; checks the database; `pooled` says whether the connection pooler is used) |
| `POST /players` | `{ email, displayName? }` | `200 { player: { id, displayName, email }, deviceCredential, created: false }` for an existing player; `201 { …, created: true }` for a new email with `displayName`; `404 player_not_found` for a new email without it; `409 name_taken` when another player has that name (#76; nothing is created) |
| `GET /me` | | `200 { player: { id, displayName, email } }` |
| `POST /games` | `{ friendEmail, requestId?, type? }` | `201 { game, invitation: { token }, duplicate: false }`; a retry with the same `requestId` gets `200 { game, invitation, duplicate: true }` |
| `POST /games` (previous opponent, #72) | `{ friendPlayerId, requestId?, type? }` | `201 { game, invitation: null, duplicate: false }`: an **active** game, creator White, opponent Black, White to move; a retry with the same `requestId` gets `200 { …, duplicate: true }`; `404 opponent_not_found` for yourself, an unknown ID or anyone you have no seated game with (one answer for all); `400` if both or neither target is given |
| `GET /opponents` (#72) | | `200 { opponents: [{ id, displayName, sharedGames, lastSharedGameUpdatedAt }] }`, newest shared activity first |
| `POST /games/:id/invitation` | | `200 { game, invitation: { token } }` (creator only, game still waiting) |
| `POST /invitations/redeem` | `{ token }` | `200 { game }` |
| `GET /games` | | `200 { games: [game…] }` (newest activity first, at most 200) |
| `GET /games/:id` | | `200 { game }` |
| `GET /history` | | `200 { history: [{ gameType, opponent, wins, draws, losses, games: [{ id, finishedAt, outcome, termination, yourSeat, moveCount }] }] }` (chess family only); with `yatzy` in `types` also `tables: [{ id, gameType, finishedAt, yourSeat, players, result: { yatzy } }]` |
| `POST /games` (Yatzy table, #85) | `{ type: "yatzy", mode: "forced"\|"free", friendPlayerIds: [1–3 IDs], requestId? }` | `201 { game, invitation: null, duplicate: false }`: an **active** table, host `p1`, guests `p2`… in the order given; retry `200 { …, duplicate: true }`; `404 opponent_not_found`; `400` for a malformed roster or mode |
| `POST /games/:id/rematch` | | `201 { game, duplicate: false }`, or `200 { game, duplicate: true }` if it already exists |
| `POST /games/:id/actions` | `{ requestId, expectedRevision, action }` | `200 { game, duplicate }` |

`action` is `{ "type": "move", "from": "e2", "to": "e4", "promotion"?: "q"|"r"|"b"|"n" }`,
`{ "type": "castle", "side": "kingside"|"queenside" }` (Chess960 only) or `{ "type": "resign" }`
(chess family). For a Yatzy table it is `{ "type": "throw", "keep": [0–4…] }` or
`{ "type": "score", "row": "ones"|…|"yatzy" }`, with no other fields.
`requestId` is a UUID.

A **game** looks like:

```json
{
  "id": "…uuid…",
  "type": "chess",
  "schemaVersion": 1,
  "status": "waiting | active | finished",
  "result": "white | black | draw | null",
  "termination": "checkmate | resignation | stalemate | insufficient-material | threefold-repetition | fifty-move-rule | null",
  "revision": 3,
  "createdAt": "…", "updatedAt": "…",
  "players": { "white": { "id": "…", "displayName": "Arne" }, "black": null },
  "yourSeat": "white",
  "turn": "white",
  "moveCount": 2,
  "chess": { "initialFen": "…", "moves": ["e2e4", "c7c5"], "turn": "white" },
  "rematchGameId": null
}
```

`turn` and `moveCount` are present for every type. `chess` is present for standard
chess only; another type will carry its own field.

Errors are `{ "error": { "code", "message", … } }`:

| Status | Codes |
|---|---|
| 400 | `bad_request` (invalid body or fields, or an action of another game type), `unsupported_game_type` |
| 401 | `unauthenticated` (missing or unknown credential) |
| 403 | `not_creator` |
| 404 | `not_found`, `player_not_found`, `game_not_found`, `invitation_not_found` |
| 409 | `stale_revision` (includes `game`), `not_your_turn`, `not_started`, `not_finished`, `game_finished`, `invitation_used`, `already_participant`, `request_id_reused` |
| 413 | `too_large` |
| 422 | `illegal_move`, `illegal_castle`, `use_castle_action` (Chess960), `unsupported_game` (a game this server or client cannot read) |

## Web client

- Routes are hash-based (`#/`, `#/game/<id>`, `#/join/<token>`, `#/local`). The part
  after `#` is never sent to a server, so invitation tokens stay out of hosting and
  server logs; after joining, the join URL is replaced in browser history.
- The device credential and the creator's unredeemed invitation tokens live in
  `localStorage`; the app never logs them, and Playwright runs without traces,
  screenshots or HTML reports so they do not end up in test artifacts.
- A shared game polls every 4 seconds while visible and refreshes on return to the page.
  A move shows as "saving" until the server confirms it. On a network or server failure
  the outcome is unknown: the page says it couldn't confirm whether the move was saved,
  shows the last confirmed position and offers Retry, which resends the same request ID
  and revision, so a request that did arrive is not applied twice. Game creation works
  the same way.
- Momentary server failures are repeated automatically, at most twice (after 0.4 s and
  1.2 s), only for requests the server deduplicates or that change nothing: reads, actions
  (request ID), game creation (request ID), joining, rematch, invitation renewal and email
  entry (a repeat reaches the same player), after network errors and 500/502/503/504.
  Timeouts are not repeated.
- When polling shows the server has moved past an unconfirmed action's revision, the page
  resolves it: cleared if the server's next move is that move (or the player's resignation),
  otherwise reported as the game changing first.
- A stale revision (another tab or device moved first) replaces the board with the
  server's game and says so. There is no offline move queue.
- Every game request names the types the client can show (`src/games/registry.ts`, sent as
  `types`). The lobby uses the common `turn` and `moveCount`; the game page is the
  chess-family presenter. A game it cannot show (`unsupported_game`, or a type it does not
  know) is explained with "needs a newer version… Reload the page", never drawn as chess.

## Data model

Migrations live in `supabase/migrations/`.

| Table | Holds |
|---|---|
| `players` | id, display name, `credential_hash` (the first browser's; kept for compatibility with the previous function version, not used for authentication) |
| `player_credentials` | one SHA-256 credential hash per browser that entered the player's email |
| `player_contacts` | private email per player |
| `games` | envelope: type, schema version, status, result, termination, revision, timestamps, `payload` (chess family: `{ initialFen, moves }`; Yatzy: `{ mode, players, log }`), `create_request_id`, `rematch_of` |
| `game_participants` | game, player, seat (`white`/`black`, or `p1`–`p4` at a table; unique per game and per player) |
| `game_invitations` | token hash, seat, invited email, redemption |
| `game_actions` | every accepted move, castle, resignation, throw and score with request ID and resulting revision |

All tables have row level security enabled without policies, and privileges are
revoked from `anon` and `authenticated`. The Supabase REST and GraphQL APIs therefore
expose nothing; tests assert both roles are denied.

## Not covered yet

- Verified authentication: email entry trusts whoever types the email (see Identity).
- No rate limiting or abuse protection; acceptable for a friends-only prototype, to revisit
  before wider use.
- CORS: production allows only `ALLOWED_ORIGINS` (the site); locally any origin. The API
  uses a custom header, not cookies, so CORS is defence in depth, not authentication.
- Deployment: docs/deployment.md.
