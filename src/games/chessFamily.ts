// The chess-family presentation boundary (#55): what the board, plates, move list and review need
// from a saved game, supplied by the rules of its type. Standard chess (chess.js) and Fischer
// Random (chessops) each implement it once; the components never call a rules library directly.
// The rules themselves stay in supabase/functions/_shared, shared with the server.
import type { Board, Color, Piece, PieceType } from '@shared/chess/board.ts';
import type { DrawReason, PromotionPiece } from '@shared/chess/game.ts';

export type { PromotionPiece };

/** A saved chess-family game: start position and its moves, as the server stores it. */
export interface ChessRecord {
  schemaVersion: 1;
  initialFen: string;
  moves: string[];
}

export type GameStatus =
  | { kind: 'playing'; turn: Color; check: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason };

export type CastleSide = 'kingside' | 'queenside';

/** A castle the side to move may make now, with where its king and rook end up. */
export interface CastleOption {
  side: CastleSide;
  king: { from: string; to: string };
  rook: { from: string; to: string };
}

/** What a player asks for on a chess-family board. Castling is its own action (Fischer Random). */
export type BoardAction =
  | { type: 'move'; from: string; to: string; promotion?: PromotionPiece }
  | { type: 'castle'; side: CastleSide };

export interface MovePly {
  /** 1 = after the first move of the game. */
  ply: number;
  /** The move number shown, e.g. 1 for "1. e4 e5". */
  number: number;
  color: Color;
  san: string;
}

/** One position of a game, ready to draw and play from. */
export interface Position {
  board: Board;
  turn: Color;
  status: GameStatus;
  pieceAt(square: string): Piece | null;
  /** Squares the piece on `from` may move to with an ordinary move (never a castle in Fischer Random). */
  legalTargets(from: string): Map<string, { promotion: boolean }>;
  kingSquare(color: Color): string | null;
  /** The last move, for highlighting; a castle shows the king's start and end squares. */
  lastMove: { from: string; to: string } | null;
  /** Explicit castles available to the side to move. Always empty for standard chess. */
  castles: CastleOption[];
  moves: MovePly[];
}

/** The rules of one chess-family type, as the presentation uses them. */
export interface ChessFamilyRules {
  type: 'chess' | 'chess960';
  /** Whether castling is an explicit control (Fischer Random) or a two-square king move (chess). */
  explicitCastling: boolean;
  /** A fresh game for local play. Shared games always get their start from the server. */
  newRecord(): ChessRecord;
  /** Throws if the record is not a legal game of this type. */
  position(record: ChessRecord): Position;
  /** The record after `action`, or null if it is not legal. */
  apply(record: ChessRecord, action: BoardAction): ChessRecord | null;
  /** The move the server will save for `action`, to recognise it in a later game state. */
  savedMove(record: ChessRecord, action: BoardAction): string | null;
  /** Pieces each side has captured, most valuable first (#44). Castling never captures. */
  captured(record: ChessRecord): Record<Color, PieceType[]>;
}

/** "Castle kingside: king to g1, rook to f1", the castle control's accessible name. */
export const castleLabel = (castle: CastleOption): string =>
  `Castle ${castle.side}: king to ${castle.king.to}, rook to ${castle.rook.to}`;

/** The game's moves, cut to the first `ply` (for review). */
export const upTo = (record: ChessRecord, ply: number | null): ChessRecord =>
  ply === null ? record : { ...record, moves: record.moves.slice(0, ply) };
