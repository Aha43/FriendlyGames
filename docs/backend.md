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

## Games and invitations

- Creating a game seats the creator as White and returns an **invitation token** once.
  The token is stored hashed, beside the friend's email (private metadata).
- Creation takes an optional client `requestId`. If the response is lost after the
  server committed, retrying with the same ID returns the same game instead of a second
  one. Because only the token's hash is stored, the retry cannot return the lost token:
  it issues a new one and the old link stops working (`invitation` is `null` once the
  friend has joined). `POST /games/:id/invitation` does the same for the creator at any
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

- `GET /history` lists the player's finished chess games per opponent, newest first,
  with a tally computed over all of them (not a page of recent games). Only the
  player's own games appear; scores are per game type.
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
5. for a move: checks it is the player's turn and that the move is legal by replaying
   the stored moves with chess.js; a promotion must name its piece, and only a
   promotion may,
6. stores the new move list, revision and any outcome, and records the action.

So two actions at the same revision yield exactly one accepted update, and a retried
request after a timeout never plays a move twice.

Outcomes are derived from the moves: checkmate, stalemate, insufficient material,
threefold repetition and the fifty-move rule end the game automatically. Resignation
ends it as a win for the other player. Draw offers, undo and clocks are deferred.

## API

Base URL: `<project>/functions/v1/game-api`. Requests and responses are JSON. All
endpoints except `GET /health` and `POST /players` need `X-Device-Credential`.

| Method and path | Body | Success |
|---|---|---|
| `GET /health` | | `200 { ok: true, commit, pooled }` (no credential; checks the database; `pooled` says whether the connection pooler is used) |
| `POST /players` | `{ email, displayName? }` | `200 { player: { id, displayName, email }, deviceCredential, created: false }` for an existing player; `201 { …, created: true }` for a new email with `displayName`; `404 player_not_found` for a new email without it |
| `GET /me` | | `200 { player: { id, displayName, email } }` |
| `POST /games` | `{ friendEmail, requestId? }` | `201 { game, invitation: { token }, duplicate: false }`; a retry with the same `requestId` gets `200 { game, invitation, duplicate: true }` |
| `POST /games/:id/invitation` | | `200 { game, invitation: { token } }` (creator only, game still waiting) |
| `POST /invitations/redeem` | `{ token }` | `200 { game }` |
| `GET /games` | | `200 { games: [game…] }` (newest activity first, at most 200) |
| `GET /games/:id` | | `200 { game }` |
| `GET /history` | | `200 { history: [{ gameType, opponent, wins, draws, losses, games: [{ id, finishedAt, outcome, termination, yourSeat, moveCount }] }] }` |
| `POST /games/:id/rematch` | | `201 { game, duplicate: false }`, or `200 { game, duplicate: true }` if it already exists |
| `POST /games/:id/actions` | `{ requestId, expectedRevision, action }` | `200 { game, duplicate }` |

`action` is `{ "type": "move", "from": "e2", "to": "e4", "promotion"?: "q"|"r"|"b"|"n" }`
or `{ "type": "resign" }`. `requestId` is a UUID.

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
  "chess": { "initialFen": "…", "moves": ["e2e4", "c7c5"], "turn": "white" },
  "rematchGameId": null
}
```

Errors are `{ "error": { "code", "message", … } }`:

| Status | Codes |
|---|---|
| 400 | `bad_request` (invalid body or fields) |
| 401 | `unauthenticated` (missing or unknown credential) |
| 403 | `not_creator` |
| 404 | `not_found`, `player_not_found`, `game_not_found`, `invitation_not_found` |
| 409 | `stale_revision` (includes `game`), `not_your_turn`, `not_started`, `not_finished`, `game_finished`, `invitation_used`, `already_participant`, `request_id_reused` |
| 413 | `too_large` |
| 422 | `illegal_move` |

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

## Data model

Migrations live in `supabase/migrations/`.

| Table | Holds |
|---|---|
| `players` | id, display name, `credential_hash` (the first browser's; kept for compatibility with the previous function version, not used for authentication) |
| `player_credentials` | one SHA-256 credential hash per browser that entered the player's email |
| `player_contacts` | private email per player |
| `games` | envelope: type, schema version, status, result, termination, revision, timestamps, `payload` (`{ initialFen, moves }`), `create_request_id`, `rematch_of` |
| `game_participants` | game, player, seat (unique per game and per player) |
| `game_invitations` | token hash, seat, invited email, redemption |
| `game_actions` | every accepted move/resignation with request ID and resulting revision |

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
