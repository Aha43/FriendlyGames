// Browser client for the game-api Edge Function (contract: docs/backend.md).
// Never log request headers or bodies: they carry the device credential and invitation tokens.

export type Seat = 'white' | 'black';

export interface PlayerSummary {
  id: string;
  displayName: string;
}

export interface SharedGame {
  id: string;
  type: 'chess';
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
  chess: { initialFen: string; moves: string[]; turn: Seat };
  /** The game started from this one with "Play again", if any. */
  rematchGameId: string | null;
}

export interface HistoryEntry {
  gameType: 'chess';
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
export class NetworkError extends Error {}

const TIMEOUT_MS = 10_000;

/** Configured URL, or the local Supabase stack on the host serving the page (works from a phone on the LAN). */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_GAME_API_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  return `${window.location.protocol}//${window.location.hostname}:56321/functions/v1/game-api`;
}

async function request<T>(method: 'GET' | 'POST', path: string, credential?: string, body?: unknown): Promise<T> {
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
    throw new NetworkError('Could not reach the game server.');
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
    throw new ApiError(response.status, error?.code ?? 'unknown', error?.message ?? 'Request failed.', error?.game);
  }
  return data as T;
}

export const gameApi = {
  createPlayer: (displayName: string, email: string) =>
    request<{ player: PlayerSummary & { email: string }; deviceCredential: string }>('POST', '/players', undefined, {
      displayName,
      email,
    }),
  me: (credential: string) => request<{ player: PlayerSummary & { email: string } }>('GET', '/me', credential),
  listGames: (credential: string) => request<{ games: SharedGame[] }>('GET', '/games', credential),
  /** Finished games per opponent with an exact tally. */
  history: (credential: string) => request<{ history: HistoryEntry[] }>('GET', '/history', credential),
  /** A new game with the same two players, colours swapped. Both players asking get the same game. */
  rematch: (credential: string, id: string) =>
    request<{ game: SharedGame; duplicate: boolean }>('POST', `/games/${encodeURIComponent(id)}/rematch`, credential),
  getGame: (credential: string, id: string) =>
    request<{ game: SharedGame }>('GET', `/games/${encodeURIComponent(id)}`, credential),
  /** Retrying with the same requestId finds the same game; `invitation` is null once the friend has joined. */
  createGame: (credential: string, friendEmail: string, requestId: string) =>
    request<{ game: SharedGame; invitation: { token: string } | null; duplicate: boolean }>('POST', '/games', credential, {
      friendEmail,
      requestId,
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
