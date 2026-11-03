# 0001 — Chess960 rules engine and saved format

Status: **proposed** for review (#52). Date: 2026-11-03. Owner, Codex and Claude decide;
nothing here enables Chess960 or ships GPL code to browsers yet.

## Decision in one paragraph

Use **chessops 0.15.1** (GPL-3.0-or-later, the rules library behind lichess) for the new
`chess960` game type only, behind a thin module, `supabase/functions/_shared/chess960/`.
Keep **chess.js 1.4.0** for standard `chess`, unchanged, so no existing record is
reinterpreted. Save Chess960 games as `{ schemaVersion: 1, initialFen: <Shredder-FEN>,
moves: <UCI> }`, with castling saved as **king onto its own rook**, sent only through an
explicit castle action. Before any browser build that contains chessops is published (#55),
FriendlyGames' source must be published under **GPL-3.0-or-later**, as the owner has accepted.

## Why not the current engine

chess.js 1.4.0 is still the latest release (npm, checked 2026-11-03) and has no Chess960
mode. With king c1 and rooks a1/h1 it offers kingside castling as c1→e1, the orthodox
result. FIDE requires the king on g1 and the rook on f1. The test "why the current engine is
not enough" in `chess960.test.ts` reproduces this. Upstream Chess960 work
([chess.js PR #575](https://github.com/jhlywa/chess.js/pull/575)) is unreleased.

## Options considered

| Option | Verdict |
| --- | --- |
| chess.js 1.4.0 with a shuffled starting FEN | Rejected: castling is wrong (above) |
| Wait for chess.js Chess960 support | Rejected for v0.2.0: no release, no date |
| A FriendlyGames castling layer on chess.js | Not authorized (Sprint 5 plan); the owner prefers publishing over a home-made rules layer |
| **chessops 0.15.1** for `chess960` only | **Chosen**: released, maintained (lichess), full Chess960 castling, legal-move generation, SAN, FIDE position identity |
| chessops for both types | Rejected: would reinterpret every existing chess record; no benefit now |

## Package facts

| | |
|---|---|
| Package | [`chessops`](https://github.com/niklasf/chessops) **0.15.1**, npm, pinned exactly; author Niklas Fiekas |
| Licence | GPL-3.0-or-later (`node_modules/chessops/LICENSE.txt`) |
| Dependencies | `@badrap/result` 0.3.1 (MIT) |
| Size | Chess960 rules + start generator: 34,027 bytes minified, **9,853 bytes gzip**. For scale, today's whole app bundle is 95,716 bytes gzip |
| Today's bundle | Contains **no** chessops: nothing in the app imports the proof modules |

## Evidence (all from the same fixtures, `fixtures.ts`, 7 check groups)

| Runtime | How | Result |
| --- | --- | --- |
| Node / Vitest | `npx vitest run supabase/functions/_shared/chess960` (part of `make check`) | 11 tests pass |
| Browser | `node scripts/chess960-browser-proof.mjs`: Vite build, run in headless Chromium 153 | 7/7, no failures |
| Deno 2.5.6 | `deno run --config supabase/functions/chess960-proof/deno.json …/fixtures.ts`, and the proof function served and called | 7/7, HTTP 200 |
| Supabase Edge runtime | `supabase/functions/chess960-proof` served by the local stack; `tests/backend/chess960-runtime.test.ts` in the CI backend job | Authoritative CI result on the PR |

The fixtures cover:

- **All 960 starts**: distinct, full inventory, opposite-colour bishops, king between the rooks, Black mirrored, standard pawns, White to move, legal for chessops; 518 is RNBQKBNR. Only a king–rook swap may castle at move 0 (e.g. BQNNRKRB), which FIDE allows.
- **Random starts**: uniform over 960 by rejection sampling of 16-bit crypto values (65,280 accepted values → exactly 68 per start; the top 256 values are rejected).
- **Castling**: kingside and queenside for both colours; both pieces moving; the king staying put; the rook staying put; king/rook swaps on both sides.
- **Castling refused**: a blocked king path; a blocked rook path; the king in check; the king passing an attacked square; an attacked destination; a rook leaving uncovers an attack (Kf1 Rg1 vs rh1); no right on that side.
- **Castling allowed despite an attack**: only the rook passes an attacked square.
- **No accidental castling**: a king move chessops would read as castling is refused as `use_castle_action`; Kb1→c1 is an ordinary step even though O-O-O also lands on c1.
- **Rights**: lost after the king or a rook moves away and back, and after a rook is captured and replaced. They are never inferred from where pieces stand.
- **Other rules**: promotion (none without a piece), en passant, a promotion capture, then the promoted queen captured; castling is never a capture.
- **Outcomes**: checkmate, stalemate, insufficient material, threefold repetition (castling rights make positions differ), fifty-move rule, no move after mate.
- **Save and replay**: a JSON round trip replays to the identical position.

Five deliberate breakages each fail the suite: ordinary moves allowed to castle; repetition by board only; modulo-biased starts; castling counted as a capture; the king not placed between the rooks.

## Saved format (game type `chess960`, schema version 1)

```json
{ "schemaVersion": 1,
  "initialFen": "bqnnrkrb/pppppppp/8/8/8/8/PPPPPPPP/BQNNRKRB w GEge - 0 1",
  "moves": ["e2e4", "e7e5", "f1g1"] }
```

- **`initialFen`** is Shredder-FEN. The castling field names the **rooks' files** (`GEge`), so each right is tied to a specific rook from the start.
- **The start** is generated once by the server (`randomStartIndex` → `startFen`) and saved before the game is returned. Retries and refreshes read it, and never reroll.
- **`moves`** are UCI. Castling is the **king onto its own rook** (`f1g1` above is a swap-castle; `b1a1`, `c1h1`). An ordinary king move can never land on its own piece, so the saved move means "castle" even when the king does not change square.
- **Replay** is `chessops` from `initialFen` through `moves`. A move that does not replay is a corrupt record, which is refused, never repaired.
- **Display notation** is SAN from chessops (`O-O`, `O-O-O`).
- **Outcomes follow today's policy**: checkmate, stalemate, insufficient material, and automatic threefold and fifty-move draws. Repetition uses FIDE identity: board, side to move, castling rights and legal en passant.
- **Captured pieces** are derived as for chess (#44); castling never adds one.

## Actions and storage (for #54)

- **Public action**: `{ type: "castle", side: "kingside" | "queenside" }`. Kingside is the h-file rook, queenside the a-file rook, as in FIDE.
  - The server resolves the rook from the current castling rights and replies `illegal_castle` if that castle isn't legal now.
  - `{ type: "move" }` for a king move that would castle (two squares, or onto its own rook) is refused with `use_castle_action`, so the client must be explicit.
- **`game_actions`**: a castle is stored with `kind = 'castle'` and `move` = the king-onto-rook UCI. #54 adds a migration that:
  - widens the `kind` check to `('move', 'resign', 'castle')`;
  - changes `move_has_notation` to `(kind in ('move', 'castle')) = (move is not null)`.
  - The `move` pattern already fits. Existing rows don't change.
- **Deduplication** stays `(kind, move)` per request ID: a retried castle returns `duplicate: true`. Reusing a request ID for a different action is `request_id_reused`.
- **`games.game_type`** gains `'chess960'` in its check (also #54). Standard `chess` records, their `payload`, actions and `schema_version` stay byte-for-byte unchanged and keep using chess.js.

## Licence and publication proposal (owner decision)

chessops is GPL-3.0-or-later. Publishing a browser build that includes it means conveying it
to every visitor, so FriendlyGames must then be licensed compatibly and its corresponding
source offered. Proposal:

1. **Licence**: FriendlyGames under **GPL-3.0-or-later**, as a `LICENSE` file plus a notice in the README. Everything else we use is compatible: chess.js (BSD-2-Clause), postgres.js (Unlicense), the Cburnett pieces (BSD-3), @badrap/result (MIT).
2. **Source**: make the GitHub repository public, the owner's preferred route. The page footer links to it and to the licences, as for chess.js today.
3. **Timing**: do both before #55 is merged, since that merge auto-publishes the first build containing chessops. This PR and #53/#54 ship no chessops to browsers. The proof function is never deployed.
4. **Before going public**, the full history was scanned on 2026-11-03: 72 commits, 22 branches and 27 PR heads.
   - **No** password, key, token or private key.
   - **No** database data: no `INSERT`/`COPY` statements in any version of any file.
   - **No** real player email.
   - Database URLs are placeholders, test values or the local `postgres:postgres` default; `backups/` was never committed.
   - **The owner should know**, before switching: the commit history shows the owner's own address, `arne.halvorsen@gmail.com`, as author of 62 commits. Docs and tests name Harald (the friend the first milestone is about) and mention a nephew; no other private person is named, and no surnames or contact details. The production site address and Supabase project ref are in the docs; they were never secret, and access depends on RLS and credentials.

Changing the licence or visibility is not part of this PR.
