// What the API logs and answers for a failure it did not expect (#116), without a backend.
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from './api.ts';
import { routePattern, safeMessage, unexpectedErrorLine } from './diagnostics.ts';

const CREDENTIAL = 'SECRETcredential0123456789abcdefghijklmnopq'; // 43 characters, as a real one
const TOKEN = 'SECRETinvitation-token_0123456789abcdefghijk';
const GAME = '3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d';

afterEach(() => vi.restoreAllMocks());

describe('the route pattern', () => {
  it('keeps the API’s own words and replaces every ID, token and query', () => {
    expect(routePattern('GET', '/health')).toBe('GET /health');
    expect(routePattern('DELETE', `/games/${GAME}?types=chess&warned=${GAME}`)).toBe('DELETE /games/:id');
    expect(routePattern('POST', `/games/${GAME}/actions/`)).toBe('POST /games/:id/actions');
    expect(routePattern('POST', `/friend-invitations/${GAME}/replacement`)).toBe('POST /friend-invitations/:id/replacement');
    expect(routePattern('POST', '/friend-invitations/preview')).toBe('POST /friend-invitations/preview');
    expect(routePattern('GET', `/${TOKEN}/harald@example.test/x`)).toBe('GET /:id/:id/:id');
    expect(routePattern('BREW', '/')).toBe('OTHER /');
    expect(routePattern('GET', `/${Array(40).fill('a').join('/')}`).split('/')).toHaveLength(7);
  });
});

describe('the reduced message', () => {
  it('keeps fixed wording and drops whatever could be data', () => {
    expect(safeMessage('deadlock detected')).toBe('deadlock detected');
    expect(safeMessage('duplicate key value violates unique constraint "player_contacts_email_key"')).toBe('duplicate key value violates unique constraint "…"');
    expect(safeMessage(`invalid input syntax for type uuid: "${TOKEN}"`)).toBe('invalid input syntax for type uuid: "…"');
    expect(safeMessage('write CONNECTION_CLOSED db.internal.example:5432')).toBe('write CONNECTION_CLOSED …');
    expect(safeMessage('connect ECONNREFUSED 10.0.0.12:5432')).toBe('connect ECONNREFUSED …');
    const worst = safeMessage(
      `failed for harald@example.test with ${CREDENTIAL} on postgresql://postgres:hunter2@db.example.test:5432/postgres game ${GAME} 'O''Brien' row 1234567\nnext line`,
    );
    for (const secret of ['harald', 'example.test', CREDENTIAL, 'hunter2', 'postgresql', GAME, 'Brien', '1234567', '\n']) expect(worst).not.toContain(secret);
    expect(safeMessage('x'.repeat(10) + ' y'.repeat(400)).length).toBeLessThanOrEqual(160);
    // Review of fa7a97a: single-quoted values and bare addresses, with or without a dot.
    expect(safeMessage("password authentication failed for 'sample-pass' at db.example.test:6543")).toBe("password authentication failed for '…' at …");
    expect(safeMessage('could not connect to supabase_db_friendlygames:5432 or localhost:54322 or [fd00::12]:5432')).toBe('could not connect to … or … or …');
    expect(safeMessage(undefined)).toBe('-');
    expect(safeMessage({ toString: () => CREDENTIAL })).toBe('-');
  });
});

describe('the log line', () => {
  it('names the request and the safe parts of a database error, never its detail, hint or query', () => {
    const error = Object.assign(new Error('deadlock detected'), {
      name: 'PostgresError',
      code: '40P01',
      severity: 'ERROR',
      routine: 'DeadLockReport',
      table_name: 'games',
      constraint_name: 'games_pkey',
      detail: `Process 1 waits for ShareLock; Key (email)=(harald@example.test) ${CREDENTIAL}`,
      hint: `See ${TOKEN}`,
      where: `SQL statement with ${TOKEN}`,
      query: `select * from players where email = 'harald@example.test'`,
      parameters: [CREDENTIAL],
    });
    const line = unexpectedErrorLine('1a2b3c4d', 'DELETE', `/games/${GAME}?warned=${GAME}`, error);
    expect(line).toBe(
      'game-api: unexpected error id=1a2b3c4d route="DELETE /games/:id" name=PostgresError code=40P01 severity=ERROR routine=DeadLockReport table=games constraint=games_pkey message="deadlock detected"',
    );
    expect(line).not.toMatch(/\n/);
  });

  it('shows a dash for anything missing or not in the expected form, and survives a non-error', () => {
    const odd = Object.assign(new Error(`bad "value" for ${CREDENTIAL}`), { code: `x y ${TOKEN}`, severity: 5, routine: { a: 1 }, table_name: 'Robert"); drop', constraint_name: '' });
    expect(unexpectedErrorLine('00000000', 'POST', '/players', odd)).toBe(
      'game-api: unexpected error id=00000000 route="POST /players" name=Error code=- severity=- routine=- table=- constraint=- message="bad \'…\' for …"',
    );
    for (const thrown of [undefined, null, 'a string with harald@example.test', 42, { message: CREDENTIAL }]) {
      const line = unexpectedErrorLine('00000000', 'GET', '/me', thrown);
      expect(line).toBe('game-api: unexpected error id=00000000 route="GET /me" name=- code=- severity=- routine=- table=- constraint=- message="-"');
    }
  });
});

describe('an unexpected failure in the handler', () => {
  it('answers 500 with an errorId that is also in the one line logged, and leaks nothing from the request', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = (() => {
      throw Object.assign(new Error(`write CONNECTION_CLOSED db.example.test:5432 for ${CREDENTIAL}`), { code: 'CONNECTION_CLOSED' });
    }) as unknown as Sql;
    const response = await handleRequest(
      new Request(`https://api.example/functions/v1/game-api/games/${GAME}/actions?types=chess`, {
        method: 'POST',
        headers: { 'x-device-credential': CREDENTIAL, 'content-type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, friendEmail: 'harald@example.test' }),
      }),
      failing,
      { allowedOrigins: null, commit: null },
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'internal', message: 'Something went wrong.', errorId: expect.stringMatching(/^[0-9a-f]{8}$/) } });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]).toEqual([
      `game-api: unexpected error id=${body.error.errorId} route="POST /games/:id/actions" name=Error code=CONNECTION_CLOSED severity=- routine=- table=- constraint=- message="write CONNECTION_CLOSED … for …"`,
    ]);
    for (const secret of [CREDENTIAL, TOKEN, 'harald', GAME, 'db.example']) expect(JSON.stringify([logged.mock.calls, body])).not.toContain(secret);
  });

  it('gives each failure its own id, and a refusal the API means to give has none and logs nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = (() => {
      throw new Error('boom');
    }) as unknown as Sql;
    const ask = (path: string, headers: Record<string, string> = {}) =>
      handleRequest(new Request(`https://api.example/functions/v1/game-api${path}`, { headers }), failing, { allowedOrigins: null, commit: null });
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add((await (await ask('/health')).json()).error.errorId);
    expect(ids.size).toBe(20);
    logged.mockClear();
    const refused = await ask('/me'); // no credential: refused before the database is touched
    expect(refused.status).toBe(401);
    expect((await refused.json()).error).toEqual({ code: 'unauthenticated', message: expect.any(String) });
    expect(logged).not.toHaveBeenCalled();
  });
});
