// Game types (#53). The common service (api.ts) owns players, invitations, transactions,
// revisions, request IDs, results and history; a small adapter per stored (game_type,
// schema_version) owns that type's start, saved payload, legal actions, turn and outcome.
// A static registry picks the adapter; there is no plugin discovery. Both types are
// chess-family (White/Black seats, white/black/draw results), which the common service still
// assumes: a future non-chess type would bring its own seats/results too.
import {
  applyMove,
  gameStatus,
  newGame,
  outcomeOf,
  replay,
  type GameRecord,
  type GameResult,
  type PromotionPiece,
  type Termination,
} from '../_shared/chess/game.ts';
import * as fischer from '../_shared/chess960/rules.ts';
import { randomStartIndex, startFen } from '../_shared/chess960/start.ts';

export type Seat = 'white' | 'black';

/** An action the adapter defines (a resignation is common and never reaches it). */
export type TypedAction = { type: string } & Record<string, unknown>;

/** How an accepted action is stored in game_actions. */
export interface StoredAction {
  kind: string;
  move: string | null;
}

export type Outcome = { result: GameResult; termination: Termination };

export type ApplyResult =
  | { payload: unknown; outcome: Outcome | null; stored: StoredAction }
  | { error: { status: number; code: string; message: string } };

export interface GameTypeAdapter {
  type: string;
  schemaVersion: number;
  /** The saved payload of a new game. */
  create(): unknown;
  /** The seat to move in a saved payload. */
  turn(payload: unknown): Seat;
  moveCount(payload: unknown): number;
  /** The type-specific part of a game view, merged into it (e.g. `{ chess: {…} }`). */
  view(payload: unknown): Record<string, unknown>;
  /** A request's action in this type's shape, or null if it is not one (the API answers 400). */
  parseAction(raw: Record<string, unknown> | undefined): TypedAction | null;
  /**
   * Whether the action stored earlier under the same request ID is this request's action. It is
   * decided from what the request asks for, never from the board now: a retry may arrive after
   * the turn or the castling rights have changed.
   */
  isRetryOf(earlier: StoredAction, action: TypedAction): boolean;
  /** Plays an action for `seat` (already known to be the side to move). Nothing is saved on error. */
  apply(payload: unknown, seat: Seat, action: TypedAction): ApplyResult;
}

// ---------- standard chess (chess.js), schema 1: unchanged since the first release ----------

type ChessPayload = { initialFen: string; moves: string[] };
const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = ['q', 'r', 'b', 'n'];

/** `{type: 'move', from, to, promotion?}` with valid squares, or null. */
function parseMove(raw: Record<string, unknown> | undefined): TypedAction | null {
  if (raw?.type !== 'move') return null;
  const { from, to, promotion } = raw;
  const valid =
    typeof from === 'string' && SQUARE.test(from) &&
    typeof to === 'string' && SQUARE.test(to) &&
    (promotion === undefined || (typeof promotion === 'string' && PROMOTIONS.includes(promotion)));
  return valid ? { type: 'move', from, to, ...(promotion ? { promotion } : {}) } : null;
}

const uciOf = (action: TypedAction) => `${action.from}${action.to}${action.promotion ?? ''}`;
const ILLEGAL_MOVE = { status: 422, code: 'illegal_move', message: 'That move is not allowed.' } as const;
const record = (payload: unknown): GameRecord => ({ schemaVersion: 1, ...(payload as ChessPayload) });
const chessTurn = (payload: unknown): Seat => (replay(record(payload)).turn() === 'w' ? 'white' : 'black');

export const chess: GameTypeAdapter = {
  type: 'chess',
  schemaVersion: 1,
  create() {
    const { initialFen, moves } = newGame();
    return { initialFen, moves };
  },
  turn: chessTurn,
  moveCount: (payload) => (payload as ChessPayload).moves.length,
  view: (payload) => ({ chess: { ...(payload as ChessPayload), turn: chessTurn(payload) } }),
  parseAction: parseMove,
  isRetryOf: (earlier, action) => earlier.kind === 'move' && earlier.move === uciOf(action),
  apply(payload, _seat, action) {
    const next = applyMove(record(payload), action.from as string, action.to as string, action.promotion as PromotionPiece | undefined);
    if (!next) return { error: ILLEGAL_MOVE };
    return {
      payload: { initialFen: next.initialFen, moves: next.moves },
      outcome: outcomeOf(gameStatus(replay(next))),
      stored: { kind: 'move', move: uciOf(action) },
    };
  },
};

// ---------- Fischer Random (chessops), schema 1: docs/decisions/0001-chess960-engine.md ----------

// Saved like chess, { initialFen, moves }, with the version in games.schema_version. The start
// is Shredder-FEN; a castle is saved as the king onto its own rook ("f1h1").
type FischerPayload = { initialFen: string; moves: string[] };
const fischerRecord = (payload: unknown): fischer.Chess960Record => ({
  schemaVersion: fischer.SCHEMA_VERSION,
  ...(payload as FischerPayload),
});
const fischerTurn = (payload: unknown): Seat => fischer.replay(fischerRecord(payload)).turn;

/**
 * The side of a saved castle, from the saved move alone: the king moves onto its own rook,
 * and the kingside rook is the one to the king's right (higher file), wherever it started.
 */
export const castleSideOf = (uci: string): fischer.CastleSide => (uci.charCodeAt(2) > uci.charCodeAt(0) ? 'kingside' : 'queenside');

const FISCHER_ERRORS: Record<fischer.ActionError, { status: number; code: string; message: string }> = {
  bad_square: { status: 400, code: 'bad_request', message: 'That is not a square.' },
  illegal_move: ILLEGAL_MOVE,
  use_castle_action: { status: 422, code: 'use_castle_action', message: 'To castle, use the castle action.' },
  illegal_castle: { status: 422, code: 'illegal_castle', message: 'You can’t castle on that side now.' },
  game_over: { status: 409, code: 'game_finished', message: 'This game is over.' },
};

function fischerOutcome(record: fischer.Chess960Record): Outcome | null {
  const status = fischer.status(record);
  if (status.kind === 'checkmate') return { result: status.winner === 'w' ? 'white' : 'black', termination: 'checkmate' };
  if (status.kind === 'draw') return { result: 'draw', termination: status.reason };
  return null;
}

export const chess960: GameTypeAdapter = {
  type: 'chess960',
  schemaVersion: fischer.SCHEMA_VERSION,
  // Called once per new game, inside the insert: a retried creation or rematch finds the saved
  // game and its start, and never draws a new one.
  create: () => ({ initialFen: startFen(randomStartIndex()), moves: [] }),
  turn: fischerTurn,
  moveCount: (payload) => (payload as FischerPayload).moves.length,
  view: (payload) => ({ chess960: { ...(payload as FischerPayload), turn: fischerTurn(payload) } }),
  parseAction(raw) {
    if (raw?.type === 'castle') {
      return raw.side === 'kingside' || raw.side === 'queenside' ? { type: 'castle', side: raw.side } : null;
    }
    return parseMove(raw);
  },
  isRetryOf(earlier, action) {
    if (action.type === 'castle') return earlier.kind === 'castle' && earlier.move !== null && castleSideOf(earlier.move) === action.side;
    return earlier.kind === 'move' && earlier.move === uciOf(action);
  },
  apply(payload, _seat, action) {
    const applied = fischer.applyAction(fischerRecord(payload), action as fischer.Chess960Action);
    if ('error' in applied) return { error: FISCHER_ERRORS[applied.error] };
    return {
      payload: { initialFen: applied.record.initialFen, moves: applied.record.moves },
      outcome: fischerOutcome(applied.record),
      stored: { kind: action.type === 'castle' ? 'castle' : 'move', move: applied.move },
    };
  },
};

// ---------- registry ----------

const ADAPTERS: GameTypeAdapter[] = [chess, chess960];

/** Types new games can be created as (by a client that reads them). */
export const ENABLED_TYPES: readonly string[] = ['chess', 'chess960'];

/** The adapter for a stored game, or null when this server cannot read it (kept untouched). */
export function adapterFor(type: string, schemaVersion: number): GameTypeAdapter | null {
  return ADAPTERS.find((a) => a.type === type && a.schemaVersion === schemaVersion) ?? null;
}

/** The adapter new games of `type` are created with, or null if the type is not enabled. */
export function creatableAdapter(type: string): GameTypeAdapter | null {
  return ENABLED_TYPES.includes(type) ? (ADAPTERS.find((a) => a.type === type) ?? null) : null;
}

/**
 * The types a client can read, from its `types` query parameter (#53): e.g. `types=chess,chess960`.
 * Omitted means chess only, which is what every client before #53 expects (it reads `.chess`).
 * Unknown names are ignored, so a newer client can ask for types an older server lacks.
 */
export function clientTypes(url: URL): string[] {
  const asked = url.searchParams.get('types');
  if (asked === null) return ['chess'];
  return asked.split(',').map((t) => t.trim()).filter((t) => ADAPTERS.some((a) => a.type === t));
}
