// Failure diagnostics (#116), against the real local backend: a failure the API did not expect
// is made on purpose, for one throwaway player only, to prove that the evidence path works on
// every run: the answer carries an `errorId`, and the server logs one safe line that
// `scripts/backend-errors.ts` then finds in the whole log, however much is logged after it.
//
// It lives with the migration rehearsals because it adds a trigger for a moment: schema changes
// stay out of the parallel run. Unlike the rehearsals it goes through the served API, since the
// point is the runtime's own log.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { call, db, newPlayer, randomUUID } from '../client';

const sql = db();
afterAll(() => sql.end());

/** The text the log checker recognises as this test's own failure. Keep in step with scripts/backend-errors.ts. */
const CONTROLLED = 'controlled failure for diagnostics';

describe('an unexpected server failure', () => {
  it('answers 500 with an errorId and no detail, for a failure made on purpose for one test player', async () => {
    const [victim, bystander] = [await newPlayer('Diagnostics'), await newPlayer('Bystander')];
    const name = `diagnostics_${randomUUID().replaceAll('-', '')}`;
    // Only this player's friend invitations fail.
    await sql.unsafe(`
      create function public.${name}() returns trigger language plpgsql as $$
      begin
        raise exception '${CONTROLLED} (#116)';
      end $$;
      create trigger ${name} before insert on public.friend_invitations
        for each row when (new.created_by = '${victim.id}') execute function public.${name}();
    `);
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failed = await call('POST', '/friend-invitations', { credential: victim.credential, body: { requestId: randomUUID() } });
      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ error: { code: 'internal', message: 'Something went wrong.', errorId: expect.stringMatching(/^[0-9a-f]{8}$/) } });
      // The test client names the request safely, with the ID that finds the server's log line.
      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported.mock.calls[0][0]).toContain(
        `[backend test] unexpected status: POST /friend-invitations → 500 code=internal errorId=${failed.body.error.errorId} handler=yes at=`,
      );
      for (const secret of [victim.credential, victim.email, victim.id]) expect(String(reported.mock.calls[0][0])).not.toContain(secret);
      // Nothing was saved, and nobody else is affected.
      expect((await sql`select count(*)::int as n from friend_invitations where created_by = ${victim.id}`)[0].n).toBe(0);
      expect((await call('POST', '/friend-invitations', { credential: bystander.credential, body: { requestId: randomUUID() } })).status).toBe(201);
    } finally {
      reported.mockRestore();
      await sql.unsafe(`drop trigger if exists ${name} on public.friend_invitations; drop function if exists public.${name}();`);
    }
    // Back to normal for the same player.
    expect((await call('POST', '/friend-invitations', { credential: victim.credential, body: { requestId: randomUUID() } })).status).toBe(201);
  });
});
