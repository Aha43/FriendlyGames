// Games with previous opponents (#72), against the real local backend: who counts as one (actual
// shared seats only), the listing's privacy, and direct creation with exact-intent retries.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, move, newPlayer, randomUUID, resign, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const BOTH = '?types=chess,chess960';
const opponents = (p: TestPlayer) => call('GET', '/opponents', { credential: p.credential });
const createDirect = (p: TestPlayer, friendPlayerId: string, extra: Record<string, unknown> = {}, query = BOTH) =>
  call('POST', `/games${query}`, { credential: p.credential, body: { friendPlayerId, ...extra } });
const gamesCreatedBy = async (p: TestPlayer) => (await sql`select count(*)::int as n from games where created_by = ${p.id}`)[0].n;

/** A finished or ongoing game stored in schema version 99, which no adapter reads. */
async function unreadableGame(white: TestPlayer, black: TestPlayer) {
  const [game] = await sql`
    insert into games (game_type, schema_version, status, revision, payload, created_by)
    values ('chess', 99, 'active', 3, ${sql.json({ future: 'format' })}, ${white.id})
    returning id`;
  await sql`insert into game_participants (game_id, player_id, seat)
            values (${game.id}, ${white.id}, 'white'), (${game.id}, ${black.id}, 'black')`;
  return game.id as string;
}

/** Arne with: Harald (one finished and one ongoing game), Ola (one ongoing), and Pending, only invited. */
async function circle() {
  const arne = await newPlayer('Arne');
  const harald = await newPlayer('Harald');
  const ola = await newPlayer('Ola');
  const pending = await newPlayer('Pending');
  const finished = await startGame(arne, harald);
  await resign(harald, finished.game.id, finished.game.revision);
  const ongoing = await startGame(harald, arne); // Harald created this one: Arne is Black
  await move(harald, ongoing.game.id, ongoing.game.revision, 'e2e4');
  await startGame(arne, ola);
  const invited = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: pending.email } });
  expect(invited.status).toBe(201);
  return { arne, harald, ola, pending, finished, ongoing };
}

describe('GET /opponents', () => {
  it('lists each person the caller has sat at a game with once, ongoing or finished, never only-invited people or the caller', async () => {
    const { arne, harald, ola, pending, ongoing } = await circle();
    const { status, body } = await opponents(arne);
    expect(status).toBe(200);
    expect(body.opponents.map((o: { id: string }) => o.id).sort()).toEqual([harald.id, ola.id].sort());
    const h = body.opponents.find((o: { id: string }) => o.id === harald.id);
    expect(h).toEqual({ id: harald.id, displayName: harald.name, sharedGames: 2, lastSharedGameUpdatedAt: expect.any(String) });
    // The latest time any shared game was created, joined or had an action: here Harald's opening move.
    const [{ updated_at }] = await sql`select updated_at from games where id = ${ongoing.game.id}`;
    expect(h.lastSharedGameUpdatedAt).toBe(new Date(updated_at).toISOString());
    expect(body.opponents.find((o: { id: string }) => o.id === ola.id)).toMatchObject({ sharedGames: 1 });
    // Newest shared activity first (Ola's game was joined after Harald's opening move).
    const times = body.opponents.map((o: { lastSharedGameUpdatedAt: string }) => o.lastSharedGameUpdatedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(body.opponents[0].id).toBe(ola.id);
    // The invited-only player sees no relationship either.
    expect((await opponents(pending)).body.opponents).toEqual([]);
  });

  it('counts only the caller’s own shared games, not the opponent’s other games', async () => {
    const { arne, harald, ola } = await circle();
    const extra = await startGame(harald, ola);
    await move(harald, extra.game.id, extra.game.revision, 'd2d4');
    const listed = (await opponents(arne)).body.opponents;
    expect(listed.find((o: { id: string }) => o.id === harald.id).sharedGames).toBe(2);
    expect(listed.find((o: { id: string }) => o.id === ola.id).sharedGames).toBe(1);
  });

  it('includes someone known only from a game this client cannot show, without returning that game', async () => {
    const arne = await newPlayer('Arne');
    const future = await newPlayer('Future');
    const gameId = await unreadableGame(future, arne);
    // No types parameter (a chess-only client), and the game is a schema no adapter reads.
    const { body } = await call('GET', '/opponents', { credential: arne.credential });
    expect(body.opponents).toEqual([expect.objectContaining({ id: future.id, displayName: future.name, sharedGames: 1 })]);
    expect(JSON.stringify(body)).not.toContain(gameId);
    expect((await call('GET', '/games', { credential: arne.credential })).body.games).toEqual([]);
    // And that relationship is enough to start a new game.
    expect((await createDirect(arne, future.id)).status).toBe(201);
  });

  it('returns no emails, credentials or invitation tokens, and needs a valid credential', async () => {
    const { arne, harald, pending } = await circle();
    const text = JSON.stringify((await opponents(arne)).body);
    for (const secret of [harald.email, pending.email, harald.credential, arne.credential, '@']) expect(text).not.toContain(secret);
    expect(Object.keys((await opponents(arne)).body.opponents[0]).sort()).toEqual(['displayName', 'id', 'lastSharedGameUpdatedAt', 'sharedGames']);
    expect((await call('GET', '/opponents')).status).toBe(401);
    expect((await call('GET', '/opponents', { credential: 'A'.repeat(43) })).status).toBe(401);
  });
});

describe('POST /games with friendPlayerId', () => {
  it('starts an active game with both seated, creator White to move, visible to both, with no invitation', async () => {
    const { arne, harald } = await circle();
    const created = await createDirect(arne, harald.id, { requestId: randomUUID() }, '');
    expect(created.status).toBe(201);
    expect(created.body.invitation).toBeNull();
    expect(created.body.duplicate).toBe(false);
    const game = created.body.game;
    expect(game).toMatchObject({
      type: 'chess',
      status: 'active',
      yourSeat: 'white',
      turn: 'white',
      moveCount: 0,
      players: { white: { id: arne.id, displayName: arne.name }, black: { id: harald.id, displayName: harald.name } },
    });
    const [{ n }] = await sql`select count(*)::int as n from game_invitations where game_id = ${game.id}`;
    expect(n).toBe(0);
    // Harald finds it through his normal game list (a chess-only client), as Black, not his turn yet.
    const his = (await call('GET', '/games', { credential: harald.credential })).body.games.find((g: { id: string }) => g.id === game.id);
    expect(his).toMatchObject({ status: 'active', yourSeat: 'black', turn: 'white' });
    expect((await move(harald, game.id, game.revision, 'e7e5')).status).not.toBe(200);
    expect((await move(arne, game.id, game.revision, 'e2e4')).status).toBe(200);
  });

  it('works for Fischer Random, drawing the start once: a retry returns the same game and start', async () => {
    const { arne, ola } = await circle();
    const requestId = randomUUID();
    const first = await createDirect(arne, ola.id, { requestId, type: 'chess960' });
    expect(first.status).toBe(201);
    expect(first.body.game.chess960.initialFen).toMatch(/ w [A-Ha-h]{4} - 0 1$/);
    const again = await createDirect(arne, ola.id, { requestId, type: 'chess960' });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.game.id).toBe(first.body.game.id);
    expect(again.body.game.chess960.initialFen).toBe(first.body.game.chess960.initialFen);
    // A chess-only client never sees it.
    const chessOnly = (await call('GET', '/games', { credential: ola.credential })).body.games;
    expect(chessOnly.some((g: { id: string }) => g.id === first.body.game.id)).toBe(false);
  });

  it('refuses yourself, unknown IDs, strangers and only-invited people alike, revealing nothing and creating nothing', async () => {
    const { arne, pending } = await circle();
    const stranger = await newPlayer('Stranger');
    const before = await gamesCreatedBy(arne);
    const answers = await Promise.all([arne.id, randomUUID(), stranger.id, pending.id].map((id) => createDirect(arne, id)));
    for (const a of answers) {
      expect(a.status).toBe(404);
      expect(a.body).toEqual(answers[0].body);
      expect(a.body.error.code).toBe('opponent_not_found');
      expect(JSON.stringify(a.body)).not.toMatch(new RegExp(`${stranger.id}|${pending.id}|@`));
    }
    expect(await gamesCreatedBy(arne)).toBe(before);
  });

  it('needs exactly one valid target', async () => {
    const { arne, harald } = await circle();
    const both = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email, friendPlayerId: harald.id } });
    expect(both.status).toBe(400);
    expect((await createDirect(arne, 'not-an-id')).status).toBe(400);
    expect((await call('POST', '/games', { credential: arne.credential, body: {} })).status).toBe(400);
    expect((await call('POST', '/games', { body: { friendPlayerId: harald.id } })).status).toBe(401);
  });

  it('keeps one request ID to one exact intent: friend, target mode and type', async () => {
    const { arne, harald, ola } = await circle();
    const requestId = randomUUID();
    const first = await createDirect(arne, harald.id, { requestId });
    expect(first.status).toBe(201);
    const before = await gamesCreatedBy(arne);
    const [{ revision }] = await sql`select revision from games where id = ${first.body.game.id}`;
    for (const reuse of [
      () => createDirect(arne, ola.id, { requestId }), // another friend
      () => createDirect(arne, harald.id, { requestId, type: 'chess960' }), // another type
      () => call('POST', `/games${BOTH}`, { credential: arne.credential, body: { friendEmail: harald.email, requestId } }), // email mode
    ]) {
      const r = await reuse();
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('request_id_reused');
    }
    expect(await gamesCreatedBy(arne)).toBe(before);
    const [after] = await sql`select revision, status from games where id = ${first.body.game.id}`;
    expect(after).toEqual({ revision, status: 'active' });
  });

  it('never treats an email-invitation request as a direct one, even after the friend joined', async () => {
    const { arne, harald } = await circle();
    const requestId = randomUUID();
    const invited = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email, requestId } });
    await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: invited.body.invitation.token } });
    const reused = await createDirect(arne, harald.id, { requestId }, '');
    expect(reused.status).toBe(409);
    // The original email retry still finds its game, with no new link (the friend has joined).
    const retried = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email, requestId } });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ duplicate: true, invitation: null, game: { id: invited.body.game.id } });
  });

  it('answers simultaneous retries of one request with one game', async () => {
    const { arne, harald } = await circle();
    const requestId = randomUUID();
    const before = await gamesCreatedBy(arne);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => createDirect(arne, harald.id, { requestId })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.game.id)).size).toBe(1);
    expect(await gamesCreatedBy(arne)).toBe(before + 1);
    const [{ seats }] = await sql`select count(*)::int as seats from game_participants where game_id = ${results[0].body.game.id}`;
    expect(seats).toBe(2);
  });

  it('lets either player start further games with the other, even while one is ongoing', async () => {
    const { arne, harald } = await circle();
    const a = await createDirect(arne, harald.id, { requestId: randomUUID() });
    const b = await createDirect(harald, arne.id, { requestId: randomUUID() });
    const c = await createDirect(arne, harald.id); // no request ID: a new game each time
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(new Set([a.body.game.id, b.body.game.id, c.body.game.id]).size).toBe(3);
    expect(b.body.game.players.white.id).toBe(harald.id);
    expect((await opponents(arne)).body.opponents.find((o: { id: string }) => o.id === harald.id).sharedGames).toBe(5);
  });

  it('leaves the email invitation path as it was for old clients', async () => {
    const arne = await newPlayer('Arne');
    const friend = await newPlayer('Friend');
    const legacy = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: friend.email } });
    expect(legacy.status).toBe(201);
    expect(legacy.body.game).toMatchObject({ status: 'waiting', players: { black: null } });
    expect(legacy.body.invitation.token).toEqual(expect.any(String));
  });
});
