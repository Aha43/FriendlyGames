// Fischer Random (Chess960) rules and saved record, candidate for #52 (not wired into the app).
// The rules are chessops (GPL-3.0-or-later, https://github.com/niklasf/chessops); this module
// only defines the saved format, the explicit castle action and our outcome policy on top.
//
// Saved record, schema version 1:
//   { schemaVersion: 1, initialFen: <Shredder-FEN, castling rights name rook files e.g. "HAha">,
//     moves: <UCI strings> }
// Castling is saved as the king moving onto its own rook ("b1a1", "g1h1"), chessops' own
// unambiguous form: an ordinary king move can never land on its own piece, so the saved move
// says "castle" even when the king does not change square.
import { Chess, castlingSide, equalsIgnoreMoves } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import type { CastlingSide, Color, NormalMove, Role } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseSquare, parseUci, rookCastlesTo } from 'chessops/util';

export const SCHEMA_VERSION = 1;

export interface Chess960Record {
  schemaVersion: typeof SCHEMA_VERSION;
  initialFen: string;
  moves: string[];
}

export type CastleSide = 'kingside' | 'queenside';
export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

/** What a player asks for. Castling is never a `move`: it has its own explicit action. */
export type Chess960Action =
  | { type: 'move'; from: string; to: string; promotion?: PromotionPiece }
  | { type: 'castle'; side: CastleSide };

export type ActionError = 'bad_square' | 'use_castle_action' | 'illegal_move' | 'illegal_castle' | 'game_over';

export interface Castle {
  side: CastleSide;
  /** The saved form: king onto its own rook. */
  uci: string;
  king: { from: string; to: string };
  rook: { from: string; to: string };
}

export type DrawReason = 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule';
export type Status =
  | { kind: 'playing'; turn: 'w' | 'b'; check: boolean }
  | { kind: 'checkmate'; winner: 'w' | 'b' }
  | { kind: 'draw'; reason: DrawReason };

const SIDE: Record<CastleSide, CastlingSide> = { kingside: 'h', queenside: 'a' };
const short = (color: Color): 'w' | 'b' => (color === 'white' ? 'w' : 'b');
const PROMOTION: Record<PromotionPiece, Role> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

function positionFrom(fen: string): Chess {
  const setup = parseFen(fen);
  if (setup.isErr) throw new Error(`invalid Chess960 FEN: ${setup.error.message}`);
  const position = Chess.fromSetup(setup.value);
  if (position.isErr) throw new Error(`illegal Chess960 position: ${position.error.message}`);
  return position.value;
}

export function newRecord(initialFen: string): Chess960Record {
  positionFrom(initialFen); // validates
  return { schemaVersion: SCHEMA_VERSION, initialFen, moves: [] };
}

/** Every position of the game, from the start to the current one (for repetition and review). */
export function positions(record: Chess960Record): Chess[] {
  if (record.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported Chess960 schema ${record.schemaVersion}`);
  const all = [positionFrom(record.initialFen)];
  for (const uci of record.moves) {
    const position = all[all.length - 1].clone();
    const move = parseUci(uci);
    if (!move || !('from' in move) || !position.isLegal(move)) throw new Error(`illegal saved move ${uci}`);
    position.play(move);
    all.push(position);
  }
  return all;
}

export const replay = (record: Chess960Record): Chess => positions(record).at(-1)!;

/** The castles the side to move may make now, with where king and rook end up. */
export function legalCastles(position: Chess): Castle[] {
  const king = position.board.kingOf(position.turn);
  if (king === undefined) return [];
  const castles: Castle[] = [];
  for (const side of ['kingside', 'queenside'] as const) {
    const rook = position.castles.rook[position.turn][SIDE[side]];
    if (rook === undefined) continue;
    const move: NormalMove = { from: king, to: rook };
    if (!position.isLegal(move)) continue;
    castles.push({
      side,
      uci: makeUci(move),
      king: { from: makeSquare(king), to: makeSquare(kingCastlesTo(position.turn, SIDE[side])) },
      rook: { from: makeSquare(rook), to: makeSquare(rookCastlesTo(position.turn, SIDE[side])) },
    });
  }
  return castles;
}

/** Plays an action: the new record and the saved move, or why it was refused (nothing changes). */
export function applyAction(
  record: Chess960Record,
  action: Chess960Action,
): { record: Chess960Record; move: string } | { error: ActionError } {
  const position = replay(record);
  if (status(record).kind !== 'playing') return { error: 'game_over' };
  let move: NormalMove;
  if (action.type === 'castle') {
    const castle = legalCastles(position).find((c) => c.side === action.side);
    if (!castle) return { error: 'illegal_castle' };
    move = parseUci(castle.uci) as NormalMove;
  } else {
    const from = parseSquare(action.from);
    const to = parseSquare(action.to);
    if (from === undefined || to === undefined) return { error: 'bad_square' };
    move = { from, to, ...(action.promotion ? { promotion: PROMOTION[action.promotion] } : {}) };
    // A king move chessops would read as castling (two squares, or onto its own rook) must
    // come as an explicit castle, so an ordinary-looking move never castles by accident.
    if (castlingSide(position, move)) return { error: 'use_castle_action' };
    if (!position.isLegal(move)) return { error: 'illegal_move' };
  }
  const saved = makeUci(move);
  return { record: { ...record, moves: [...record.moves, saved] }, move: saved };
}

/** Our outcome policy, the same as standard chess: draws by repetition and fifty moves are automatic. */
export function status(record: Chess960Record): Status {
  const all = positions(record);
  const position = all[all.length - 1];
  if (position.isCheckmate()) return { kind: 'checkmate', winner: position.turn === 'white' ? 'b' : 'w' };
  if (position.isStalemate()) return { kind: 'draw', reason: 'stalemate' };
  if (position.isInsufficientMaterial()) return { kind: 'draw', reason: 'insufficient-material' };
  // FIDE identity: same board, side to move, castling rights and legal en passant.
  if (all.filter((p) => equalsIgnoreMoves(p, position)).length >= 3) return { kind: 'draw', reason: 'threefold-repetition' };
  if (position.halfmoves >= 100) return { kind: 'draw', reason: 'fifty-move-rule' };
  return { kind: 'playing', turn: short(position.turn), check: position.isCheck() };
}

/** Moves in standard notation (castling as O-O / O-O-O). */
export function sanMoves(record: Chess960Record): string[] {
  const all = positions(record);
  return record.moves.map((uci, i) => makeSan(all[i], parseUci(uci)!));
}

/** Current position as FEN (Shredder castling), for display and fixtures. */
export const fenOf = (record: Chess960Record): string => makeFen(replay(record).toSetup());

const ROLE_LETTER: Record<Role, 'k' | 'q' | 'r' | 'b' | 'n' | 'p'> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'];

/** Captured pieces per capturing side, as for standard chess (#44). Castling never captures. */
export function capturedPieces(record: Chess960Record): Record<'w' | 'b', ('q' | 'r' | 'b' | 'n' | 'p')[]> {
  const captured: Record<'w' | 'b', ('q' | 'r' | 'b' | 'n' | 'p')[]> = { w: [], b: [] };
  const all = positions(record);
  record.moves.forEach((uci, i) => {
    const before = all[i];
    const move = parseUci(uci) as NormalMove;
    if (castlingSide(before, move)) return;
    const victim = before.board.get(move.to);
    if (victim && victim.color !== before.turn) {
      captured[short(before.turn)].push(ROLE_LETTER[victim.role] as 'q' | 'r' | 'b' | 'n' | 'p');
    } else if (before.board.get(move.from)?.role === 'pawn' && (move.to - move.from) % 8 !== 0) {
      captured[short(before.turn)].push('p'); // en passant: a diagonal pawn move to an empty square
    }
  });
  for (const list of Object.values(captured)) list.sort((a, b) => CAPTURE_ORDER.indexOf(a) - CAPTURE_ORDER.indexOf(b));
  return captured;
}
