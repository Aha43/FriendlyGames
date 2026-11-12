// The game types this client can show (#53, #55). The server only sends games of these types
// (`types` on every request), and a game page is chosen by the type's family.
import { isTable, type AnyGame, type TableGame } from '../shared/gameApi';
import { chessRules } from './chess';
import { chess960Rules } from './chess960';
import type { ChessFamilyRules, ChessRecord } from './chessFamily';

export type GameFamily = 'chess';
export type GameType = 'chess' | 'chess960';

interface GameTypeEntry {
  /** Short name, e.g. in lists and the game picker. */
  label: string;
  family: GameFamily;
  schemaVersions: readonly number[];
  rules: ChessFamilyRules;
  /** Which field of a game view carries this type's saved record. */
  view: 'chess' | 'chess960';
}

/** Each type with the saved schema versions this client can replay. */
export const GAME_TYPES: Record<GameType, GameTypeEntry> = {
  chess: { label: 'Chess', family: 'chess', schemaVersions: [1], rules: chessRules, view: 'chess' },
  chess960: {
    label: 'Fischer Random',
    family: 'chess',
    schemaVersions: [1],
    rules: chess960Rules,
    view: 'chess960',
  },
};

/** Table games (#86): two to four seated players and one ranking; shown by their own page. */
export const TABLE_TYPES = {
  yatzy: { label: 'Yatzy', schemaVersions: [1] as readonly number[] },
} as const;
export type TableType = keyof typeof TABLE_TYPES;

/** Sent as `types` with every game request. */
export const SUPPORTED_TYPES: readonly string[] = [...Object.keys(GAME_TYPES), ...Object.keys(TABLE_TYPES)];

/** The label for a type name from the server, e.g. in history. */
export const typeLabel = (type: string): string =>
  GAME_TYPES[type as GameType]?.label ?? TABLE_TYPES[type as TableType]?.label ?? type;

/** A table this client can show: a known table type in a schema version it reads. */
export function tableView(game: AnyGame): TableGame | null {
  if (!isTable(game)) return null;
  const entry = TABLE_TYPES[game.type as TableType];
  return entry && entry.schemaVersions.includes(game.schemaVersion) && game.yatzy ? game : null;
}

/** A chess-family game whose saved record this client can replay, with the rules to replay it. */
export interface ChessFamilyView {
  type: GameType;
  rules: ChessFamilyRules;
  record: ChessRecord;
}

export function chessFamilyView(game: AnyGame): ChessFamilyView | null {
  const entry = GAME_TYPES[game.type as GameType];
  if (isTable(game) || !entry || entry.family !== 'chess' || !entry.schemaVersions.includes(game.schemaVersion)) return null;
  const saved = game[entry.view];
  if (!saved) return null;
  return {
    type: game.type as GameType,
    rules: entry.rules,
    record: { schemaVersion: 1, initialFen: saved.initialFen, moves: saved.moves },
  };
}

export const UNSUPPORTED_GAME_TEXT = 'This game needs a newer version of FriendlyGames. Reload the page to update.';

/** One line about Fischer Random, at the game picker and on its table. */
export const CHESS960_SUMMARY =
  'The pieces behind the pawns start in one of 960 arrangements, the same for both sides: bishops on opposite colours, the king between the rooks. Every piece moves as usual.';

/** How castling works in Fischer Random, where the picker and the table explain it. */
export const CHESS960_CASTLING =
  'To castle, select your king and use a castle button. King and rook end where they would in ordinary chess: kingside on g and f, queenside on c and d.';
