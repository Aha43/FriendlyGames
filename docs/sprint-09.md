# Sprint 9 — Invite friends before choosing a game

Proposed [v0.6.0](https://github.com/Aha43/FriendlyGames/milestone/10), planned
2026-11-21. The owner selected friend invites before choosing a game, normal
entry on Your games, player details and recipient emails on pending invites.
Claude reviews this plan and the owner authorizes its merge before implementation.

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
work. A reusable group invitation link and email sending are outside the proposed
minimum. Claude should review that link choice with the owner before coding.
