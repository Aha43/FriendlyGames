// The piece artwork in one place so the set can be swapped later.
// Cburnett pieces, used under the BSD license: see docs/third-party-assets.md.
import type { Piece } from '@shared/chess/board.ts';
import wK from '../assets/pieces/cburnett/wK.svg';
import wQ from '../assets/pieces/cburnett/wQ.svg';
import wR from '../assets/pieces/cburnett/wR.svg';
import wB from '../assets/pieces/cburnett/wB.svg';
import wN from '../assets/pieces/cburnett/wN.svg';
import wP from '../assets/pieces/cburnett/wP.svg';
import bK from '../assets/pieces/cburnett/bK.svg';
import bQ from '../assets/pieces/cburnett/bQ.svg';
import bR from '../assets/pieces/cburnett/bR.svg';
import bB from '../assets/pieces/cburnett/bB.svg';
import bN from '../assets/pieces/cburnett/bN.svg';
import bP from '../assets/pieces/cburnett/bP.svg';

const IMAGES: Record<string, string> = { wK, wQ, wR, wB, wN, wP, bK, bQ, bR, bB, bN, bP };

export function pieceImage(piece: Piece): string {
  return IMAGES[`${piece.color}${piece.type.toUpperCase()}`];
}

export const PIECE_SET_CREDIT = 'Chess pieces by Cburnett, BSD license';
export const PIECE_SET_LICENSE_URL = `${import.meta.env.BASE_URL}licenses/cburnett-chess-pieces.txt`;
