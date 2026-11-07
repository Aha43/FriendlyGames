// Rehearses the player-credentials migration (#29) inside a rolled-back transaction, against the
// real local backend. It drops and recreates a table, so it runs with no other test files in
// parallel (vitest.backend-migrations.config.ts, #60).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const unique = uniqueSuffix;

describe('the player-credentials migration', () => {
  const migration = readFileSync(
    new URL('../../../supabase/migrations/20261101120000_player_credentials.sql', import.meta.url),
    'utf8',
  );

  it('carries every existing browser credential over unchanged', async () => {
    const run = unique();
    const rollback = new Error('rollback test transaction');
    await expect(
      sql.begin(async (tx) => {
        // Recreate the pre-migration state inside this transaction only.
        await tx`drop table player_credentials cascade`;
        await tx`drop function copy_first_player_credential() cascade`;
        const [legacy] = await tx`
          insert into players (display_name, credential_hash)
          values (${`Legacy-${run}`}, gen_random_bytes(32))
          returning id, credential_hash`;
        const [before] = await tx`select count(*)::int as n from players`;

        await tx.unsafe(migration);

        const [after] = await tx`select count(*)::int as n from player_credentials`;
        expect(after.n).toBe(before.n);
        const [found] = await tx`
          select p.id from player_credentials c join players p on p.id = c.player_id
           where c.credential_hash = ${legacy.credential_hash}`;
        expect(found.id).toBe(legacy.id);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('accepts a player created the old way while versions overlap', async () => {
    // What the previous function version does: write only players.credential_hash.
    const credential = 'B'.repeat(43);
    const [hash] = await sql`select sha256(${credential}::bytea) as h`;
    const [legacy] = await sql`
      insert into players (display_name, credential_hash) values ('Old-version player', ${hash.h})
      on conflict (credential_hash) do update set display_name = excluded.display_name
      returning id`;
    const me = await call('GET', '/me', { credential });
    expect(me.status).toBe(200);
    expect(me.body.player.id).toBe(legacy.id);
  });

  it('keeps the credentials table private', async () => {
    const [grants] = await sql`
      select count(*)::int as n from information_schema.role_table_grants
       where table_name = 'player_credentials' and grantee in ('anon', 'authenticated')`;
    expect(grants.n).toBe(0);
    const [rls] = await sql`select relrowsecurity from pg_class where relname = 'player_credentials'`;
    expect(rls.relrowsecurity).toBe(true);
  });
});
