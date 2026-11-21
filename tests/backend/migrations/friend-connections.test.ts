// The friend-connection migration (#110), against the real local backend. Inside a rolled-back
// transaction existing records are made through the API, the two new tables are removed (the
// schema as it was before), and the migration is applied over the records: no existing row
// changes, the picker answers as before, and the new tables enforce what the API relies on.
import { readFileSync } from 'node:fs';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../../supabase/functions/game-api/api';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const migration = readFileSync(new URL('../../../supabase/migrations/20261121120000_friend_connections.sql', import.meta.url), 'utf8');
const rollback = new Error('rollback test transaction');
const TYPES = 'types=chess,chess960,yatzy';

/** The schema as it was before the migration (migrations up to 20261115120000). */
const BEFORE = `
  drop table public.player_connections;
  drop table public.friend_invitations;
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

/** A hash of every existing kind of row: proof that nothing was rewritten. */
async function snapshot(tx: TransactionSql) {
  const [row] = await tx`
    select md5(coalesce((select string_agg(p::text, '|' order by id) from players p), '')) as players,
           md5(coalesce((select string_agg(c::text, '|' order by player_id) from player_contacts c), '')) as contacts,
           md5(coalesce((select string_agg(c::text, '|' order by credential_hash) from player_credentials c), '')) as credentials,
           md5(coalesce((select string_agg(g::text, '|' order by id) from games g), '')) as games,
           md5(coalesce((select string_agg(p::text, '|' order by game_id, seat) from game_participants p), '')) as seats,
           md5(coalesce((select string_agg(i::text, '|' order by game_id) from game_invitations i), '')) as invitations,
           md5(coalesce((select string_agg(a::text, '|' order by id) from game_actions a), '')) as actions,
           md5(coalesce((select string_agg(d::text, '|' order by created_by, create_request_id) from deleted_game_requests d), '')) as deleted`;
  return row;
}

describe('the friend-connection migration', () => {
  it('applies over existing players, games and invitations without changing them, and enforces what the API relies on', async () => {
    await expect(
      sql.begin(async (tx) => {
        const api = apiOn(tx);
        const run = uniqueSuffix();
        const enter = async (name: string) => {
          const r = await api('POST', '/players', { body: { email: `${name}-${run}@example.test`, displayName: `${name} ${run}` } });
          expect(r.status).toBe(201);
          return { id: r.body.player.id as string, credential: r.body.deviceCredential as string, email: `${name}-${run}@example.test` };
        };
        const [arne, harald, william] = [await enter('Arne'), await enter('Harald'), await enter('William')];

        // Existing records: an active game, a waiting invitation, a finished and deleted game.
        const created = await api('POST', `/games?${TYPES}`, { credential: arne.credential, body: { friendEmail: harald.email, requestId: crypto.randomUUID() } });
        const joined = await api('POST', `/invitations/redeem?${TYPES}`, { credential: harald.credential, body: { token: created.body.invitation.token } });
        expect(joined.status).toBe(200);
        const waiting = await api('POST', `/games?${TYPES}`, { credential: arne.credential, body: { friendEmail: `nobody-${run}@example.test` } });
        const gone = await api('POST', `/games?${TYPES}`, { credential: harald.credential, body: { friendPlayerId: arne.id, requestId: crypto.randomUUID() } });
        await api('POST', `/games/${gone.body.game.id}/actions?${TYPES}`, {
          credential: arne.credential,
          body: { requestId: crypto.randomUUID(), expectedRevision: 0, action: { type: 'resign' } },
        });
        expect((await api('DELETE', `/games/${gone.body.game.id}?${TYPES}&warned=`, { credential: arne.credential })).status).toBe(200);
        const pickerBefore = await api('GET', '/opponents', { credential: arne.credential });
        expect(pickerBefore.body.opponents).toHaveLength(1);

        // The schema as it was before the migration, with those records in place.
        await tx.unsafe(BEFORE);
        const before = await snapshot(tx);
        await tx.unsafe(migration);
        expect(await snapshot(tx)).toEqual(before);
        expect((await tx`select (select count(*) from friend_invitations)::int as invitations, (select count(*) from player_connections)::int as connections`)[0]).toEqual({
          invitations: 0,
          connections: 0,
        });

        // Nobody is connected by the migration itself: the picker, for old and new clients, and
        // the pending game invitation are as they were.
        expect((await api('GET', '/opponents', { credential: arne.credential })).body).toEqual(pickerBefore.body);
        expect((await api('GET', '/opponents?friends=1', { credential: arne.credential })).body.opponents).toEqual(
          pickerBefore.body.opponents.map((o: object) => ({ ...o, connectedAt: null })),
        );
        expect((await api('GET', '/opponents?friends=1', { credential: william.credential })).body.opponents).toEqual([]);
        expect((await api('GET', `/games/${waiting.body.game.id}/invitation`, { credential: arne.credential })).body.invitation.invitedEmail).toBe(`nobody-${run}@example.test`);

        // The new path works over the old records, and changes none of them.
        const link = await api('POST', '/friend-invitations', { credential: arne.credential, body: { requestId: crypto.randomUUID() } });
        expect(link.status).toBe(201);
        expect((await api('POST', '/friend-invitations/accept', { credential: william.credential, body: { token: link.body.invitation.token } })).status).toBe(200);
        expect(await snapshot(tx)).toEqual(before);

        // What the tables themselves refuse.
        const [low, high] = [arne.id, harald.id].sort();
        const hash = (n: number) => tx`decode(${n.toString(16).padStart(64, '0')}, 'hex')`;
        const refused: [() => unknown, RegExp][] = [
          [() => tx`insert into player_connections (player_low, player_high) values (${high}, ${low})`, /player_connection_ordered/],
          [() => tx`insert into player_connections (player_low, player_high) values (${low}, ${low})`, /player_connection_ordered/],
          [
            () => tx`insert into friend_invitations (created_by, create_request_id, token_hash, expires_at, accepted_at, accepted_by)
                     values (${arne.id}, gen_random_uuid(), ${hash(1)}, now(), now(), ${arne.id})`,
            /friend_invitation_not_own/,
          ],
          [
            () => tx`insert into friend_invitations (created_by, create_request_id, token_hash, expires_at, accepted_at)
                     values (${arne.id}, gen_random_uuid(), ${hash(2)}, now(), now())`,
            /friend_invitation_accepted_together/,
          ],
          [
            () => tx`insert into friend_invitations (created_by, create_request_id, token_hash, expires_at)
                     values (${arne.id}, gen_random_uuid(), decode('abcd', 'hex'), now())`,
            /token_hash/,
          ],
        ];
        for (const [statement, why] of refused) await expect(tx.savepoint(statement as never)).rejects.toThrow(why);
        await tx.savepoint((sp) => sp`insert into player_connections (player_low, player_high) values (${low}, ${high})`);
        await expect(tx.savepoint((sp) => sp`insert into player_connections (player_low, player_high) values (${low}, ${high})`)).rejects.toThrow(/duplicate key/);

        // Not reachable through the public API roles.
        const access = await tx`
          select c.relname, c.relrowsecurity,
                 has_table_privilege('anon', c.oid, 'select') as anon, has_table_privilege('authenticated', c.oid, 'select') as authenticated
            from pg_class c where c.relname in ('friend_invitations', 'player_connections') order by 1`;
        expect(access).toEqual([
          { relname: 'friend_invitations', relrowsecurity: true, anon: false, authenticated: false },
          { relname: 'player_connections', relrowsecurity: true, anon: false, authenticated: false },
        ]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
    // Rehearsal only: the real schema is as migrated.
    const [{ n }] = await sql`select count(*)::int as n from pg_class where relname in ('friend_invitations', 'player_connections')`;
    expect(n).toBe(2);
  });
});
