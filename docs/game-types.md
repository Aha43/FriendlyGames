# Two game types, one place to play

Planning contract for [Sprint 5](sprint-05.md), owner-selected 2026-11-03.
Standard chess stays `chess`; Fischer Random is a distinct saved type `chess960`.
They share a chess-family board renderer. This demonstrates two real type/rules
paths, not proof that arbitrary non-chess games or player counts already work.

## Preserve what is already live

Keep credentials, participants, existing chess payloads/actions, castling rights,
invitations, results and archives intact. Existing local chess saves also survive.
Do not rewrite standard-chess history or switch its engine silently to make the
abstraction convenient. Omitted type on a legacy create request still means chess.

The current database already has `game_type`, `schema_version` and JSON payload,
but constraints, action notation, API views and UI assume chess. The boundary
must use the stored type and version rather than relabel a chess replay. Only
reviewed additive migrations extend constraints or add required representation.

Cached old clients are part of rollout: their lobby reads `.chess.moves` and
cannot interpret arbitrary new type views. Use one `types` query parameter
(e.g. `types=chess,chess960`) for opt-in, not a new versioned API or capability
framework. Omitted `types` means chess-only. Legacy listings/history remain chess-only;
an unsupported direct game request gets an explicit safe response, never a payload
replayed under orthodox rules. Apply this guard before invitation/action/rematch
writes for a type the client has not opted into. New clients opt in to supported types. Test this
with existing clients both before and after Chess960 records exist.

## Small shared boundary

- **Common service:** identity, participant authorization/privacy, creation retries,
  invitation recovery/claim, game row locking, expected revisions, canonical request
  deduplication, metadata/status, action persistence, archive/rematch links and history
  grouped by type and opponent.
- **Rules/record adapter per type/version:** create initial state, validate/decode its
  payload/actions, replay, legal actions, turn/outcome, board/notation/captures for
  its presentation. A static typed registry chooses it; no dynamic plugin discovery,
  event bus or universal board/action language.
- **Presentation:** game selector and type labels in shared chrome; a registered
  game-family renderer. These two reuse squares, pieces, plates, capture rows, move
  list, promotion/focus and saving/retry presentation, supplied by the right adapter.
- **Chess-family specifics:** White/Black seats and chess results can remain here.
  Do not generalize every column or implement teams now. Document the boundary so
  a future non-chess type supplies its own rules/record/presenter while using the
  shared lifecycle. No new unrelated game-specific branches in auth/transactions.

Unknown types/schema versions fail explicitly and preserve their records. This
compatible dispatcher is the supported rollback boundary once new records exist;
the old hard-coded chess backend must not be used to read Chess960 games.

## The boundary as built (#53)

- **Backend**: `supabase/functions/game-api/gameTypes.ts` holds the adapter interface, the
  standard-chess adapter (chess.js, schema 1, record and wire format unchanged) and the
  static registry. `api.ts` is the common service and calls the adapter for start state,
  action shape, stored notation, turn, legality/outcome, move count and the view. Resign is
  common. #54 adds a `chess960` adapter and its migration; nothing else in `api.ts` should
  need a new branch.
- **Frontend**: `src/games/registry.ts` lists the types the client shows, their family
  and the schema versions it replays; anything else is refused, not drawn.
  `gameApi` sends them as `types` on every game request. Shared chrome uses the common
  `turn`/`moveCount`; `SharedGamePage` is the chess-family presenter and refuses anything
  else with an explicit message.
- **Still chess-family**: White/Black seats, white/black/draw results, terminations, the
  `game_actions.move` pattern and history's per-seat outcome. A non-chess type would add
  its own adapter, presenter, and (by migration) its own seats/results, keeping the common
  lifecycle.
- **Characterised legacy client**: a request without `types` sees exactly the old chess
  views; a game no adapter reads (tested with a schema-99 fixture, standing in for future
  rows) is left out of lists/history and refused on direct requests, with the row
  unchanged (`tests/backend/game-types.test.ts`).

### Rollout and rollback

1. Deploy the #53 backend (`make deploy-backend`, owner). The frontend publishes on merge,
   possibly first: until the backend is deployed, it takes `turn`/`moveCount` from the old
   chess view (`gameApi.ts`), and the old backend ignores `types`. No data changes; old
   cached clients keep working because omitted `types` means chess.
2. Only then may #54's migration and backend create `chess960` records.
3. Once such records exist, the supported rollback is to the #53 dispatcher or later, which
   leaves unknown types out and refuses them explicitly. Rolling back to the pre-#53
   backend is unsafe: it would replay Chess960 records with orthodox rules.

## Fischer Random contract

Use the [FIDE Chess960 Guidelines II](https://handbook.fide.com/chapter/e012023):
constrained random back rank, opposite-colour bishops, king between rooks, Black
mirrored, normal pawn ranks and White to move. Ordinary moves/objective remain.
Castling ends with king/rook on g/f or c/d, including king-only, rook-only and swap
cases. Rights and king-path safety must be enforced by the selected rules engine.
Retain the prototype's existing standard-chess outcome policy; do not add a new
draw-claim/settings flow incidentally.

Generate a random start on the server once, sample the full 960 set uniformly,
and save its exact position/rights with its complete actions. The orthodox setup
is a valid member; no seed/index picker is required. Retrying creation never
rerolls. Same-type rematch swaps colours and generates one fresh random start;
retries/concurrent rematches find that same game. Tallies remain separate by type.

For Chess960, use explicit legal castle controls on the selected king (touch and keyboard,
with final king/rook squares). A normal king move must never silently select a
castle, including ambiguous destinations or a stationary king. The persisted
action/notation must preserve this distinction. Standard chess retains today's
king-two-squares interaction. Local Chess960 has its own save.

## First gate: engine and record proof (#52)

**Proposed outcome:** [decision 0001](decisions/0001-chess960-engine.md). chessops 0.15.1 for
`chess960` only (chess.js stays for `chess`), Shredder-FEN start, UCI moves with castling saved as
king onto its own rook, an explicit `castle` action and `game_actions.kind = 'castle'` (#54
migration). Publish the source under GPL-3.0-or-later before #55 ships chessops to browsers.


Installed chess.js 1.4.0 is not established as Chess960-capable. An isolated probe
with king c1 and rooks a1/h1 offered c1→e1 as O-O, not the required g1/f1 result.
[Upstream Chess960 work](https://github.com/jhlywa/chess.js/pull/575) was still an
open PR when planning; its existence is not released-library support.

#52 must recommend a maintained engine strategy, exact version/licence/notices,
stable initial-rights/action encoding and replay schema, with executable castling,
promotion/en-passant/draw/capture fixtures and browser plus real Supabase Edge
runtime evidence. If the implementer's container registry is blocked, its browser
and Deno proof plus a passing current-head real Edge-runtime fixture in CI meets
the runtime gate. Codex may additionally verify locally. Exhaustively check the
960 starts. It may retain chess.js for
legacy chess and add a separate Chess960 adapter. A replacement needs replay and
behaviour compatibility evidence; do not build castling patches around a shuffled
orthodox board or ship with castling disabled.

Codex reviews that concrete decision before #53–#55. Update this contract if the
proof changes the design; bring actual dependency/licence/product tradeoffs to
the owner. No rules dependency or record format is selected by this planning PR.

## Owner licence preference

After Claude's plan review, the owner stated willingness to make FriendlyGames
public and adopt a compatible open-source licence for a needed library. Evaluate
a released library first, including [chessops](https://github.com/niklasf/chessops),
whose upstream documents Chess960 support and GPL-3.0-or-later licensing. Do not
build a custom castling layer merely to preserve the previous private/no-licence
position; such a layer is not authorized by this preference.

#52 still verifies the exact package/version, rules and notices. It prepares the
concrete project-licence and corresponding-source/publication proposal for review
before distributing a GPL-containing browser build. GPL source requirements do
not specifically mandate a public GitHub repository; see the [GNU FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#GPLRequireSourcePostedPublic).
Public source is the owner's acceptable practical route, not permission to expose
player data, backups or credentials. This plan changes neither visibility nor
the project's licence; those concrete publication steps follow the reviewed proof.
