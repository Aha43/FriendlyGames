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
- A player starts a turn by throwing five dice. On later throws the player picks
  which dice to retain. Committing a row records its calculated score and ends the
  turn. A row with no matching combination records zero. Show the points and any
  token award before committing.
- Each player starts the game with zero tokens. Committing on the first, second
  or third throw banks two, one or zero tokens respectively. The balance carries
  across that player's turns for this game. A fourth or later throw spends one
  token per throw. The available balance is the limit, including when a player
  spends several tokens chasing a single score. A turn that used an extra throw
  earns zero tokens.
- Proposed baseline is the ordinary five-dice, fifteen-row Norwegian scorecard.
  In order: ones through sixes, one pair, two pairs, three of a kind, four of a
  kind, small straight, large straight, full house, chance and Yatzy. The upper
  section awards 50 bonus points at 63 or more. Straights are 1–5 and 2–6, worth
  15 and 20. Five equal dice in the Yatzy row score 50. Use the highest matching
  pair or set, two distinct values for two pairs, and distinct pair and triple
  values for full house. See the
  [Norwegian scorecard reference](https://www.rusta.com/globalassets/productimages/ba_762202840101_spelregler_yatzy_no_002.pdf).
- Finish after every player fills the scorecard. Highest total wins, with joint
  winners on a tie. Preserve the final scorecard so each player can reopen it.

## First release proposal

Use the existing name picker to choose distinct previous opponents. The host
chooses one to three opponents and starts one table with everyone seated. Show
the turn order before starting, with the host first and the chosen order after
that. Each selected player sees the table in their existing lobby. The server
checks that the host has shared a seated game with every selected player.
As with today's direct start, the recipient can open the game from their lobby.
Sharing a Yatzy table would make its participants previous opponents for later
games. The first release proposes known opponents only for Yatzy. Email and link
invitations remain available in the chess flows.

The owner and Claude should review the scorecard baseline, two-to-four-player
limit, direct group seating and known-opponents-only launch scope before the
proof starts. Group invitation links for new players, local pass-and-play, teams,
mid-game roster changes, and Yatzy rematch controls are outside this proposal.

Use FriendlyGames branding and Yatzy as a descriptive game label. Write original
rules help, scorecard UI and artwork. Keep the current licence and record any
third-party material under the existing asset and dependency practices. Revisit
trademark clearance if the game becomes a separately marketed product.

## Issue order

| Order | Issue | Reviewable result |
| --- | --- | --- |
| 1 | [#83 — Release plan](https://github.com/Aha43/FriendlyGames/issues/83) | Review the scope and issue order with the owner and Claude. |
| 2 | [#84 — Rules and save-format proof](https://github.com/Aha43/FriendlyGames/issues/84) | Demonstrate scores, token economy, ordered turns, resume and a compatible storage/API design on disposable data. |
| 3 | [#85 — Shared backend](https://github.com/Aha43/FriendlyGames/issues/85) | Authorize and persist group play, dice outcomes, retries and results. Verify production backend before the UI merges. |
| 4 | [#86 — Dice table and group picker](https://github.com/Aha43/FriendlyGames/issues/86) | Complete the browser flow with score previews, phone and keyboard operation, resume and finished scorecards. |
| 5 | [#87 — Release qualification](https://github.com/Aha43/FriendlyGames/issues/87) | Qualify the integrated result, record rollout evidence, prepare v0.4.0 and hand off the release command. |

## Storage, rollout and release evidence

The [current boundary](game-types.md) reuses the lifecycle but still has
White/Black seats, chess results and chess action assumptions. The proof should
map those constraints, propose the smallest compatible change, and show how an
ordered roster, active player, recorded dice, scores and joint winners survive a
reload and a finished-game read. Keep the existing chess schemas and client
responses compatible. Decide how to represent group records and results after
rehearsing the proposed format on disposable Supabase. Keep Yatzy scoring rules
separate from routing and presentation.

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
lost replies, reload and archived results. Check desktop and phone layouts and
existing chess games, invitations, rematches and saves. Obtain the owner's
play observation for acceptance. The release issue prepares version and
changelog changes. After the owner accepts and merges, the owner runs
`make release` and decides when to close the milestone. Record the published tag
and actual deployment in the release follow-up.
