import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, gameApi, NetworkError, RETRY_DELAYS_MS } from './gameApi';

const CRED = 'C'.repeat(43);
const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Run a call while letting the retry pauses pass. */
async function settle<T>(promise: Promise<T>) {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
  return outcome;
}

const action = () => gameApi.submitAction(CRED, 'g1', 'r1', 3, { type: 'move', from: 'e2', to: 'e4' });

describe('momentary server failures', () => {
  it('repeats a move after a worker restart (503) with the same request, and succeeds', async () => {
    fetchMock.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, { game: { id: 'g1' }, duplicate: false }));
    const outcome = await settle(action());
    expect(outcome).toEqual({ value: { game: { id: 'g1' }, duplicate: false } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body); // same request ID and revision
  });

  it('repeats reads after 500 and after a dropped connection', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(500))
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(reply(200, { games: [] }));
    expect(await settle(gameApi.listGames(CRED))).toEqual({ value: { games: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after two repeats and reports the last failure', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: { code: 'x', message: 'busy' } }));
    const outcome = await settle(gameApi.rematch(CRED, 'g1'));
    expect((outcome as { error: unknown }).error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never repeats rejections that are the player’s answer (4xx)', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: { code: 'stale_revision', message: 'changed' } }));
    const outcome = await settle(action());
    expect((outcome as { error: ApiError }).error.code).toBe('stale_revision');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a generic 503', () => reply(503)],
    ['a 500', () => reply(500)],
    ['a dropped connection', () => Promise.reject(new TypeError('connection reset'))],
  ])('repeats email entry after %s with the same request: it reaches the same player', async (_name, failure) => {
    fetchMock
      .mockImplementationOnce(failure)
      .mockResolvedValue(reply(200, { player: { id: 'p-h' }, deviceCredential: CRED, created: false }));
    expect(await settle(gameApi.enterPlayer('h@example.test'))).toHaveProperty('value.player.id', 'p-h');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  });

  it('asks for a name only when the email is new, without repeating', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: { code: 'player_not_found', message: 'new' } }));
    const outcome = await settle(gameApi.enterPlayer('new@example.test'));
    expect((outcome as { error: ApiError }).error.code).toBe('player_not_found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'new@example.test' });
    await settle(gameApi.enterPlayer('new@example.test', 'Newcomer'));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: 'new@example.test', displayName: 'Newcomer' });
  });

  it('does not repeat a request that timed out', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted')))),
    );
    const outcome = action().then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).timedOut).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('game types this client reads (#53)', () => {
  it('names them on every game request, but not on email entry (both types since #55)', async () => {
    fetchMock.mockImplementation(async () => reply(200, { games: [], history: [], game: { id: 'g1' }, player: {} }));
    await settle(gameApi.listGames(CRED));
    await settle(gameApi.history(CRED));
    await settle(gameApi.getGame(CRED, 'g1'));
    await settle(action());
    await settle(gameApi.redeemInvitation(CRED, 'T'));
    await settle(gameApi.enterPlayer('a@example.test'));
    const urls = fetchMock.mock.calls.map((call) => new URL(call[0] as string));
    expect(urls.slice(0, 5).map((url) => url.searchParams.get('types'))).toEqual(Array(5).fill('chess,chess960'));
    expect(urls[3].pathname).toMatch(/\/games\/g1\/actions$/);
    expect(urls[5].search).toBe('');
  });
});

describe('a backend from before #53 (during rollout)', () => {
  // The web client publishes on merge; the owner deploys the backend afterwards.
  const legacy = (moves: string[]) => ({
    id: 'g1',
    type: 'chess',
    schemaVersion: 1,
    chess: { initialFen: 'start', moves, turn: moves.length % 2 ? 'black' : 'white' },
  });

  it('gets turn and moveCount from the chess view, in lists, games and conflicts', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { games: [legacy(['e2e4']), legacy([])] }))
      .mockResolvedValueOnce(reply(200, { game: legacy(['e2e4', 'e7e5']) }))
      .mockResolvedValueOnce(reply(409, { error: { code: 'stale_revision', message: 'x', game: legacy(['d2d4']) } }));
    const list = await settle(gameApi.listGames(CRED));
    expect((list as { value: { games: unknown[] } }).value.games).toMatchObject([
      { turn: 'black', moveCount: 1 },
      { turn: 'white', moveCount: 0 },
    ]);
    expect(await settle(gameApi.getGame(CRED, 'g1'))).toMatchObject({ value: { game: { turn: 'white', moveCount: 2 } } });
    const conflict = (await settle(action())) as { error: ApiError };
    expect(conflict.error.game).toMatchObject({ turn: 'black', moveCount: 1 });
  });

  it('keeps what a current backend sends', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { game: { ...legacy(['e2e4']), turn: 'black', moveCount: 1 } }));
    expect(await settle(gameApi.getGame(CRED, 'g1'))).toMatchObject({ value: { game: { turn: 'black', moveCount: 1 } } });
  });
});
