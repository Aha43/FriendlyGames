// The Yatzy migration (#85; format proved in #84), against the real local backend. Inside a
// rolled-back transaction the schema is put back as it was before the migration, chess and
// Chess960 records are made through the API, and the migration is applied over them: no existing
// row changes, and the widened checks hold the new shape. (The #84 rehearsal of this same change
// against the previous backend, 1c0850a, is the rollback evidence: docs/decisions/0002.)
import { readFileSync } from 'node:fs';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../../supabase/functions/game-api/api';
import { completeGame } from '../../../supabase/functions/_shared/yatzy/fixtures';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const migration = readFileSync(new URL('../../../supabase/migrations/20261111120000_yatzy_games.sql', import.meta.url), 'utf8');
const rollback = new Error('rollback test transaction');
const TYPES = 'types=chess,chess960';

/** The checks as they were before the migration (migrations up to 20261108120000). */
const BEFORE = `
  alter table public.games drop constraint games_game_type_check;
  alter table public.games add constraint games_game_type_check check (game_type in ('chess', 'chess960'));
  alter table public.games drop constraint games_result_check;
  alter table public.games add constraint games_result_check check (result in ('white', 'black', 'draw'));
  alter table public.games drop constraint games_termination_check;
  alter table public.games add constraint games_termination_check check (termination in (
    'checkmate', 'resignation', 'stalemate', 'insufficient-material', 'threefold-repetition', 'fifty-move-rule'));
  alter table public.game_participants drop constraint game_participants_seat_check;
  alter table public.game_participants add constraint game_participants_seat_check check (seat in ('white', 'black'));
  alter table public.game_actions drop constraint game_actions_kind_check;
  alter table public.game_actions add constraint game_actions_kind_check check (kind in ('move', 'resign', 'castle'));
  alter table public.game_actions drop constraint game_actions_move_check;
  alter table public.game_actions add constraint game_actions_move_check check (move ~ '^[a-h][1-8][a-h][1-8][qrbn]?$');
  alter table public.game_actions drop constraint move_has_notation;
  alter table public.game_actions add constraint move_has_notation check ((kind in ('move', 'castle')) = (move is not null));
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

describe('the Yatzy migration', () => {
  it('applies over chess and Chess960 records without changing them, and holds the new shape', async () => {
    await expect(
      sql.begin(async (tx) => {
        // Existing Yatzy rows (from other tests on this database) cannot exist before the migration.
        await tx`
          delete from games
           where game_type = 'yatzy'
              or id in (select game_id from game_participants where seat not in ('white', 'black'))`; // seats and actions cascade
        await tx.unsafe(BEFORE);

        const api = apiOn(tx);
        const run = uniqueSuffix();
        const enter = async (name: string) => {
          const r = await api('POST', '/players', { body: { email: `${name}-${run}@example.test`, displayName: `${name} ${run}` } });
          expect(r.status).toBe(201);
          return { id: r.body.player.id as string, credential: r.body.deviceCredential as string, email: `${name}-${run}@example.test` };
        };
        const [host, guest1, guest2] = [await enter('Host'), await enter('Guest1'), await enter('Guest2')];

        // Legacy records on the old schema: a finished chess game (a move, then a resignation), a
        // finished Chess960 game, an active chess game and a waiting invitation.
        const seated = async (guest: typeof guest1, type: string) => {
          const created = await api('POST', `/games?${TYPES}`, {
            credential: host.credential,
            body: { friendEmail: guest.email, requestId: crypto.randomUUID(), type },
          });
          expect(created.status).toBe(201);
          await api('POST', `/invitations/redeem?${TYPES}`, { credential: guest.credential, body: { token: created.body.invitation.token } });
          return created.body.game.id as string;
        };
        const chessId = await seated(guest1, 'chess');
        const chess = await api('GET', `/games/${chessId}?${TYPES}`, { credential: host.credential });
        const moved = await api('POST', `/games/${chessId}/actions?${TYPES}`, {
          credential: host.credential,
          body: { requestId: crypto.randomUUID(), expectedRevision: chess.body.game.revision, action: { type: 'move', from: 'e2', to: 'e4' } },
        });
        expect(moved.status).toBe(200);
        await api('POST', `/games/${chessId}/actions?${TYPES}`, {
          credential: guest1.credential,
          body: { requestId: crypto.randomUUID(), expectedRevision: moved.body.game.revision, action: { type: 'resign' } },
        });
        const fischerId = await seated(guest2, 'chess960');
        const fischer = await api('GET', `/games/${fischerId}?${TYPES}`, { credential: guest2.credential });
        await api('POST', `/games/${fischerId}/actions?${TYPES}`, {
          credential: guest2.credential,
          body: { requestId: crypto.randomUUID(), expectedRevision: fischer.body.game.revision, action: { type: 'resign' } },
        });
        await seated(guest1, 'chess');
        await api('POST', `/games?${TYPES}`, { credential: host.credential, body: { friendEmail: `nobody-${run}@example.test`, type: 'chess' } });
        // The old schema has no Yatzy.
        await expect(
          tx.savepoint((sp) => sp`
            insert into games (game_type, schema_version, status, payload, created_by)
            values ('yatzy', 1, 'active', '{}', ${host.id})`),
        ).rejects.toThrow(/violates check constraint/);
        const history = await api('GET', `/history?${TYPES}`, { credential: host.credential });

        // The migration rewrites none of them, and what the chess clients read is the same.
        const before = await snapshot(tx);
        await tx.unsafe(migration);
        expect(await snapshot(tx)).toEqual(before);
        expect((await api('GET', `/history?${TYPES}`, { credential: host.credential })).body).toEqual(history.body);
        const finishedChess = await api('GET', `/games/${chessId}?${TYPES}`, { credential: guest1.credential });
        expect(finishedChess.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'resignation' });

        // The widened checks: a table through the API, then shapes they still refuse.
        const table = await api('POST', '/games?types=chess,chess960,yatzy', {
          credential: host.credential,
          body: { type: 'yatzy', mode: 'free', friendPlayerIds: [guest1.id, guest2.id], requestId: crypto.randomUUID() },
        });
        expect(table.status).toBe(201);
        const tableId = table.body.game.id as string;
        const refused = async (statement: () => Promise<unknown>) =>
          expect(tx.savepoint(statement as never)).rejects.toThrow(/violates check constraint/);
        await refused(() => tx`update game_participants set seat = 'p5' where game_id = ${tableId} and seat = 'p3'`);
        for (const [kind, move] of [['throw', 'keep:01234'], ['throw', 'keep:31'], ['throw', null], ['score', 'chance'], ['resign', 'row:ones'], ['move', 'keep:']]) {
          await refused(() => tx`
            insert into game_actions (game_id, player_id, request_id, kind, move, revision)
            values (${tableId}, ${guest1.id}, gen_random_uuid(), ${kind}, ${move}, 1000)`);
        }
        await refused(() => tx`update games set result = 'winner' where id = ${tableId}`);
        // A finished table is frozen like any finished game.
        const [done] = await tx`
          insert into games (game_type, schema_version, status, result, termination, revision, payload, created_by)
          values ('yatzy', 1, 'finished', 'scored', 'scorecards-complete', 60, ${tx.json(completeGame('free', 2) as never)}, ${host.id})
          returning id`;
        await expect(tx.savepoint((sp) => sp`update games set payload = '{}' where id = ${done.id}`)).rejects.toThrow(/is finished/);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
