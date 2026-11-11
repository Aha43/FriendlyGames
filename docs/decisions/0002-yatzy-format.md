# 0002 — Yatzy rules, saved format and group tables

Status: **proposed** for review (#84). Date: 2026-11-11. Owner, Codex and Claude decide. This
document enables nothing by itself. The schema change is a rehearsed proposal outside
`supabase/migrations`, and no API or UI exposes Yatzy yet.

## Decision in one paragraph

**Rules.** Yatzy rules live in one dependency-free module,
`supabase/functions/_shared/yatzy/rules.ts`, shared by the server and the browser like the
chess rules. They follow the agreed Norwegian card and the owner's house rules
([Sprint 7](../sprint-07.md)).

**Record.** A table is saved as `games.payload = { schemaVersion: 1, mode, players, log }`.
The `log` lists every throw, with the positions kept and the five dice it produced, and every
scored row. Replaying the log rebuilds every score, token balance and turn, and the turn in
progress. The server rolls the dice; the record stores them, so replay never rolls.

**Schema.** The change only widens checks:
- a third game type `yatzy`
- ordered seats `p1`–`p4` next to `white`/`black`
- `throw` and `score` actions, with their intent as notation
- a finished-table result `scored` with termination `scorecards-complete`

No table, column or existing row changes. Chess tallies stay pairwise. Yatzy results are
ranked per table from the payload. Co-players at a table become previous opponents through the
existing seat rows, which is the owner's decision.

## Rules module (proved)

The rules follow the scorecard and house rules in [docs/sprint-07.md](../sprint-07.md):
- fifteen rows, with pairs and sets summing only the matching dice
- full house and chance summing all five dice, straights a fixed 15 or 20, Yatzy 50
- a bonus of 50 at 63
- Forced or Free order
- tokens: banking 2/1/0 tokens for scoring on throw 1/2/3, and spending one token per throw
  after the third
- two to four players in seat order
- ranking by total, then unused tokens; players equal on both are joint winners

The module has these parts:
- `scoreRow(row, dice)`, `total`, `upperBonus` and `tokensBanked`
- `applyThrow(record, keep, roll)`: `roll(n)` supplies `n` new dice, while kept positions keep
  their dice
- `applyScore(record, row)`
- `replay(record)`: checks the record and every entry and rejects bad input with a structured
  error rather than guessing or throwing. That covers a tampered log (a kept die that changed,
  a seventh face) and a malformed record (an unknown mode, a player count that isn't a whole
  number from 2 to 4, a missing or null entry).
- `openRows`, `throwCost` and `preview`: what the table may show before a commit
- `standings` and `winners`

The rules are deterministic for given dice, and `roll` is the only source of chance. 61 tests
in `rules.test.ts` cover:
- every row, with zero entries, five equal dice, straights and full house edge cases
- the bonus at 63 and not at 62
- both modes
- scoring after one, two and three throws
- a refused fourth throw without tokens
- spending four tokens on one turn
- 2, 3 and 4 players
- a tie on points broken by tokens, and joint winners on both
- a mid-turn resume from a JSON round trip, and a finished game rebuilt from its record alone
- tampered and malformed records, rejected without throwing

Deterministic fixtures live in `fixtures.ts`, which is test code only.

## Saved record

```jsonc
{ "schemaVersion": 1, "mode": "forced" | "free", "players": 3,
  "log": [ { "t": "throw", "keep": [], "dice": [5, 1, 3, 1, 1] },
           { "t": "throw", "keep": [1, 3, 4], "dice": [6, 1, 2, 1, 1] },
           { "t": "score", "row": "ones" } ] }
```

- The log is the whole game. The turn in progress is everything after the last score: the dice,
  the kept positions and the throw number. That is enough to resume on any device and to show
  spectators the latest committed throw.
- Players are seat indexes. Seat `p1` is index 0, the host, and turn order is seat order. Seats
  are rows in `game_participants`, and the API checks that `players` equals the number of seats.
- Tokens are not stored. They follow from the log.

## Storage change (proposal)

The proposal is [`supabase/proposals/yatzy_games.sql`](../../supabase/proposals/yatzy_games.sql);
#85 copies it into `supabase/migrations` after review.

| Constraint | Today | Proposed |
| --- | --- | --- |
| `games_game_type_check` | chess, chess960 | + `yatzy` |
| `games_result_check` | white, black, draw | + `scored` (the ranking comes from the payload) |
| `games_termination_check` | six chess endings | + `scorecards-complete` |
| `game_participants_seat_check` | white, black | + `p1`–`p4`; primary key `(game_id, seat)` and `unique (game_id, player_id)` unchanged |
| `game_actions_kind_check` | move, resign, castle | + `throw`, `score` |
| `game_actions_move_check` | chess UCI only | the same pattern for move/castle; `keep:` plus the sorted kept positions (at most four) for throws; `row:<row>` for scores; null for resign |
| `move_has_notation` | move/castle have notation | + throw/score |

These stay unchanged:
- invitations: White/Black only, since Yatzy tables have none
- `finished_has_result`
- the finished-game freeze trigger
- RLS
- creation request IDs
- every chess row

Nothing in the database checks that a seat matches its table's type (chess seats on chess,
`p1`–`p4` on Yatzy). The API enforces that when it seats players, as it already does for the
White/Black pair. Codex's review of #84 recommends keeping it there. #85 validates each seat's
type, the seat count against `players`, and the order (`p1` the host, then `p2`… with no gaps)
in the API, with integration tests. A trigger stays possible later if that proves
insufficient.

## API for #85 (proposed)

These use today's contracts, applied unchanged, from the shared boundary in
[game-types.md](../game-types.md):

- **Create:** `POST /games?types=…,yatzy { type: "yatzy", mode, friendPlayerIds: [1–3 distinct
  ids], requestId }`.
  - The host takes `p1` and the guests follow in selection order.
  - The table starts `active`; there are no invitations.
  - Each guest must pass today's direct-start check: the host has sat at a game with them.
  - The existing `(created_by, create_request_id)` deduplication covers retries. The intent is
    the type, the mode and the ordered roster; a different intent with the same ID returns
    `409 request_id_reused`.
- **Act:** `POST /games/:id/actions { requestId, expectedRevision, action: { type: "throw",
  keep: [...] } | { type: "score", row } }`. The existing path is unchanged:
  - the row lock, then request-ID recognition before the revision and rules
  - `stale_revision` with the current game
  - the `not_your_turn` check through `adapter.turn(payload)`, which returns `p1`–`p4`
  - one revision per action and an action row
  - The server rolls new dice with `crypto.getRandomValues` (unbiased) and saves them with the
    throw.
  - A retried throw (same request ID, same `keep:`) returns the current view, whose log holds
    the committed dice. It never rolls again.
- **Not for Yatzy:** resign, rematch and invitation endpoints are refused for Yatzy. The common
  resign branch must ask the adapter first. Leaving a table is the accepted v0.4.0 limitation.
- **View:**
  - the mode, the roster as seats with names, the current seat and the turn in progress
  - per-player scores, bonus and tokens
  - `standings` once finished
  - the common `turn` and `moveCount` (actions)
- **History:** chess-family history stays the per-opponent tally, limited to chess-family
  types. Yatzy gets a per-table list: finished time, players with totals, tokens and places,
  and the winners. Neither list ever enters the other.

## Compatibility and rollback (rehearsed)

`tests/backend/migrations/yatzy-format.test.ts` runs on the disposable local Supabase stack, inside a rolled-back
transaction:

1. It makes legacy records through today's API: a finished chess game with a move and a
   resignation, a finished Chess960 game, an active chess game and a waiting invitation.
2. It applies the proposal. The hashes of every game, seat, invitation and action row are
   unchanged.
3. It stores a finished three-player table and a mid-turn table in the proposed shape. Reading
   them back rebuilds the ranking (90 actions; the winner in seat `p2`, then two players sharing second
   place) and the turn in progress (dice, kept positions and throw number).
4. It checks that two guests who share only Yatzy tables:
   - see each other in `GET /opponents` (2 shared games)
   - may start chess and Fischer Random directly, and play that game
   while a stranger to both is still refused.
5. The host's history is byte-identical to before. The guests' histories hold only chess
   entries and no entry for each other: no Yatzy table adds a tally.
6. Clients without Yatzy never see it:
   - `/games` with no `types`, with `chess,chess960`, or even asking for `yatzy` today
   - a direct read, an action or a rematch on a Yatzy table gets `422` and leaves every row
     unchanged
7. It checks the new constraints: seat `p5`, unsorted or five kept positions, throw or score
   notation that doesn't fit, a resign with notation, and an unknown result are all refused. A
   finished table is frozen like any finished game.

Step 3 onward runs against today's API, the live backend `1c0850a` (#72). So the same test is
the rollback evidence: **once Yatzy records exist, the supported function rollback is to
`1c0850a`.** There, chess games, history, invitations and direct starts keep working. Yatzy is
simply unavailable, its records untouched and refused with `422`. Keep the migration: it is
forward-only and harmless to `1c0850a`. Older clients ask only for chess types and are
unaffected.

Other targets are not rehearsed. The existing Chess960 rollback limit still applies on top of
this: never roll the backend back before the #53 dispatcher, because a pre-#53 backend would
replay Chess960 records with orthodox rules
([game-types.md](../game-types.md#rollout-and-rollback)). It would not leave Yatzy out
either.

## Not proved here

- The #85 endpoints and their real-stack tests.
- The UI (#86).
- The Edge runtime's random source.

## Dependencies and assets

None. The rules are original code, and the dice and scorecard art are for #86 to draw.

## Decisions for review

1. The record format above: a log of throws with their dice, and scores.
2. The constraint widening, with seats `p1`–`p4` in `game_participants`, and the
   `scored`/`scorecards-complete` result.
3. Seats match their table's type, count and order: checked in the API with integration tests
   in #85 (recommended in review), not by a database trigger.
4. The proposed API shape for #85.
