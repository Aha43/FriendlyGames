// @vitest-environment node
// Backend test fixtures (#60), checked without a backend: unique players across workers, redacted
// setup failures, and migration rehearsals kept out of the parallel backend run.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import parallelConfig from '../../vitest.backend.config';
import migrationsConfig from '../../vitest.backend-migrations.config';

const ROOT = resolve(__dirname, '../..');
const SECRET = 'SECRET-device-credential-0123456789abcdefghijklmnop';

type Reply = { status: number; body: unknown };
type RequestBody = Record<string, unknown> | undefined;

/** Stand-in for the game API: records each request body and answers with `reply`. */
function fakeApi(reply: (path: string, body: RequestBody) => Reply) {
  const requests: RequestBody[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body: RequestBody = init.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push(body);
      const { status, body: answer } = reply(new URL(url).pathname, body);
      return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return requests;
}

const created = (): Reply => ({ status: 201, body: { player: { id: 'p' }, deviceCredential: SECRET } });

/** A fresh copy of the client module, as each test file and worker gets its own. */
async function freshClient() {
  vi.resetModules();
  return import('../backend/client');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('test player identities', () => {
  it('differ between test files and workers created in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_762_000_000_000);
    const requests = fakeApi(created);
    const workerA = await freshClient();
    const workerB = await freshClient();

    const a = await workerA.newPlayer('Tester');
    const b = await workerB.newPlayer('Tester');

    expect(a.email).not.toBe(b.email);
    expect(requests.map((r) => r?.email)).toEqual([a.email, b.email]);
  });

  it('stay unique over many players in one millisecond, within the display-name limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_762_000_000_000);
    const { uniqueSuffix } = await freshClient();
    const suffixes = Array.from({ length: 10_000 }, () => uniqueSuffix());
    expect(new Set(suffixes).size).toBe(suffixes.length);
    // Names such as `Racer1-<suffix>` must fit the API's 40-character display-name limit.
    expect(`Racer1-${suffixes[0]}`.length).toBeLessThanOrEqual(40);
  });
});

describe('setup failures', () => {
  it('report the operation and status, never the credential in the response', async () => {
    fakeApi(() => ({ status: 200, body: { created: false, player: { id: 'p' }, deviceCredential: SECRET } }));
    const { newPlayer } = await freshClient();

    const failure = await newPlayer('Tester').then(
      () => null,
      (e: Error) => e,
    );

    expect(failure?.message).toBe('createPlayer failed: HTTP 200');
    expect(failure?.message).not.toContain(SECRET);
    expect(failure?.message).not.toContain('@example.test');
  });

  it('include an API error code but no tokens, emails or other body fields', async () => {
    const token = 'SECRET-invitation-token';
    fakeApi((path) =>
      path.endsWith('/actions')
        ? {
            status: 409,
            body: { error: { code: 'stale_revision', message: `see ${token}`, token, email: 'h@example.test' } },
          }
        : { status: 200, body: { game: { revision: 3, chess: { turn: 'white' } } } },
    );
    const { playMoves } = await freshClient();
    const player = { id: 'p', name: 'Arne', email: 'a@example.test', credential: SECRET };

    const failure = await playMoves(player, player, 'g1', ['e2e4']).then(
      () => null,
      (e: Error) => e,
    );

    expect(failure?.message).toBe('move e2e4 failed: HTTP 409 stale_revision');
  });

  it('leave out an error code that is not a plain identifier', async () => {
    const { setupFailure } = await freshClient();
    const failure = setupFailure('createGame', { status: 400, body: { error: { code: `bad ${SECRET}` } } });
    expect(failure.message).toBe('createGame failed: HTTP 400');
  });
});

describe('a server failure seen by the test client (#116)', () => {
  const GAME = '3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d';

  it('is reported with the method, route pattern, status, code and errorId, and still returned to the test', async () => {
    fakeApi(() => ({ status: 500, body: { error: { code: 'internal', message: 'Something went wrong.', errorId: '1a2b3c4d', note: SECRET } } }));
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await freshClient();
    const answer = await call('DELETE', `/games/${GAME}?types=chess&warned=${GAME}`, { credential: SECRET, body: { token: SECRET } });
    expect(answer.status).toBe(500); // the test's own assertion still sees it and fails
    expect(reported.mock.calls).toEqual([[expect.stringMatching(/^\[backend test\] unexpected status: DELETE \/games\/:id → 500 code=internal errorId=1a2b3c4d handler=yes at=\d{4}-\d\d-\d\dT[\d:.]+Z$/)]]);
  });

  it('says when the answer did not come from the game API’s own error handling', async () => {
    fakeApi(() => ({ status: 503, body: { code: 'BOOT_ERROR', message: `worker failed ${SECRET}` } }));
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await freshClient();
    await call('GET', `/games/${GAME}/invitation`, { credential: SECRET });
    expect(String(reported.mock.calls[0][0])).toContain('[backend test] unexpected status: GET /games/:id/invitation → 503 code=- errorId=- handler=no at=');
    expect(reported).toHaveBeenCalledTimes(1);
    // An errorId or code that is not in the expected form is not echoed.
    const { unexpectedStatusLine } = await freshClient();
    expect(unexpectedStatusLine('POST', '/players', 500, { error: { code: `x ${SECRET}`, errorId: SECRET } }, new Date('2026-11-21T19:20:30.123Z'))).toBe(
      '[backend test] unexpected status: POST /players → 500 code=- errorId=- handler=no at=2026-11-21T19:20:30.123Z',
    );
  });

  it('fails with a safe message when the answer is not JSON at all, and says nothing for ordinary answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>Bad gateway ${SECRET}</html>`, { status: 502 })));
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await freshClient();
    const failure = await call('POST', `/games/${GAME}/actions`, { credential: SECRET }).catch((e: Error) => e);
    expect((failure as Error).message).toBe('POST /games/:id/actions answered HTTP 502 without a JSON body');
    expect(String(reported.mock.calls[0][0])).toContain('[backend test] unexpected status: POST /games/:id/actions → 502 code=- errorId=- handler=no at=');

    reported.mockClear();
    fakeApi(() => ({ status: 409, body: { error: { code: 'stale_revision', message: 'x' } } }));
    expect((await (await freshClient()).call('GET', '/me')).status).toBe(409);
    expect(reported).not.toHaveBeenCalled();
  });
});

describe('a request the local runtime refused because its worker had retired (#130)', () => {
  const GAME = '3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d';
  // What the Supabase CLI 2.105.0 main service answers: its generic 500 with the stack as trace.
  const REFUSAL = {
    code: 'Internal Server Error',
    message: 'Request failed due to an internal server error',
    trace: JSON.stringify('WorkerAlreadyRetired: request cannot be handled because the worker has already retired\n    at async UserWorker.fetch (ext:user_workers/user_workers.js:84:21)'),
  };
  const REPEAT = /^\[backend test\] runtime refused the request because its worker had retired; repeated once: /;

  /** Answers in order, recording every request exactly as it was sent. */
  function scripted(...replies: Reply[]) {
    const sent: { url: string; method?: string; headers: unknown; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, method: init.method, headers: { ...(init.headers as Record<string, string>) }, body: init.body });
        const { status, body } = replies[Math.min(sent.length, replies.length) - 1];
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      }),
    );
    return sent;
  }

  it('is sent again once, unchanged: same method, address, headers, body and request ID', async () => {
    const sent = scripted({ status: 500, body: REFUSAL }, { status: 201, body: { game: { id: GAME } } });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call, repeatedRequests } = await freshClient();
    const body = { requestId: '11111111-2222-4333-8444-555555555555', friendEmail: 'friend@example.test', nested: { order: [3, 1, 2] } };
    const answer = await call('POST', `/games?types=chess&x=${GAME}`, { credential: SECRET, body });

    expect(answer).toEqual({ status: 201, body: { game: { id: GAME } } });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].body).toBe(JSON.stringify(body)); // the same bytes, so the same request ID
    expect(sent[0].headers).toEqual({ 'content-type': 'application/json', 'x-device-credential': SECRET });
    // Printed and counted, with the route pattern only.
    expect(reported.mock.calls).toEqual([[expect.stringMatching(/repeated once: POST \/games repeat=1 in this test file at=\d{4}-\d\d-\d\dT[\d:.]+Z$/)]]);
    expect(String(reported.mock.calls[0][0])).toMatch(REPEAT);
    expect(JSON.stringify(reported.mock.calls)).not.toMatch(new RegExp(`${SECRET}|${GAME}|example\\.test|requestId`));
    expect(repeatedRequests()).toBe(1);

    // A bodyless read is repeated the same way, and the count goes on.
    const read = scripted({ status: 500, body: REFUSAL }, { status: 200, body: { ok: true } });
    expect((await call('GET', '/me', { credential: SECRET })).status).toBe(200);
    expect(read[1]).toEqual(read[0]);
    expect(read[0].body).toBeUndefined();
    expect(String(reported.mock.calls[1][0])).toContain('GET /me repeat=2 in this test file');
    expect(repeatedRequests()).toBe(2);
  });

  it('a second refusal is not repeated again: it reaches the test as the 500 it is', async () => {
    const sent = scripted({ status: 500, body: REFUSAL });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call, repeatedRequests } = await freshClient();
    const answer = await call('POST', '/players', { body: { email: 'a@example.test' } });
    expect(answer.status).toBe(500);
    expect(sent).toHaveLength(2);
    expect(repeatedRequests()).toBe(1);
    expect(reported.mock.calls.map(([line]) => String(line))).toEqual([
      expect.stringMatching(REPEAT),
      expect.stringContaining('[backend test] unexpected status: POST /players → 500 code=- errorId=- handler=no at='),
    ]);
  });

  it('whatever the repeat answers stands, also a failure of the game API itself', async () => {
    const sent = scripted({ status: 500, body: REFUSAL }, { status: 500, body: { error: { code: 'internal', message: 'x', errorId: '1a2b3c4d' } } });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await freshClient();
    expect((await call('DELETE', `/games/${GAME}`, { credential: SECRET })).body.error.errorId).toBe('1a2b3c4d');
    expect(sent).toHaveLength(2);
    expect(String(reported.mock.calls[1][0])).toContain('→ 500 code=internal errorId=1a2b3c4d handler=yes');
  });

  const trace = (text: string) => JSON.stringify(text);
  it.each<[string, number, unknown]>([
    ['the game API’s own failure', 500, { error: { code: 'internal', message: 'Something went wrong.', errorId: '1a2b3c4d' } }],
    ['the game API’s failure that happens to carry the same trace', 500, { ...REFUSAL, error: { code: 'internal', message: 'x' } }],
    ['the runtime’s generic 500 for another error', 500, { ...REFUSAL, trace: trace('TypeError: cannot read properties of undefined\n    at x') }],
    ['a 500 that only mentions the error later in its trace', 500, { ...REFUSAL, trace: trace('Error: wrapped\n  caused by WorkerAlreadyRetired: request cannot be handled because the worker has already retired') }],
    ['a similar error name', 500, { ...REFUSAL, trace: trace('WorkerAlreadyRetiredish: request cannot be handled because the worker has already retired') }],
    ['the runtime’s 500 without a trace', 500, { code: REFUSAL.code, message: REFUSAL.message }],
    ['the right trace under another code', 500, { ...REFUSAL, code: 'BOOT_ERROR' }],
    ['a 503 with the refusal’s body', 503, REFUSAL],
    ['a 546 worker limit', 546, { code: 'WORKER_LIMIT', message: 'x' }],
    ['a 502 with the refusal’s body', 502, REFUSAL],
    ['a 500 with an empty object', 500, {}],
    ['a 500 with a list', 500, [REFUSAL]],
    ['a 500 with null', 500, null],
    ['a 200 with the refusal’s body', 200, REFUSAL],
  ])('is the only thing repeated: not %s', async (_what, status, body) => {
    const sent = scripted({ status, body }, { status: 200, body: { ok: true } });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call, repeatedRequests, isRetiredWorkerRefusal } = await freshClient();
    expect(isRetiredWorkerRefusal(status, body)).toBe(false);
    const answer = await call('POST', '/players', { body: { email: 'a@example.test' } });
    expect(answer.status).toBe(status); // the first answer reaches the test
    expect(sent).toHaveLength(1);
    expect(repeatedRequests()).toBe(0);
    expect(reported.mock.calls.filter(([line]) => REPEAT.test(String(line)))).toEqual([]);
    expect(reported).toHaveBeenCalledTimes(status >= 500 ? 1 : 0);
  });

  it('a 5xx that is not JSON is not repeated and fails as before', async () => {
    const sent = scripted({ status: 503, body: '' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { call } = await freshClient();
    const failure = await call('POST', '/invitations/redeem', { body: { token: SECRET } }).catch((e: Error) => e);
    expect((failure as Error).message).toBe('POST /invitations/redeem answered HTTP 503 without a JSON body');
    expect(sent).toHaveLength(1);
  });

  it('recognises the refusal as the runtime writes it, and nothing looser', async () => {
    const { isRetiredWorkerRefusal } = await freshClient();
    expect(isRetiredWorkerRefusal(500, REFUSAL)).toBe(true);
    // The stack may be the message alone.
    expect(isRetiredWorkerRefusal(500, { ...REFUSAL, trace: trace('WorkerAlreadyRetired: request cannot be handled because the worker has already retired') })).toBe(true);
    expect(isRetiredWorkerRefusal(500, { ...REFUSAL, trace: trace('WorkerAlreadyRetired: something else') })).toBe(false);
    expect(isRetiredWorkerRefusal(500, { ...REFUSAL, trace: 42 })).toBe(false);
    expect(isRetiredWorkerRefusal(500, JSON.stringify(REFUSAL))).toBe(false);
  });
});

describe('migration rehearsals', () => {
  const DDL = /\b(drop|alter|create)\s+(table|(unique\s+)?index|function|trigger|type|schema|view|policy)\b|\.unsafe\(\s*migration\b/i;

  function testFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return testFiles(path);
      return entry.name.endsWith('.test.ts') ? [relative(ROOT, path)] : [];
    });
  }

  it('change the schema only from tests/backend/migrations/, never in the parallel run', () => {
    const parallel = testFiles(join(ROOT, 'tests/backend')).filter((f) => !f.startsWith('tests/backend/migrations/'));
    expect(parallel.length).toBeGreaterThan(0);
    const offenders = parallel.filter((f) => DDL.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('run one file at a time, after the parallel backend suite', () => {
    expect(parallelConfig.test?.exclude).toContain('tests/backend/migrations/**');
    expect(migrationsConfig.test?.include).toEqual(['tests/backend/migrations/**/*.test.ts']);
    expect(migrationsConfig.test?.fileParallelism).toBe(false);

    const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['test:backend'];
    expect(script).toBe(
      'vitest run --config vitest.backend.config.ts && vitest run --config vitest.backend-migrations.config.ts',
    );
  });

  it('still exist where the migration run looks for them', () => {
    expect(testFiles(join(ROOT, 'tests/backend/migrations')).sort()).toEqual([
      'tests/backend/migrations/delete-finished-games.test.ts',
      'tests/backend/migrations/diagnostics.test.ts',
      'tests/backend/migrations/friend-connections.test.ts',
      'tests/backend/migrations/player-credentials.test.ts',
      'tests/backend/migrations/unique-email.test.ts',
      'tests/backend/migrations/unique-names.test.ts',
      'tests/backend/migrations/yatzy-format.test.ts',
    ]);
  });
});
