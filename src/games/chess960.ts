// Fischer Random (Chess960) on the chess-family boundary (#55): chessops through the same rules
// module the server uses (@shared/chess960/rules.ts, decision 0001). The browser never shuffles a
// shared game's board: the start comes saved from the server. Only local play draws its own.
//
// Castling is explicit. Ordinary targets leave out every king move chessops would read as a castle
// (two squares, or onto its own rook), exactly as the server refuses them; castles are offered
// separately with their final king and rook squares.
import type { Color, PieceType } from '@shared/chess/board.ts';
import * as fischer from '@shared/chess960/rules.ts';
import { randomStartIndex, startFen } from '@shared/chess960/start.ts';
import { castlingSide, type Chess } from 'chessops/chess';
import type { NormalMove, Role } from 'chessops/types';
import { makeSquare, parseSquare, parseUci, squareRank } from 'chessops/util';
import type { ChessFamilyRules, ChessRecord, MovePly, Position } from './chessFamily';

const LETTER: Record<Role, PieceType> = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const short = (color: 'white' | 'black'): Color => (color === 'white' ? 'w' : 'b');
const record960 = (record: ChessRecord): fischer.Chess960Record => ({ ...record, schemaVersion: fischer.SCHEMA_VERSION });

function boardOf(chess: Chess): Position['board'] {
  const ranks: Position['board'] = [];
  for (let rank = 7; rank >= 0; rank--) {
    const row: Position['board'][number] = [];
    for (let file = 0; file < 8; file++) {
      const piece = chess.board.get(rank * 8 + file);
      row.push(piece ? { color: short(piece.color), type: LETTER[piece.role] } : null);
    }
    ranks.push(row);
  }
  return ranks;
}

function position(record: ChessRecord): Position {
  const r = record960(record);
  const all = fischer.positions(r);
  const chess = all[all.length - 1];
  const sans = fischer.sanMoves(r);
  const status = fischer.status(r);
  const moves: MovePly[] = r.moves.map((_, i) => ({
    ply: i + 1,
    number: all[i].fullmoves,
    color: short(all[i].turn),
    san: sans[i],
  }));

  let last: Position['lastMove'] = null;
  if (r.moves.length > 0) {
    const before = all[all.length - 2];
    const move = parseUci(r.moves[r.moves.length - 1]) as NormalMove;
    const side = castlingSide(before, move);
    if (side) {
      // Saved as king onto rook; show where the king actually went.
      const castle = fischer.legalCastles(before).find((c) => c.uci === r.moves[r.moves.length - 1]);
      last = castle ? castle.king : { from: makeSquare(move.from), to: makeSquare(move.to) };
    } else {
      last = { from: makeSquare(move.from), to: makeSquare(move.to) };
    }
  }

  return {
    board: boardOf(chess),
    turn: short(chess.turn),
    status,
    pieceAt(square) {
      const sq = parseSquare(square);
      const piece = sq === undefined ? undefined : chess.board.get(sq);
      return piece ? { color: short(piece.color), type: LETTER[piece.role] } : null;
    },
    legalTargets(from) {
      const targets = new Map<string, { promotion: boolean }>();
      const sq = parseSquare(from);
      if (sq === undefined || status.kind !== 'playing') return targets;
      const piece = chess.board.get(sq);
      for (const to of chess.dests(sq)) {
        if (castlingSide(chess, { from: sq, to })) continue; // castles have their own controls
        const lastRank = squareRank(to) === 7 || squareRank(to) === 0;
        targets.set(makeSquare(to), { promotion: piece?.role === 'pawn' && lastRank });
      }
      return targets;
    },
    kingSquare(color) {
      const sq = chess.board.kingOf(color === 'w' ? 'white' : 'black');
      return sq === undefined ? null : makeSquare(sq);
    },
    lastMove: last,
    castles:
      status.kind === 'playing'
        ? fischer.legalCastles(chess).map(({ side, king, rook }) => ({ side, king, rook }))
        : [],
    moves,
  };
}

export const chess960Rules: ChessFamilyRules = {
  type: 'chess960',
  explicitCastling: true,
  newRecord: () => ({ schemaVersion: 1, initialFen: startFen(randomStartIndex()), moves: [] }),
  position,
  apply(record, action) {
    const applied = fischer.applyAction(record960(record), action);
    return 'error' in applied ? null : { ...record, moves: applied.record.moves };
  },
  savedMove(record, action) {
    if (action.type === 'move') return `${action.from}${action.to}${action.promotion ?? ''}`;
    return fischer.legalCastles(fischer.replay(record960(record))).find((c) => c.side === action.side)?.uci ?? null;
  },
  captured: (record) => fischer.capturedPieces(record960(record)),
};
