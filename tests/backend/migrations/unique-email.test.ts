// Rehearses the unique-email migration (#27) inside a rolled-back transaction, against the real
// local backend. It drops and recreates an index, so it runs with no other test files in parallel
// (vitest.backend-migrations.config.ts, #60).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const unique = uniqueSuffix;

describe('the unique-email migration', () => {
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20261018200000_unique_player_email.sql', import.meta.url),
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
