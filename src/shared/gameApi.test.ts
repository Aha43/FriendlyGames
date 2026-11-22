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
  it('names them on every game request, but not on email entry (chess types since #55, Yatzy since #86)', async () => {
    fetchMock.mockImplementation(async () => reply(200, { games: [], history: [], game: { id: 'g1' }, player: {} }));
    await settle(gameApi.listGames(CRED));
    await settle(gameApi.history(CRED));
    await settle(gameApi.getGame(CRED, 'g1'));
    await settle(action());
    await settle(gameApi.redeemInvitation(CRED, 'T'));
    await settle(gameApi.enterPlayer('a@example.test'));
    const urls = fetchMock.mock.calls.map((call) => new URL(call[0] as string));
    expect(urls.slice(0, 5).map((url) => url.searchParams.get('types'))).toEqual(Array(5).fill('chess,chess960,yatzy'));
    expect(urls[3].pathname).toMatch(/\/games\/g1\/actions$/);
    expect(urls[5].search).toBe('');
  });
});

describe('who the creator invited (#113)', () => {
  it('is a read of that one game, with the credential in a header and nothing in the address', async () => {
    const invitation = { gameId: 'g1', invitedEmail: 'kari@example.test', createdAt: '2026-11-22T10:00:00Z' };
    fetchMock.mockImplementationOnce(async () => reply(200, { invitation }));
    expect(await settle(gameApi.pendingInvitation(CRED, 'g1'))).toEqual({ value: { invitation } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toMatch(/\/games\/g1\/invitation$/);
    expect(url).not.toContain(CRED);
    expect(url).not.toContain('@');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('does not repeat a refusal', async () => {
    fetchMock.mockImplementation(async () => reply(403, { error: { code: 'not_creator', message: 'x' } }));
    const outcome = await settle(gameApi.pendingInvitation(CRED, 'g1'));
    expect((outcome as { error: ApiError }).error.code).toBe('not_creator');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleting a finished game (#93)', () => {
  it('asks who is affected with a read, and deletes with one DELETE that is never repeated', async () => {
    fetchMock.mockImplementationOnce(async () => reply(200, { deletion: { gameId: 'g1', removesFromPlayWith: [] } }));
    expect(await settle(gameApi.deletionPreview(CRED, 'g1'))).toEqual({ value: { deletion: { gameId: 'g1', removesFromPlayWith: [] } } });
    const [previewUrl, previewInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(previewUrl).pathname).toMatch(/\/games\/g1\/deletion$/);
    expect(previewInit.method).toBe('GET');

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => reply(503, { error: { code: 'unavailable', message: 'x' } }));
    const outcome = await settle(gameApi.deleteGame(CRED, 'g1', ['p1', 'p2']));
    expect((outcome as { error: unknown }).error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toMatch(/\/games\/g1$/);
    expect(new URL(url).searchParams.get('warned')).toBe('p1,p2');
    expect(new URL(url).searchParams.get('types')).toBe('chess,chess960,yatzy');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('hands over who is affected now when the server says that changed, and sends an empty list as such', async () => {
    const deletion = { gameId: 'g1', removesFromPlayWith: [{ id: 'p2', displayName: 'Harald' }] };
    fetchMock.mockImplementation(async () => reply(409, { error: { code: 'deletion_changed', message: 'x', deletion } }));
    const outcome = (await settle(gameApi.deleteGame(CRED, 'g1', []))) as { error: ApiError };
    expect(outcome.error).toMatchObject({ status: 409, code: 'deletion_changed', deletion });
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('warned')).toBe('');
  });
});

describe('friend invitations (#111)', () => {
  const TOKEN = 'F'.repeat(43);
  const sent = (n = 0) => {
    const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
    return { url: new URL(url), init, headers: init.headers as Record<string, string> };
  };

  it('asks the picker for friends without a shared game too', async () => {
    fetchMock.mockImplementation(async () => reply(200, { opponents: [] }));
    await settle(gameApi.listOpponents(CRED));
    expect(sent().url.pathname).toMatch(/\/opponents$/);
    expect(sent().url.searchParams.get('friends')).toBe('1');
    expect(sent().url.searchParams.get('types')).toBe('chess,chess960,yatzy');
  });

  it('never puts a friend link’s token in an address: preview and accept send it in the body', async () => {
    fetchMock.mockImplementation(async () => reply(200, { invitation: { inviter: { displayName: 'Harald' }, state: 'open' }, friend: {} }));
    await settle(gameApi.previewFriendInvitation(TOKEN));
    await settle(gameApi.previewFriendInvitation(TOKEN, CRED));
    await settle(gameApi.acceptFriendInvitation(CRED, TOKEN));
    for (const n of [0, 1, 2]) {
      expect(sent(n).url.href).not.toContain(TOKEN);
      expect(sent(n).init.method).toBe('POST');
      expect(JSON.parse(String(sent(n).init.body))).toEqual({ token: TOKEN });
    }
    expect(sent(0).url.pathname).toMatch(/\/friend-invitations\/preview$/);
    // A visitor without a player sends no credential; a player sends theirs.
    expect(sent(0).headers['X-Device-Credential']).toBeUndefined();
    expect(sent(1).headers['X-Device-Credential']).toBe(CRED);
    expect(sent(2).url.pathname).toMatch(/\/friend-invitations\/accept$/);
  });

  it('creates with a request ID, lists, and replaces one invitation by its ID', async () => {
    fetchMock.mockImplementation(async () => reply(200, { invitation: {}, invitations: [] }));
    await settle(gameApi.createFriendInvitation(CRED, 'r1'));
    await settle(gameApi.listFriendInvitations(CRED));
    await settle(gameApi.replaceFriendInvitation(CRED, 'i/1'));
    expect([sent(0).init.method, sent(0).url.pathname.replace(/^.*game-api/, '')]).toEqual(['POST', '/friend-invitations']);
    expect(JSON.parse(String(sent(0).init.body))).toEqual({ requestId: 'r1' });
    expect([sent(1).init.method, sent(1).url.pathname.replace(/^.*game-api/, '')]).toEqual(['GET', '/friend-invitations']);
    expect([sent(2).init.method, sent(2).url.pathname.replace(/^.*game-api/, '')]).toEqual(['POST', '/friend-invitations/i%2F1/replacement']);
    expect(sent(2).init.body).toBeUndefined();
  });

  it('repeats a creation, a replacement and an acceptance after a momentary failure: each is safe to repeat', async () => {
    const calls: (() => Promise<unknown>)[] = [
      () => gameApi.createFriendInvitation(CRED, 'r1'),
      () => gameApi.replaceFriendInvitation(CRED, 'i1'),
      () => gameApi.acceptFriendInvitation(CRED, TOKEN),
    ];
    for (const call of calls) {
      fetchMock.mockReset();
      fetchMock.mockImplementationOnce(async () => reply(503, { error: { code: 'unavailable', message: 'x' } })).mockImplementation(async () => reply(200, { ok: true }));
      expect(await settle<unknown>(call())).toEqual({ value: { ok: true } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].body).toBe((fetchMock.mock.calls[0] as [string, RequestInit])[1].body);
    }
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
