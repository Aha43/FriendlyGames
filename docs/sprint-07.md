# Sprint 7 — Yatzy with friends

Proposed target: [v0.4.0 — Yatzy with friends](https://github.com/Aha43/FriendlyGames/milestone/8).

The owner plays Yatzy with friends in person and wants FriendlyGames to handle the
scoring. This is the first game with dice and the first table that can seat more
than two players. Build and verify two-player play first. The proposed release
supports two to four players and qualifies a complete three-player game.

## Rules to carry into the proof

The owner confirmed both modes and the banked-throw rule. Choose the mode when
starting a table, and use the same scorecard and token balance rules in both.

- **Forced** fills the scorecard from top to bottom. **Free** lets the current
  player choose any unused row after the first throw or a later throw.
- The first throw rolls five dice. Each later throw identifies the dice to keep,
  and the server rolls the rest. The client sends positions to retain. The server
  checks the throw count and token balance and supplies the dice values.
  A player must throw at least once before scoring a row. Scoring records the
  calculated points and ends the turn. A row with no matching combination
  records zero. Show the points and any token award before committing.
- Each player starts the game with zero tokens. Committing on the first, second
  or third throw banks two, one or zero tokens respectively. The balance carries
  across that player's turns for this game. A fourth or later throw spends one
  token per throw. The available balance is the limit, including when a player
  spends several tokens chasing a single score. A turn that used an extra throw
  earns zero tokens.
- Proposed baseline is the ordinary five-dice, fifteen-row Norwegian scorecard.
  In order: ones through sixes, one pair, two pairs, three of a kind, four of a
  kind, small straight, large straight, full house, chance and Yatzy. The upper
  section awards 50 bonus points at 63 or more. One pair, two pairs, three of a
  kind and four of a kind sum the matching dice. Use the highest eligible
  combination, with two distinct values for two pairs. Full house requires
  distinct pair and triple values. Full house and chance sum all five dice.
  Straights are 1–5 and 2–6, worth a fixed 15 and 20 points. Five equal dice
  qualify for three or four of a kind and score 50 in the Yatzy row. They score
  zero for two pairs and full house. The
  [Rusta scorecard](https://www.rusta.com/globalassets/productimages/ba_762202840101_spelregler_yatzy_no_002.pdf)
  uses free order and at most three throws. Forced order and banked throws are
  the owner's house rules.
- Finish after every player fills the scorecard. Rank by total points first, then
  by unused tokens among players tied on points. Players tied on both measures
  at the top are joint winners. Preserve the final scorecard and token balances
  so each player can reopen it.

## First release proposal

Use the existing name picker to choose distinct previous opponents. The host
chooses one to three opponents and starts one table with everyone seated. Show
the turn order before starting, with the host first and the guests in selection
order. Each selected player sees the table in their existing lobby. The server
checks that the host has shared a seated game with every selected player.
Everyone seated at a shared Yatzy table becomes a previous opponent of everyone
else at the table, including guests who had only played the host before. That
relationship also allows direct chess and Fischer Random starts. The first
release uses known opponents for Yatzy. Email and link invitations remain
available in the chess flows.

While watching another player's turn, seated players see the latest committed
throw and any scored row on the normal table refresh. A refresh may skip
intermediate throws. Save the committed dice, the positions retained on the
last throw, and the throw number for refresh and resume.

**Known limitation:** an unfinished table stays in progress in each player's
lobby when someone stops playing. v0.4.0 has no leave or abandon action.

Group invitation links for new players, local pass-and-play, teams, mid-game
roster changes and Yatzy rematch controls are outside this proposal.

Use FriendlyGames branding and Yatzy as a descriptive game label. Write original
rules help, scorecard UI and artwork. Keep the current licence and record any
third-party material under the existing asset and dependency practices. Revisit
trademark clearance if the game becomes a separately marketed product.

## Issue order

| Order | Issue | Reviewable result |
| --- | --- | --- |
| 1 | [#83 — Release plan](https://github.com/Aha43/FriendlyGames/issues/83) | Review the scope and issue order with the owner and Claude. |
| 2 | [#84 — Rules and save-format proof](https://github.com/Aha43/FriendlyGames/issues/84) | Demonstrate scores, token economy, ordered turns, resume and a compatible storage/API design on disposable data. Proposed: [decision 0002](decisions/0002-yatzy-format.md). |
| 3 | [#85 — Shared backend](https://github.com/Aha43/FriendlyGames/issues/85) | Authorize and persist group play, dice outcomes, retries and results. Verify production backend before the UI merges. |
| 4 | [#86 — Dice table and group picker](https://github.com/Aha43/FriendlyGames/issues/86) | Complete the browser flow with score previews, phone and keyboard operation, resume and finished scorecards. |
| 5 | [#87 — Release qualification](https://github.com/Aha43/FriendlyGames/issues/87) | Qualify the integrated result, record rollout evidence, prepare v0.4.0 and hand off the release command. |

## Storage, rollout and release evidence

The [current boundary](game-types.md) reuses the lifecycle and has chess-specific
seats, results and actions. In the current schema, `game_participants.seat`
allows only `'white'` and `'black'`, with primary key `(game_id, seat)`.
The opponents list, history and direct-start authorization all read participant
rows. #84 must propose ordered Yatzy seats that preserve existing chess rows,
and show how the roster, active player, dice, scores and joint winners survive
a reload and finished-game read. Verify that the opponents list and direct-start
checks see every pair of Yatzy co-players, including for chess requests. Chess
history keeps pairwise tallies. Yatzy history lists the result per table with
scores, remaining tokens and winners, outside the per-opponent win/loss tallies.
Rehearse the format on disposable Supabase and keep Yatzy scoring separate from
routing and presentation.

The server generates dice and commits each outcome and token change with its
request ID and revision. Retrying an accepted throw returns the committed dice.
Scoring commits one row, any banked tokens and the next turn or result together.
Test turn, membership and retry checks at the normal API entry points. Keep
deterministic scoring and roll fixtures in test code.

Verify that older clients continue to list, play and resume both chess types
while omitting unsupported Yatzy records. The proof must document the supported
rollback after Yatzy records exist, including what happens to Yatzy availability.
Owner deploys the reviewed compatible backend from clean main before the
frontend exposes Yatzy. Record the live backend and frontend commits separately.

Run full CI on real Supabase, complete two-player and three-player journeys,
exercise the maximum roster, both modes, banked throws, multiple token spends,
lost replies, reload and archived results, including both levels of tie.
Check desktop and phone layouts and existing chess games, invitations, rematches
and saves. Record the abandoned-table limitation in the release notes. Obtain the owner's
play observation for acceptance. The release issue prepares version and
changelog changes. After the owner accepts and merges, the owner runs
`make release` and decides when to close the milestone. Record the published tag
and actual deployment in the release follow-up.
