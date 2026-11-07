// One player per email (#27): reconciling legacy duplicates, against the real local backend.
// Entering an email that is already used is covered in email-entry.test.ts (#29).
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, newPlayer, startGame } from './client';

const sql = db();
afterAll(() => sql.end());

const signUp = (displayName: string, email: string) => call('POST', '/players', { body: { displayName, email } });

describe('a player whose email was detached (reconciling duplicates)', () => {
  it('keeps working, and the email can be used by someone else', async () => {
    const tester = await newPlayer('Tester');
    const friend = await newPlayer('Friend');
    const { game } = await startGame(tester, friend);
    await sql`delete from player_contacts where player_id = ${tester.id}`;

    const me = await call('GET', '/me', { credential: tester.credential });
    expect(me.status).toBe(200);
    expect(me.body.player).toEqual({ id: tester.id, displayName: 'Tester', email: null });
    const games = await call('GET', '/games', { credential: tester.credential });
    expect(games.body.games.map((g: { id: string }) => g.id)).toContain(game.id);

    const real = await signUp('Real owner', tester.email);
    expect(real.status).toBe(201);
    expect(real.body.player.id).not.toBe(tester.id);

    // Entering that email now opens the real owner, never the detached tester (no reattaching).
    const again = await call('POST', '/players', { body: { email: tester.email } });
    expect(again.body.player.id).toBe(real.body.player.id);
    const testerMe = await call('GET', '/me', { credential: tester.credential });
    expect(testerMe.body.player).toEqual({ id: tester.id, displayName: 'Tester', email: null });
  });
});
