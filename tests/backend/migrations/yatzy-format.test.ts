// Yatzy save-format rehearsal (#84), against the real local backend. Inside a rolled-back
// transaction: legacy chess and Chess960 records are made through today's API, the proposed
// schema change (supabase/proposals/yatzy_games.sql) is applied over them, and Yatzy tables are
// stored in the proposed shape. Today's API is the live backend `1c0850a`, the supported rollback
// target once Yatzy tables exist (never before the #53 dispatcher, which would replay Chess960 as
// chess), so every check below runs against it unchanged.
import { readFileSync } from 'node:fs';
import type { Sql, TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { handleRequest } from '../../../supabase/functions/game-api/api';
import { completeGame, play } from '../../../supabase/functions/_shared/yatzy/fixtures';
import { newRecord, replay, standings, type LogEntry, type YatzyRecord } from '../../../supabase/functions/_shared/yatzy/rules';
import { db, uniqueSuffix } from '../client';

const sql = db();
afterAll(() => sql.end());

const proposal = readFileSync(new URL('../../../supabase/proposals/yatzy_games.sql', import.meta.url), 'utf8');
const rollback = new Error('rollback test transaction');
const TYPES = 'types=chess,chess960';

/** Today's API on this transaction: its own transactions become savepoints. */
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

/** Stores a Yatzy table in the proposed shape: seats p1.., one action row per log entry. */
async function storeTable(tx: TransactionSql, players: string[], record: YatzyRecord) {
  const state = replay(record);
  if ('error' in state) throw new Error(state.error.message);
  const [game] = await tx`
    insert into games (game_type, schema_version, status, result, termination, revision, payload, created_by)
    values ('yatzy', 1, ${state.finished ? 'finished' : 'active'}, ${state.finished ? 'scored' : null},
            ${state.finished ? 'scorecards-complete' : null}, ${record.log.length}, ${tx.json(record as never)}, ${players[0]})
    returning id`;
  for (const [i, id] of players.entries()) {
    await tx`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${id}, ${`p${i + 1}`})`;
  }
  // Who acted at each entry: the player whose turn it was, replayed from the log so far.
  const actor = (n: number) => {
    const before = replay({ ...record, log: record.log.slice(0, n) });
    if ('error' in before) throw new Error(before.error.message);
    return players[before.current!];
  };
  const notation = (e: LogEntry) => (e.t === 'throw' ? `keep:${e.keep.join('')}` : `row:${e.row}`);
  for (const [i, entry] of record.log.entries()) {
    await tx`
      insert into game_actions (game_id, player_id, request_id, kind, move, revision)
      values (${game.id}, ${actor(i)}, gen_random_uuid(), ${entry.t}, ${notation(entry)}, ${i + 1})`;
  }
  return game.id as string;
}

describe('the proposed Yatzy format', () => {
  it('applies over chess and Chess960 records unchanged; today’s API keeps every chess path working beside Yatzy tables', async () => {
    await expect(
      sql.begin(async (tx) => {
        const api = apiOn(tx);
        const run = uniqueSuffix();
        const enter = async (name: string) => {
          const r = await api('POST', '/players', { body: { email: `${name}-${run}@example.test`, displayName: `${name} ${run}` } });
          expect(r.status).toBe(201);
          return { id: r.body.player.id as string, credential: r.body.deviceCredential as string, email: `${name}-${run}@example.test` };
        };
        const [host, guest1, guest2, other] = [await enter('Host'), await enter('Guest1'), await enter('Guest2'), await enter('Other')];

        // Legacy records: a finished chess game host–guest1 (one move, then a resignation), a finished
        // Chess960 game host–guest2, an active chess game host–other and a waiting invitation.
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
        const activeId = await seated(other, 'chess');
        await api('POST', `/games?${TYPES}`, { credential: host.credential, body: { friendEmail: `nobody-${run}@example.test`, type: 'chess' } });

        const historyBefore = await api('GET', `/history?${TYPES}`, { credential: host.credential });
        expect(historyBefore.body.history.map((h: { gameType: string; wins: number }) => [h.gameType, h.wins])).toEqual(
          expect.arrayContaining([['chess', 1], ['chess960', 1]]),
        );
        // Before any Yatzy table, the two guests have never met.
        const guestsBefore = await api('GET', '/opponents', { credential: guest1.credential });
        expect(guestsBefore.body.opponents.map((o: { id: string }) => o.id)).not.toContain(guest2.id);

        // The proposed change rewrites none of them.
        const before = await snapshot(tx);
        await tx.unsafe(proposal);
        expect(await snapshot(tx)).toEqual(before);

        // Two Yatzy tables in the proposed shape: a finished three-player table and one mid-turn.
        const finished = completeGame('free', 3, (seat, row) =>
          row === 'yatzy' && seat !== 1 ? [{ throw: [1, 2, 3, 4, 6] }, { score: 'yatzy' }] : undefined,
        );
        const finishedTable = await storeTable(tx, [host.id, guest1.id, guest2.id], finished);
        const midTurn = play(newRecord('forced', 3), [
          { throw: [1, 1, 1, 2, 3] },
          { score: 'ones' },
          { throw: [5, 1, 3, 1, 1] },
          { throw: [6, 1, 2, 1, 1], keep: [1, 3, 4] },
        ]);
        const activeTable = await storeTable(tx, [host.id, guest1.id, guest2.id], midTurn);

        // Saved state survives a read back: the finished ranking and the turn in progress.
        const [stored] = await tx`select payload, status, result, termination, revision from games where id = ${finishedTable}`;
        const finalState = replay(stored.payload as YatzyRecord);
        if ('error' in finalState) throw new Error(finalState.error.message);
        expect(standings(finalState).map((s) => [s.seat, s.place])).toEqual([[1, 1], [0, 2], [2, 2]]);
        expect(stored).toMatchObject({ status: 'finished', result: 'scored', termination: 'scorecards-complete', revision: 90 });
        const [resumed] = await tx`select payload from games where id = ${activeTable}`;
        const turn = replay(resumed.payload as YatzyRecord);
        if ('error' in turn) throw new Error(turn.error.message);
        expect(turn).toMatchObject({ current: 1, turn: { throws: 2, dice: [6, 1, 2, 1, 1], kept: [1, 3, 4] } });
        expect(turn.players.map((p) => p.tokens)).toEqual([2, 0, 0]);

        // Guests who share only a Yatzy table are now previous opponents and may start chess.
        const guestsAfter = await api('GET', '/opponents', { credential: guest1.credential });
        const met = guestsAfter.body.opponents.find((o: { id: string }) => o.id === guest2.id);
        expect(met).toMatchObject({ displayName: `Guest2 ${run}`, sharedGames: 2 });
        const hostOpponents = await api('GET', '/opponents', { credential: host.credential });
        expect(hostOpponents.body.opponents.find((o: { id: string }) => o.id === guest1.id).sharedGames).toBe(3);
        const direct = await api('POST', `/games?${TYPES}`, {
          credential: guest1.credential,
          body: { friendPlayerId: guest2.id, requestId: crypto.randomUUID(), type: 'chess' },
        });
        expect(direct.status).toBe(201);
        expect(direct.body.game).toMatchObject({ type: 'chess', status: 'active' });
        expect(direct.body.invitation).toBeNull();
        const play960 = await api('POST', `/games?${TYPES}`, {
          credential: guest2.credential,
          body: { friendPlayerId: guest1.id, requestId: crypto.randomUUID(), type: 'chess960' },
        });
        expect(play960.status).toBe(201);
        // …and that chess game is played as usual.
        const firstMove = await api('POST', `/games/${direct.body.game.id}/actions?${TYPES}`, {
          credential: guest1.credential,
          body: { requestId: crypto.randomUUID(), expectedRevision: direct.body.game.revision, action: { type: 'move', from: 'g1', to: 'f3' } },
        });
        expect(firstMove.status).toBe(200);
        // A stranger to both tables still may not.
        const stranger = await api('POST', `/games?${TYPES}`, {
          credential: other.credential,
          body: { friendPlayerId: guest2.id, requestId: crypto.randomUUID(), type: 'chess' },
        });
        expect(stranger.body.error?.code).toBe('opponent_not_found');

        // Chess tallies stay pairwise: the finished Yatzy table adds nothing to anyone's history.
        const historyAfter = await api('GET', `/history?${TYPES}`, { credential: host.credential });
        expect(historyAfter.body).toEqual(historyBefore.body);
        for (const guest of [guest1, guest2]) {
          const history = await api('GET', `/history?${TYPES}`, { credential: guest.credential });
          for (const entry of history.body.history) expect(['chess', 'chess960']).toContain(entry.gameType);
          expect(history.body.history.some((h: { opponent: { id: string } }) => h.opponent.id === (guest === guest1 ? guest2.id : guest1.id))).toBe(false);
        }

        // Clients that don't ask for Yatzy never see it: lists and direct requests leave it out.
        for (const query of ['', `?${TYPES}`, '?types=chess,chess960,yatzy']) {
          const list = await api('GET', `/games${query}`, { credential: host.credential });
          expect(list.status).toBe(200);
          const ids = list.body.games.map((g: { id: string }) => g.id);
          expect(ids).not.toContain(finishedTable);
          expect(ids).not.toContain(activeTable);
          if (query === `?${TYPES}`) expect(ids).toEqual(expect.arrayContaining([chessId, fischerId, activeId]));
        }
        const direct404 = await api('GET', `/games/${activeTable}?${TYPES}`, { credential: guest1.credential });
        expect(direct404.status).toBe(422);
        const beforeAttempt = await snapshot(tx);
        for (const path of [`/games/${activeTable}/actions`, `/games/${finishedTable}/rematch`]) {
          const attempt = await api('POST', `${path}?${TYPES}`, {
            credential: guest1.credential,
            body: { requestId: crypto.randomUUID(), expectedRevision: 4, action: { type: 'resign' } },
          });
          expect(attempt.status, path).toBe(422);
        }
        expect(await snapshot(tx)).toEqual(beforeAttempt);

        // The proposed checks hold the shape: seats p1–p4, throw and score notation.
        const refused = async (statement: () => Promise<unknown>) =>
          expect(tx.savepoint(statement as never)).rejects.toThrow(/violates check constraint/);
        await refused(() => tx`insert into game_participants (game_id, player_id, seat) values (${activeTable}, ${other.id}, 'p5')`);
        for (const [kind, move] of [['throw', 'keep:01234'], ['throw', 'keep:31'], ['throw', null], ['score', 'chance'], ['resign', 'row:ones'], ['move', 'keep:']]) {
          await refused(() => tx`
            insert into game_actions (game_id, player_id, request_id, kind, move, revision)
            values (${activeTable}, ${guest1.id}, gen_random_uuid(), ${kind}, ${move}, 1000)`);
        }
        await refused(() => tx`update games set result = 'winner' where id = ${activeTable}`);
        // The finished table is frozen like any finished game.
        await expect(tx.savepoint((sp) => sp`update games set payload = '{}' where id = ${finishedTable}`)).rejects.toThrow(/is finished/);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
    // Rehearsal only: the real schema still knows two game types.
    const [check] = await sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'games_game_type_check'`;
    expect(check.d).not.toContain('yatzy');
  });
});
