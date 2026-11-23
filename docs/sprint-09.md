# Sprint 9 — Invite friends before choosing a game

[v0.6.0](https://github.com/Aha43/FriendlyGames/milestone/10), planned
2026-11-21. The owner selected friend invites before choosing a game, normal
entry on Your games, player details and recipient emails on pending invites.
Delivered and prepared for release on 2026-11-22; see
[Integrated result](#integrated-result-114-prepared-2026-11-22) at the end. The
text between is the plan as agreed.

| Order | Issue | Outcome |
| --- | --- | --- |
| 1 | [#110](https://github.com/Aha43/FriendlyGames/issues/110) | Backend for game-independent friend invitations and durable connections. |
| 2 | [#111](https://github.com/Aha43/FriendlyGames/issues/111) | Invite, onboard and connect from Your games, then choose a game. |
| 3 | [#112](https://github.com/Aha43/FriendlyGames/issues/112) | Normal app entry opens Your games. |
| 4 | [#113](https://github.com/Aha43/FriendlyGames/issues/113) | Player details and creator-visible recipient email on pending invitations. |
| 5 | [#114](https://github.com/Aha43/FriendlyGames/issues/114) | Integrated qualification and v0.6.0 release preparation. |

## Connect before choosing a game

The proposed minimum is one manually shared, single-use link per friend, open
about which game to play. The host creates the link without selecting a game or
typing an email. The receiver sees who invited them, uses the existing onboarding
if needed, and explicitly accepts. Acceptance connects the two stable player IDs
in both directions and creates no game. Both can then select the other in
Play with for Chess, Fischer Random or Yatzy. Existing game-specific chess
invitations continue to work.

Propose the small schema/API in #110 before building it. Store token hashes,
make create recovery and concurrent acceptance safe, refuse self-acceptance, and
let the same accepting player retry without another connection. A second player
cannot claim an already redeemed link. Existing email-only prototype identity
continues to apply. Use available/unavailable wording for invalid links without
exposing private account data.

Keep shared seats as an eligibility source and add accepted connections to the
same opponent/direct-start/table checks. Connections survive deletion of the last
shared game. The deletion warning must use this combined eligibility rule.
The existing shared-game count and date remain meaningful for connected people
who have never played together, without inventing a date or showing an error.

Deploy the compatible backend before exposing the invitation UI. Verify both
mixed-version combinations. Use the existing migration, backup and deploy
procedure and document rollback for newly connected players. Verify acceptance,
lost replies and races through the real API, and a two-browser journey connecting
people who have never shared a game and then starting the chosen game.

## Agreed invitation lifecycle and compatibility

Friend links expire 30 days after creation. Each creator may have at most 20
unused, unexpired invitations. Expired and accepted invitations do not count.
Enforce the cap atomically, including concurrent creation. Started games have
no inactivity expiry. An accepted connection lasts independently of game history.

In #110 provide a creator-only list of pending friend invitations with stable
invitation ID, creation time and expiry, and an explicit replacement endpoint.
Replacement cancels the selected old token and issues a new link for that
invitation with a fresh 30-day lifetime. It uses the existing slot at the cap.
Creation never silently cancels another invitation. Listing cannot return token
plaintext because only hashes are stored. #111 exposes this list and replacement
action and explains that the old link stops working. Handle lost create and
replacement replies with recoverable retries, without duplicate invitations or
extra cap slots. Race replacement against acceptance so either the original
acceptance wins or the replacement wins, with no second person connected through
the same invitation. Reissuing a link invalidates the previous token.

Older clients receive today's opponents and response format. New clients
explicitly opt into invitation-only connections and show “No games together yet”
where appropriate. All clients may start a game with an accepted connection.
Shared games remain the other eligibility source, without automatically
creating durable connections. The deletion warning applies when that remaining
eligibility would be lost.

#110 also supplies the read-only inviter-name preview and a creator-only endpoint
for the recipient email on pending chess invitations. #113 builds that email UI
and player details. Cover recipient access refusal and existing pending records
in the backend tests. Keep the endpoint out of general game views.

## Open on Your games

Normal root entry opens Your games or the existing onboarding. Explicit game and
friend/game invitation links retain their destination. Reload and background
return preserve an intentionally opened game. #112 investigates the existing
entry URL and phone shortcut behavior to identify controllable launch paths.
An old shortcut whose stored URL names a game may need to be recreated by the
owner. Document that limitation and obtain a phone observation. Avoid a reset
on every focus or visibility event, which would interrupt play.

## Player and invitation details

A small details view reached from a name shows the display name and useful
shared-game context for accepted connections and co-players. Own details can
show the signed-in player's email. The owner explicitly requested seeing the
email on their own pending invitations, including the existing waiting chess
games. Read this from invitation data and authorize it for the creator on the
server, whether or not the recipient has joined FriendlyGames.

The owner has not selected a general rule for showing another player's email.
The proposed scope therefore shows names/context in other-player details and
keeps recipient email in creator-only invitation details. Claude should flag
any product gap this creates before implementation. Avoid speculative empty
profile fields. Protect credentials, tokens and private contacts in every read
path, including invitation-link reads. Check creator/outsider access through the
API and the details interaction by tap and keyboard on desktop and phone.

## Qualification and owner acceptance

Run current-head CI on real Supabase with disposable test players. Preserve all
three games, rematches, deletion, shared history and local saves. Record rollout
order, actual commits, backups and limitations. Ask the owner to observe a normal
phone launch, invite someone without choosing a game, and inspect an existing
pending invitation's email.

#114 prepares versions, changelog and deployment evidence. The owner accepts,
authorizes merge and runs make release. Record publication before closing the
milestone. The historical first-game issue #11 remains separate.

Direct Yatzy table invitations (#94), Yatzy scorecard polish, invitation
withdrawal, multiplayer resignation, personal archives and table talk are later
work. A reusable group invitation link and email sending are outside this scope.

## Integrated result (#114, prepared 2026-11-22)

Delivered in order: #110 (PR #117), backend diagnostics #120 (PRs #121 and #124, the first
step of #116), #111 (PR #122), #112 (PR #123), #113 (PR #126). The plan came in PR #115.

**What runs live (read 2026-11-22 14:09 UTC, changing nothing):** the site footer reads
"Build 49f5067" and `/health` reports backend `50a087c`, database ok, pooled. `49f5067` is
`main` and the commit this release is prepared from.

**The live backend is not the release commit's backend.** Since `50a087c`, only the
diagnostics of #120 changed under `supabase/` (`api.ts`, `diagnostics.ts` and its test): an
unexpected failure logs one safe line and its `500` answer carries an `errorId`. No
migration, and no change to any other answer. Every v0.6.0 feature works on `50a087c`; that
is the combination running now. The diagnostics reach production with the next
`make deploy-backend`, which is the owner's to run and is not needed for this release.

What the integrated checks cover, all on disposable data (real-Supabase CI on
`main@49f5067`, [run 45013926624](https://github.com/Aha43/FriendlyGames/actions/runs/45013926624):
check 489, backend 174, migration rehearsal 12, browser journeys 76 on desktop and phone,
and no unexpected backend error in either runtime log):

- **Connecting (#110, #111):** two players who never shared a game connect through a link,
  the receiver new or already known, and then start Chess, Fischer Random or Yatzy from
  *Play with*. Accepting starts no game. Own link, used link, expired link and a second
  claimant are refused; a repeated accept by the same player connects once.
- **Lifecycle:** 30 days, 20 waiting per player enforced under concurrent creation, lost
  create replies recovered without a second invitation, replacement cancelling the old
  link, and replacement racing acceptance with exactly one winner.
- **Old and new clients:** without `friends=1` the picker answer is exactly the old one;
  with it, friends without a game appear as "No games together yet". Direct starts, tables
  and the deletion warning use shared seats or a connection; a connection outlives the
  deletion of the last shared game.
- **Opening on Your games (#112):** root entry, explicit game and invitation links, reload,
  return from the background, and the iPhone Home Screen rule with `navigator.standalone`
  set by the test.
- **Player details and the invited email (#113):** own email from `/me` for the caller
  alone; other players by name and shared context, never an email, and no lookup by ID; the
  invited email for the creator only (joined player 403, outsider 404, after joining 409, a
  waiting game stored earlier), by tap and keyboard, at 320px with long names and addresses.
- **Unchanged:** Chess, Fischer Random and Yatzy play, game invitations by email, rematches,
  deletion with its warning and tombstones, shared history, one-device play and its local
  saves, and the migration rehearsal over existing rows.

**Rollout as it happened:** backend first. The owner deployed #110 on 2026-11-21
(`50a087c`: backup, migration `20261121120000_friend_connections.sql`, function) while the
site still had no friend invitations, so the old site ran on the new backend from then until
#111 merged that evening. The site followed each merge by itself: `a41e839` (#111),
`9525a76` (#112), `49f5067` (#113). The other mixed combination, the new site on the old
backend, never ran live; the backend tests cover the old client format instead. Rows are in
[deployment.md](deployment.md).

**Migration and rollback:** the migration adds two tables and changes no existing row
(rehearsed in CI). The previous function (`8d4e13c`) works on the migrated schema. After
such a rollback the current site's friend invitations and invited-email line are expected to
fail or show nothing, and friends connected only by invitation would leave *Play with* until rolled
forward; connections and games are kept. Keep the migration. The rollback was not exercised
on production.

**Owner's observations:**

- **Phone launch: confirmed.** On 2026-11-22, with the site at `9525a76`, the owner opened
  the app from the Home Screen on his iPhone and it showed the game list, not the old game.
  Not stated: whether it was the old icon or a new one. See [launch paths](launch-paths.md).
- **Inviting a new friend and then choosing a game, on the live site: pending.** No real
  friend invitation has been reported made or accepted.
- **The email on an existing pending invitation, on the live site: pending.**
- **Player details on the live site: pending.**
- **A signed-in look at his games and *Play with* after the #110 deploy: not reported.**

My own read of the live page at `49f5067` (a browser on the owner's computer, signed in as
his test player; I read and changed nothing) showed the *Invite a friend* card, the name in
the top bar as a details button and a *Details* button under *Play with*. I opened none of
them and made no invitation. No production-writing smoke test was run.

**Unexplained backend failures (#116, open):** three single failed requests on the local
real-Supabase stack in CI, each on a run that otherwise passed or on code that passed
before and after.

| When | Where | What |
| --- | --- | --- |
| 2026-11-21, PR #115 at `ec3c7ef` | `DELETE /games/:id` racing creation retries | `500`, not captured |
| 2026-11-21, `main@50a087c` | `GET /games/:id/invitation`, nothing concurrent | `500`, not captured |
| 2026-11-21, `main@a41e839` | `POST /invitations/redeem` | `503` without a body, not from the function's code; 5 ms after the runtime logged a worker's early termination and 1 ms after "connection aborted" |

The third was captured by the #120 diagnostics. It is the first evidence that a request in
flight when the local Edge runtime retires a worker can fail; the runtime did that 6 to 12
times in each of the five backend runs read, otherwise without a failed request. It does not establish
the cause of the first two, and nothing is known about the hosted runtime. The three runs
on `main` since (`55b1ab5`, `9525a76`, `49f5067`) passed. On `a41e839` the browser job also
failed, for a different and understood reason: the log checker crashed (`malloc`), fixed by
re-running it on the saved log in #124; its 66 journeys had passed.

**Other limits of this evidence:** local runs in the implementation workspace used a
stand-in database; CI on real Supabase is the authoritative result. Android launch
behavior and iOS 26 `display: browser` were not checked on a device.

**Released (2026-11-23):** Codex approved the release PR and asked the owner to try a friend
invitation through to choosing a game, the email on a pending invitation and player details.
The owner answered "Looks good, merge", without saying which he tried; those three live
checks therefore stay recorded as not reported. He then deployed the backend, so production
has the #120 diagnostics and site and backend both run `b145194`, and ran `make release`:
tag `v0.6.0` at `b145194`, published 08:50 UTC. The details are in
[deployment.md](deployment.md). #116 stays open: the two earlier failures are unexplained.
Closing the milestone is the owner's. #11 stays open.
