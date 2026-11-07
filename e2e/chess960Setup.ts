// Setup moves for the Fischer Random browser journey (#55). The server draws a random start, so the
// journey cannot know it in advance: from any of the 960 starts this plans ordinary moves after which
// White may castle. White clears the squares between its king and a rook; Black only shuttles a
// knight, which never reaches White's back rank. Checked for every start in
// tests/tooling/chess960-setup.test.ts. The castle itself is then made through the real controls.
import { castlingSide } from 'chessops/chess';
import type { NormalMove } from 'chessops/types';
import { makeUci, squareFile, squareRank } from 'chessops/util';
import {
  legalCastles,
  replay,
  SCHEMA_VERSION,
  type Castle,
  type Chess960Record,
} from '../supabase/functions/_shared/chess960/rules.ts';

export interface PlannedMove {
  from: string;
  to: string;
}

const between = (a: number, b: number) => {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};

/** Ordinary moves (White first) after which White, to move, has at least one legal castle. */
export function planCastle(initialFen: string, maxPlies = 40): { moves: PlannedMove[]; castles: Castle[] } {
  const record: Chess960Record = { schemaVersion: SCHEMA_VERSION, initialFen, moves: [] };
  let knightHome: number | null = null;
  let knightAway: number | null = null;

  for (let ply = 0; ply <= maxPlies; ply++) {
    const position = replay(record);
    let move: NormalMove | undefined;

    if (position.turn === 'white') {
      const castles = legalCastles(position);
      if (castles.length > 0) {
        return { moves: record.moves.map((m) => ({ from: m.slice(0, 2), to: m.slice(2, 4) })), castles };
      }
      const king = position.board.kingOf('white')!;
      // For each side that still has its right: the back-rank squares that must be empty.
      const plans = (['a', 'h'] as const).flatMap((side) => {
        const rook = position.castles.rook.white[side];
        if (rook === undefined) return [];
        const kingTo = side === 'h' ? 6 : 2;
        const rookTo = side === 'h' ? 5 : 3;
        const span = [...new Set([...between(king, kingTo), ...between(rook, rookTo)])];
        const blockers = span.filter((sq) => sq !== king && sq !== rook && position.board.get(sq));
        return [{ rook, span: new Set(span), blockers }];
      });
      plans.sort((a, b) => a.blockers.length - b.blockers.length);
      const legal = (from: number, to: number) => {
        const m = { from, to };
        return position.isLegal(m) && !castlingSide(position, m);
      };
      const first = (froms: Iterable<number>, accept: (to: number) => boolean): NormalMove | undefined => {
        for (const from of froms) {
          for (const to of position.dests(from)) if (accept(to) && legal(from, to)) return { from, to };
        }
        return undefined;
      };
      // Side by side, fewest blockers first: 1. a blocker off the back rank; 2. a blocker aside,
      // out of this side's way; 3. a pawn push in front of or beside a blocker, to open a way out.
      for (const plan of plans) {
        const files = new Set(plan.blockers.flatMap((sq) => [squareFile(sq) - 1, squareFile(sq), squareFile(sq) + 1]));
        const pawns = [...position.board.pieces('white', 'pawn')].filter((sq) => files.has(squareFile(sq)) && squareRank(sq) === 1);
        move =
          first(plan.blockers, (to) => squareRank(to) !== 0) ??
          first(plan.blockers, (to) => !plan.span.has(to)) ??
          first(pawns, () => true);
        if (move) break;
      }
    } else {
      // Black shuttles one knight between its start and a square on the sixth rank.
      if (knightHome === null) {
        for (const from of position.board.pieces('black', 'knight')) {
          const to = [...position.dests(from)].find((sq) => squareRank(sq) === 5);
          if (to !== undefined) {
            knightHome = from;
            knightAway = to;
            break;
          }
        }
      }
      if (knightHome !== null && knightAway !== null) {
        const atHome = position.board.get(knightHome)?.role === 'knight';
        move = atHome ? { from: knightHome, to: knightAway } : { from: knightAway, to: knightHome };
      }
    }

    if (!move || !position.isLegal(move)) throw new Error(`no setup move from ${initialFen} after ${record.moves.join(' ')}`);
    record.moves.push(makeUci(move));
  }
  throw new Error(`no castle within ${maxPlies} plies from ${initialFen}`);
}
