// Board representation for display. Rules live in game.ts.

export type Color = 'w' | 'b';
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export interface Piece {
  color: Color;
  type: PieceType;
}

/** Ranks 8 → 1 (index 0 is rank 8), files a → h. */
export type Board = (Piece | null)[][];

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const PIECE_NAMES: Record<PieceType, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

export function pieceName(piece: Piece): string {
  return `${piece.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[piece.type]}`;
}
