// One player per email (#27), against the real local backend.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, newPlayer, startGame } from './client';

const sql = db();
afterAll(() => sql.end());

let counter = 0;
const unique = () => `${Date.now()}-${process.pid}-${counter++}`;

const signUp = (displayName: string, email: string) => call('POST', '/players', { body: { displayName, email } });

async function rowsFor(displayName: string, email: string) {
  const [players] = await sql`select count(*)::int as n from players where display_name = ${displayName}`;
  const [contacts] = await sql`select count(*)::int as n from player_contacts where lower(btrim(email)) = lower(btrim(${email}))`;
  return { players: players.n, contacts: contacts.n };
}

describe('one player per email', () => {
  it('refuses a second player for the same email, creating nothing and revealing nothing', async () => {
    const run = unique();
    const email = `dup-${run}@example.test`;
    const first = await signUp(`First-${run}`, email);
    expect(first.status).toBe(201);

    const second = await signUp(`Second-${run}`, email);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: { code: 'email_taken', message: 'A player already uses this email.' } });
    const leaked = JSON.stringify(second.body);
    expect(leaked).not.toContain(first.body.player.id);
    expect(leaked).not.toContain(`First-${run}`);
    expect(leaked).not.toContain(first.body.deviceCredential);

    // The losing attempt left no player (rolled back with its contact) and no contact.
    expect(await rowsFor(`Second-${run}`, email)).toEqual({ players: 0, contacts: 1 });
    expect(await rowsFor(`First-${run}`, email)).toEqual({ players: 1, contacts: 1 });
  });

  it('treats case and surrounding whitespace as the same email', async () => {
    const run = unique();
    expect((await signUp(`A-${run}`, `case-${run}@example.test`)).status).toBe(201);
    for (const variant of [`CASE-${run}@Example.TEST`, `  case-${run}@example.test  `, `\tCase-${run}@EXAMPLE.test`]) {
      const attempt = await signUp(`B-${run}`, variant);
      expect(attempt.status).toBe(409);
      expect(attempt.body.error.code).toBe('email_taken');
    }
    expect(await rowsFor(`B-${run}`, `case-${run}@example.test`)).toEqual({ players: 0, contacts: 1 });
  });

  it('lets exactly one of several simultaneous sign-ups win', async () => {
    const run = unique();
    const email = `race-${run}@example.test`;
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => signUp(`Racer-${run}`, i % 2 ? email : email.toUpperCase())));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await rowsFor(`Racer-${run}`, email)).toEqual({ players: 1, contacts: 1 });
  });

  it('gives the second browser no access, and the original player keeps everything', async () => {
    const original = await newPlayer('Original');
    const friend = await newPlayer('Friend');
    const { game } = await startGame(original, friend);

    const intruder = await signUp('Intruder', original.email);
    expect(intruder.status).toBe(409);
    expect(intruder.body.deviceCredential).toBeUndefined();

    const me = await call('GET', '/me', { credential: original.credential });
    expect(me.body.player).toEqual({ id: original.id, displayName: 'Original', email: original.email });
    const games = await call('GET', '/games', { credential: original.credential });
    expect(games.body.games.map((g: { id: string }) => g.id)).toContain(game.id);
  });
});

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
