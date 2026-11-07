// Browser client for the game-api Edge Function (contract: docs/backend.md).
// Never log request headers or bodies: they carry the device credential and invitation tokens.
import { SUPPORTED_TYPES } from '../games/registry';

export type Seat = 'white' | 'black';

export interface PlayerSummary {
  id: string;
  displayName: string;
}

export interface SharedGame {
  id: string;
  /** The game type; only types this client asked for are sent (see src/games/registry.ts). */
  type: string;
  schemaVersion: number;
  status: 'waiting' | 'active' | 'finished';
  result: 'white' | 'black' | 'draw' | null;
  termination:
    | 'checkmate'
    | 'resignation'
    | 'stalemate'
    | 'insufficient-material'
    | 'threefold-repetition'
    | 'fifty-move-rule'
    | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  players: Record<Seat, PlayerSummary | null>;
  yourSeat: Seat;
  /** The seat to move, for any type. */
  turn: Seat;
  /** Moves played so far, for any type. */
  moveCount: number;
  /** Standard chess only. */
  chess?: { initialFen: string; moves: string[]; turn: Seat };
  /** Fischer Random (Chess960) only: Shredder-FEN start, UCI moves, a castle as king onto rook. */
  chess960?: { initialFen: string; moves: string[]; turn: Seat };
  /** The game started from this one with "Play again", if any. */
  rematchGameId: string | null;
}

export interface HistoryEntry {
  gameType: string;
  opponent: PlayerSummary;
  wins: number;
  draws: number;
  losses: number;
  games: {
    id: string;
    finishedAt: string;
    outcome: 'win' | 'loss' | 'draw';
    termination: NonNullable<SharedGame['termination']>;
    yourSeat: Seat;
    moveCount: number;
  }[];
}

export type GameAction =
  | { type: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' }
  /** Fischer Random only: castling is never sent as a king move. */
  | { type: 'castle'; side: 'kingside' | 'queenside' }
  | { type: 'resign' };

/** The server answered with an error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly game?: SharedGame,
  ) {
    super(message);
  }
}

/** The server could not be reached, or did not answer in time. Nothing is known to be saved. */
export class NetworkError extends Error {
  constructor(
    message: string,
    /** True when no answer came within the time limit (as opposed to a refused or dropped connection). */
    readonly timedOut = false,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

/** Configured URL, or the local Supabase stack on the host serving the page (works from a phone on the LAN). */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_GAME_API_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  return `${window.location.protocol}//${window.location.hostname}:56321/functions/v1/game-api`;
}

/**
 * How a request may be repeated after a momentary server failure.
 * - 'safe': repeating cannot do anything twice (reads, and writes the server deduplicates by
 *   request ID or by design). Repeated after network failures and 500/502/503/504.
 * - 'never': not repeated automatically. For writes the server cannot deduplicate: no status
 *   (not even 503) proves the server did not apply them, so only the player decides to try again.
 */
type Repeat = 'safe' | 'never';

/** Pauses before each repeat. Short: these failures are a server worker restarting. */
export const RETRY_DELAYS_MS = [400, 1200];

function repeatable(error: unknown, repeat: Repeat): boolean {
  if (repeat === 'never') return false;
  if (error instanceof ApiError) return [500, 502, 503, 504].includes(error.status);
  // A timeout already cost 10 s; repeating it would leave the player waiting far too long.
  return error instanceof NetworkError && !error.timedOut;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  credential?: string,
  body?: unknown,
  repeat: Repeat = 'safe',
): Promise<T> {
  // Every game request says which game types this client can show (#53); the server sends no others.
  const url = path === '/players' ? path : `${path}${path.includes('?') ? '&' : '?'}types=${SUPPORTED_TYPES.join(',')}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptRequest<T>(method, url, credential, body);
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !repeatable(error, repeat)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function attemptRequest<T>(method: 'GET' | 'POST', path: string, credential?: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(credential ? { 'X-Device-Credential': credential } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError('Could not reach the game server.', controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // fall through with null
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; game?: SharedGame } } | null)?.error;
    const game = error?.game ? withCommonFields(error.game) : undefined;
    throw new ApiError(response.status, error?.code ?? 'unknown', error?.message ?? 'Request failed.', game);
  }
  if (data && typeof data === 'object') {
    const body = data as { game?: SharedGame; games?: SharedGame[] };
    if (body.game) body.game = withCommonFields(body.game);
    if (Array.isArray(body.games)) body.games = body.games.map(withCommonFields);
  }
  return data as T;
}

/**
 * A backend from before #53 sends chess games without the common `turn` and `moveCount`.
 * The web client publishes on merge, before the owner deploys the backend, so fill them in
 * from the chess view rather than show "undefined moves" in the meantime.
 */
function withCommonFields(game: SharedGame): SharedGame {
  if ((game.turn !== undefined && game.moveCount !== undefined) || !game.chess) return game;
  return { ...game, turn: game.turn ?? game.chess.turn, moveCount: game.moveCount ?? game.chess.moves.length };
}

export const gameApi = {
  /**
   * Email entry (prototype, #29): opens the player with this email in this browser, or creates one
   * when `displayName` is given and the email is new (`player_not_found` without it). Safe to
   * repeat: a repeat reaches the same player and leaves the player's other browsers signed in.
   */
  enterPlayer: (email: string, displayName?: string) =>
    request<{ player: PlayerSummary & { email: string }; deviceCredential: string; created: boolean }>(
      'POST',
      '/players',
      undefined,
      displayName === undefined ? { email } : { email, displayName },
    ),
  me: (credential: string) => request<{ player: PlayerSummary & { email: string } }>('GET', '/me', credential),
  listGames: (credential: string) => request<{ games: SharedGame[] }>('GET', '/games', credential),
  /** Finished games per opponent with an exact tally. */
  history: (credential: string) => request<{ history: HistoryEntry[] }>('GET', '/history', credential),
  /** A new game with the same two players, colours swapped. Both players asking get the same game. */
  rematch: (credential: string, id: string) =>
    request<{ game: SharedGame; duplicate: boolean }>('POST', `/games/${encodeURIComponent(id)}/rematch`, credential),
  getGame: (credential: string, id: string) =>
    request<{ game: SharedGame }>('GET', `/games/${encodeURIComponent(id)}`, credential),
  /**
   * Retrying with the same requestId (and the same friend and type) finds the same game;
   * `invitation` is null once the friend has joined.
   */
  createGame: (credential: string, friendEmail: string, requestId: string, type: string = 'chess') =>
    request<{ game: SharedGame; invitation: { token: string } | null; duplicate: boolean }>('POST', '/games', credential, {
      friendEmail,
      requestId,
      type,
    }),
  /** A new invitation link for the creator of a game nobody has joined; earlier links stop working. */
  renewInvitation: (credential: string, id: string) =>
    request<{ game: SharedGame; invitation: { token: string } }>(
      'POST',
      `/games/${encodeURIComponent(id)}/invitation`,
      credential,
    ),
  redeemInvitation: (credential: string, token: string) =>
    request<{ game: SharedGame }>('POST', '/invitations/redeem', credential, { token }),
  submitAction: (credential: string, id: string, requestId: string, expectedRevision: number, action: GameAction) =>
    request<{ game: SharedGame; duplicate: boolean }>('POST', `/games/${encodeURIComponent(id)}/actions`, credential, {
      requestId,
      expectedRevision,
      action,
    }),
};
