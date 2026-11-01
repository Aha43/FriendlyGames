# Product brief

## First milestone

Arne and Harald can play a complete legal chess game from separate devices,
close the app, return later and resume. The completed game remains in their history.

## Experience

1. Enter your email to open your player and games, from any browser or phone; a new
   email also asks for a name. The browser remembers the player afterwards.
2. See ongoing games and whose turn it is, or start a game.
3. Choose Chess and a friend's email. Share a game link manually initially.
4. Play at an inviting park table, together or asynchronously, without a clock.
5. Finish, revisit the game or play again.

**Prototype access (owner decision, 2026-11-01, #29):** entering an email opens that
player; email ownership is not checked, so anyone who knows a player's email can play as
them. This is accepted for the friends-only prototype and stated on the onboarding screen.
Each browser that enters the email gets its own opaque device credential, which authorises
its later requests; several browsers stay signed in at once. Verified authentication
(e.g. an emailed sign-in link) comes later, before the site is shared beyond friends.

## Visual direction

One shared table on an autumn afternoon: warm wood, muted greens and gold foliage.
Atmosphere surrounds a crisp board with recognizable pieces. The design must work
on phones as well as desktop. A navigable park is outside the first milestone.

## Shared history

The local aha-ha-wordly project is a product reference: Arne and Harald's daily
Gjett results, seasonal atmosphere, playful commentary and monthly recaps make an
ongoing friendship visible. FriendlyGames should retain this sense of continuity.

Initially show completed games with date and result, a win/draw tally, and a way
to reopen each board. Sample history in visual prototypes must be clearly labeled.
Championships, generated commentary and richer recaps can follow actual use.
Keep scores specific to each game type rather than combining unrelated results.

## Data direction

A common game envelope carries ID, type, schema version, participants, status,
timestamps and revision. Game-specific JSON carries chess state. Use database
columns for searchable common fields alongside the JSON.

Record initial position and ordered moves so chess state and repetition can be
reconstructed. Server validation and atomic revision checks prevent illegal moves
and concurrent overwrites. Determine outcomes from the rules, including draws,
and support resignation. Specify exact chess behavior in implementation issues.

Leave room for participant lists but defer multiplayer games and teams. Start with
one game type and direct code rather than a framework for hypothetical games.

## Technical and delivery direction

React + TypeScript + Vite and Supabase are proposed, inspired by NamWeb. Reuse
familiar practices without copying NamWeb's full dependency list. Hosting remains
to be selected. JUranometria supplies issue-sized work and independent, commit-bound
review practices; its desktop packaging machinery is not needed here.

## Deferred

Verified authentication, automatic email invitations, teams, additional games,
ratings, matchmaking, chat, clocks and formal seasons. Licensing and public
visibility remain owner decisions; private visibility alone does not settle
hosting access or data security.
