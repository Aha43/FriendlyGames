# Sprint 4 — Captured pieces at a glance

Target: [v0.1.2](https://github.com/Aha43/FriendlyGames/milestone/6).
Owner finding, 2026-11-03: while playing with a friend and nephew, it is difficult
to see which pieces have been captured as a game progresses. Play can continue;
this is a focused board-readability patch.

## Entry and order

Finalize v0.1.1 through [#34 / PR #42](https://github.com/Aha43/FriendlyGames/pull/42)
and merge this planning PR before implementation. This plan grants no merge,
deployment, tag or release approval. Keep the owner's checkout and ongoing games intact.

| Order | Issue | Result |
| --- | --- | --- |
| 1 | [#43 — Patch planning](https://github.com/Aha43/FriendlyGames/issues/43) | Scope, criteria, sprint and milestone; Codex planning PR. |
| 2 | [#44 — Captured pieces](https://github.com/Aha43/FriendlyGames/issues/44) | Claude implements two clear captured-piece rows, with pure replay-derived data, local/shared/review support and regression evidence. |
| 3 | [#45 — Qualify v0.1.2](https://github.com/Aha43/FriendlyGames/issues/45) | Integrated review, version/lockfile and changelog, actual deployed provenance and owner release commands. |

One issue, focused branch, PR, exact-head Codex review, then owner merge approval.
New findings are triaged separately rather than added to this patch by default.

## Product and technical contract

Show rows **Captured by White** and **Captured by Black**, close to the corresponding
player plates, inside each plate as a second line or directly under it. White's row
contains captured black pieces. Reuse the existing SVGs,
show repeated pieces in a stable type order and use a quiet **None yet** when empty.
Keep the capturing player's row with their plate when the board faces Black. Rows
wrap on narrow phones; they must not obscure or shrink the board to make room.
Provide accessible colour/type/count descriptions without additional keyboard stops.

Derive captures from actual replayed moves in the existing `initialFen` + move history.
Do not infer captures by comparing remaining pieces to the standard starting inventory.
En passant, promotion captures and later captures of promoted pieces must be correct;
promotion itself, castling and initially missing pieces are not captures.

Local and shared games, resumed existing games and finished-game review all use the
same pure helper. Earlier-ply review shows only captures at that ply. Shared trays
show confirmed captures until an unsaved move resolves; the board retains its existing
pending indication. During saving, an optimistic board may briefly show the victim gone
before the confirmed tray adds it. This is intentional, not a consistency defect.
A failed move must not leave a captured piece in the tray, and a
committed-but-lost response must not count it twice. A new game/rematch starts empty.

No new persisted fields, migration, backend rule/API change or production data repair
is expected. No material-advantage score, animation, settings, pin explanation (#20),
colour selection (#38), deployment orchestration (#37) or release automation in this patch.
The learning aid remains the next proposed feature direction after this patch.

## Evidence and release

- #44 carries the detailed edge-case, component and real-backend browser criteria.
  Verify ordinary and capture-heavy layouts on desktop and phone, including 320px,
  both player orientations and readable rows without horizontal scrolling.
- Exercise capture by each colour, refresh/resume, pending/failure recovery, local reset
  and finished-game replay. Extend existing journeys with capture assertions where
  practical rather than adding a single long journey duplicating those flows.
  Tests must fail when capture derivation/display breaks.
- Use `make check` and relevant browser journeys; the release issue runs relevant
  integrated checks. Preserve real Supabase CI and disclose any stand-in limitations.
- Existing live games and identities are untouched. No production-writing tests without
  explicit owner authorization; owner observation can use the ongoing game as it stands.
- Expected shipping path is frontend auto-publication on owner-approved merge, with no
  backend redeploy. #45 records the actual site build and backend health separately,
  and prepares commands tagging the accepted merged release SHA.
- Package version remains unchanged in planning/feature work. #45 prepares 0.1.2 and
  release notes. Only the owner accepts the patch and authorizes tags/releases.
- First-game acceptance #11 stays separate; a passing patch does not complete it.
