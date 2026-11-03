// Game-type boundary (#53), against the real local backend. A chess row in an unknown schema
// version stands in for "a game this server cannot read"; Chess960 games as seen by a client
// that reads only chess are in chess960.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, move, newPlayer, playMoves, randomUUID, resign, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

/** A finished or ongoing game stored in schema version 99, which no adapter reads. */
async function unreadableGame(white: TestPlayer, black: TestPlayer, status: 'active' | 'finished' = 'active') {
  const [game] = await sql`
    insert into games (game_type, schema_version, status, result, termination, revision, payload, created_by)
    values ('chess', 99, ${status}, ${status === 'finished' ? 'white' : null}, ${status === 'finished' ? 'resignation' : null},
            3, ${sql.json({ future: 'format' })}, ${white.id})
    returning id`;
  await sql`
    insert into game_participants (game_id, player_id, seat)
    values (${game.id}, ${white.id}, 'white'), (${game.id}, ${black.id}, 'black')`;
  return game.id as string;
}

async function rowOf(gameId: string) {
  const [row] = await sql`select status, revision, payload, schema_version from games where id = ${gameId}`;
  const [actions] = await sql`select count(*)::int as n from game_actions where game_id = ${gameId}`;
  return { ...row, actions: actions.n };
}

describe('the types a client asks for', () => {
  it('means chess when omitted (every client before #53), with the old fields intact and new ones added', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const { game } = await startGame(arne, harald);
    await playMoves(arne, harald, game.id, ['e2e4', 'e7e5', 'g1f3']);

    for (const query of ['', '?types=chess', '?types=chess,chess960,checkers']) {
      const list = await call('GET', `/games${query}`, { credential: arne.credential });
      expect(list.status).toBe(200);
      const view = list.body.games.find((g: { id: string }) => g.id === game.id);
      expect(view).toMatchObject({
        type: 'chess',
        schemaVersion: 1,
        turn: 'black',
        moveCount: 3,
        chess: { moves: ['e2e4', 'e7e5', 'g1f3'], turn: 'black' },
      });
    }
  });

  it('creates standard chess by default or by name; unknown types are refused', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const create = (body: Record<string, unknown>, query = '') =>
      call('POST', `/games${query}`, { credential: arne.credential, body: { friendEmail: harald.email, ...body } });

    expect((await create({})).body.game.type).toBe('chess');
    expect((await create({ type: 'chess' })).body.game.type).toBe('chess');
    // Chess960 needs a client that reads it (tests/backend/chess960.test.ts).
    for (const [type, query] of [['chess960', ''], ['chess960', '?types=chess'], ['checkers', '?types=chess,checkers'], [7, '']]) {
      const refused = await create({ type }, query as string);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('unsupported_game_type');
    }
    // A client that does not read chess cannot create it either.
    expect((await create({ type: 'chess' }, '?types=chess960')).body.error.code).toBe('unsupported_game_type');
    const [count] = await sql`select count(*)::int as n from games where created_by = ${arne.id}`;
    expect(count.n).toBe(2);
  });

  it('groups history by game type and opponent', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const { game } = await startGame(arne, harald);
    await resign(harald, game.id, game.revision);
    const history = await call('GET', '/history', { credential: arne.credential });
    expect(history.body.history).toEqual([
      expect.objectContaining({ gameType: 'chess', opponent: { id: harald.id, displayName: 'Harald' }, wins: 1 }),
    ]);
    expect(history.body.history[0].games[0]).toMatchObject({ id: game.id, moveCount: 0, outcome: 'win' });
  });
});

describe('a game this server or client cannot read', () => {
  it('is left out of lists and history, and every read or write is refused without touching it', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const { game: readableGame } = await startGame(arne, harald);
    const finished = await unreadableGame(arne, harald, 'finished');
    const active = await unreadableGame(arne, harald);
    const before = await rowOf(active);

    // The mixed lobby still loads, with the readable game only.
    const list = await call('GET', '/games', { credential: arne.credential });
    expect(list.status).toBe(200);
    expect(list.body.games.map((g: { id: string }) => g.id)).toEqual([readableGame.id]);
    const history = await call('GET', '/history', { credential: arne.credential });
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).not.toContain(finished);

    const refusals = [
      await call('GET', `/games/${active}`, { credential: arne.credential }),
      await move(arne, active, 3, 'e2e4'),
      await resign(arne, active, 3),
      await call('POST', `/games/${finished}/rematch`, { credential: arne.credential }),
      await call('POST', `/games/${active}/invitation`, { credential: arne.credential }),
    ];
    for (const refusal of refusals) {
      expect(refusal.status).toBe(422);
      expect(refusal.body.error.code).toBe('unsupported_game');
      expect(JSON.stringify(refusal.body)).not.toContain('future');
    }
    expect(await rowOf(active)).toEqual(before);
    const [rematches] = await sql`select count(*)::int as n from games where rematch_of = ${finished}`;
    expect(rematches.n).toBe(0);

    // Not a participant: the same "not found" as ever, revealing nothing about the type.
    const outsider = await newPlayer('Mallory');
    expect((await call('GET', `/games/${active}`, { credential: outsider.credential })).body.error.code).toBe('game_not_found');
  });

  it('refuses a creation retry that finds an unreadable game, without renewing its invitation', async () => {
    const arne = await newPlayer('Arne');
    const requestId = randomUUID();
    const [game] = await sql`
      insert into games (game_type, schema_version, status, revision, payload, created_by, create_request_id)
      values ('chess', 99, 'waiting', 0, ${sql.json({ future: 'format' })}, ${arne.id}, ${requestId})
      returning id`;
    await sql`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${arne.id}, 'white')`;
    await sql`
      insert into game_invitations (game_id, token_hash, seat, invited_email)
      values (${game.id}, decode(md5(${randomUUID()}) || md5(${randomUUID()}), 'hex'), 'black', 'friend@example.test')`;
    const invitation = () => sql`select encode(token_hash, 'hex') as hash, created_at from game_invitations where game_id = ${game.id}`;
    const before = await invitation();

    const retry = await call('POST', '/games', {
      credential: arne.credential,
      body: { friendEmail: 'friend@example.test', requestId },
    });
    expect(retry.status).toBe(422);
    expect(retry.body.error.code).toBe('unsupported_game');
    expect(retry.body).not.toHaveProperty('invitation');
    expect(await invitation()).toEqual(before);
    expect(await rowOf(game.id)).toMatchObject({ schema_version: 99, revision: 0, actions: 0 });
  });

  it('refuses a game whose type the client did not ask for, before any write', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    const gameId = created.body.game.id;
    const token = created.body.invitation.token;
    // A client that only reads some other type (as a future client without chess would).
    const other = '?types=chess960';

    expect((await call('GET', `/games${other}`, { credential: arne.credential })).body.games).toEqual([]);
    const join = await call('POST', `/invitations/redeem${other}`, { credential: harald.credential, body: { token } });
    expect(join.body.error.code).toBe('unsupported_game');
    const [seats] = await sql`select count(*)::int as n from game_participants where game_id = ${gameId}`;
    expect(seats.n).toBe(1); // Harald was not seated
    const opening = await call('POST', `/games/${gameId}/actions${other}`, {
      credential: arne.credential,
      body: { requestId: randomUUID(), expectedRevision: 0, action: { type: 'move', from: 'e2', to: 'e4' } },
    });
    expect(opening.body.error.code).toBe('unsupported_game');
    expect(await rowOf(gameId)).toMatchObject({ revision: 0, actions: 0 });

    // The same requests as a chess client work as before.
    expect((await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token } })).status).toBe(200);
  });

  it('checks the action against the game’s type', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const { game } = await startGame(arne, harald);
    const castle = await call('POST', `/games/${game.id}/actions`, {
      credential: arne.credential,
      body: { requestId: randomUUID(), expectedRevision: game.revision, action: { type: 'castle', side: 'kingside' } },
    });
    expect(castle.status).toBe(400);
    expect(castle.body.error.code).toBe('bad_request');
  });
});
