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
