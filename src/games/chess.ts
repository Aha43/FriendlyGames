// Standard chess on the chess-family boundary: chess.js through @shared/chess/game.ts, unchanged.
// Castling stays the familiar king-two-squares move, so there are no explicit castle controls.
import type { Color } from '@shared/chess/board.ts';
import {
  applyMove,
  boardOf,
  capturedPieces,
  gameStatus,
  kingSquare,
  lastMove,
  legalTargets,
  newGame,
  replay,
} from '@shared/chess/game.ts';
import type { ChessFamilyRules, ChessRecord, MovePly, Position } from './chessFamily';

function position(record: ChessRecord): Position {
  const chess = replay(record);
  const moves: MovePly[] = chess.history({ verbose: true }).map((move, index) => ({
    ply: index + 1,
    number: Number(move.before.split(' ')[5]),
    color: move.color as Color,
    san: move.san,
  }));
  return {
    board: boardOf(chess),
    turn: chess.turn(),
    status: gameStatus(chess),
    pieceAt: (square) => {
      const piece = chess.get(square as 'a1');
      return piece ? { color: piece.color, type: piece.type } : null;
    },
    legalTargets: (from) => legalTargets(chess, from),
    kingSquare: (color) => kingSquare(chess, color),
    lastMove: lastMove(chess),
    castles: [],
    moves,
  };
}

export const chessRules: ChessFamilyRules = {
  type: 'chess',
  explicitCastling: false,
  newRecord: () => newGame(),
  position,
  apply: (record, action) =>
    action.type === 'move' ? applyMove(record, action.from, action.to, action.promotion) : null,
  savedMove: (_record, action) =>
    action.type === 'move' ? `${action.from}${action.to}${action.promotion ?? ''}` : null,
  captured: capturedPieces,
};
