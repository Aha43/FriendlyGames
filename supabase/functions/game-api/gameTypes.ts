// Game types (#53). The common service (api.ts) owns players, invitations, transactions,
// revisions, request IDs, results and history; a small adapter per stored (game_type,
// schema_version) owns that type's start, saved payload, legal actions, turn and outcome.
// A static registry picks the adapter; there is no plugin discovery. Both current and planned
// types are chess-family (White/Black seats, white/black/draw results), which the common
// service still assumes: a future non-chess type would bring its own seats/results too.
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

export type Seat = 'white' | 'black';

/** An action the adapter defines (a resignation is common and never reaches it). */
export type TypedAction = { type: string } & Record<string, unknown>;

/** How an accepted action is stored in game_actions: also the canonical form for request-ID dedupe. */
export interface StoredAction {
  kind: string;
  move: string | null;
}

export type ApplyResult =
  | { payload: unknown; outcome: { result: GameResult; termination: Termination } | null }
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
  /** The stored form of an action, computed before legality so retries can be recognised. */
  stored(action: TypedAction): StoredAction;
  /** Plays an action for `seat` (already known to be the side to move). Nothing is saved on error. */
  apply(payload: unknown, seat: Seat, action: TypedAction): ApplyResult;
}

// ---------- standard chess (chess.js), schema 1: unchanged since the first release ----------

type ChessPayload = { initialFen: string; moves: string[] };
const SQUARE = /^[a-h][1-8]$/;
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
  parseAction(raw) {
    if (raw?.type !== 'move') return null;
    const { from, to, promotion } = raw;
    const valid =
      typeof from === 'string' && SQUARE.test(from) &&
      typeof to === 'string' && SQUARE.test(to) &&
      (promotion === undefined || (typeof promotion === 'string' && ['q', 'r', 'b', 'n'].includes(promotion)));
    return valid ? { type: 'move', from, to, ...(promotion ? { promotion } : {}) } : null;
  },
  stored: (action) => ({ kind: 'move', move: `${action.from}${action.to}${action.promotion ?? ''}` }),
  apply(payload, _seat, action) {
    const next = applyMove(record(payload), action.from as string, action.to as string, action.promotion as PromotionPiece | undefined);
    if (!next) return { error: { status: 422, code: 'illegal_move', message: 'That move is not allowed.' } };
    return {
      payload: { initialFen: next.initialFen, moves: next.moves },
      outcome: outcomeOf(gameStatus(replay(next))),
    };
  },
};

// ---------- registry ----------

const ADAPTERS: GameTypeAdapter[] = [chess];

/** Types new games can be created as. `chess960` is reserved for #54 and not enabled yet. */
export const ENABLED_TYPES: readonly string[] = ['chess'];

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
