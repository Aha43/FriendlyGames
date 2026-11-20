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

## Integrated result (#106, prepared 2026-11-20)

Delivered in order: #93 (PR #99), #100 (PR #102), #82 (PR #105). The plan itself came in
PRs #98 and #101. The live site runs `ecbadbf` and the backend reports `8d4e13c`; nothing
under `supabase/` changed between those two commits, so the live backend is the released
backend. Version 0.5.0 and its changelog section are prepared in the #106 release PR, with
the evidence and limits there and in [deployment.md](deployment.md).

What the integrated checks cover, all on disposable data (real-Supabase CI on
`main@ecbadbf`: check 413, backend 150, migration rehearsal 10, browser journeys 58 on
desktop and phone):

- **Deleting, each type:** a finished Chess game, a Fischer Random game and a three-player
  Yatzy table, each deleted by a participant who did not start it; gone for the others after
  a refresh, and from history, results and *Play with*.
- **Refusals:** waiting and active games of every type, outsiders, unknown and malformed IDs,
  a client that did not ask for the type. Nothing changes.
- **Once only:** a repeated delete and four at once give exactly one deletion; a lost reply
  recovers without a second effect; an answer that arrives after the player left the page
  does not pull them back.
- **Rematches:** an active and a finished rematch survive unchanged apart from the detached
  link; deleting a finished rematch frees *Play again*; a rematch racing the deletion ends
  coherent either way.
- **The *Play with* warning:** a pair, nobody, and a group table naming only some. If who is
  affected changes before confirmation, nothing is deleted and the new warning is shown; two
  players deleting their last two shared games at once cannot both pass unwarned.
- **Late creation retries:** `410 game_deleted` for email invitations, direct starts and
  tables, also when the retry races the deletion or the deleted game was the last shared one.
- **Join and opening (#100):** both controlled orders, White's retry, and a really missing
  seat still refused.
- **One device (#82):** the label in the top bar and lobby, the explanation for both local
  game types, local saves kept, no sideways scroll at phone width.
- **Unchanged:** Chess, Fischer Random and Yatzy play, invitations, direct starts, history,
  and the migration rehearsal over existing rows.

**Rollout as it happened:** the backend went live with #93 on 2026-11-15 (`4e4d88c`, with the
migration and a backup) and with #100 on 2026-11-18 (`8d4e13c`, function only, with a
backup). The site followed each merge by itself. Rows for each are in
[deployment.md](deployment.md).

**Owner's observations:** on 2026-11-15 the owner deleted a finished three-player Yatzy table
and a finished chess game against a test player on the live site; both worked well. On
2026-11-20 he saw the #82 wording in the Cloudflare preview on his phone and accepted it.
(The preview cannot reach the backend, by design, so only the wording and one-device play
were shown there.)

**Not verified:** whether either live confirmation showed the *Play with* warning; that an
ongoing game on the live site still opens and takes a move after the #93 and #100 deploys
(the owner's signed-in check is pending); and the #82 wording on the live site by the owner
(I read it there in a browser at `ecbadbf`). No production-writing smoke test was run. Local
runs in the implementation workspace used a stand-in database; CI on real Supabase is the
authoritative result.

**Released (2026-11-20):** the owner reported that an ongoing game and the one-device wording
looked right on the live site, accepted v0.5.0, and ran `make release`: tag `v0.5.0` at
`81e0b98`, published 17:37 UTC. The details are in [deployment.md](deployment.md). The live
*Play with* warning remains unverified by hand. Closing the milestone is the owner's. #11
stays open.

