// Board representation for display. Move rules arrive with the chess rules library (#3).

export type Color = 'w' | 'b';
export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

export interface Piece {
  color: Color;
  type: PieceType;
}

/** Ranks 8 → 1 (index 0 is rank 8), files a → h. */
export type Board = (Piece | null)[][];

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_TYPES = new Set<string>(['k', 'q', 'r', 'b', 'n', 'p']);

/** Parse the piece placement and side to move of a FEN string. */
export function parseFen(fen: string): { board: Board; turn: Color } {
  const [placement, turn = 'w'] = fen.trim().split(/\s+/);
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new Error(`Invalid FEN: expected 8 ranks in "${fen}"`);
  if (turn !== 'w' && turn !== 'b') throw new Error(`Invalid FEN: bad side to move in "${fen}"`);

  const board = ranks.map((rank) => {
    const row: (Piece | null)[] = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else if (PIECE_TYPES.has(ch.toLowerCase())) {
        row.push({ color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() as PieceType });
      } else {
        throw new Error(`Invalid FEN: unexpected "${ch}" in "${fen}"`);
      }
    }
    if (row.length !== 8) throw new Error(`Invalid FEN: rank "${rank}" is not 8 squares`);
    return row;
  });

  return { board, turn };
}

const PIECE_NAMES: Record<PieceType, string> = {
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
