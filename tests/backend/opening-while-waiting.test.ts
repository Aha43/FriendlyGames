// The creator may move while waiting for the friend, on their own colour's turn (#33).
// Against the real local backend.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, move, newPlayer, randomUUID, resign, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const STANDARD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Arne creates a game inviting Harald; nobody has joined. */
async function waitingGame() {
  const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
  const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
  expect(created.status).toBe(201);
  return { arne, harald, gameId: created.body.game.id as string, token: created.body.invitation.token as string };
}

const join = (player: TestPlayer, token: string) =>
  call('POST', '/invitations/redeem', { credential: player.credential, body: { token } });

async function stored(gameId: string) {
  const [game] = await sql`select status, revision, payload from games where id = ${gameId}`;
  const actions = await sql`select kind, move, revision from game_actions where game_id = ${gameId} order by revision`;
  const seats = await sql`select seat from game_participants where game_id = ${gameId} order by seat`;
  const [invitation] = await sql`select redeemed_by from game_invitations where game_id = ${gameId}`;
  return { ...game, actions, seats: seats.map((s) => s.seat), redeemed: invitation.redeemed_by !== null };
}

describe('opening while waiting for the friend', () => {
  it('saves the creator’s opening, keeps the game waiting and the invitation usable', async () => {
    const { arne, harald, gameId, token } = await waitingGame();

    const opened = await move(arne, gameId, 0, 'e2e4');
    expect(opened.status).toBe(200);
    expect(opened.body.game).toMatchObject({
      status: 'waiting',
      revision: 1,
      yourSeat: 'white',
      players: { white: { id: arne.id }, black: null },
      chess: { initialFen: STANDARD, moves: ['e2e4'], turn: 'black' },
    });
    expect(await stored(gameId)).toMatchObject({
      status: 'waiting',
      revision: 1,
      actions: [{ kind: 'move', move: 'e2e4', revision: 1 }],
      seats: ['white'],
      redeemed: false,
    });

    // Harald joins later and finds the opening; it is his move.
    const joined = await join(harald, token);
    expect(joined.status).toBe(200);
    expect(joined.body.game).toMatchObject({
      status: 'active',
      revision: 2,
      yourSeat: 'black',
      chess: { initialFen: STANDARD, moves: ['e2e4'], turn: 'black' },
    });
    const reply = await move(harald, gameId, 2, 'e7e5');
    expect(reply.status).toBe(200);
    expect(reply.body.game.chess.moves).toEqual(['e2e4', 'e7e5']);
    expect((await stored(gameId)).actions.map((a) => a.move as string)).toEqual(['e2e4', 'e7e5']);
  });

  it('allows one opening only: no second move, no illegal move, no resignation, no outsiders', async () => {
    const { arne, gameId } = await waitingGame();
    const outsider = await newPlayer('Mallory');

    expect((await move(arne, gameId, 0, 'e2e5')).status).toBe(422);
    expect((await move(outsider, gameId, 0, 'e2e4')).body.error.code).toBe('game_not_found');
    expect((await resign(arne, gameId, 0)).body.error.code).toBe('not_started');

    expect((await move(arne, gameId, 0, 'e2e4')).status).toBe(200);
    const second = await move(arne, gameId, 1, 'd2d4');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('not_your_turn');
    expect((await resign(arne, gameId, 1)).body.error.code).toBe('not_started');
    expect(await stored(gameId)).toMatchObject({ status: 'waiting', revision: 1, actions: [{ move: 'e2e4' }] });
  });

  it('still lets White move first when the friend joins before the opening', async () => {
    const { arne, harald, gameId, token } = await waitingGame();
    expect((await join(harald, token)).body.game).toMatchObject({ status: 'active', revision: 1 });
    const blackFirst = await move(harald, gameId, 1, 'e7e5');
    expect(blackFirst.body.error.code).toBe('not_your_turn');
    expect((await move(arne, gameId, 1, 'e2e4')).status).toBe(200);
    expect((await move(harald, gameId, 2, 'e7e5')).status).toBe(200);
  });

  it('keeps invitation renewal working after the opening', async () => {
    const { arne, harald, gameId } = await waitingGame();
    expect((await move(arne, gameId, 0, 'd2d4')).status).toBe(200);
    const renewed = await call('POST', `/games/${gameId}/invitation`, { credential: arne.credential });
    expect(renewed.status).toBe(200);
    expect(renewed.body.game.chess.moves).toEqual(['d2d4']);
    expect((await join(harald, renewed.body.invitation.token)).body.game).toMatchObject({
      status: 'active',
      chess: { moves: ['d2d4'], turn: 'black' },
    });
  });

  it('repeats a lost opening without playing it twice, before and after the friend joins', async () => {
    const { arne, harald, gameId, token } = await waitingGame();
    const requestId = randomUUID();
    const first = await move(arne, gameId, 0, 'e2e4', requestId);
    expect(first.body.duplicate).toBe(false);
    // The first reply was lost; the browser repeats the same request.
    const repeat = await move(arne, gameId, 0, 'e2e4', requestId);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ duplicate: true, game: { status: 'waiting', revision: 1, chess: { moves: ['e2e4'] } } });

    await join(harald, token);
    const afterJoin = await move(arne, gameId, 0, 'e2e4', requestId);
    expect(afterJoin.status).toBe(200);
    expect(afterJoin.body).toMatchObject({ duplicate: true, game: { status: 'active', revision: 2, chess: { moves: ['e2e4'] } } });
    expect((await stored(gameId)).actions).toHaveLength(1);
  });

  it('accepts exactly one of two simultaneous openings from two creator browsers', async () => {
    const { arne, gameId } = await waitingGame();
    const phone = await call('POST', '/players', { body: { email: arne.email } });
    const arnePhone = { ...arne, credential: phone.body.deviceCredential };
    const results = await Promise.all([move(arne, gameId, 0, 'e2e4'), move(arnePhone, gameId, 0, 'd2d4')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('stale_revision');
    expect(await stored(gameId)).toMatchObject({ status: 'waiting', revision: 1 });
    expect((await stored(gameId)).actions).toHaveLength(1);
  });

  it('keeps a joining friend and a simultaneous opening consistent', async () => {
    for (let round = 0; round < 5; round++) {
      const { arne, harald, gameId, token } = await waitingGame();
      const [opening, joined] = await Promise.all([move(arne, gameId, 0, 'e2e4'), join(harald, token)]);
      expect(joined.status).toBe(200);
      const game = await stored(gameId);
      // Either order is fine: the opening landed first, or it was refused as stale and nothing was lost.
      if (opening.status === 200) {
        expect(game).toMatchObject({ status: 'active', revision: 2, payload: { moves: ['e2e4'] } });
        expect(game.actions).toHaveLength(1);
      } else {
        expect(opening.body.error.code).toBe('stale_revision');
        expect(game).toMatchObject({ status: 'active', revision: 1, payload: { moves: [] } });
        expect(game.actions).toHaveLength(0);
        expect((await move(arne, gameId, 1, 'e2e4')).status).toBe(200);
      }
      expect(game.seats).toEqual(['black', 'white']);
    }
  });
});
