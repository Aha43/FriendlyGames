// Small client for the game API, used by the integration tests.
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

export const API_URL = process.env.FG_API_URL ?? 'http://127.0.0.1:56321/functions/v1/game-api';
export const DB_URL = process.env.FG_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  { credential, body }: { credential?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(credential ? { 'x-device-credential': credential } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A server failure the API did not mean to give (#116): say which request, safely. The
  // assertion that follows still fails; this only makes the failure traceable to the server log.
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (response.status >= 500) console.error(unexpectedStatusLine(method, path, response.status, parsed));
  if (parsed === undefined) throw new Error(`${method} ${routeOf(path)} answered HTTP ${response.status} without a JSON body`);
  return { status: response.status, body: parsed as T };
}

const ROUTE_WORDS = new Set([
  'health', 'players', 'me', 'games', 'history', 'opponents', 'invitations', 'redeem', 'actions', 'invitation',
  'rematch', 'deletion', 'friend-invitations', 'preview', 'accept', 'replacement',
]); // prettier-ignore

/** The path with every ID replaced and no query string: `/games/:id/actions`. */
export function routeOf(path: string): string {
  const segments = path.split('?')[0].split('/').filter(Boolean).slice(0, 6);
  return `/${segments.map((segment) => (ROUTE_WORDS.has(segment) ? segment : ':id')).join('/')}`;
}

/**
 * One line for a 5xx answer: method, route pattern, status, the API's error code and the
 * `errorId` that finds the server's own log line. Nothing else from the request or the answer,
 * which can hold credentials, tokens and emails. `handler=no` means the answer did not come from
 * the game API's own error handling (no `errorId`): the runtime in front of it answered. `at` is
 * when the answer arrived, to set beside the times in the runtime's log.
 */
export function unexpectedStatusLine(method: string, path: string, status: number, body: unknown, at = new Date()): string {
  const error = (body as { error?: { code?: unknown; errorId?: unknown } } | undefined)?.error;
  const safe = (value: unknown, pattern: RegExp) => (typeof value === 'string' && pattern.test(value) ? value : '-');
  const errorId = safe(error?.errorId, /^[0-9a-f]{8}$/);
  return `[backend test] unexpected status: ${method} ${routeOf(path)} → ${status} code=${safe(error?.code, /^[a-z0-9_]{1,64}$/)} errorId=${errorId} handler=${errorId === '-' ? 'no' : 'yes'} at=${at.toISOString()}`;
}

export interface TestPlayer {
  id: string;
  name: string;
  email: string;
  credential: string;
}

/**
 * A suffix that is unique across test files, parallel workers and runs, even when several are
 * made in the same millisecond (#60). A timestamp with a per-file counter was not: every file
 * starts its counter at zero. 16 random hex digits (64 bits) keep names such as
 * `Racer1-<suffix>` within the 40-character display-name limit.
 */
export function uniqueSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 16);
}

/**
 * A setup failure that names the operation, HTTP status and API error code only. Response bodies
 * can hold device credentials, invitation tokens and emails, so they are never included (#60).
 */
export function setupFailure(operation: string, { status, body }: ApiResponse): Error {
  const code = body?.error?.code;
  const shown = typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? ` ${code}` : '';
  return new Error(`${operation} failed: HTTP ${status}${shown}`);
}

/**
 * A new player named `<base>-<suffix>` (names are unique, #76; at most 40 characters). Its `name`
 * is the generated name: assert on that, never on the base.
 */
export async function newPlayer(base: string): Promise<TestPlayer> {
  const suffix = uniqueSuffix();
  const name = `${base}-${suffix}`;
  if (name.length > 40) throw new Error(`test player base "${base}" is too long for a unique name`);
  const email = `${base.toLowerCase()}-${suffix}@example.test`;
  const response = await call('POST', '/players', { body: { displayName: name, email } });
  if (response.status !== 201) throw setupFailure('createPlayer', response);
  const { body } = response;
  return { id: body.player.id, name, email, credential: body.deviceCredential };
}

/** White creates a game inviting Black, Black joins. Returns the joined game. */
export async function startGame(white: TestPlayer, black: TestPlayer) {
  const created = await call('POST', '/games', { credential: white.credential, body: { friendEmail: black.email } });
  if (created.status !== 201) throw setupFailure('createGame', created);
  const joined = await call('POST', '/invitations/redeem', {
    credential: black.credential,
    body: { token: created.body.invitation.token },
  });
  if (joined.status !== 200) throw setupFailure('redeem', joined);
  return { game: joined.body.game, token: created.body.invitation.token as string };
}

export function move(player: TestPlayer, gameId: string, revision: number, uci: string, requestId = randomUUID()) {
  return call('POST', `/games/${gameId}/actions`, {
    credential: player.credential,
    body: {
      requestId,
      expectedRevision: revision,
      action: { type: 'move', from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) },
    },
  });
}

export function resign(player: TestPlayer, gameId: string, revision: number, requestId = randomUUID()) {
  return call('POST', `/games/${gameId}/actions`, {
    credential: player.credential,
    body: { requestId, expectedRevision: revision, action: { type: 'resign' } },
  });
}

/** Play alternating moves (white first unless the game says otherwise), failing on any rejection. */
export async function playMoves(white: TestPlayer, black: TestPlayer, gameId: string, moves: string[]) {
  let game = (await call('GET', `/games/${gameId}`, { credential: white.credential })).body.game;
  for (const uci of moves) {
    const player = game.chess.turn === 'white' ? white : black;
    const result = await move(player, gameId, game.revision, uci);
    if (result.status !== 200) throw setupFailure(`move ${uci}`, result);
    game = result.body.game;
  }
  return game;
}

export const db = () => postgres(DB_URL, { max: 2, onnotice: () => {} });
export { randomUUID };
