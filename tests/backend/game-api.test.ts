// Integration tests for the shared-game API against a real local Supabase stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  db,
  move,
  newPlayer,
  playMoves,
  randomUUID,
  resign,
  startGame,
  type TestPlayer,
} from './client';

const sql = db();
afterAll(() => sql.end());

let arne: TestPlayer;
let harald: TestPlayer;
let outsider: TestPlayer;

beforeAll(async () => {
  [arne, harald, outsider] = await Promise.all([newPlayer('Arne'), newPlayer('Harald'), newPlayer('Mallory')]);
});

describe('device identity', () => {
  it('creates a player and returns the credential once, storing only its hash', async () => {
    const me = await call('GET', '/me', { credential: arne.credential });
    expect(me.status).toBe(200);
    expect(me.body.player).toEqual({ id: arne.id, displayName: 'Arne', email: arne.email });

    const [row] = await sql`select encode(credential_hash, 'hex') as hash from players where id = ${arne.id}`;
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(await sql`select * from players`);
    expect(dump).not.toContain(arne.credential);
  });

  it('rejects missing, malformed and unknown credentials', async () => {
    expect((await call('GET', '/games')).status).toBe(401);
    expect((await call('GET', '/games', { credential: 'nope' })).status).toBe(401);
    const unknown = 'A'.repeat(43);
    expect((await call('GET', '/games', { credential: unknown })).status).toBe(401);
  });

  it('validates onboarding input', async () => {
    expect((await call('POST', '/players', { body: { displayName: '', email: 'x@example.test' } })).status).toBe(400);
    expect((await call('POST', '/players', { body: { displayName: 'X', email: 'not-an-email' } })).status).toBe(400);
  });
});

describe('two players', () => {
  it('create, join and exchange moves; both see the same complete game', async () => {
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    expect(created.status).toBe(201);
    expect(created.body.game).toMatchObject({ status: 'waiting', revision: 0, yourSeat: 'white' });
    expect(created.body.game.players).toEqual({ white: { id: arne.id, displayName: 'Arne' }, black: null });
    expect(created.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const gameId = created.body.game.id;

    const early = await move(arne, gameId, 0, 'e2e4');
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_started');

    const joined = await call('POST', '/invitations/redeem', {
      credential: harald.credential,
      body: { token: created.body.invitation.token },
    });
    expect(joined.status).toBe(200);
    expect(joined.body.game).toMatchObject({ id: gameId, status: 'active', revision: 1, yourSeat: 'black' });

    const game = await playMoves(arne, harald, gameId, ['e2e4', 'c7c5', 'g1f3']);
    expect(game.revision).toBe(4);

    const [fromArne, fromHarald] = await Promise.all([
      call('GET', `/games/${gameId}`, { credential: arne.credential }),
      call('GET', `/games/${gameId}`, { credential: harald.credential }),
    ]);
    expect(fromArne.body.game.chess).toEqual({
      initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: ['e2e4', 'c7c5', 'g1f3'],
      turn: 'black',
    });
    expect(fromHarald.body.game.chess).toEqual(fromArne.body.game.chess);
    expect(fromHarald.body.game.players).toEqual({
      white: { id: arne.id, displayName: 'Arne' },
      black: { id: harald.id, displayName: 'Harald' },
    });

    const lists = await Promise.all([arne, harald].map((p) => call('GET', '/games', { credential: p.credential })));
    for (const list of lists) expect(list.body.games.map((g: { id: string }) => g.id)).toContain(gameId);
  });

  it('never returns email addresses or secrets in game data', async () => {
    const { game } = await startGame(arne, harald);
    const views = await Promise.all([
      call('GET', `/games/${game.id}`, { credential: arne.credential }),
      call('GET', `/games/${game.id}`, { credential: harald.credential }),
      call('GET', '/games', { credential: harald.credential }),
    ]);
    for (const view of views) {
      const text = JSON.stringify(view.body);
      expect(text).not.toContain(arne.email);
      expect(text).not.toContain(harald.email);
      expect(text).not.toContain(arne.credential);
      expect(text).not.toContain(harald.credential);
    }
  });
});

describe('outsiders', () => {
  it('cannot read, list or act on a game they are not in', async () => {
    const { game } = await startGame(arne, harald);

    const read = await call('GET', `/games/${game.id}`, { credential: outsider.credential });
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('game_not_found');

    const list = await call('GET', '/games', { credential: outsider.credential });
    expect(list.body.games.map((g: { id: string }) => g.id)).not.toContain(game.id);

    expect((await move(outsider, game.id, game.revision, 'e2e4')).status).toBe(404);
    expect((await resign(outsider, game.id, game.revision)).status).toBe(404);

    const after = await call('GET', `/games/${game.id}`, { credential: arne.credential });
    expect(after.body.game).toMatchObject({ revision: game.revision, status: 'active' });
    expect(after.body.game.chess.moves).toEqual([]);
  });

  it('get the same answer for a missing game as for someone else’s', async () => {
    const missing = await call('GET', `/games/${randomUUID()}`, { credential: outsider.credential });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('game_not_found');
  });
});

describe('invitations', () => {
  it('cannot be reused to take over a joined seat', async () => {
    const { game, token } = await startGame(arne, harald);
    const takeover = await call('POST', '/invitations/redeem', { credential: outsider.credential, body: { token } });
    expect(takeover.status).toBe(409);
    expect(takeover.body.error.code).toBe('invitation_used');

    const again = await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token } });
    expect(again.status).toBe(200);
    expect(again.body.game).toMatchObject({ id: game.id, yourSeat: 'black', revision: game.revision });

    expect((await call('GET', `/games/${game.id}`, { credential: outsider.credential })).status).toBe(404);
  });

  it('cannot be redeemed by the creator or with an unknown token', async () => {
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    const own = await call('POST', '/invitations/redeem', {
      credential: arne.credential,
      body: { token: created.body.invitation.token },
    });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('already_participant');

    const unknown = await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: 'B'.repeat(43) } });
    expect(unknown.status).toBe(404);
  });

  it('give the seat to exactly one of two racing players', async () => {
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    const token = created.body.invitation.token;
    const racers = await Promise.all([newPlayer('Racer1'), newPlayer('Racer2'), newPlayer('Racer3')]);
    const results = await Promise.all(
      racers.map((p) => call('POST', '/invitations/redeem', { credential: p.credential, body: { token } })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);

    const seats = await sql`select seat from game_participants where game_id = ${created.body.game.id} order by seat`;
    expect(seats.map((s) => s.seat)).toEqual(['black', 'white']);
  });

  it('are stored hashed, never as the shared token', async () => {
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    const dump = JSON.stringify(await sql`select * from game_invitations`);
    expect(dump).not.toContain(created.body.invitation.token);
  });
});

describe('move validation', () => {
  it('rejects illegal, out-of-turn and malformed moves without changing the game', async () => {
    const { game } = await startGame(arne, harald);

    const illegal = await move(arne, game.id, game.revision, 'e2e5');
    expect(illegal.status).toBe(422);
    expect(illegal.body.error.code).toBe('illegal_move');

    const outOfTurn = await move(harald, game.id, game.revision, 'e7e5');
    expect(outOfTurn.status).toBe(409);
    expect(outOfTurn.body.error.code).toBe('not_your_turn');

    const opponentsPiece = await move(arne, game.id, game.revision, 'e7e5');
    expect(opponentsPiece.status).toBe(422);

    const malformed = await call('POST', `/games/${game.id}/actions`, {
      credential: arne.credential,
      body: { requestId: randomUUID(), expectedRevision: game.revision, action: { type: 'move', from: 'e9', to: 'e4' } },
    });
    expect(malformed.status).toBe(400);

    const unchanged = await call('GET', `/games/${game.id}`, { credential: arne.credential });
    expect(unchanged.body.game).toMatchObject({ revision: game.revision });
    expect(unchanged.body.game.chess.moves).toEqual([]);
  });

  it('requires a promotion piece exactly when a pawn promotes', async () => {
    const { game } = await startGame(arne, harald);
    // White pawn marches up the a-file and captures on b7, then promotes on a8 or b8.
    const before = await playMoves(arne, harald, game.id, ['a2a4', 'h7h6', 'a4a5', 'h6h5', 'a5a6', 'h5h4', 'a6b7', 'h4h3']);
    expect((await move(arne, game.id, before.revision, 'b7a8')).status).toBe(422);
    expect((await move(arne, game.id, before.revision, 'e2e4q')).status).toBe(422);
    const promoted = await move(arne, game.id, before.revision, 'b7a8n');
    expect(promoted.status).toBe(200);
    expect(promoted.body.game.chess.moves.at(-1)).toBe('b7a8n');
  });
});

describe('finished games', () => {
  it('records checkmate from the moves and accepts nothing afterwards', async () => {
    const { game } = await startGame(arne, harald);
    const mated = await playMoves(arne, harald, game.id, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(mated).toMatchObject({ status: 'finished', result: 'black', termination: 'checkmate' });

    const late = await move(arne, game.id, mated.revision, 'a2a3');
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('game_finished');
    expect((await resign(arne, game.id, mated.revision)).body.error.code).toBe('game_finished');
  });

  it('records a threefold-repetition draw derived by replay', async () => {
    const { game } = await startGame(arne, harald);
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const drawn = await playMoves(arne, harald, game.id, [...shuffle, ...shuffle]);
    expect(drawn).toMatchObject({ status: 'finished', result: 'draw', termination: 'threefold-repetition' });
  });

  it('records resignation as a win for the other player', async () => {
    const { game } = await startGame(arne, harald);
    const afterMove = await playMoves(arne, harald, game.id, ['d2d4']);
    const resigned = await resign(arne, game.id, afterMove.revision);
    expect(resigned.status).toBe(200);
    expect(resigned.body.game).toMatchObject({ status: 'finished', result: 'black', termination: 'resignation' });
    expect(resigned.body.game.chess.moves).toEqual(['d2d4']);
  });

  it('keeps the complete history and result when read back later', async () => {
    const { game } = await startGame(arne, harald);
    const moves = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
    await playMoves(arne, harald, game.id, moves);

    for (const player of [arne, harald]) {
      const reread = await call('GET', `/games/${game.id}`, { credential: player.credential });
      expect(reread.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'checkmate', revision: 8 });
      expect(reread.body.game.chess.moves).toEqual(moves);
    }
    const actions = await sql`select kind, move, revision from game_actions where game_id = ${game.id} order by revision`;
    expect(actions.map((a) => a.move)).toEqual(moves);
    expect(actions.map((a) => a.revision)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('concurrency and retries', () => {
  it('accepts exactly one of two actions sent at the same revision', async () => {
    const { game } = await startGame(arne, harald);
    const results = await Promise.all([
      move(arne, game.id, game.revision, 'e2e4'),
      move(arne, game.id, game.revision, 'd2d4'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stale = results.find((r) => r.status === 409)!;
    expect(stale.body.error.code).toBe('stale_revision');
    expect(stale.body.error.game.revision).toBe(game.revision + 1);

    const final = await call('GET', `/games/${game.id}`, { credential: arne.credential });
    expect(final.body.game.chess.moves).toHaveLength(1);
  });

  it('accepts exactly one of a move and a resignation racing from both players', async () => {
    const { game } = await startGame(arne, harald);
    const results = await Promise.all([move(arne, game.id, game.revision, 'e2e4'), resign(harald, game.id, game.revision)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [count] = await sql`select count(*)::int as n from game_actions where game_id = ${game.id}`;
    expect(count.n).toBe(1);
  });

  it('treats a retried request ID as the same action, not a new one', async () => {
    const { game } = await startGame(arne, harald);
    const requestId = randomUUID();
    const first = await move(arne, game.id, game.revision, 'e2e4', requestId);
    const retry = await move(arne, game.id, game.revision, 'e2e4', requestId);
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.game).toEqual(first.body.game);

    const reused = await move(arne, game.id, first.body.game.revision, 'd2d4', requestId);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('request_id_reused');
  });

  it('applies concurrent copies of one request once', async () => {
    const { game } = await startGame(arne, harald);
    const requestId = randomUUID();
    const copies = await Promise.all(
      [1, 2, 3].map(() => move(arne, game.id, game.revision, 'e2e4', requestId)),
    );
    expect(copies.every((c) => c.status === 200)).toBe(true);
    expect(copies.filter((c) => c.body.duplicate === false)).toHaveLength(1);
    const [count] = await sql`select count(*)::int as n from game_actions where game_id = ${game.id}`;
    expect(count.n).toBe(1);
    const final = await call('GET', `/games/${game.id}`, { credential: arne.credential });
    expect(final.body.game).toMatchObject({ revision: game.revision + 1 });
    expect(final.body.game.chess.moves).toEqual(['e2e4']);
  });
});

describe('direct database access by API roles', () => {
  const tables = ['players', 'player_contacts', 'games', 'game_participants', 'game_invitations', 'game_actions'];

  for (const role of ['anon', 'authenticated']) {
    it(`is denied for ${role} on every table`, async () => {
      for (const table of tables) {
        await expect(
          sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(`select * from public.${table} limit 1`);
          }),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(`update public.games set status = 'finished'`);
        }),
      ).rejects.toThrow(/permission denied/);
    });
  }
});

describe('recovering a game whose creation response was lost', () => {
  const create = (requestId: string, friendEmail = harald.email) =>
    call('POST', '/games', { credential: arne.credential, body: { friendEmail, requestId } });

  it('finds the same game on a retry with the same request ID, with a fresh working link', async () => {
    const requestId = randomUUID();
    const first = await create(requestId);
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);

    const retry = await create(requestId);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.game.id).toBe(first.body.game.id);
    expect(retry.body.invitation.token).not.toBe(first.body.invitation.token);

    const [count] = await sql`select count(*)::int as n from games where create_request_id = ${requestId}`;
    expect(count.n).toBe(1);

    // Only the newest link works.
    const stale = await call('POST', '/invitations/redeem', {
      credential: harald.credential,
      body: { token: first.body.invitation.token },
    });
    expect(stale.status).toBe(404);
    const joined = await call('POST', '/invitations/redeem', {
      credential: harald.credential,
      body: { token: retry.body.invitation.token },
    });
    expect(joined.status).toBe(200);
    expect(joined.body.game.id).toBe(first.body.game.id);

    // After the friend has joined, a late retry still finds the game but issues no link.
    const late = await create(requestId);
    expect(late.status).toBe(200);
    expect(late.body.game).toMatchObject({ id: first.body.game.id, status: 'active' });
    expect(late.body.invitation).toBeNull();
  });

  it('creates one game for concurrent copies of a request', async () => {
    const requestId = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => create(requestId)));
    expect(new Set(results.map((r) => r.body.game.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const [count] = await sql`select count(*)::int as n from games where create_request_id = ${requestId}`;
    expect(count.n).toBe(1);
  });

  it('keeps request IDs per creator', async () => {
    const requestId = randomUUID();
    const mine = await create(requestId);
    const theirs = await call('POST', '/games', {
      credential: outsider.credential,
      body: { friendEmail: harald.email, requestId },
    });
    expect(theirs.status).toBe(201);
    expect(theirs.body.game.id).not.toBe(mine.body.game.id);
  });

  it('lets only the creator replace the link of a game nobody has joined', async () => {
    const created = await create(randomUUID());
    const gameId = created.body.game.id;

    const outsiderTry = await call('POST', `/games/${gameId}/invitation`, { credential: outsider.credential });
    expect(outsiderTry.status).toBe(404);

    const renewed = await call('POST', `/games/${gameId}/invitation`, { credential: arne.credential });
    expect(renewed.status).toBe(200);
    expect(renewed.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(renewed.body.invitation.token).not.toBe(created.body.invitation.token);
    expect(
      (await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: created.body.invitation.token } }))
        .status,
    ).toBe(404);
    expect(
      (await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: renewed.body.invitation.token } }))
        .status,
    ).toBe(200);

    const afterJoin = await call('POST', `/games/${gameId}/invitation`, { credential: arne.credential });
    expect(afterJoin.status).toBe(409);
    expect(afterJoin.body.error.code).toBe('invitation_used');
    const byBlack = await call('POST', `/games/${gameId}/invitation`, { credential: harald.credential });
    expect(byBlack.status).toBe(403);
  });

  it('serialises a link replacement racing a join: the joiner either gets in or the old link is dead', async () => {
    for (let i = 0; i < 5; i++) {
      const created = await create(randomUUID());
      const joiner = await newPlayer(`Joiner${i}`);
      const [renewed, joined] = await Promise.all([
        call('POST', `/games/${created.body.game.id}/invitation`, { credential: arne.credential }),
        call('POST', '/invitations/redeem', { credential: joiner.credential, body: { token: created.body.invitation.token } }),
      ]);
      if (joined.status === 200) expect(renewed.status).toBe(409);
      else expect([joined.status, renewed.status]).toEqual([404, 200]);
    }
  });
});
