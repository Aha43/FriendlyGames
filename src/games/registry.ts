// The game types this client can show (#53). The server only sends games of these types
// (`types` on every request), and a game page is chosen by the type's family.
import type { SharedGame } from '../shared/gameApi';

export type GameFamily = 'chess';

/** Each type with the saved schema versions this client can replay. */
export const GAME_TYPES: Record<string, { label: string; family: GameFamily; schemaVersions: readonly number[] }> = {
  chess: { label: 'Chess', family: 'chess', schemaVersions: [1] },
};

/** Sent as `types` with every game request. */
export const SUPPORTED_TYPES: readonly string[] = Object.keys(GAME_TYPES);

/** A chess-family game whose saved record this client can replay. */
export type ChessGame = SharedGame & { chess: NonNullable<SharedGame['chess']> };

export function isChessGame(game: SharedGame): game is ChessGame {
  const known = GAME_TYPES[game.type];
  return known?.family === 'chess' && known.schemaVersions.includes(game.schemaVersion) && game.chess !== undefined;
}

export const UNSUPPORTED_GAME_TEXT = 'This game needs a newer version of FriendlyGames. Reload the page to update.';
