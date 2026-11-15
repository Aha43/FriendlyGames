// The deletion migration (#93), against the real local backend. Inside a rolled-back transaction
// finished games with rematches are made through the API, the schema is put back as it was before
// the migration, and the migration is applied over them: no existing row changes, finished
// games stay frozen, and a finished game with a rematch can then be deleted with the rematch kept.
import { readFileSync } from 'node:fs';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../../supabase/functions/game-api/api';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const migration = readFileSync(new URL('../../../supabase/migrations/20261115120000_delete_finished_games.sql', import.meta.url), 'utf8');
const rollback = new Error('rollback test transaction');
const TYPES = 'types=chess,chess960,yatzy';

/** The schema as it was before the migration (migrations up to 20261111120000). */
const BEFORE = `
  drop table public.deleted_game_requests;
  alter table public.games drop constraint games_rematch_of_fkey;
  alter table public.games add constraint games_rematch_of_fkey foreign key (rematch_of) references public.games (id);
  create or replace function public.keep_finished_games_unchanged() returns trigger
    language plpgsql as $$
  begin
    if old.status = 'finished' then
      raise exception 'game % is finished and cannot be changed', old.id using errcode = 'check_violation';
    end if;
    return new;
  end;
  $$;
`;

/** The API on this transaction: its own transactions become savepoints. */
function apiOn(tx: TransactionSql) {
  const db = new Proxy(tx, {
    get: (target, prop) =>
      prop === 'begin' ? (fn: (t: TransactionSql) => unknown) => target.savepoint(fn) : Reflect.get(target, prop),
  }) as unknown as Sql;
  return async (method: string, path: string, options: { credential?: string; body?: unknown } = {}) => {
    const response = await handleRequest(
      new Request(`http://api.test/functions/v1/game-api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(options.credential ? { 'x-device-credential': options.credential } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
      db,
      { allowedOrigins: null, commit: null },
    );
    return { status: response.status, body: await response.json() };
  };
}

/** A hash of every game, seat, invitation and action row: proof that nothing was rewritten. */
async function snapshot(tx: TransactionSql) {
  const [row] = await tx`
    select md5(coalesce((select string_agg(g::text, '|' order by id) from games g), '')) as games,
           md5(coalesce((select string_agg(p::text, '|' order by game_id, seat) from game_participants p), '')) as seats,
           md5(coalesce((select string_agg(i::text, '|' order by game_id) from game_invitations i), '')) as invitations,
           md5(coalesce((select string_agg(a::text, '|' order by id) from game_actions a), '')) as actions`;
  return row;
}

describe('the deletion migration', () => {
  it('applies over finished games and rematches without changing them, keeps them frozen, and lets a source go while its rematch stays', async () => {
    await expect(
      sql.begin(async (tx) => {
        const api = apiOn(tx);
        const run = uniqueSuffix();
        const enter = async (name: string) => {
          const r = await api('POST', '/players', { body: { email: `${name}-${run}@example.test`, displayName: `${name} ${run}` } });
          expect(r.status).toBe(201);
          return { id: r.body.player.id as string, credential: r.body.deviceCredential as string, email: `${name}-${run}@example.test` };
        };
        const [arne, harald] = [await enter('Arne'), await enter('Harald')];
        const act = (who: typeof arne, gameId: string, revision: number, action: unknown) =>
          api('POST', `/games/${gameId}/actions?${TYPES}`, { credential: who.credential, body: { requestId: crypto.randomUUID(), expectedRevision: revision, action } });

        // Existing records: a finished game, its finished rematch, and an active rematch of that;
        // plus a waiting invitation.
        const created = await api('POST', `/games?${TYPES}`, { credential: arne.credential, body: { friendEmail: harald.email, requestId: crypto.randomUUID() } });
        const joined = await api('POST', `/invitations/redeem?${TYPES}`, { credential: harald.credential, body: { token: created.body.invitation.token } });
        const source = joined.body.game.id as string;
        await act(harald, source, joined.body.game.revision, { type: 'resign' });
        const first = (await api('POST', `/games/${source}/rematch?${TYPES}`, { credential: arne.credential })).body.game;
        await act(arne, first.id, first.revision, { type: 'resign' });
        const second = (await api('POST', `/games/${first.id}/rematch?${TYPES}`, { credential: harald.credential })).body.game;
        expect(second.status).toBe('active');
        await api('POST', `/games?${TYPES}`, { credential: arne.credential, body: { friendEmail: `nobody-${run}@example.test` } });

        // Put the schema back as it was before the migration, with those records in place. (They
        // are made first because this API needs the migrated schema: it is deployed after it.)
        await tx.unsafe(BEFORE);
        // Before the migration a game with a rematch cannot be deleted at all.
        await expect(tx.savepoint((sp) => sp`delete from games where id = ${source}`)).rejects.toThrow(/violates foreign key constraint/);

        const before = await snapshot(tx);
        await tx.unsafe(migration);
        expect(await snapshot(tx)).toEqual(before);
        expect((await tx`select count(*)::int as n from deleted_game_requests`)[0].n).toBe(0);

        // Finished games are still frozen after it.
        for (const statement of [
          () => tx`update games set payload = '{}' where id = ${first.id}`,
          () => tx`update games set rematch_of = null, revision = 99 where id = ${first.id}`,
          () => tx`update games set status = 'active' where id = ${source}`,
        ]) {
          await expect(tx.savepoint(statement as never)).rejects.toThrow(/is finished and cannot be changed/);
        }

        // Deleting the source through the API keeps its finished rematch, content unchanged, and
        // the active rematch of that; the creation request is remembered as deleted.
        const [firstBefore] = await tx`select (to_jsonb(g) - 'rematch_of')::text as row from games g where id = ${first.id}`;
        const deleted = await api('DELETE', `/games/${source}?${TYPES}`, { credential: harald.credential });
        expect(deleted.status).toBe(200);
        const [firstAfter] = await tx`select (to_jsonb(g) - 'rematch_of')::text as row, rematch_of from games g where id = ${first.id}`;
        expect(firstAfter).toEqual({ row: firstBefore.row, rematch_of: null });
        expect((await tx`select rematch_of from games where id = ${second.id}`)[0].rematch_of).toBe(first.id);
        expect((await api('GET', `/games/${second.id}?${TYPES}`, { credential: arne.credential })).body.game.status).toBe('active');
        expect((await tx`select count(*)::int as n from deleted_game_requests where created_by = ${arne.id}`)[0].n).toBe(1);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
    // Rehearsal only: the real schema is as migrated.
    const [fk] = await sql`select confdeltype from pg_constraint where conname = 'games_rematch_of_fkey'`;
    expect(fk.confdeltype).toBe('n');
  });
});
