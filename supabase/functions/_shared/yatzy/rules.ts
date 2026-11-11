// Yatzy rules (#84): the Norwegian five-dice, fifteen-row scorecard with the owner's house rules
// (Forced/Free order and banked throws), as agreed in docs/sprint-07.md. Shared by the server and
// the browser. Pure and deterministic: the dice of every throw are supplied by the caller (the
// server rolls them) and saved in the record, so replaying a record always gives the same state.
// No dependencies.

/** The fifteen rows, in scorecard order (Forced fills them in exactly this order). */
export const ROWS = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'onePair',
  'twoPairs',
  'threeOfAKind',
  'fourOfAKind',
  'smallStraight',
  'largeStraight',
  'fullHouse',
  'chance',
  'yatzy',
] as const;
export type Row = (typeof ROWS)[number];

/** The upper section (ones to sixes) and its bonus. */
export const UPPER_ROWS: readonly Row[] = ROWS.slice(0, 6);
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 50;

export const DICE = 5;
/** Throws per turn that cost nothing; each further throw spends one banked token. */
export const FREE_THROWS = 3;
/** Tokens banked when a row is scored after throw 1, 2 or 3 (index 0, 1, 2); none after that. */
export const BANKED = [2, 1, 0] as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export type Mode = 'forced' | 'free';
export type Die = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The saved record (games.payload for game_type 'yatzy', schema 1). Players are seat indexes
 * 0..players-1 in turn order (seat p1 is index 0, the host). Every throw saves the five dice it
 * produced and the positions kept from the previous throw.
 */
export interface YatzyRecord {
  schemaVersion: 1;
  mode: Mode;
  players: number;
  log: LogEntry[];
}

export type LogEntry = { t: 'throw'; keep: number[]; dice: Die[] } | { t: 'score'; row: Row };

export interface PlayerState {
  scores: Partial<Record<Row, number>>;
  tokens: number;
}

/** The turn in progress: zero throws means the current player has not thrown yet. */
export interface TurnState {
  throws: number;
  dice: Die[] | null;
  /** The positions kept on the latest throw (empty on a first throw). */
  kept: number[];
}

export interface YatzyState {
  mode: Mode;
  players: PlayerState[];
  /** Seat index of the player to act; null once finished. */
  current: number | null;
  turn: TurnState;
  finished: boolean;
}

export type RuleError = { code: string; message: string };
const fail = (code: string, message: string): { error: RuleError } => ({ error: { code, message } });

// ---------------------------------------------------------------------------------------------
// Scoring

function counts(dice: readonly Die[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

const sum = (dice: readonly Die[]) => dice.reduce((a, d) => a + d, 0);

/** The highest face shown at least `n` times, or 0. */
function highestWith(c: number[], n: number): number {
  for (let face = 6; face >= 1; face--) if (c[face] >= n) return face;
  return 0;
}

/** Points the five dice score in `row`; zero when they don't match it. */
export function scoreRow(row: Row, dice: readonly Die[]): number {
  if (dice.length !== DICE) throw new RangeError('a Yatzy score needs five dice');
  const c = counts(dice);
  const upper = UPPER_ROWS.indexOf(row);
  if (upper >= 0) return c[upper + 1] * (upper + 1);
  switch (row) {
    case 'onePair':
      return highestWith(c, 2) * 2;
    case 'twoPairs': {
      // Two different faces, each shown at least twice: the two highest such faces.
      const pairs = [6, 5, 4, 3, 2, 1].filter((face) => c[face] >= 2);
      return pairs.length >= 2 ? (pairs[0] + pairs[1]) * 2 : 0;
    }
    case 'threeOfAKind':
      return highestWith(c, 3) * 3;
    case 'fourOfAKind':
      return highestWith(c, 4) * 4;
    case 'smallStraight':
      return [1, 2, 3, 4, 5].every((face) => c[face] === 1) ? 15 : 0;
    case 'largeStraight':
      return [2, 3, 4, 5, 6].every((face) => c[face] === 1) ? 20 : 0;
    case 'fullHouse':
      // A triple and a pair of different faces; five equal dice are not a full house.
      return c.includes(3) && c.includes(2) ? sum(dice) : 0;
    case 'chance':
      return sum(dice);
    case 'yatzy':
      return c.includes(5) ? 50 : 0;
  }
  throw new RangeError(`unknown row ${row as string}`);
}

export function upperSum(player: PlayerState): number {
  return UPPER_ROWS.reduce((a, row) => a + (player.scores[row] ?? 0), 0);
}

export function upperBonus(player: PlayerState): number {
  return upperSum(player) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function total(player: PlayerState): number {
  return ROWS.reduce((a, row) => a + (player.scores[row] ?? 0), 0) + upperBonus(player);
}

/** Tokens a turn banks when it scores after `throws` throws: 2, 1, 0, then 0 once a token was spent. */
export function tokensBanked(throws: number): number {
  return throws >= 1 && throws <= BANKED.length ? BANKED[throws - 1] : 0;
}

// ---------------------------------------------------------------------------------------------
// Turns

export function newRecord(mode: Mode, players: number): YatzyRecord {
  if (mode !== 'forced' && mode !== 'free') throw new RangeError(`unknown mode ${mode as string}`);
  if (!Number.isInteger(players) || players < MIN_PLAYERS || players > MAX_PLAYERS) {
    throw new RangeError(`Yatzy needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  return { schemaVersion: 1, mode, players, log: [] };
}

function startState(record: YatzyRecord): YatzyState {
  return {
    mode: record.mode,
    players: Array.from({ length: record.players }, () => ({ scores: {}, tokens: 0 })),
    current: 0,
    turn: { throws: 0, dice: null, kept: [] },
    finished: false,
  };
}

/** The rows the current player may score now: the next empty row (Forced) or any empty row (Free). */
export function openRows(state: YatzyState): Row[] {
  if (state.current === null || state.turn.throws === 0) return [];
  const scores = state.players[state.current].scores;
  const empty = ROWS.filter((row) => scores[row] === undefined);
  return state.mode === 'forced' ? empty.slice(0, 1) : empty;
}

/** Whether the current player may throw again, and what it costs. */
export function throwCost(state: YatzyState): { allowed: boolean; tokens: number } {
  if (state.current === null) return { allowed: false, tokens: 0 };
  if (state.turn.throws < FREE_THROWS) return { allowed: true, tokens: 0 };
  return { allowed: state.players[state.current].tokens >= 1, tokens: 1 };
}

/** What scoring `row` now would record: shown before committing. */
export function preview(state: YatzyState, row: Row): { points: number; tokens: number } | null {
  if (!openRows(state).includes(row) || !state.turn.dice) return null;
  return { points: scoreRow(row, state.turn.dice), tokens: tokensBanked(state.turn.throws) };
}

function isDie(value: unknown): value is Die {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;
}

/** Positions to keep: distinct, 0–4, sorted, never all five. */
export function normalizeKeep(keep: unknown): number[] | null {
  if (!Array.isArray(keep) || keep.length >= DICE) return null;
  if (!keep.every((p) => Number.isInteger(p) && p >= 0 && p < DICE)) return null;
  const sorted = [...new Set(keep as number[])].sort((a, b) => a - b);
  return sorted.length === keep.length ? sorted : null;
}

/** Applies one entry to a state (mutating a copy made by replay). Returns an error if illegal. */
function step(state: YatzyState, entry: LogEntry): RuleError | null {
  if (state.current === null) return { code: 'game_finished', message: 'The game is over.' };
  const player = state.players[state.current];
  if (entry.t === 'throw') {
    const keep = normalizeKeep(entry.keep);
    if (!keep) return { code: 'bad_keep', message: 'Keep up to four dice, each once.' };
    if (state.turn.throws === 0 && keep.length > 0) return { code: 'bad_keep', message: 'The first throw rolls all five dice.' };
    const cost = throwCost(state);
    if (!cost.allowed) return { code: 'no_tokens', message: 'No banked tokens left for another throw.' };
    if (!Array.isArray(entry.dice) || entry.dice.length !== DICE || !entry.dice.every(isDie)) {
      return { code: 'bad_dice', message: 'A throw records five dice.' };
    }
    if (keep.some((p) => state.turn.dice![p] !== entry.dice[p])) {
      return { code: 'bad_dice', message: 'Kept dice cannot change.' };
    }
    player.tokens -= cost.tokens;
    state.turn = { throws: state.turn.throws + 1, dice: [...entry.dice], kept: keep };
    return null;
  }
  if (entry.t === 'score') {
    if (state.turn.throws === 0) return { code: 'not_thrown', message: 'Throw the dice before scoring.' };
    if (!ROWS.includes(entry.row)) return { code: 'bad_row', message: 'Unknown scorecard row.' };
    if (player.scores[entry.row] !== undefined) return { code: 'row_used', message: 'That row is already scored.' };
    if (!openRows(state).includes(entry.row)) {
      return { code: 'row_order', message: 'Forced order: score the next row on the card.' };
    }
    player.scores[entry.row] = scoreRow(entry.row, state.turn.dice!);
    player.tokens += tokensBanked(state.turn.throws);
    const done = state.players.every((p) => ROWS.every((row) => p.scores[row] !== undefined));
    state.finished = done;
    state.current = done ? null : (state.current + 1) % state.players.length;
    state.turn = { throws: 0, dice: null, kept: [] };
    return null;
  }
  return { code: 'bad_entry', message: 'Unknown Yatzy action.' };
}

/** Rebuilds the state from a saved record, checking every entry. */
export function replay(record: YatzyRecord): YatzyState | { error: RuleError } {
  if (record?.schemaVersion !== 1 || !Array.isArray(record.log)) return fail('bad_record', 'Not a Yatzy record.');
  let state: YatzyState;
  try {
    state = startState(record);
    if (record.players < MIN_PLAYERS || record.players > MAX_PLAYERS) throw new RangeError();
  } catch {
    return fail('bad_record', 'Not a Yatzy record.');
  }
  for (const [i, entry] of record.log.entries()) {
    const error = step(state, entry);
    if (error) return fail(error.code, `Entry ${i}: ${error.message}`);
  }
  return state;
}

/** One throw: keeps `keep` and asks `roll` for the other dice. Returns the extended record. */
export function applyThrow(
  record: YatzyRecord,
  keep: unknown,
  roll: (count: number) => Die[],
): { record: YatzyRecord; state: YatzyState } | { error: RuleError } {
  const state = replay(record);
  if ('error' in state) return state;
  const kept = normalizeKeep(keep);
  if (!kept) return fail('bad_keep', 'Keep up to four dice, each once.');
  const fresh = roll(DICE - kept.length);
  const dice: Die[] = [];
  let next = 0;
  for (let p = 0; p < DICE; p++) dice.push(kept.includes(p) && state.turn.dice ? state.turn.dice[p] : fresh[next++]);
  return extend(record, state, { t: 'throw', keep: kept, dice });
}

/** Scores `row` with the current dice, ending the turn. */
export function applyScore(record: YatzyRecord, row: Row): { record: YatzyRecord; state: YatzyState } | { error: RuleError } {
  const state = replay(record);
  if ('error' in state) return state;
  return extend(record, state, { t: 'score', row });
}

function extend(record: YatzyRecord, state: YatzyState, entry: LogEntry) {
  const error = step(state, entry);
  if (error) return { error };
  return { record: { ...record, log: [...record.log, entry] }, state };
}

// ---------------------------------------------------------------------------------------------
// Result

export interface Standing {
  seat: number;
  total: number;
  tokens: number;
  /** 1 for the winner(s); players equal on both points and tokens share a place. */
  place: number;
}

/** Ranked by total, then unused tokens; equal on both means the same place (joint winners at 1). */
export function standings(state: YatzyState): Standing[] {
  const rows = state.players.map((p, seat) => ({ seat, total: total(p), tokens: p.tokens }));
  rows.sort((a, b) => b.total - a.total || b.tokens - a.tokens || a.seat - b.seat);
  return rows.map((row, i) => {
    let first = i;
    while (first > 0 && rows[first - 1].total === row.total && rows[first - 1].tokens === row.tokens) first--;
    return { ...row, place: first + 1 };
  });
}

export function winners(state: YatzyState): number[] {
  return standings(state)
    .filter((s) => s.place === 1)
    .map((s) => s.seat);
}
