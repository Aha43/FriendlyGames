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
- The creator shares the token as a link by hand. Possession of it lets one player
  claim the Black seat, once. The seat claim is serialised with a row lock, so two
  racing players cannot both get it. The same player redeeming again gets the game back;
  anyone else gets `invitation_used`.
- Every game read and action requires being a participant. For anyone else, a game is
  indistinguishable from a missing one (`404 game_not_found`).

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
| `POST /players` | `{ displayName, email }` | `201 { player: { id, displayName, email }, deviceCredential }` |
| `GET /me` | | `200 { player: { id, displayName, email } }` |
| `POST /games` | `{ friendEmail }` | `201 { game, invitation: { token } }` |
| `POST /invitations/redeem` | `{ token }` | `200 { game }` |
| `GET /games` | | `200 { games: [game…] }` (newest activity first, at most 200) |
| `GET /games/:id` | | `200 { game }` |
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
  "chess": { "initialFen": "…", "moves": ["e2e4", "c7c5"], "turn": "white" }
}
```

Errors are `{ "error": { "code", "message", … } }`:

| Status | Codes |
|---|---|
| 400 | `bad_request` (invalid body or fields) |
| 401 | `unauthenticated` (missing or unknown credential) |
| 404 | `not_found`, `game_not_found`, `invitation_not_found` |
| 409 | `stale_revision` (includes `game`), `not_your_turn`, `not_started`, `game_finished`, `invitation_used`, `already_participant`, `request_id_reused` |
| 413 | `too_large` |
| 422 | `illegal_move` |

## Data model

Migrations live in `supabase/migrations/`.

| Table | Holds |
|---|---|
| `players` | id, display name, credential hash |
| `player_contacts` | private email per player |
| `games` | envelope: type, schema version, status, result, termination, revision, timestamps, `payload` (`{ initialFen, moves }`) |
| `game_participants` | game, player, seat (unique per game and per player) |
| `game_invitations` | token hash, seat, invited email, redemption |
| `game_actions` | every accepted move/resignation with request ID and resulting revision |

All tables have row level security enabled without policies, and privileges are
revoked from `anon` and `authenticated`. The Supabase REST and GraphQL APIs therefore
expose nothing; tests assert both roles are denied.

## Not covered yet

- No rate limiting or abuse protection beyond unguessable secrets; acceptable for a
  friends-only prototype, to revisit before wider use.
- CORS allows any origin. The API uses a custom header, not cookies, so this does not
  let other sites act as a player.
- Production deployment (#11): set no `GAME_DB_URL` there, confirm the `_shared` code is
  bundled on the first deploy, and keep the service connection only in the function.
