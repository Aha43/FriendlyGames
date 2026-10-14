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
    ['a 503 with a boot-error body', () => reply(503, { code: 'BOOT_ERROR', message: 'Function failed to start' })],
    ['a 500', () => reply(500)],
    ['a dropped connection', () => Promise.reject(new TypeError('connection reset'))],
  ])('never repeats sign-up after %s: it may have created the player', async (_name, failure) => {
    fetchMock.mockImplementationOnce(failure).mockResolvedValue(reply(201, { player: {}, deviceCredential: CRED }));
    expect(await settle(gameApi.createPlayer('Harald', 'h@example.test'))).toHaveProperty('error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
