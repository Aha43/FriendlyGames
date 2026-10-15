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
- Locally the function reaches Postgres through `GAME_DB_URL` (set in
  `config.toml` to the `db.supabase.internal` network alias). Deno's resolver rejects
  the default `supabase_db_<project>` hostname because of its underscores. Hosted
  Supabase does not need this; there the function uses `SUPABASE_DB_URL`.

## Identity

- `POST /players` creates a player and returns a **device credential**: 32 random
  bytes, base64url (43 characters). The server stores only its SHA-256 hash.
- The client keeps the credential on the device and sends it as
  `X-Device-Credential` on every other request.
- Email is private contact metadata. It is stored apart from games, is never returned
  to other players and proves nothing about who someone is.
- There is no login and no player directory.

### Losing the credential

The credential is the player's only key. If the browser's storage is cleared, the app
is reinstalled, or the player switches device, that identity and its games cannot be
reached again. Typing the same email does **not** recover it; that would let anyone
who knows an email take over a player. Recovery and moving an identity between devices
are deferred beyond Sprint 2. The app must explain this limit plainly (#9).

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
4. rejects games that are waiting (`not_started`) or over (`game_finished`),
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
endpoints except `POST /players` need `X-Device-Credential`.

| Method and path | Body | Success |
|---|---|---|
| `GET /health` | | `200 { ok: true, commit }` (no credential; checks the database) |
| `POST /players` | `{ displayName, email }` | `201 { player: { id, displayName, email }, deviceCredential }` |
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
| 404 | `not_found`, `game_not_found`, `invitation_not_found` |
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
  (request ID), game creation (request ID), joining, rematch and invitation renewal, after
  network errors and 500/502/503/504. Timeouts are not repeated. Sign-up has no request ID and
  is **never** repeated automatically, since no error status proves it was not applied; the
  player is told and can press Continue again.
- When polling shows the server has moved past an unconfirmed action's revision, the page
  resolves it: cleared if the server's next move is that move (or the player's resignation),
  otherwise reported as the game changing first.
- A stale revision (another tab or device moved first) replaces the board with the
  server's game and says so. There is no offline move queue.

## Data model

Migrations live in `supabase/migrations/`.

| Table | Holds |
|---|---|
| `players` | id, display name, credential hash |
| `player_contacts` | private email per player |
| `games` | envelope: type, schema version, status, result, termination, revision, timestamps, `payload` (`{ initialFen, moves }`), `create_request_id`, `rematch_of` |
| `game_participants` | game, player, seat (unique per game and per player) |
| `game_invitations` | token hash, seat, invited email, redemption |
| `game_actions` | every accepted move/resignation with request ID and resulting revision |

All tables have row level security enabled without policies, and privileges are
revoked from `anon` and `authenticated`. The Supabase REST and GraphQL APIs therefore
expose nothing; tests assert both roles are denied.

## Not covered yet

- No rate limiting or abuse protection beyond unguessable secrets; acceptable for a
  friends-only prototype, to revisit before wider use.
- CORS: production allows only `ALLOWED_ORIGINS` (the site); locally any origin. The API
  uses a custom header, not cookies, so CORS is defence in depth, not authentication.
- Deployment: docs/deployment.md.
