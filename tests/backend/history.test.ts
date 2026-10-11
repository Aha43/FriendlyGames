// Shared history and "play again" against the real local backend.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, db, move, newPlayer, playMoves, resign, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

let arne: TestPlayer;
let harald: TestPlayer;
let other: TestPlayer;
let outsider: TestPlayer;
const finished: Record<string, string> = {};

const FOOLS_MATE = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
const SCHOLARS_MATE = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];

beforeAll(async () => {
  [arne, harald, other, outsider] = await Promise.all([
    newPlayer('Arne'),
    newPlayer('Harald'),
    newPlayer('Ola'),
    newPlayer('Mallory'),
  ]);

  // Arne vs Harald: Harald mates (Arne White), Arne mates (Arne White), Harald resigns, a draw.
  let { game } = await startGame(arne, harald);
  await playMoves(arne, harald, game.id, FOOLS_MATE);
  finished.haraldMates = game.id;

  ({ game } = await startGame(arne, harald));
  await playMoves(arne, harald, game.id, SCHOLARS_MATE);
  finished.arneMates = game.id;

  ({ game } = await startGame(harald, arne)); // Harald White this time
  const afterMove = await playMoves(harald, arne, game.id, ['d2d4']);
  await resign(harald, game.id, afterMove.revision);
  finished.haraldResigns = game.id;

  ({ game } = await startGame(arne, harald));
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  await playMoves(arne, harald, game.id, [...shuffle, ...shuffle]);
  finished.draw = game.id;

  // An unfinished game and a game with someone else must not count.
  await startGame(arne, harald);
  ({ game } = await startGame(arne, other));
  await playMoves(arne, other, game.id, FOOLS_MATE);
  finished.withOla = game.id;
});

describe('history', () => {
  it('gives each player an exact tally per opponent, newest game first', async () => {
    const mine = await call('GET', '/history', { credential: arne.credential });
    expect(mine.status).toBe(200);
    const withHarald = mine.body.history.find((h: any) => h.opponent.id === harald.id);
    expect(withHarald).toMatchObject({
      gameType: 'chess',
      opponent: { id: harald.id, displayName: 'Harald' },
      wins: 2,
      draws: 1,
      losses: 1,
    });
    expect(withHarald.games.map((g: any) => g.id)).toEqual([
      finished.draw,
      finished.haraldResigns,
      finished.arneMates,
      finished.haraldMates,
    ]);
    expect(withHarald.games[1]).toMatchObject({ outcome: 'win', termination: 'resignation', yourSeat: 'black', moveCount: 1 });
    expect(withHarald.games[3]).toMatchObject({ outcome: 'loss', termination: 'checkmate', yourSeat: 'white', moveCount: 4 });
    expect(Date.parse(withHarald.games[0].finishedAt)).not.toBeNaN();

    const withOla = mine.body.history.find((h: any) => h.opponent.id === other.id);
    expect(withOla).toMatchObject({ wins: 0, draws: 0, losses: 1 });

    const theirs = await call('GET', '/history', { credential: harald.credential });
    expect(theirs.body.history).toHaveLength(1);
    expect(theirs.body.history[0]).toMatchObject({ opponent: { id: arne.id }, wins: 1, draws: 1, losses: 2 });
  });

  it('shows nothing of other people’s games', async () => {
    const theirs = await call('GET', '/history', { credential: outsider.credential });
    expect(theirs.body.history).toEqual([]);
    expect((await call('GET', `/games/${finished.draw}`, { credential: outsider.credential })).status).toBe(404);
    expect(JSON.stringify((await call('GET', '/history', { credential: harald.credential })).body)).not.toContain(
      arne.email,
    );
  });

  it('reopens a finished game with its full move list and result', async () => {
    const reopened = await call('GET', `/games/${finished.arneMates}`, { credential: harald.credential });
    expect(reopened.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'checkmate' });
    expect(reopened.body.game.chess.moves).toEqual(SCHOLARS_MATE);
  });
});

describe('play again', () => {
  it('starts a new game for the same two players with colours swapped, without an invitation', async () => {
    const before = (await sql`select * from games where id = ${finished.haraldMates}`)[0];

    const rematch = await call('POST', `/games/${finished.haraldMates}/rematch`, { credential: harald.credential });
    expect(rematch.status).toBe(201);
    const game = rematch.body.game;
    expect(game.id).not.toBe(finished.haraldMates);
    expect(game).toMatchObject({ status: 'active', revision: 0, yourSeat: 'white' });
    expect(game.players).toEqual({
      white: { id: harald.id, displayName: 'Harald' },
      black: { id: arne.id, displayName: 'Arne' },
    });
    expect(game.chess.moves).toEqual([]);

    // Arne can play in it straight away; no invitation exists for it.
    const [invitations] = await sql`select count(*)::int as n from game_invitations where game_id = ${game.id}`;
    expect(invitations.n).toBe(0);
    expect((await move(harald, game.id, 0, 'e2e4')).status).toBe(200);
    expect((await call('GET', `/games/${game.id}`, { credential: arne.credential })).body.game.yourSeat).toBe('black');

    // Both see the link from the finished game; the finished game itself is unchanged.
    const original = await call('GET', `/games/${finished.haraldMates}`, { credential: arne.credential });
    expect(original.body.game.rematchGameId).toBe(game.id);
    const after = (await sql`select * from games where id = ${finished.haraldMates}`)[0];
    expect(after).toEqual(before);

    expect((await call('GET', `/games/${game.id}`, { credential: outsider.credential })).status).toBe(404);
  });

  it('leads both players to the same new game', async () => {
    const results = await Promise.all([
      call('POST', `/games/${finished.arneMates}/rematch`, { credential: arne.credential }),
      call('POST', `/games/${finished.arneMates}/rematch`, { credential: harald.credential }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.game.id).toBe(results[1].body.game.id);
    const [count] = await sql`select count(*)::int as n from games where rematch_of = ${finished.arneMates}`;
    expect(count.n).toBe(1);
  });

  it('is only for participants of a finished game', async () => {
    expect((await call('POST', `/games/${finished.draw}/rematch`, { credential: outsider.credential })).status).toBe(404);
    const { game } = await startGame(arne, harald);
    const early = await call('POST', `/games/${game.id}/rematch`, { credential: arne.credential });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('not_finished');
  });
});

describe('archived games', () => {
  it('cannot be changed through the API or directly in the database', async () => {
    const before = (await sql`select * from games where id = ${finished.draw}`)[0];
    expect((await move(arne, finished.draw, before.revision, 'e2e4')).body.error.code).toBe('game_finished');
    expect((await resign(harald, finished.draw, before.revision)).body.error.code).toBe('game_finished');
    await expect(sql`update games set result = 'white' where id = ${finished.draw}`).rejects.toThrow(
      /finished and cannot be changed/,
    );
    expect((await sql`select * from games where id = ${finished.draw}`)[0]).toEqual(before);
  });
});
