// The unique-name migration and `make prod-name-check`'s query (#76), against the real local
// backend. These drop the uniqueness index inside rolled-back transactions to recreate the old
// schema, so they run in the sequential migration phase (vitest.backend-migrations.config.ts).
import { readFileSync } from 'node:fs';
import type { TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261108120000_unique_player_names.sql', import.meta.url),
  'utf8',
);
const check = readFileSync(new URL('../../../scripts/name-check.sql', import.meta.url), 'utf8');
const [readOnlyPrefix, checkQuery] = check.split('-- query\n');
const rollback = new Error('rollback test transaction');

/** Recreates the schema before #76 inside `tx`, with colliding names. */
async function oldSchemaWithCollisions(tx: TransactionSql, run: string) {
  await tx`drop index players_display_name_unique`;
  return tx`
    insert into players (display_name, credential_hash)
    values (${`Åse ${run}`}, gen_random_bytes(32)),
           (${`  åse ${run.toUpperCase()}`}, gen_random_bytes(32)),
           (${`Bjørn ${run}`}, gen_random_bytes(32)),
           (${`Bjorn ${run}`}, gen_random_bytes(32))
    returning id, display_name`;
}

describe('the unique-name migration', () => {
  it('refuses to run over colliding names, keeping every player and adding no index', async () => {
    const run = uniqueSuffix();
    await expect(
      sql.begin(async (tx) => {
        const players = await oldSchemaWithCollisions(tx, run);
        const failure = await tx.savepoint((sp) => sp.unsafe(migration)).then(
          () => null,
          (e: Error) => e,
        );
        expect(failure?.message).toMatch(/^\d+ player name\(s\) are used by more than one player; reconcile them first/);
        expect(failure?.message).not.toContain(run);
        const [kept] = await tx`select count(*)::int as n from players where id = any(${players.map((p) => p.id)})`;
        expect(kept.n).toBe(4);
        const [names] = await tx`select array_agg(display_name order by display_name) as all from players where id = any(${players.map((p) => p.id)})`;
        expect(names.all).toContain(`  åse ${run.toUpperCase()}`); // nothing rewritten
        const [index] = await tx`select count(*)::int as n from pg_indexes where indexname = 'players_display_name_unique'`;
        expect(index.n).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const [index] = await sql`select count(*)::int as n from pg_indexes where indexname = 'players_display_name_unique'`;
    expect(index.n).toBe(1);
  });

  it('applies over existing players, games and credentials without changing them', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`drop index players_display_name_unique`;
        const [before] = await tx`select md5(string_agg(id::text || display_name || credential_hash::text, ',' order by id)) as h from players`;
        await tx.unsafe(migration);
        const [after] = await tx`select md5(string_agg(id::text || display_name || credential_hash::text, ',' order by id)) as h from players`;
        expect(after.h).toBe(before.h);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});

describe('make prod-name-check’s query', () => {
  it('finds collisions by trim, NFC and case on the schema before the migration', async () => {
    const run = uniqueSuffix();
    await expect(
      sql.begin(async (tx) => {
        const players = await oldSchemaWithCollisions(tx, run);
        const rows = await tx.unsafe(checkQuery);
        const [summary, ...collisions] = rows;
        expect(summary.kind).toBe('summary');
        const ours = collisions.filter((r) => players.some((p) => p.id === r.player_id));
        // The two Åse spellings collide; Bjørn and Bjorn are different names.
        expect(ours.map((r) => r.display_name).sort()).toEqual([`  åse ${run.toUpperCase()}`, `Åse ${run}`].sort());
        expect(new Set(ours.map((r) => r.name_key))).toEqual(new Set([`åse ${run}`]));
        expect(ours.every((r) => Number(r.games) === 0 && r.created_at)).toBe(true);
        expect(Object.keys(collisions[0] ?? summary)).not.toContain('email');
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('runs read-only: the whole file reports it, and nothing can be written after its prefix', async () => {
    const results = await sql.unsafe(check);
    const rows = results.at(-1) as unknown as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ kind: 'summary', read_only: 'on' });
    for (const write of [
      `insert into players (display_name, credential_hash) values ('Write ${uniqueSuffix()}', gen_random_bytes(32))`,
      `update players set display_name = display_name where false`,
      `create table name_check_probe (id int)`,
    ]) {
      await expect(sql.unsafe(`${readOnlyPrefix}${write}`)).rejects.toThrow(/read-only transaction/);
    }
  });
});
