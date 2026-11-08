# Sprint 6 — Play again with friends

Proposed target: [v0.2.1](https://github.com/Aha43/FriendlyGames/milestone/7).
Owner direction, clarified 2026-11-08: someone already played should be selectable
by name when starting a separate new game, without another email/invitation cycle.
The owner has found the existing rematch button; changing rematches is not selected.
This improves existing Chess and Fischer Random play; it adds no game type.

## What is already there

The reviewed backend's `POST /games/:id/rematch` already seats both players,
starts the same game type, swaps colours and returns the same rematch on retry.
No invitation is needed. Its frontend control is below the finished game's move
list; history only links to the board. General creation still requires an email.

The owner found Play again after resigning a test game and will try it with
Harald later. The real game with Harald is still ongoing. There is no reported
rematch/game-ending defect to fix. Preserve the existing rematch path unchanged;
never finish or repair a live game as part of these changes.

## Order and review points

| Order | Issue | Complete result |
| --- | --- | --- |
| 1 | [#70 — Planning](https://github.com/Aha43/FriendlyGames/issues/70) | This ordered plan, focused acceptance criteria and active guidance. Owner/Claude review before implementation. |
| 2 | [#72 — Previous-opponent backend](https://github.com/Aha43/FriendlyGames/issues/72) | Authorized name/ID list from shared seats and direct game creation with both players seated, privacy, retry identity and legacy compatibility. Owner deploys before #73 merges. |
| 3 | [#73 — Name-based game picker](https://github.com/Aha43/FriendlyGames/issues/73) | Choose a known opponent and game type; one Start game action opens it for both. Preserve Invite someone new. |
| 4 | [#74 — Qualify v0.2.1](https://github.com/Aha43/FriendlyGames/issues/74) | Integrated checks, rollout evidence, patch version/changelog, owner acceptance and owner-run make release. |

Merge the planning PR before implementation. One focused issue/branch/PR at a
time; Codex reviews the exact head, the owner approves shipping. #72 is the first
implementation issue. Investigating another urgent live bug
need not wait for this sprint's features, but fixes still need an issue and review.

## Product and architecture contract

- **Rematch** means the same two seated players and game type, with colours
  swapped. One source game has at most one rematch. Existing rematches open
  rather than being duplicated. This path already exists and is preserved, not
  redesigned by this sprint. Opening a page must never create a game.
- **Known opponent** means another player who actually shares seats in a game,
  including joined ongoing games and finished games, across the two supported
  types. A person merely named in an unused invitation is not yet known this way.
  No new friend/contact table or global player search is needed.
- **New game with a known opponent** is a deliberate new request, not a rematch:
  creator White, chosen opponent Black, White starts. The server seats both,
  makes the game active, and both lobbies show it on normal refresh. No email,
  invitation token, link-sharing or recipient confirmation. Another ongoing
  game with that person does not prevent this new game.
- Add a small credential-authorized opponents endpoint and a player-ID creation
  target alongside the legacy email target. Targets are mutually exclusive;
  authorize the relationship again on creation. Names/IDs only, no private
  emails or global account/relationship enumeration. Self and unrelated IDs
  are refused safely. No social graph, friend requests or authentication change.
- Keep type dispatch, game payloads and full histories unchanged. Use existing
  transaction/revision patterns. Creation retries bind target mode, canonical
  recipient and game type; after a committed/lost reply or concurrent retry,
  return the same game and Chess960 start. Mismatched intent refuses before
  writes. Rematches retain their existing deduplication and colour rules.
- Show a compact known-opponent picker in Start a game, alongside the type
  choice, with an explicit Invite someone new path. Do not confuse loading or
  failure with an empty list. Preserve selection/intent on retry and explain
  unknown save outcomes honestly. Local play and its saves remain separate.

## Evidence, rollout and boundaries

Extend meaningful real-Supabase backend and desktop/phone journeys for both
direct known-opponent creation and regression coverage of existing rematches. Include ongoing and
finished relationships, privacy/authorization, old email invitations, both types,
committed/lost-response recovery, concurrent retries and the second player's
lobby. Regressions must fail when authorization or deduplication is broken.
Inspect keyboard operation and 320px layouts; preserve board/capture readability.
Stand-ins are supplementary; exact-head real-stack CI is authoritative.

Frontend auto-publishes on merge. #72 keeps its new UI unexposed, preserves old
clients and documents any additive migration. Owner deploys and verifies that
backend from clean main before #73 merges. Record actual site/backend commits;
no new infrastructure or publishing setting is selected here.

Do not alter ongoing or finished production games. Production-writing tests need
owner authorization. #11 remains separate: the owner confirms the real game with Harald is still
ongoing; finished-game/resume/history acceptance must be met before closing it.
#71 (optional rematch discoverability), #67 (Mac fixture timing), #20 (pins),
#37 (deployment command) and #38 (colour choice) are not selected by this sprint. No notifications, third game, teams,
ratings, chat, park navigation or email verification. New issues may be triaged
separately; backlog presence is not implementation permission.

This planning PR neither bumps versions nor authorizes merges, deployments,
release publication or milestone closing. Feature changes go under Unreleased;
#74 owns the version bump and the reviewed make release handover.
