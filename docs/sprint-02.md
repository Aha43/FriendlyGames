# Sprint 2 — Across the table from Harald

## Result

Arne and Harald open a deployed URL on separate devices, create and join a chess
game, exchange legal moves, close and resume it, and retain the completed game in
their shared history. The current autumn table remains the playing surface.

## Product decisions for the prototype

- Name and email onboarding, no verified login and no automated email sending.
- Email is private contact metadata, never a password or proof of ownership.
- A random device credential identifies a returning player. Persist only its hash
  on the server; keep service credentials on the server. No global player directory.
- Creating a game uses the friend's email and returns a manually shareable,
  unguessable invitation. Redeeming it once assigns the invited seat to the joining
  player. Possession of that invitation authorizes joining; email is unverified.
- Creator plays White, friend Black. One-on-one, untimed chess only.
- Device credentials authorize reads and actions only for that player's games.
  A game ID or email alone must not permit reads, moves or seat takeover.
- Losing browser storage loses device identity. This sprint must explain that
  limit honestly; do not silently recover an existing identity by typing its email.
  Cross-device account recovery and identity transfer remain deferred.
- Shared games are authoritative on the server. Never upload the existing local
  game automatically. Retain local play as an explicitly separate mode.
- Use modest polling while a shared game is visible, plus refresh on return to
  the page. Show saving, stale/conflict, offline and retry states without claiming
  an unacknowledged move was saved. No offline move queue in this sprint.
- Keep the current automatic threefold/50-move draw policy explicit. Resignation
  is included; draw offers, undo, clocks and formal tournament rules are deferred.

## Proposed implementation

Use Supabase Postgres for shared storage and a small server-side API, preferably
Supabase Edge Functions if the existing TypeScript chess model works there. The
first issue confirms that runtime and documents any necessary alternative.
Clients submit actions, never arbitrary replacement game records. Deny direct
client writes to game, identity and invitation tables. Store private contacts
separately from game payloads returned to players.

The common game envelope includes schema version, ID, type, participant IDs and
seats, timestamps, status/result and revision. The chess payload preserves initial
FEN and ordered moves. The server derives position, turn and outcome with chess.js.
Apply moves and resignations atomically against expected revision, with a request
ID so retrying a timed-out request cannot create a duplicate action. Joining also
needs atomic seat assignment. Finished games cannot accept more moves.

Keep migrations and real-backend integration tests in this repository. Use an
isolated local/test Supabase instance for CI, never production data. No cloud
resource or paid service needs to be created just to implement the first issue.

## Ordered coding issues

### 1. Establish shared-game backend and its contract

Implement migrations, device identity, create/join/list/read game actions and
server-validated move/resign actions. Document setup, API and recovery limits.
Acceptance uses the real backend: two credentials can join and exchange moves;
an unrelated credential cannot read or mutate their game; invitation cannot be
used to take over a joined seat; illegal/out-of-turn moves are rejected; two
requests at one revision yield exactly one accepted update; retried request IDs
do not duplicate actions; complete move history and results survive reload.
Include tests for resignation and replay-derived terminal outcomes. CI runs the
integration checks from a fresh database with repository migrations applied.

### 2. Connect onboarding, game list and the playing table

Build name/email onboarding, remembered identity, ongoing games, create invitation,
copy-link sharing and join flow. Wire the existing table to the API, including
polling, status and resign confirmation. Route local play separately. Acceptance:
two independent browser contexts create/join, alternate moves, refresh/resume and
observe each other's updates. Stale revisions refresh safely; a network failure
preserves the last confirmed state and offers a usable retry. Invitations and
device secrets must not appear in logs or test reports. Preserve phone and keyboard
usability and promotion focus behavior.

### 3. Keep the shared chess history

Show real completed games for the two participants, dates, results and win/draw
tally. Reopen a completed game read-only with move history and a way to inspect
positions. Play again creates a distinct game with the same participants, without
requiring the friend to redeem another invitation. Acceptance: finish games through
checkmate and resignation, reopen them after refresh, and verify exact tally and
unchanged past records. Sample history stays confined to explicit local/demo mode.

### 4. Deploy and play with Harald

Confirm frontend hosting compatible with the private repository and selected
backend; document environments, migrations, secrets, deployment and rollback.
Prepare the deployment before requesting approval to provision resources or publish.
Verify the deployed app with two independent sessions through onboarding, joining,
moves, refresh, finish and history on desktop and phone. Record the actual deployed
version and limits. The owner and Harald's real game is the final milestone test;
automation cannot stand in for that acceptance.

## Outside this sprint

Walkable park, friends waving, other games, teams, verified authentication,
notifications, automated invitations, account recovery, public visibility and
project licensing. See future-ideas.md for the park concepts.
