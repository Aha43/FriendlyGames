// One player per email (#27): reconciling legacy duplicates, against the real local backend.
// Entering an email that is already used is covered in email-entry.test.ts (#29).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, newPlayer, startGame } from './client';

const sql = db();
afterAll(() => sql.end());

let counter = 0;
const unique = () => `${Date.now()}-${process.pid}-${counter++}`;

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

describe('the unique-email migration', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261018200000_unique_player_email.sql', import.meta.url),
    'utf8',
  );

  it('refuses to run over existing duplicates, keeping every row and adding no index', async () => {
    const run = unique();
    const email = `legacy-${run}@example.test`;
    const rollback = new Error('rollback test transaction');

    await expect(
      sql.begin(async (tx) => {
        // Recreate the pre-migration state inside this transaction only.
        await tx`drop index player_contacts_email_unique`;
        const players = await tx`
          insert into players (display_name, credential_hash)
          values (${`Legacy1-${run}`}, gen_random_bytes(32)), (${`Legacy2-${run}`}, gen_random_bytes(32))
          returning id`;
        for (const p of players) await tx`insert into player_contacts (player_id, email) values (${p.id}, ${email})`;

        const failure = await tx.savepoint((sp) => sp.unsafe(migration)).then(
          () => null,
          (e: Error) => e,
        );
        expect(failure?.message).toMatch(/1 email\(s\) are used by more than one player; reconcile them first/);
        expect(failure?.message).not.toContain(email);

        const [kept] = await tx`select count(*)::int as n from player_contacts where email = ${email}`;
        expect(kept.n).toBe(2);
        const [index] = await tx`select count(*)::int as n from pg_indexes where indexname = 'player_contacts_email_unique'`;
        expect(index.n).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    // Everything above was rolled back: the real index is back in place.
    const [index] = await sql`select count(*)::int as n from pg_indexes where indexname = 'player_contacts_email_unique'`;
    expect(index.n).toBe(1);
  });
});
