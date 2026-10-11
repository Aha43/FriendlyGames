// Local chess game: the record we keep (initial position + ordered moves) and
// the rules applied to it. Rules come from chess.js; nothing here touches the UI.
import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import type { Board, Color, PieceType } from './board';

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

/** Long algebraic move, e.g. "e2e4" or "e7e8q". */
export type MoveRecord = string;

export interface GameRecord {
  schemaVersion: 1;
  initialFen: string;
  moves: MoveRecord[];
}

export type DrawReason = 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule';

export type GameStatus =
  | { kind: 'playing'; turn: Color; check: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason };

export function newGame(initialFen: string = DEFAULT_POSITION): GameRecord {
  return { schemaVersion: 1, initialFen, moves: [] };
}

/** Rebuild the position by replaying every move; throws if the record is not a legal game. */
export function replay(record: GameRecord): Chess {
  const chess = new Chess(record.initialFen);
  for (const move of record.moves) chess.move(parseMoveRecord(move));
  return chess;
}

function parseMoveRecord(move: MoveRecord) {
  return { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] };
}

/** Apply a move if it is legal, returning the new record; returns null for an illegal move. */
export function applyMove(
  record: GameRecord,
  from: string,
  to: string,
  promotion?: PromotionPiece,
): GameRecord | null {
  const chess = replay(record);
  if (gameStatus(chess).kind !== 'playing') return null;
  try {
    const move = chess.move({ from, to, promotion });
    return { ...record, moves: [...record.moves, move.lan] };
  } catch {
    return null;
  }
}

/** Squares the piece on `from` can legally move to, with whether the move promotes. */
export function legalTargets(chess: Chess, from: string): Map<string, { promotion: boolean }> {
  const targets = new Map<string, { promotion: boolean }>();
  for (const move of chess.moves({ square: from as Square, verbose: true })) {
    targets.set(move.to, { promotion: move.isPromotion() });
  }
  return targets;
}

export function gameStatus(chess: Chess): GameStatus {
  if (chess.isCheckmate()) return { kind: 'checkmate', winner: chess.turn() === 'w' ? 'b' : 'w' };
  if (chess.isStalemate()) return { kind: 'draw', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { kind: 'draw', reason: 'insufficient-material' };
  if (chess.isThreefoldRepetition()) return { kind: 'draw', reason: 'threefold-repetition' };
  if (chess.isDrawByFiftyMoves()) return { kind: 'draw', reason: 'fifty-move-rule' };
  return { kind: 'playing', turn: chess.turn(), check: chess.inCheck() };
}

export function boardOf(chess: Chess): Board {
  return chess.board().map((rank) =>
    rank.map((square) => (square ? { color: square.color as Color, type: square.type as PieceType } : null)),
  );
}

/** Square of the king of `color`, for highlighting check. */
export function kingSquare(chess: Chess, color: Color): string | null {
  for (const rank of chess.board()) {
    for (const square of rank) {
      if (square?.type === 'k' && square.color === color) return square.square;
    }
  }
  return null;
}

/** Moves in standard notation, paired by move number. */
export function moveList(chess: Chess): { number: number; white?: string; black?: string }[] {
  const history = chess.history({ verbose: true });
  const rows: { number: number; white?: string; black?: string }[] = [];
  for (const move of history) {
    const number = Number(move.before.split(' ')[5]);
    let row = rows[rows.length - 1];
    if (!row || row.number !== number || (move.color === 'w' && row.white)) {
      row = { number };
      rows.push(row);
    }
    row[move.color === 'w' ? 'white' : 'black'] = move.san;
  }
  return rows;
}

export function lastMove(chess: Chess): { from: string; to: string } | null {
  const history = chess.history({ verbose: true });
  const move = history[history.length - 1];
  return move ? { from: move.from, to: move.to } : null;
}
