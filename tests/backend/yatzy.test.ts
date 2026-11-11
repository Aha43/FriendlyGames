// Yatzy tables (#85), against the real local backend: the ordered roster and who may be seated,
// server dice, throws and scores with exact retries, turn and membership checks, reload mid-turn,
// finished rankings, previous opponents through a table, and chess left as it was.
import { afterAll, describe, expect, it } from 'vitest';
import { completeGame, play, type Scripted } from '../../supabase/functions/_shared/yatzy/fixtures';
import {
  newRecord,
  replay,
  ROWS,
  scoreRow,
  tokensBanked,
  type Die,
  type Row,
  type YatzyRecord,
} from '../../supabase/functions/_shared/yatzy/rules';
import { call, db, newPlayer, randomUUID, resign, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const ALL = '?types=chess,chess960,yatzy';
const CHESS = '?types=chess,chess960';
type Mode = 'forced' | 'free';

const createTable = (host: TestPlayer, guests: string[], mode: Mode | unknown = 'free', extra: Record<string, unknown> = {}, query = ALL) =>
  call('POST', `/games${query}`, { credential: host.credential, body: { type: 'yatzy', mode, friendPlayerIds: guests, ...extra } });
const read = (p: TestPlayer, gameId: string, query = ALL) => call('GET', `/games/${gameId}${query}`, { credential: p.credential });
const act = (p: TestPlayer, gameId: string, revision: number, action: unknown, requestId = randomUUID(), query = ALL) =>
  call('POST', `/games/${gameId}/actions${query}`, { credential: p.credential, body: { requestId, expectedRevision: revision, action } });
const throwDice = (p: TestPlayer, gameId: string, revision: number, keep: number[] = [], requestId = randomUUID()) =>
  act(p, gameId, revision, { type: 'throw', keep }, requestId);
const score = (p: TestPlayer, gameId: string, revision: number, row: Row, requestId = randomUUID()) =>
  act(p, gameId, revision, { type: 'score', row }, requestId);
const stored = async (gameId: string) =>
  (await sql`select status, result, termination, revision, payload from games where id = ${gameId}`)[0];
const actions = async (gameId: string) =>
  await sql`select player_id, kind, move, revision from game_actions where game_id = ${gameId} order by revision`;

/** A host who has sat at a chess game with each guest (the guests have never met each other). */
async function friends(guestCount: number) {
  const host = await newPlayer('Host');
  const guests: TestPlayer[] = [];
  for (let i = 0; i < guestCount; i++) {
    const guest = await newPlayer(`Guest${i + 1}`);
    await startGame(host, guest);
    guests.push(guest);
  }
  return { host, guests };
}

async function table(guestCount: number, mode: Mode = 'free') {
  const { host, guests } = await friends(guestCount);
  const created = await createTable(host, guests.map((g) => g.id), mode);
  expect(created.status).toBe(201);
  return { host, guests, players: [host, ...guests], game: created.body.game };
}

/** Stores a table as the API would have left it after `record`, for results dice cannot be asked to give. */
async function storedTable(players: TestPlayer[], record: YatzyRecord) {
  const state = replay(record);
  if ('error' in state) throw new Error(state.error.message);
  const { mode, players: count, log } = record;
  const [game] = await sql`
    insert into games (game_type, schema_version, status, result, termination, revision, payload, created_by)
    values ('yatzy', 1, ${state.finished ? 'finished' : 'active'}, ${state.finished ? 'scored' : null},
            ${state.finished ? 'scorecards-complete' : null}, ${log.length}, ${sql.json({ mode, players: count, log } as never)}, ${players[0].id})
    returning id`;
  for (const [i, p] of players.entries()) {
    await sql`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${p.id}, ${`p${i + 1}`})`;
  }
  return game.id as string;
}

describe('creating a table', () => {
  it('seats the host first and the chosen previous opponents in order, active at once, visible to everyone seated', async () => {
    const { host, guests } = await friends(3);
    const order = [guests[2], guests[0], guests[1]];
    const created = await createTable(host, order.map((g) => g.id), 'forced');
    expect(created.status).toBe(201);
    const game = created.body.game;
    expect(created.body).toMatchObject({ invitation: null, duplicate: false });
    expect(game).toMatchObject({
      type: 'yatzy',
      schemaVersion: 1,
      status: 'active',
      result: null,
      revision: 0,
      yourSeat: 'p1',
      turn: 'p1',
      moveCount: 0,
      rematchGameId: null,
      players: {
        p1: { id: host.id, displayName: host.name },
        p2: { id: order[0].id, displayName: order[0].name },
        p3: { id: order[1].id, displayName: order[1].name },
        p4: { id: order[2].id, displayName: order[2].name },
      },
    });
    expect(Object.keys(game.players)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(game.yatzy).toMatchObject({
      mode: 'forced',
      current: 'p1',
      turn: { throws: 0, dice: null, kept: [] },
      standings: null,
      winners: null,
    });
    expect(game.yatzy.players).toEqual(
      ['p1', 'p2', 'p3', 'p4'].map((seat) => ({ seat, scores: {}, upperSum: 0, bonus: 0, total: 0, tokens: 0 })),
    );
    // No invitation exists; each guest finds the table in their usual list and opens it.
    expect((await sql`select count(*)::int as n from game_invitations where game_id = ${game.id}`)[0].n).toBe(0);
    for (const [i, guest] of order.entries()) {
      const list = await call('GET', `/games${ALL}`, { credential: guest.credential });
      const mine = list.body.games.find((g: { id: string }) => g.id === game.id);
      expect(mine).toMatchObject({ type: 'yatzy', yourSeat: `p${i + 2}`, turn: 'p1' });
      expect((await read(guest, game.id)).body.game.yatzy.mode).toBe('forced');
    }
    // No emails, credentials or tokens in what the table shows.
    const text = JSON.stringify(game);
    for (const p of [host, ...guests]) {
      expect(text).not.toContain(p.email);
      expect(text).not.toContain(p.credential);
    }
  });

  it('plays with two, three or four players only', async () => {
    const { host, guests } = await friends(4);
    for (const n of [1, 2, 3]) {
      const created = await createTable(host, guests.slice(0, n).map((g) => g.id));
      expect(created.status).toBe(201);
      expect(Object.keys(created.body.game.players)).toHaveLength(n + 1);
    }
    for (const ids of [[], guests.map((g) => g.id)]) {
      const refused = await createTable(host, ids);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('bad_request');
    }
  });

  it('refuses a roster that is not distinct previous opponents, the same way for every reason, creating nothing', async () => {
    const { host, guests } = await friends(2);
    const stranger = await newPlayer('Stranger');
    const before = (await sql`select count(*)::int as n from games where created_by = ${host.id}`)[0].n;
    for (const ids of [[stranger.id], [guests[0].id, stranger.id], [host.id], [guests[0].id, host.id], [randomUUID()]]) {
      const refused = await createTable(host, ids);
      expect(refused.status, JSON.stringify(ids)).toBe(404);
      expect(refused.body.error.code).toBe('opponent_not_found');
    }
    // A guest cannot seat the other guest: they have never sat at a game together.
    const viaGuest = await createTable(guests[0], [guests[1].id]);
    expect(viaGuest.body.error?.code).toBe('opponent_not_found');
    // Malformed rosters and options.
    const bad: [unknown, unknown][] = [
      [[guests[0].id, guests[0].id], 'free'],
      [[guests[0].id, guests[0].id.toUpperCase()], 'free'],
      [['not-an-id'], 'free'],
      [guests[0].id, 'free'],
      [[guests[0].name], 'free'],
      [[guests[0].email], 'free'],
      [[guests[0].id], 'random'],
      [[guests[0].id], null],
      [[guests[0].id], 3],
    ];
    for (const [ids, mode] of bad) {
      const refused = await createTable(host, ids as string[], mode);
      expect(refused.status, JSON.stringify([ids, mode])).toBe(400);
    }
    const noMode = await call('POST', `/games${ALL}`, { credential: host.credential, body: { type: 'yatzy', friendPlayerIds: [guests[0].id] } });
    expect(noMode.status).toBe(400);
    // Chess-style targets are not table targets, and table options are not chess options.
    expect((await createTable(host, [guests[0].id], 'free', { friendEmail: guests[1].email })).status).toBe(400);
    expect((await createTable(host, [guests[0].id], 'free', { friendPlayerId: guests[1].id })).status).toBe(400);
    const chessWithRoster = await call('POST', `/games${ALL}`, {
      credential: host.credential,
      body: { type: 'chess', friendPlayerId: guests[0].id, friendPlayerIds: [guests[1].id] },
    });
    expect(chessWithRoster.status).toBe(400);
    expect((await sql`select count(*)::int as n from games where created_by = ${host.id}`)[0].n).toBe(before);
  });

  it('only for clients that ask for Yatzy', async () => {
    const { host, guests } = await friends(1);
    for (const query of ['', CHESS]) {
      const refused = await createTable(host, [guests[0].id], 'free', {}, query);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('unsupported_game_type');
    }
  });

  it('a retried creation finds the same table; the same ID for a different table is refused', async () => {
    const { host, guests } = await friends(3);
    const requestId = randomUUID();
    const ids = guests.slice(0, 2).map((g) => g.id);
    const first = await createTable(host, ids, 'forced', { requestId });
    const [again, concurrentA, concurrentB] = await Promise.all([
      createTable(host, ids, 'forced', { requestId }),
      createTable(host, ids, 'forced', { requestId }),
      createTable(host, ids, 'forced', { requestId }),
    ]);
    for (const retry of [again, concurrentA, concurrentB]) {
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ duplicate: true, invitation: null, game: { id: first.body.game.id } });
    }
    // Different mode, order, roster or type under the same ID: a different game.
    const others = [
      await createTable(host, ids, 'free', { requestId }),
      await createTable(host, [ids[1], ids[0]], 'forced', { requestId }),
      await createTable(host, [ids[0]], 'forced', { requestId }),
      await createTable(host, [...ids, guests[2].id], 'forced', { requestId }),
      await call('POST', `/games${ALL}`, { credential: host.credential, body: { type: 'chess', friendPlayerId: ids[0], requestId } }),
      await call('POST', `/games${ALL}`, { credential: host.credential, body: { type: 'chess', friendEmail: guests[0].email, requestId } }),
    ];
    for (const other of others) {
      expect(other.status).toBe(409);
      expect(other.body.error.code).toBe('request_id_reused');
    }
    // A chess creation's ID cannot become a table either.
    const chessId = randomUUID();
    await call('POST', `/games${ALL}`, { credential: host.credential, body: { type: 'chess', friendPlayerId: ids[0], requestId: chessId } });
    expect((await createTable(host, [ids[0]], 'free', { requestId: chessId })).body.error.code).toBe('request_id_reused');
    const made = await sql`select id from games where created_by = ${host.id} and create_request_id = ${requestId}`;
    expect(made).toHaveLength(1);
    expect((await sql`select count(*)::int as n from game_participants where game_id = ${made[0].id}`)[0].n).toBe(3);
  });

  it('two tables started at the same moment with different IDs are two tables', async () => {
    const { host, guests } = await friends(1);
    const [a, b] = await Promise.all([createTable(host, [guests[0].id]), createTable(host, [guests[0].id])]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.game.id).not.toBe(b.body.game.id);
  });
});

describe('throwing', () => {
  it('rolls five dice on the server, keeps the chosen positions on later throws, and saves each outcome', async () => {
    const { host, game } = await table(1);
    const first = await throwDice(host, game.id, 0);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    const dice1 = first.body.game.yatzy.turn.dice as Die[];
    expect(dice1).toHaveLength(5);
    for (const die of dice1) expect([1, 2, 3, 4, 5, 6]).toContain(die);
    expect(first.body.game).toMatchObject({ revision: 1, turn: 'p1', moveCount: 1, yatzy: { turn: { throws: 1, kept: [] } } });

    const second = await throwDice(host, game.id, 1, [4, 0, 2]);
    expect(second.status).toBe(200);
    const turn = second.body.game.yatzy.turn;
    expect(turn).toMatchObject({ throws: 2, kept: [0, 2, 4] });
    for (const p of [0, 2, 4]) expect(turn.dice[p]).toBe(dice1[p]);

    // What was committed: the dice in the record, the kept positions as the action's notation.
    const row = await stored(game.id);
    expect(row.revision).toBe(2);
    expect(row.payload.log).toEqual([
      { t: 'throw', keep: [], dice: dice1 },
      { t: 'throw', keep: [0, 2, 4], dice: turn.dice },
    ]);
    expect((await actions(game.id)).map((a) => [a.player_id, a.kind, a.move, a.revision])).toEqual([
      [host.id, 'throw', 'keep:', 1],
      [host.id, 'throw', 'keep:024', 2],
    ]);
  });

  it('never accepts dice, points or tokens from a client, or a malformed keep', async () => {
    const { host, game } = await table(1);
    await throwDice(host, game.id, 0);
    const bad: unknown[] = [
      { type: 'throw', keep: [], dice: [6, 6, 6, 6, 6] },
      { type: 'throw', keep: [0], dice: [6, 6, 6, 6, 6] },
      { type: 'throw', keep: [0], tokens: 5 },
      { type: 'throw', keep: [0, 1, 2, 3, 4] },
      { type: 'throw', keep: [0, 0] },
      { type: 'throw', keep: [5] },
      { type: 'throw', keep: [-1] },
      { type: 'throw', keep: [1.5] },
      { type: 'throw', keep: ['0'] },
      { type: 'throw', keep: '01' },
      { type: 'score', row: 'chance', points: 30 },
      { type: 'score', row: 'chance', dice: [6, 6, 6, 6, 6] },
      { type: 'score', row: 'bonus' },
      { type: 'score', row: 7 },
      { type: 'score' },
      { type: 'move', from: 'e2', to: 'e4' },
      { type: 'castle', side: 'kingside' },
      { type: 'roll' },
      null,
      'throw',
    ];
    for (const action of bad) {
      const refused = await act(host, game.id, 1, action);
      expect(refused.status, JSON.stringify(action)).toBe(400);
      expect(refused.body.error.code).toBe('bad_request');
    }
    expect((await stored(game.id)).revision).toBe(1);
    expect(await actions(game.id)).toHaveLength(1);
  });

  it('refuses keeping on a first throw, and a fourth throw without a banked token', async () => {
    const { host, game } = await table(1);
    const early = await throwDice(host, game.id, 0, [0]);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('bad_keep');
    await throwDice(host, game.id, 0);
    await throwDice(host, game.id, 1, [0]);
    await throwDice(host, game.id, 2, [0, 1]);
    const fourth = await throwDice(host, game.id, 3, [0]);
    expect(fourth.status).toBe(422);
    expect(fourth.body.error.code).toBe('no_tokens');
    const row = await stored(game.id);
    expect(row.revision).toBe(3);
    expect(row.payload.log).toHaveLength(3);
  });

  it('a retried throw returns the committed dice and never rolls or charges again', async () => {
    const { host, guests, game } = await table(1);
    const guest = guests[0];
    // The host banks two tokens (scores on the first throw), the guest plays, the host uses three throws.
    let revision = (await throwDice(host, game.id, 0)).body.game.revision;
    revision = (await score(host, game.id, revision, 'chance')).body.game.revision;
    revision = (await throwDice(guest, game.id, revision)).body.game.revision;
    revision = (await score(guest, game.id, revision, 'chance')).body.game.revision;
    for (const keep of [[], [0], [0]]) revision = (await throwDice(host, game.id, revision, keep)).body.game.revision;

    // A fourth throw costs one token. Its reply is "lost"; the same request arrives again, four times at once.
    const requestId = randomUUID();
    const paid = await throwDice(host, game.id, revision, [1, 3], requestId);
    expect(paid.status).toBe(200);
    expect(paid.body.game.yatzy.players[0].tokens).toBe(1);
    const committed = paid.body.game.yatzy.turn;
    expect(committed).toMatchObject({ throws: 4, kept: [1, 3] });
    const retries = await Promise.all([1, 2, 3, 4].map(() => throwDice(host, game.id, revision, [3, 1], requestId)));
    for (const retry of retries) {
      expect(retry.status).toBe(200);
      expect(retry.body.duplicate).toBe(true);
      expect(retry.body.game.yatzy.turn).toEqual(committed);
      expect(retry.body.game.yatzy.players[0].tokens).toBe(1);
      expect(retry.body.game.revision).toBe(revision + 1);
    }
    const row = await stored(game.id);
    expect(row.revision).toBe(revision + 1);
    expect(row.payload.log.filter((e: { t: string }) => e.t === 'throw')).toHaveLength(6);
    expect((await actions(game.id)).filter((a) => a.move === 'keep:13')).toHaveLength(1);

    // The same ID for a different throw or a score is a client bug, not a retry.
    for (const action of [{ type: 'throw', keep: [1] }, { type: 'throw', keep: [] }, { type: 'score', row: 'ones' }]) {
      const reused = await act(host, game.id, revision + 1, action, requestId);
      expect(reused.status).toBe(409);
      expect(reused.body.error.code).toBe('request_id_reused');
    }
    // The second paid throw takes the last token; a third is refused.
    const fifth = await throwDice(host, game.id, revision + 1, [1, 3]);
    expect(fifth.body.game.yatzy.players[0].tokens).toBe(0);
    expect((await throwDice(host, game.id, revision + 2, [1, 3])).body.error.code).toBe('no_tokens');
    // Scoring after paid throws banks nothing.
    const scored = await score(host, game.id, revision + 2, 'ones');
    expect(scored.body.game.yatzy.players[0].tokens).toBe(0);
  });

  it('two different throws sent at once: one is saved, the other is told the game changed', async () => {
    const { host, game } = await table(1);
    await throwDice(host, game.id, 0);
    const [a, b] = await Promise.all([throwDice(host, game.id, 1, [0]), throwDice(host, game.id, 1, [1])]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stale = a.status === 409 ? a : b;
    expect(stale.body.error.code).toBe('stale_revision');
    expect(stale.body.error.game.yatzy.turn.throws).toBe(2);
    expect((await stored(game.id)).payload.log).toHaveLength(2);
  });
});

describe('scoring', () => {
  it('needs a throw first; commits the row, its calculated points and the banked tokens, and passes the turn', async () => {
    const { host, guests, game } = await table(2);
    const unthrown = await score(host, game.id, 0, 'chance');
    expect(unthrown.status).toBe(422);
    expect(unthrown.body.error.code).toBe('not_thrown');

    const thrown = await throwDice(host, game.id, 0);
    const dice = thrown.body.game.yatzy.turn.dice as Die[];
    const scored = await score(host, game.id, 1, 'onePair');
    expect(scored.status).toBe(200);
    const view = scored.body.game;
    expect(view).toMatchObject({ revision: 2, turn: 'p2', status: 'active' });
    expect(view.yatzy.current).toBe('p2');
    expect(view.yatzy.turn).toEqual({ throws: 0, dice: null, kept: [] });
    expect(view.yatzy.players[0]).toMatchObject({ seat: 'p1', scores: { onePair: scoreRow('onePair', dice) }, tokens: 2 });
    expect(view.yatzy.players[0].total).toBe(scoreRow('onePair', dice));
    expect((await actions(game.id)).at(-1)).toMatchObject({ player_id: host.id, kind: 'score', move: 'row:onePair', revision: 2 });

    // Second and third throw bank one and nothing.
    let revision = 2;
    for (const [player, throws] of [[guests[0], 2], [guests[1], 3]] as const) {
      for (let t = 0; t < throws; t++) revision = (await throwDice(player, game.id, revision, t === 0 ? [] : [0])).body.game.revision;
      const done = await score(player, game.id, revision, 'chance');
      revision = done.body.game.revision;
      const seat = player === guests[0] ? 1 : 2;
      expect(done.body.game.yatzy.players[seat].tokens).toBe(tokensBanked(throws));
    }
    expect((await read(host, game.id)).body.game.turn).toBe('p1');
  });

  it('a retried score is answered once: no second row, tokens or turn', async () => {
    const { host, guests, game } = await table(1);
    await throwDice(host, game.id, 0);
    const requestId = randomUUID();
    const [first, ...rest] = await Promise.all([1, 2, 3, 4].map(() => score(host, game.id, 1, 'chance', requestId)));
    const all = [first, ...rest];
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(all.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    for (const r of all) {
      expect(r.body.game.revision).toBe(2);
      expect(r.body.game.yatzy.players[0]).toMatchObject({ tokens: 2 });
      expect(r.body.game.turn).toBe('p2');
    }
    // Much later, after the other player has moved on, the lost reply is retried again.
    await throwDice(guests[0], game.id, 2);
    const late = await score(host, game.id, 1, 'chance', requestId);
    expect(late.status).toBe(200);
    expect(late.body.duplicate).toBe(true);
    expect(late.body.game.revision).toBe(3);
    expect(late.body.game.yatzy.players[0].tokens).toBe(2);
    expect((await actions(game.id)).filter((a) => a.kind === 'score')).toHaveLength(1);
    // The same ID for another row is refused.
    expect((await score(host, game.id, 3, 'ones', requestId)).body.error.code).toBe('request_id_reused');
  });

  it('Forced takes only the next row on the card; Free any empty row once', async () => {
    const forced = await table(1, 'forced');
    await throwDice(forced.host, forced.game.id, 0);
    const outOfOrder = await score(forced.host, forced.game.id, 1, 'chance');
    expect(outOfOrder.status).toBe(422);
    expect(outOfOrder.body.error.code).toBe('row_order');
    expect((await score(forced.host, forced.game.id, 1, 'ones')).status).toBe(200);

    const free = await table(1, 'free');
    await throwDice(free.host, free.game.id, 0);
    await score(free.host, free.game.id, 1, 'yatzy');
    await throwDice(free.guests[0], free.game.id, 2);
    await score(free.guests[0], free.game.id, 3, 'yatzy');
    await throwDice(free.host, free.game.id, 4);
    const used = await score(free.host, free.game.id, 5, 'yatzy');
    expect(used.status).toBe(422);
    expect(used.body.error.code).toBe('row_used');
    expect((await stored(free.game.id)).revision).toBe(5);
  });
});

describe('turns, membership and revisions', () => {
  it('only the player to move may throw or score; people outside the table see and change nothing', async () => {
    const { guests, game } = await table(2);
    const outsider = await newPlayer('Outsider');
    await startGame(outsider, guests[0]); // knows a guest, but is not at this table
    for (const waiting of guests) {
      for (const action of [{ type: 'throw', keep: [] }, { type: 'score', row: 'chance' }]) {
        const refused = await act(waiting, game.id, 0, action);
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe('not_your_turn');
      }
    }
    for (const response of [
      await read(outsider, game.id),
      await act(outsider, game.id, 0, { type: 'throw', keep: [] }),
      await act(outsider, game.id, 0, { type: 'score', row: 'chance' }),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('game_not_found');
    }
    const list = await call('GET', `/games${ALL}`, { credential: outsider.credential });
    expect(list.body.games.map((g: { id: string }) => g.id)).not.toContain(game.id);
    expect((await call('GET', `/games/${game.id}/actions${ALL}`, {})).status).toBe(401);
    expect((await stored(game.id)).revision).toBe(0);
  });

  it('rejects a stale revision with the current table', async () => {
    const { host, game } = await table(1);
    await throwDice(host, game.id, 0);
    const stale = await throwDice(host, game.id, 0, []);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'stale_revision', game: { revision: 1, yatzy: { turn: { throws: 1 } } } });
    expect((await act(host, game.id, -1, { type: 'throw', keep: [] })).status).toBe(400);
    expect((await call('POST', `/games/${game.id}/actions${ALL}`, {
      credential: host.credential,
      body: { expectedRevision: 1, action: { type: 'throw', keep: [] } },
    })).status).toBe(400);
  });

  it('has no resignation, rematch or invitation link', async () => {
    const { host, guests, game } = await table(1);
    const resigned = await resignTable(host, game.id);
    expect(resigned.status).toBe(422);
    expect(resigned.body.error.code).toBe('unsupported_action');
    for (const path of ['rematch', 'invitation']) {
      const refused = await call('POST', `/games/${game.id}/${path}${ALL}`, { credential: guests[0].credential });
      expect(refused.status, path).toBe(422);
      expect(refused.body.error.code).toBe('unsupported_action');
    }
    expect(await stored(game.id)).toMatchObject({ status: 'active', revision: 0 });
    expect((await sql`select count(*)::int as n from games where rematch_of = ${game.id}`)[0].n).toBe(0);
  });

  it('a reload mid-turn shows every seated player the latest committed throw, kept positions and throw number', async () => {
    const { host, guests, game } = await table(2);
    await throwDice(host, game.id, 0);
    await score(host, game.id, 1, 'chance');
    await throwDice(guests[0], game.id, 2);
    const second = await throwDice(guests[0], game.id, 3, [1, 2]);
    const turn = second.body.game.yatzy.turn;
    for (const viewer of [host, guests[0], guests[1]]) {
      const reloaded = (await read(viewer, game.id)).body.game;
      expect(reloaded.yatzy.turn).toEqual(turn);
      expect(reloaded.yatzy.turn).toMatchObject({ throws: 2, kept: [1, 2] });
      expect(reloaded).toMatchObject({ turn: 'p2', revision: 4, yatzy: { current: 'p2' } });
      expect(reloaded.yatzy.players[0].tokens).toBe(2);
      const listed = (await call('GET', `/games${ALL}`, { credential: viewer.credential })).body.games.find((g: { id: string }) => g.id === game.id);
      expect(listed.yatzy.turn).toEqual(turn);
    }
  });
});

const resignTable = (p: TestPlayer, gameId: string) => act(p, gameId, 0, { type: 'resign' });

describe('a whole game through the API', () => {
  it.each([
    ['forced', 2],
    ['free', 3],
  ] as const)('%s with %i players: every throw and score matches the rules, and the finished ranking is saved', async (mode, count) => {
    const { players, game } = await table(count - 1, mode);
    let view = game;
    const rowOrder = mode === 'forced' ? [...ROWS] : [...ROWS].reverse();
    // Seat 0 always scores on the first throw (banking two each turn) and later spends tokens;
    // the others use one, two or three throws in rotation.
    for (const [round, row] of rowOrder.entries()) {
      for (const [seat, player] of players.entries()) {
        const before = view.yatzy.players[seat];
        let throws = seat === 0 ? 1 : ((round + seat) % 3) + 1;
        // From round 5 the host chases with every banked token on one turn (several paid throws).
        if (seat === 0 && round === 5) throws = 3 + before.tokens;
        let spent = 0;
        for (let t = 0; t < throws; t++) {
          const thrown = await throwDice(player, view.id, view.revision, t === 0 ? [] : [0, 1]);
          expect(thrown.status).toBe(200);
          if (t >= 3) spent++;
          expect(thrown.body.game.yatzy.players[seat].tokens).toBe(before.tokens - spent);
          view = thrown.body.game;
        }
        const dice = view.yatzy.turn.dice as Die[];
        const scored = await score(player, view.id, view.revision, row);
        expect(scored.status).toBe(200);
        view = scored.body.game;
        const after = view.yatzy.players[seat];
        expect(after.scores[row]).toBe(scoreRow(row, dice));
        expect(after.tokens).toBe(before.tokens - spent + tokensBanked(throws));
      }
    }
    if (count >= 2) expect(view.yatzy.players[0].tokens).toBeGreaterThan(0);

    // Finished: the view, the stored row and a replay of the saved record agree.
    expect(view).toMatchObject({ status: 'finished', result: 'scored', termination: 'scorecards-complete', turn: null });
    const row = await stored(view.id);
    expect(row).toMatchObject({ status: 'finished', result: 'scored', termination: 'scorecards-complete' });
    const state = replay({ schemaVersion: 1, ...row.payload });
    if ('error' in state) throw new Error(state.error.message);
    expect(state.finished).toBe(true);
    expect(view.yatzy.players.map((p: { total: number }) => p.total)).toEqual(
      state.players.map((p) => ROWS.reduce((a, r) => a + (p.scores[r] ?? 0), 0) + (ROWS.slice(0, 6).reduce((a, r) => a + (p.scores[r] ?? 0), 0) >= 63 ? 50 : 0)),
    );
    const standings = view.yatzy.standings as { seat: string; total: number; tokens: number; place: number }[];
    expect(standings).toHaveLength(count);
    for (let i = 1; i < standings.length; i++) {
      const [a, b] = [standings[i - 1], standings[i]];
      expect(a.total > b.total || (a.total === b.total && a.tokens >= b.tokens)).toBe(true);
    }
    expect(view.yatzy.winners).toEqual(standings.filter((s) => s.place === 1).map((s) => s.seat));
    expect((await actions(view.id)).length).toBe(row.revision);
    // Everyone seated reads the same finished table; nothing more can be played.
    for (const player of players) {
      const final = (await read(player, view.id)).body.game;
      expect(final.yatzy.standings).toEqual(standings);
      const more = await throwDice(player, view.id, view.revision);
      expect(more.status).toBe(409);
      expect(more.body.error.code).toBe('game_finished');
    }
  }, 120_000);
});

describe('finished rankings', () => {
  // The last turn decides: a Yatzy (50) or a miss, scored after one, two or three throws.
  const yatzyOn = (throws: number): Scripted[] => [
    ...Array.from({ length: throws - 1 }, (_, i): Scripted => (i === 0 ? { throw: [6, 6, 6, 6, 1] } : { throw: [6, 6, 6, 6, 1], keep: [0, 1, 2, 3] })),
    throws === 1 ? { throw: [6, 6, 6, 6, 6] } : { throw: [6, 6, 6, 6, 6], keep: [0, 1, 2, 3] },
    { score: 'yatzy' },
  ];
  const miss: Scripted[] = [{ throw: [1, 2, 3, 4, 6] }, { score: 'yatzy' }];
  const ending = (bySeat: Record<number, Scripted[]>) => (seat: number, row: Row) => (row === 'yatzy' ? bySeat[seat] : undefined);

  it('rank by points, then unused tokens, with joint winners when both tie; listed per table for everyone seated', async () => {
    const { host, guests } = await friends(3);
    const players = [host, ...guests];
    // p1 and p3: 330 points and 29 tokens (joint winners); p4: 330 and 28; p2: 280.
    const record = completeGame('free', 4, ending({ 0: yatzyOn(2), 1: miss, 2: yatzyOn(2), 3: yatzyOn(3) }));
    const tableId = await storedTable(players, record);
    for (const player of players) {
      const view = (await read(player, tableId)).body.game;
      expect(view).toMatchObject({ status: 'finished', result: 'scored', turn: null });
      expect(view.yatzy.standings).toEqual([
        { seat: 'p1', total: 330, tokens: 29, place: 1 },
        { seat: 'p3', total: 330, tokens: 29, place: 1 },
        { seat: 'p4', total: 330, tokens: 28, place: 3 },
        { seat: 'p2', total: 280, tokens: 30, place: 4 },
      ]);
      expect(view.yatzy.winners).toEqual(['p1', 'p3']);
      const history = await call('GET', `/history${ALL}`, { credential: player.credential });
      const listed = history.body.tables.find((t: { id: string }) => t.id === tableId);
      expect(listed).toMatchObject({
        gameType: 'yatzy',
        yourSeat: `p${players.indexOf(player) + 1}`,
        players: { p1: { id: host.id }, p4: { id: guests[2].id } },
        result: { yatzy: { winners: ['p1', 'p3'] } },
      });
      expect(listed.result.yatzy.standings).toHaveLength(4);
    }
    // A points tie broken by tokens alone has one winner.
    const { host: h2, guests: g2 } = await friends(1);
    const single = await storedTable([h2, ...g2], completeGame('forced', 2, ending({ 0: yatzyOn(2), 1: yatzyOn(1) })));
    const view = (await read(h2, single)).body.game;
    expect(view.yatzy.standings.map((s: { seat: string; place: number }) => [s.seat, s.place])).toEqual([['p2', 1], ['p1', 2]]);
    expect(view.yatzy.winners).toEqual(['p2']);
  });

  it('never add to a chess tally: chess history stays pairwise and unchanged', async () => {
    const { host, guests } = await friends(2);
    // The host has a finished chess game with guest 1 (and an ongoing one with each from setup).
    const chess = await startGame(host, guests[0]);
    await resign(guests[0], chess.game.id, chess.game.revision);
    const before = await call('GET', `/history${CHESS}`, { credential: host.credential });
    expect(before.body.history).toHaveLength(1);
    expect(before.body.history[0]).toMatchObject({ gameType: 'chess', wins: 1, losses: 0, draws: 0 });
    expect(before.body.tables).toBeUndefined();

    const tableId = await storedTable([host, ...guests], completeGame('free', 3));
    // Old and chess-only clients: byte-identical history, no tables.
    for (const query of ['', CHESS]) {
      const after = await call('GET', `/history${query}`, { credential: host.credential });
      expect(after.body).toEqual(query === CHESS ? before.body : (await call('GET', '/history', { credential: host.credential })).body);
      expect(after.body.tables).toBeUndefined();
      expect(JSON.stringify(after.body)).not.toContain(tableId);
    }
    expect((await call('GET', `/history${CHESS}`, { credential: host.credential })).body).toEqual(before.body);
    // A Yatzy client: the same pairwise chess entries, plus the table on its own list.
    const both = await call('GET', `/history${ALL}`, { credential: host.credential });
    expect(both.body.history).toEqual(before.body.history);
    expect(both.body.tables.map((t: { id: string }) => t.id)).toEqual([tableId]);
    // The guests met only at the table: no chess entry between them, in either direction.
    for (const [me, other] of [[guests[0], guests[1]], [guests[1], guests[0]]]) {
      const history = await call('GET', `/history${ALL}`, { credential: me.credential });
      expect(history.body.history.every((h: { gameType: string }) => h.gameType !== 'yatzy')).toBe(true);
      expect(history.body.history.some((h: { opponent: { id: string } }) => h.opponent.id === other.id)).toBe(false);
      expect(history.body.tables).toHaveLength(1);
    }
    // An unfinished table is on nobody's history.
    const { host: h2, game } = await table(1);
    expect((await call('GET', `/history${ALL}`, { credential: h2.credential })).body.tables.map((t: { id: string }) => t.id)).not.toContain(game.id);
  });
});

describe('previous opponents through a table', () => {
  it('every pair seated together may start chess and Fischer Random with each other, and seat each other at tables', async () => {
    const { host, guests } = await friends(3);
    const [a, b, c] = guests;
    const opponentsOf = async (p: TestPlayer) =>
      (await call('GET', '/opponents', { credential: p.credential })).body.opponents.map((o: { id: string }) => o.id);
    expect(await opponentsOf(a)).toEqual([host.id]);
    const before = await call('POST', `/games${CHESS}`, { credential: a.credential, body: { friendPlayerId: b.id } });
    expect(before.body.error.code).toBe('opponent_not_found');

    const created = await createTable(host, [a.id, b.id]); // c is not at this table
    expect(created.status).toBe(201);
    expect((await opponentsOf(a)).sort()).toEqual([host.id, b.id].sort());
    expect((await opponentsOf(b)).sort()).toEqual([host.id, a.id].sort());
    const listed = (await call('GET', '/opponents', { credential: a.credential })).body.opponents.find((o: { id: string }) => o.id === b.id);
    expect(listed).toEqual({ id: b.id, displayName: b.name, sharedGames: 1, lastSharedGameUpdatedAt: expect.any(String) });

    // Either guest starts chess or Fischer Random with the other, even with a chess-only client, and it is playable.
    const chess = await call('POST', `/games${CHESS}`, { credential: a.credential, body: { friendPlayerId: b.id, type: 'chess' } });
    expect(chess.status).toBe(201);
    expect(chess.body.game).toMatchObject({ type: 'chess', status: 'active', players: { white: { id: a.id }, black: { id: b.id } } });
    const moved = await call('POST', `/games/${chess.body.game.id}/actions${CHESS}`, {
      credential: a.credential,
      body: { requestId: randomUUID(), expectedRevision: chess.body.game.revision, action: { type: 'move', from: 'e2', to: 'e4' } },
    });
    expect(moved.status).toBe(200);
    const fischer = await call('POST', `/games${CHESS}`, { credential: b.credential, body: { friendPlayerId: a.id, type: 'chess960' } });
    expect(fischer.status).toBe(201);
    // …and a guest can host a table with the other guest, but not with c, who sat at neither.
    expect((await createTable(a, [b.id, host.id])).status).toBe(201);
    expect((await createTable(a, [c.id])).body.error.code).toBe('opponent_not_found');
    expect((await call('POST', `/games${CHESS}`, { credential: c.credential, body: { friendPlayerId: a.id } })).body.error.code).toBe('opponent_not_found');
  });
});

describe('next to chess', () => {
  it('chess-only and older clients never see a table, and cannot read or change one', async () => {
    const { host, guests, game } = await table(1);
    await throwDice(host, game.id, 0);
    const chessGames = (await call('GET', `/games${CHESS}`, { credential: host.credential })).body.games;
    for (const query of ['', '?types=chess', CHESS]) {
      const list = await call('GET', `/games${query}`, { credential: host.credential });
      expect(list.status).toBe(200);
      expect(list.body.games.map((g: { id: string }) => g.id)).not.toContain(game.id);
      expect(list.body.games.every((g: { type: string }) => g.type !== 'yatzy')).toBe(true);
      const refusals = [
        await read(guests[0], game.id, query),
        await act(host, game.id, 1, { type: 'throw', keep: [0] }, randomUUID(), query),
        await act(host, game.id, 1, { type: 'resign' }, randomUUID(), query),
        await call('POST', `/games/${game.id}/rematch${query}`, { credential: host.credential }),
        await call('POST', `/games/${game.id}/invitation${query}`, { credential: host.credential }),
      ];
      for (const refused of refusals) {
        expect(refused.status, query).toBe(422);
        expect(refused.body.error.code).toBe('unsupported_game');
      }
    }
    expect((await call('GET', `/games${CHESS}`, { credential: host.credential })).body.games).toEqual(chessGames);
    expect((await stored(game.id)).revision).toBe(1);
    // A chess game still reads the same for a client that also asks for Yatzy.
    const chess = chessGames[0];
    const both = (await read(host, chess.id)).body.game;
    expect(both).toEqual((await read(host, chess.id, CHESS)).body.game);
    expect(Object.keys(both.players)).toEqual(['white', 'black']);
  });

  it('chess creation, invitations, resignation and rematch work as before beside tables', async () => {
    const { host, guests } = await table(1);
    const guest = guests[0];
    const invited = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendEmail: guest.email, type: 'chess960' } });
    expect(invited.status).toBe(201);
    expect(invited.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const joined = await call('POST', `/invitations/redeem${ALL}`, { credential: guest.credential, body: { token: invited.body.invitation.token } });
    expect(joined.status).toBe(200);
    const over = await act(guest, joined.body.game.id, joined.body.game.revision, { type: 'resign' });
    expect(over.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'resignation' });
    const rematch = await call('POST', `/games/${joined.body.game.id}/rematch${ALL}`, { credential: guest.credential });
    expect(rematch.status).toBe(201);
    expect(rematch.body.game).toMatchObject({ type: 'chess960', players: { white: { id: guest.id }, black: { id: host.id } } });
  });
});

describe('seats that do not fit the game', () => {
  // Rows this API never writes: put there directly, as a bug or a manual change would.
  const insertGame = async (creator: TestPlayer, type: string, payload: unknown) =>
    (await sql`
      insert into games (game_type, schema_version, status, revision, payload, created_by)
      values (${type}, 1, 'active', 0, ${sql.json(payload as never)}, ${creator.id}) returning id`)[0].id as string;
  const seat = (gameId: string, p: TestPlayer, s: string) =>
    sql`insert into game_participants (game_id, player_id, seat) values (${gameId}, ${p.id}, ${s})`;
  const empty = (players: number) => ({ mode: 'free', players, log: [] });
  const chessPayload = { initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] };

  it('are refused for reads and actions and left out of lists, by type, count and order', async () => {
    const { host, guests } = await friends(2);
    const [a, b] = guests;
    const cases: [string, () => Promise<string>][] = [
      ['a chess seat at a table', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'white'); await seat(id, a, 'p2'); return id; }],
      ['chess seats at a table', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'white'); await seat(id, a, 'black'); return id; }],
      ['fewer seats than the record says', async () => { const id = await insertGame(host, 'yatzy', empty(3)); await seat(id, host, 'p1'); await seat(id, a, 'p2'); return id; }],
      ['more seats than the record says', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'p1'); await seat(id, a, 'p2'); await seat(id, b, 'p3'); return id; }],
      ['a gap in the order', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'p1'); await seat(id, a, 'p3'); return id; }],
      ['no first seat', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'p2'); await seat(id, a, 'p3'); return id; }],
      ['a single player', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, host, 'p1'); return id; }],
      ['a one-player record with one seat', async () => { const id = await insertGame(host, 'yatzy', empty(1)); await seat(id, host, 'p1'); return id; }],
      ['a five-player record', async () => { const id = await insertGame(host, 'yatzy', empty(5)); await seat(id, host, 'p1'); await seat(id, a, 'p2'); return id; }],
      ['a record with an unknown mode', async () => { const id = await insertGame(host, 'yatzy', { mode: 'fast', players: 2, log: [] }); await seat(id, host, 'p1'); await seat(id, a, 'p2'); return id; }],
      ['a record with a broken log', async () => { const id = await insertGame(host, 'yatzy', { mode: 'free', players: 2, log: [null] }); await seat(id, host, 'p1'); await seat(id, a, 'p2'); return id; }],
      ['a record that is not an object', async () => { const id = await insertGame(host, 'yatzy', 'yatzy'); await seat(id, host, 'p1'); await seat(id, a, 'p2'); return id; }],
      ['the host not in the first seat', async () => { const id = await insertGame(host, 'yatzy', empty(2)); await seat(id, a, 'p1'); await seat(id, host, 'p2'); return id; }],
      ['a table seat at a chess game', async () => { const id = await insertGame(host, 'chess', chessPayload); await seat(id, host, 'white'); await seat(id, a, 'p2'); return id; }],
      ['three players at a chess game', async () => { const id = await insertGame(host, 'chess', chessPayload); await seat(id, host, 'white'); await seat(id, a, 'black'); await seat(id, b, 'p3'); return id; }],
    ];
    for (const [label, make] of cases) {
      const id = await make();
      const opened = await read(host, id);
      expect(opened.status, label).toBe(409);
      expect(opened.body.error.code, label).toBe('invalid_seats');
      for (const action of [{ type: 'throw', keep: [] }, { type: 'move', from: 'e2', to: 'e4' }, { type: 'resign' }]) {
        const refused = await act(host, id, 0, action);
        expect(refused.status, label).toBe(409);
        expect(refused.body.error.code, label).toBe('invalid_seats');
      }
      const list = await call('GET', `/games${ALL}`, { credential: host.credential });
      expect(list.status).toBe(200);
      expect(list.body.games.map((g: { id: string }) => g.id), label).not.toContain(id);
      const row = await stored(id);
      expect(row).toMatchObject({ status: 'active', revision: 0 });
      expect(await actions(id)).toHaveLength(0);
    }
    // The valid games around them are still listed and playable.
    const good = await createTable(host, [a.id, b.id]);
    expect((await throwDice(host, good.body.game.id, 0)).status).toBe(200);
  });

  it('one bad table never breaks the games list, and a guest in the first seat cannot throw (review of 4fb7c9f)', async () => {
    const { host, guests } = await friends(1);
    const guest = guests[0];
    const chessBefore = (await call('GET', `/games${ALL}`, { credential: host.credential })).body.games;
    expect(chessBefore).toHaveLength(1);
    // A one-seat table whose record says one player: its seats match its record, but no rules read it.
    const lonely = await insertGame(host, 'yatzy', empty(1));
    await seat(lonely, host, 'p1');
    // The host created this table but sits second: the guest would be first to throw.
    const swapped = await insertGame(host, 'yatzy', empty(2));
    await seat(swapped, guest, 'p1');
    await seat(swapped, host, 'p2');

    for (const player of [host, guest]) {
      const list = await call('GET', `/games${ALL}`, { credential: player.credential });
      expect(list.status).toBe(200);
      expect(list.body.games.map((g: { id: string }) => g.id)).toEqual([chessBefore[0].id]);
      const history = await call('GET', `/history${ALL}`, { credential: player.credential });
      expect(history.status).toBe(200);
    }
    for (const [player, action] of [[guest, { type: 'throw', keep: [] }], [host, { type: 'throw', keep: [] }], [guest, { type: 'score', row: 'chance' }]] as const) {
      const refused = await act(player, swapped, 0, action);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('invalid_seats');
    }
    expect((await read(host, lonely)).body.error.code).toBe('invalid_seats');
    for (const id of [lonely, swapped]) {
      expect(await stored(id)).toMatchObject({ revision: 0, status: 'active' });
      expect(await actions(id)).toHaveLength(0);
    }
  });

  it('a chess game with a malformed roster adds to no tally and gets no rematch or invitation (review of 4fb7c9f)', async () => {
    const { host, guests } = await friends(2);
    const [a, b] = guests;
    const tally = async (p: TestPlayer) => (await call('GET', `/history${ALL}`, { credential: p.credential })).body.history;
    const before = { host: await tally(host), a: await tally(a), b: await tally(b) };
    const finishedChess = async () =>
      (await sql`
        insert into games (game_type, schema_version, status, result, termination, revision, payload, created_by)
        values ('chess', 1, 'finished', 'white', 'resignation', 1, ${sql.json(chessPayload as never)}, ${host.id}) returning id`)[0].id as string;
    // White and Black plus a third player; and White with a table seat for Black.
    const three = await finishedChess();
    await seat(three, host, 'white');
    await seat(three, a, 'black');
    await seat(three, b, 'p3');
    const mixed = await finishedChess();
    await seat(mixed, host, 'white');
    await seat(mixed, a, 'p2');

    expect({ host: await tally(host), a: await tally(a), b: await tally(b) }).toEqual(before);
    expect((await call('GET', `/history${CHESS}`, { credential: host.credential })).body.history).toEqual(before.host);
    for (const id of [three, mixed]) {
      for (const player of [host, a]) {
        for (const path of ['rematch', 'invitation']) {
          const refused = await call('POST', `/games/${id}/${path}${ALL}`, { credential: player.credential });
          expect(refused.status, path).toBe(409);
          expect(refused.body.error.code, path).toBe('invalid_seats');
        }
      }
      expect((await sql`select count(*)::int as n from games where rematch_of = ${id}`)[0].n).toBe(0);
    }
    // A well-formed finished game between the same two still counts and rematches.
    const good = await finishedChess();
    await seat(good, host, 'white');
    await seat(good, a, 'black');
    const after = await tally(host);
    expect(after.find((h: { opponent: { id: string } }) => h.opponent.id === a.id)).toMatchObject({ wins: 1, losses: 0, games: [{ id: good }] });
    expect((await call('POST', `/games/${good}/rematch${ALL}`, { credential: a.credential })).status).toBe(201);
  });

  it('a finished table stays in the history however many newer unfinished tables there are (review of 4fb7c9f)', async () => {
    const { host, guests } = await friends(1);
    const finished = await storedTable([host, guests[0]], completeGame('free', 2));
    // 205 newer unfinished tables at the same two seats: more than one page of the games list.
    await sql`
      with made as (
        insert into games (game_type, schema_version, status, revision, payload, created_by, updated_at)
        select 'yatzy', 1, 'active', 0, ${sql.json(empty(2) as never)}, ${host.id}, now() + (n || ' seconds')::interval
          from generate_series(1, 205) n
        returning id
      )
      insert into game_participants (game_id, player_id, seat)
      select id, ${host.id}::uuid, 'p1' from made union all select id, ${guests[0].id}::uuid, 'p2' from made`;
    for (const player of [host, guests[0]]) {
      const list = await call('GET', `/games${ALL}`, { credential: player.credential });
      expect(list.body.games).toHaveLength(200);
      expect(list.body.games.map((g: { id: string }) => g.id)).not.toContain(finished);
      const history = await call('GET', `/history${ALL}`, { credential: player.credential });
      expect(history.body.tables.map((t: { id: string }) => t.id)).toEqual([finished]);
    }
  });

  it('a record whose player count is not 2–4 is never created by the API', async () => {
    const { host, guests } = await friends(1);
    const record = play(newRecord('free', 2), []);
    expect(record.players).toBe(2);
    const created = await createTable(host, [guests[0].id]);
    expect((await stored(created.body.game.id)).payload).toEqual({ mode: 'free', players: 2, log: [] });
  });
});
