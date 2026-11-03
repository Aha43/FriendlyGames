# Third-party code and artwork

Record every external asset here before it is merged: what it is, where it came
from, who made it, the license it is used under and what that license requires.

## Chess rules — chess.js

| | |
|---|---|
| Package | [`chess.js`](https://github.com/jhlywa/chess.js) 1.4.0 (npm, pinned exactly), no runtime dependencies |
| Author | Jeff Hlywa |
| License | BSD-2-Clause (`node_modules/chess.js/LICENSE`) |
| Obligations | Keep the copyright notice with source; reproduce it with binary distributions |
| How we comply | Copy of the license in [`public/licenses/chess.js.txt`](../public/licenses/chess.js.txt), shipped with every build and linked from the page footer. Refresh it when upgrading chess.js |
| Used for | Move legality, check/checkmate and draw detection in `supabase/functions/_shared/chess/game.ts`, in the browser and in the `game-api` Edge Function |

## Chess960 rules — chessops (proposed, not shipped)

| | |
|---|---|
| Package | [`chessops`](https://github.com/niklasf/chessops) 0.15.1 (npm, pinned exactly); dependency [`@badrap/result`](https://github.com/badrap/result) 0.3.1 (MIT) |
| Author | Niklas Fiekas |
| License | GPL-3.0-or-later (`node_modules/chessops/LICENSE.txt`) |
| Status | Used only by the Chess960 proof (#52): Vitest, `proofs/chess960` and the local-only `chess960-proof` Edge Function. **Not in the app bundle and not deployed.** See [decision 0001](decisions/0001-chess960-engine.md) |
| Obligations once shipped | Conveying it in the browser build requires FriendlyGames to be licensed compatibly (proposed GPL-3.0-or-later) with its corresponding source offered (proposed: public repository), plus the licence text with the build |

## Database client — postgres.js

| | |
|---|---|
| Package | [`postgres`](https://github.com/porsager/postgres) 3.4.9 (npm, pinned exactly) |
| Author | Rasmus Porsager |
| License | Unlicense (public domain dedication) |
| Obligations | None |
| Used for | Server-side only: the `game-api` Edge Function's database connection, and the backend integration tests. Never shipped to the browser |

## Chess pieces — Cburnett set

| | |
|---|---|
| Files | `src/assets/pieces/cburnett/{w,b}{K,Q,R,B,N,P}.svg` (12 files) |
| Author | [Cburnett](https://commons.wikimedia.org/wiki/User:Cburnett) |
| Source | Wikimedia Commons `Chess_{k,q,r,b,n,p}{l,d}t45.svg`, e.g. [Chess_klt45.svg](https://commons.wikimedia.org/wiki/File:Chess_klt45.svg); downloaded 2026-10-11 |
| Licensing on source | Each file: `{{self\|GFDL\|migration=relicense\|BSD\|GPL}}` — GFDL (migrated to CC BY-SA 3.0), BSD or GPL, recipient's choice |
| Used under | **BSD 3-clause** (Commons `{{BSD}}` default), copyright holder Cburnett |
| Changes | None to the artwork; files renamed (`Chess_klt45.svg` → `wK.svg`, etc.) |
| Obligations | Keep the copyright notice, conditions and disclaimer with the files and reproduce them with the built app; do not use the author's name to endorse FriendlyGames |
| How we comply | Full notice in [`public/licenses/cburnett-chess-pieces.txt`](../public/licenses/cburnett-chess-pieces.txt), shipped with every build and linked from the page footer credit |

The set is swappable: `src/components/pieceSet.ts` is the only module that
imports the files. Replacing it means new files, a new entry here and an updated
footer credit (`PIECE_SET_CREDIT`).

## Park backdrop

`src/components/ParkBackdrop.tsx` (trees, hills, path and leaves) and the
favicon are original artwork written for FriendlyGames. No external source.
