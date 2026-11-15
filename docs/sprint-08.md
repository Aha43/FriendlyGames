# Sprint 8 — Finished game cleanup

Target [v0.5.0](https://github.com/Aha43/FriendlyGames/milestone/9). This is the
start of the release. The owner confirmed the scope and deletion rule on
2026-11-15.

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#93](https://github.com/Aha43/FriendlyGames/issues/93) | Any participant can delete a finished shared game for everyone. |
| 2 | [#100](https://github.com/Aha43/FriendlyGames/issues/100) | Fix the chess join/opening race from post-merge CI. |
| 3 | [#82](https://github.com/Aha43/FriendlyGames/issues/82) | Make it clear that playing on one device means taking turns on that device, with a browser-only save. |

## Delete a finished shared game

Offer **Delete game** to any participant on a finished shared Chess, Fischer
Random or Yatzy game, including a chess game finished by resignation. Confirm
which game will be deleted and say that it disappears for everyone, including
from results and history. On success return to the lobby. If the response is
lost, recover to the correct state without repeating a destructive effect.

Authorize membership and finished status on the server in the same transaction
as deletion. Waiting and active games are ineligible. Missing games and games
the requester cannot see use the same not-found response. The database cascades
game deletion to seats, invitations and action rows. Keep player accounts and
other games intact. A create request whose creator and request ID belong to
a deleted game returns HTTP 410 with code `game_deleted`. Apply this to
email invites, direct starts and Yatzy tables. The client says the game was
deleted and lets the player start a new game deliberately with a fresh request
ID. Preserve only the request identity needed for that response. Keep
`request_id_reused` for conflicting retries against existing games.

The current finished-game trigger blocks updates. The rematch foreign key
blocks deleting a game with a rematch. Preserve that rematch as an independent
game, whether active or finished. If the migration detaches its parent link,
keep all other finished-game fields protected. Deleting a finished rematch
leaves its source available for **Play again**. A concurrent delete and rematch
request must leave a coherent result. The rematch can succeed before deletion
and survive, or the source can be removed first and the rematch request refused.

History and chess tallies reflect the remaining games. The previous-opponent
picker also derives its eligibility from surviving shared seats. When deleting
this game would remove someone from the requesting player's **Play with** list,
name each affected player in the confirmation and explain that they can be
picked again once the two share another game. Use the same server-side
eligibility rule as the picker, excluding the game being deleted. Omit this
warning when every co-player remains eligible.

Verify a group table where the warning names only the co-players who would
drop out of the picker's list. Also check a game where no warning is needed.

Use real-Supabase CI to exercise a participant other than the host, a finished
game of each type, waiting and active refusal, outsider refusal, rematch
preservation, the rematch race and retries. In a browser, verify cancellation,
confirmation, and deletion disappearing for another participant after refresh.
Use disposable games for verification. The owner will finish his own test
games before deleting them.

For rollout, the site may build on merge while the old backend is still live.
Use a server-provided eligibility signal so the Delete game control only becomes
available after the owner applies the migration and deploys the backend. Verify
the new site against the old API, and the old site against the new API. Record
the backup and the actual site and backend commits. Document rollback behavior
before deploying. A code rollback does not restore deleted games.

## Fix the chess join/opening race

The post-merge backend CI for #93 saw a valid simultaneous join and White
opening return `invalid_seats`. Fix #100 before #82. A join that commits first
should yield `stale_revision` with the current active game and both seats. If
the opening commits first, it should be visible when the guest joins. Verify
the ordering through the real API on disposable Supabase and keep malformed
roster rejection.

## Clarify playing on one device

Use **Play on one device** in the top bar and lobby. On the local page, explain
that players take turns on this device and the game is saved only in this browser.
Keep the local routes, both local game types and their existing saves. Verify
the labels and destination on desktop and phone.

Keeping an archive for other participants and resigning from multiplayer games
come later. Pending chess invitations remain waiting. Direct Yatzy invitations
(#94), the Yatzy scorecard improvements and other ideas are outside this sprint.
A separate owner decision sets v0.5.0 release acceptance and publication.
