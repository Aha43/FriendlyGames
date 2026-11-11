// Game types (#53). The common service (api.ts) owns players, invitations, transactions,
// revisions, request IDs, results and history; a small adapter per stored (game_type,
// schema_version) owns that type's start, saved payload, legal actions, turn and outcome.
// A static registry picks the adapter; there is no plugin discovery. Chess and Fischer Random
// are chess-family (White/Black seats, white/black/draw results, pairwise history, resignation,
// rematch, email invitations). Yatzy (#85) is a table of two to four ordered seats with one
// ranking per table; its adapter says which of the common flows apply.
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
import * as yatzyRules from '../_shared/yatzy/rules.ts';

export type ChessSeat = 'white' | 'black';
export type TableSeat = 'p1' | 'p2' | 'p3' | 'p4';
export type Seat = ChessSeat | TableSeat;

/** An action the adapter defines (a resignation is common and never reaches it). */
export type TypedAction = { type: string } & Record<string, unknown>;

/** How an accepted action is stored in game_actions. */
export interface StoredAction {
  kind: string;
  move: string | null;
}

/** How a game ended: a chess result, or `scored` for a Yatzy table (its ranking is in the view). */
export type Outcome = { result: GameResult | 'scored'; termination: Termination | 'scorecards-complete' };

export type ApplyResult =
  | { payload: unknown; outcome: Outcome | null; stored: StoredAction }
  | { error: { status: number; code: string; message: string } };

export interface GameTypeAdapter {
  type: string;
  schemaVersion: number;
  /**
   * `chess`: two seats (White/Black), created for an email or one previous opponent, with
   * resignation, rematch and per-opponent history. `table`: ordered seats p1.., created for a
   * roster of previous opponents, with none of those and one ranking per table.
   */
  family: 'chess' | 'table';
  /** The saved payload of a new game (`options` are the type's own, already validated). */
  create(options?: unknown): unknown;
  /**
   * Whether the seated players fit the saved game: the right kind of seats, their count and
   * order. A game that fails is never shown or played (its rows are left untouched).
   */
  seatsValid(payload: unknown, seats: string[]): boolean;
  /** The seat to move in a saved payload; null when nobody is to move (a finished table). */
  turn(payload: unknown): Seat | null;
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

/** Chess-family seats: White and/or Black (Black is empty while an invitation is open). */
const chessSeatsValid = (_payload: unknown, seats: string[]) =>
  seats.length <= 2 && seats.every((seat) => seat === 'white' || seat === 'black') && new Set(seats).size === seats.length;

export const chess: GameTypeAdapter = {
  type: 'chess',
  schemaVersion: 1,
  family: 'chess',
  seatsValid: chessSeatsValid,
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
  family: 'chess',
  seatsValid: chessSeatsValid,
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

// ---------- Yatzy, schema 1: docs/decisions/0002-yatzy-format.md ----------

// Saved as { mode, players, log } with the version in games.schema_version. The log holds every
// throw (kept positions and the five dice the server rolled) and every scored row; scores, token
// balances and the turn in progress are replayed from it, never stored or sent by a client.
type YatzyPayload = { mode: yatzyRules.Mode; players: number; log: yatzyRules.LogEntry[] };
const yatzyRecord = (payload: unknown): yatzyRules.YatzyRecord => ({ schemaVersion: 1, ...(payload as YatzyPayload) });

export const TABLE_SEATS: readonly TableSeat[] = ['p1', 'p2', 'p3', 'p4'];
const seatOf = (index: number): TableSeat => TABLE_SEATS[index];

function yatzyState(payload: unknown): yatzyRules.YatzyState {
  const state = yatzyRules.replay(yatzyRecord(payload));
  // Only this server writes these payloads, each one checked by the same rules before saving.
  if ('error' in state) throw new Error(`unreadable Yatzy record: ${state.error.code}`);
  return state;
}

/** One die, 1–6, each equally likely: bytes that would bias the result are drawn again. */
export function rollDice(count: number): yatzyRules.Die[] {
  const dice: yatzyRules.Die[] = [];
  while (dice.length < count) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < 252 && dice.length < count) dice.push(((byte % 6) + 1) as yatzyRules.Die);
    }
  }
  return dice;
}

/** The intent a retried throw or score is compared with, saved as the action's notation. */
const keepNotation = (keep: number[]) => `keep:${keep.join('')}`;
const rowNotation = (row: string) => `row:${row}`;

// Shapes are refused with 400 before this; these are requests the rules do not allow now.
const YATZY_ERRORS: Record<string, { status: number; message: string }> = {
  game_finished: { status: 409, message: 'This game is over.' },
  bad_keep: { status: 422, message: 'The first throw rolls all five dice; later throws keep up to four.' },
  no_tokens: { status: 422, message: 'You have no banked throws left.' },
  not_thrown: { status: 422, message: 'Throw the dice before scoring.' },
  row_used: { status: 422, message: 'That row is already scored.' },
  row_order: { status: 422, message: 'Forced order: score the next row on the card.' },
};

/** `roll` supplies new dice; only tests replace it. */
export function yatzyAdapter(roll: (count: number) => yatzyRules.Die[] = rollDice): GameTypeAdapter {
  return {
    type: 'yatzy',
    schemaVersion: 1,
    family: 'table',
    create(options) {
      const { mode, players } = options as { mode: yatzyRules.Mode; players: number };
      const { log } = yatzyRules.newRecord(mode, players);
      return { mode, players, log } satisfies YatzyPayload;
    },
    // Exactly p1..pN in order, N being the player count the record was created with.
    seatsValid(payload, seats) {
      const players = (payload as Partial<YatzyPayload> | null)?.players;
      if (typeof players !== 'number' || seats.length !== players) return false;
      const sorted = [...seats].sort();
      return sorted.every((seat, index) => seat === TABLE_SEATS[index]);
    },
    turn(payload) {
      const { current } = yatzyState(payload);
      return current === null ? null : seatOf(current);
    },
    moveCount: (payload) => (payload as YatzyPayload).log.length,
    view(payload) {
      const state = yatzyState(payload);
      return {
        yatzy: {
          mode: state.mode,
          current: state.current === null ? null : seatOf(state.current),
          // The turn in progress: the latest committed throw, what was kept for it, and its number.
          turn: state.turn,
          players: state.players.map((player, index) => ({
            seat: seatOf(index),
            scores: player.scores,
            upperSum: yatzyRules.upperSum(player),
            bonus: yatzyRules.upperBonus(player),
            total: yatzyRules.total(player),
            tokens: player.tokens,
          })),
          // Ranked by total, then unused tokens; equal on both share a place. Only once finished.
          standings: state.finished
            ? yatzyRules.standings(state).map(({ seat, ...rest }) => ({ seat: seatOf(seat), ...rest }))
            : null,
          winners: state.finished ? yatzyRules.winners(state).map(seatOf) : null,
        },
      };
    },
    // { type: 'throw', keep: [positions] } or { type: 'score', row }. Nothing else is read: a
    // request that carries dice, points or tokens is refused, never trusted or ignored.
    parseAction(raw) {
      if (raw?.type === 'throw') {
        if (Object.keys(raw).some((key) => key !== 'type' && key !== 'keep')) return null;
        const keep = yatzyRules.normalizeKeep(raw.keep ?? []);
        return keep ? { type: 'throw', keep } : null;
      }
      if (raw?.type === 'score') {
        if (Object.keys(raw).some((key) => key !== 'type' && key !== 'row')) return null;
        return typeof raw.row === 'string' && (yatzyRules.ROWS as readonly string[]).includes(raw.row)
          ? { type: 'score', row: raw.row }
          : null;
      }
      return null;
    },
    isRetryOf(earlier, action) {
      if (action.type === 'throw') return earlier.kind === 'throw' && earlier.move === keepNotation(action.keep as number[]);
      return earlier.kind === 'score' && earlier.move === rowNotation(action.row as string);
    },
    apply(payload, _seat, action) {
      const record = yatzyRecord(payload);
      const applied =
        action.type === 'throw'
          ? yatzyRules.applyThrow(record, action.keep, roll)
          : yatzyRules.applyScore(record, action.row as yatzyRules.Row);
      if ('error' in applied) {
        const known = YATZY_ERRORS[applied.error.code] ?? { status: 422, message: applied.error.message };
        return { error: { status: known.status, code: applied.error.code, message: known.message } };
      }
      const { mode, players, log } = applied.record;
      return {
        payload: { mode, players, log } satisfies YatzyPayload,
        outcome: applied.state.finished ? { result: 'scored', termination: 'scorecards-complete' } : null,
        stored:
          action.type === 'throw'
            ? { kind: 'throw', move: keepNotation(action.keep as number[]) }
            : { kind: 'score', move: rowNotation(action.row as string) },
      };
    },
  };
}

export const yatzy = yatzyAdapter();

/** A new table's options from a creation request, or null if they are not valid. */
export function yatzyOptions(mode: unknown, players: number): { mode: yatzyRules.Mode; players: number } | null {
  if (mode !== 'forced' && mode !== 'free') return null;
  if (players < yatzyRules.MIN_PLAYERS || players > yatzyRules.MAX_PLAYERS) return null;
  return { mode, players };
}

// ---------- registry ----------

const ADAPTERS: GameTypeAdapter[] = [chess, chess960, yatzy];

/** Types new games can be created as (by a client that reads them). */
export const ENABLED_TYPES: readonly string[] = ['chess', 'chess960', 'yatzy'];

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
