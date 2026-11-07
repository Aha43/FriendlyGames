// Email entry from several browsers (#29), against the real local backend.
// Prototype rule: knowing a player's email opens that player; ownership is not checked.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, move, newPlayer, playMoves, resign, startGame, uniqueSuffix, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const unique = uniqueSuffix;

const enter = (email: string, displayName?: string) =>
  call('POST', '/players', { body: displayName === undefined ? { email } : { email, displayName } });

/** The same player, as seen from another browser that entered the email. */
async function secondBrowser(player: TestPlayer, typedEmail = player.email, typedName?: string): Promise<TestPlayer> {
  const entered = await enter(typedEmail, typedName);
  expect(entered.status).toBe(200);
  expect(entered.body.created).toBe(false);
  return { ...player, credential: entered.body.deviceCredential };
}

async function rowsForEmail(email: string) {
  const [row] = await sql`
    select count(distinct c.player_id)::int as players, count(pc.*)::int as credentials
      from player_contacts c left join player_credentials pc on pc.player_id = c.player_id
     where lower(btrim(c.email)) = lower(btrim(${email}))`;
  return row as { players: number; credentials: number };
}

describe('entering an email', () => {
  it('creates one player for a new email, which needs a name', async () => {
    const email = `new-${unique()}@example.test`;
    const nameless = await enter(email);
    expect(nameless.status).toBe(404);
    expect(nameless.body.error.code).toBe('player_not_found');
    expect(await rowsForEmail(email)).toEqual({ players: 0, credentials: 0 });

    const created = await enter(email, 'Newcomer');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ player: { displayName: 'Newcomer', email }, created: true });
    expect(created.body.deviceCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await rowsForEmail(email)).toEqual({ players: 1, credentials: 1 });
  });

  it('opens the SAME player in a second browser, with its games, moves and tally', async () => {
    const harald = await newPlayer('Harald');
    const arne = await newPlayer('Arne');
    const { game } = await startGame(arne, harald);
    await playMoves(arne, harald, game.id, ['e2e4', 'e7e5']);
    const finished = await resign(harald, game.id, 3);
    expect(finished.status).toBe(200);

    // Case and whitespace variants of the email; a different typed name is ignored.
    for (const typed of [harald.email.toUpperCase(), `  ${harald.email}  `]) {
      const phone = await secondBrowser(harald, typed, 'Someone else');
      expect(phone.credential).not.toBe(harald.credential);

      const me = await call('GET', '/me', { credential: phone.credential });
      expect(me.body.player).toEqual({ id: harald.id, displayName: 'Harald', email: harald.email });
      const fromPhone = await call('GET', `/games/${game.id}`, { credential: phone.credential });
      const fromLaptop = await call('GET', `/games/${game.id}`, { credential: harald.credential });
      expect(fromPhone.body.game).toEqual(fromLaptop.body.game);
      expect(fromPhone.body.game.chess.moves).toEqual(['e2e4', 'e7e5']);
      const history = await call('GET', '/history', { credential: phone.credential });
      expect(history.body.history[0]).toMatchObject({ opponent: { id: arne.id }, wins: 0, losses: 1, draws: 0 });
    }
    // One player, three browsers.
    expect(await rowsForEmail(harald.email)).toEqual({ players: 1, credentials: 3 });
  });

  it('keeps every browser working: both can refresh and play, with revision checks intact', async () => {
    const arne = await newPlayer('Arne');
    const harald = await newPlayer('Harald');
    const { game } = await startGame(arne, harald);
    const arnePhone = await secondBrowser(arne);

    // The laptop still works after the phone entered.
    expect((await call('GET', '/games', { credential: arne.credential })).status).toBe(200);

    // Both browsers try White's first move at the same revision: exactly one is accepted.
    const [fromLaptop, fromPhone] = await Promise.all([
      move(arne, game.id, game.revision, 'e2e4'),
      move(arnePhone, game.id, game.revision, 'd2d4'),
    ]);
    expect([fromLaptop.status, fromPhone.status].sort()).toEqual([200, 409]);
    const loser = fromLaptop.status === 409 ? fromLaptop : fromPhone;
    expect(loser.body.error.code).toBe('stale_revision');

    // Moves continue from either browser; illegal and out-of-turn moves are still refused.
    let current = (fromLaptop.status === 200 ? fromLaptop : fromPhone).body.game;
    expect((await move(arnePhone, game.id, current.revision, 'g1f3')).body.error.code).toBe('not_your_turn');
    current = (await move(harald, game.id, current.revision, 'e7e5')).body.game;
    expect((await move(arne, game.id, current.revision, 'e1e3')).status).toBe(422);
    const next = await move(arnePhone, game.id, current.revision, 'g1f3');
    expect(next.status).toBe(200);
    expect((await call('GET', `/games/${game.id}`, { credential: arne.credential })).body.game.revision).toBe(
      next.body.game.revision,
    );
  });

  it('stores only credential hashes', async () => {
    const player = await newPlayer('Hashed');
    const other = await secondBrowser(player);
    const rows = await sql`select encode(credential_hash, 'hex') as hash from player_credentials where player_id = ${player.id}`;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify([
      await sql`select * from players where id = ${player.id}`,
      await sql`select encode(credential_hash, 'escape') as raw, * from player_credentials where player_id = ${player.id}`,
    ]);
    expect(dump).not.toContain(player.credential);
    expect(dump).not.toContain(other.credential);
  });

  it('resolves simultaneous first entries for a new email to exactly one player', async () => {
    const run = unique();
    const email = `race-${run}@example.test`;
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => enter(i % 2 ? email : `  ${email.toUpperCase()} `, `Racer${i}-${run}`)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(results.map((r) => r.body.player.id));
    expect(ids.size).toBe(1);
    const [id] = ids;
    for (const r of results) {
      const me = await call('GET', '/me', { credential: r.body.deviceCredential });
      expect(me.body.player.id).toBe(id);
    }
    // No orphans: losing attempts left no player, contact or credential behind.
    const [orphans] = await sql`select count(*)::int as n from players where display_name like ${`Racer%-${run}`}`;
    expect(orphans.n).toBe(1);
    expect(await rowsForEmail(email)).toEqual({ players: 1, credentials: 5 });
  });

  it('is safe to repeat after a lost response, for a new and an existing player', async () => {
    const email = `retry-${unique()}@example.test`;
    // The first reply is "lost"; the browser repeats the same request.
    const first = await enter(email, 'Retrier');
    const repeat = await enter(email, 'Retrier');
    expect([first.status, repeat.status]).toEqual([201, 200]);
    expect(repeat.body.player.id).toBe(first.body.player.id);

    const again = await enter(email);
    const againRepeat = await enter(email);
    expect(new Set([again, againRepeat].map((r) => r.body.player.id))).toEqual(new Set([first.body.player.id]));
    // No browser was disconnected by the repeats.
    for (const r of [first, repeat, again, againRepeat]) {
      expect((await call('GET', '/me', { credential: r.body.deviceCredential })).status).toBe(200);
    }
    expect(await rowsForEmail(email)).toEqual({ players: 1, credentials: 4 });
  });

  it('validates input', async () => {
    expect((await enter('not-an-email', 'X')).status).toBe(400);
    expect((await enter('')).status).toBe(400);
    expect((await enter(`n-${unique()}@example.test`, '')).status).toBe(400);
    expect((await enter(`n-${unique()}@example.test`, 'x'.repeat(41))).status).toBe(400);
  });

  it('reveals nothing but the entered player', async () => {
    const player = await newPlayer('Private');
    const friend = await newPlayer('Friend');
    await startGame(player, friend);
    const entered = await enter(player.email);
    expect(Object.keys(entered.body).sort()).toEqual(['created', 'deviceCredential', 'player']);
    expect(Object.keys(entered.body.player).sort()).toEqual(['displayName', 'email', 'id']);
    const text = JSON.stringify(entered.body);
    expect(text).not.toContain(friend.email);
    expect(text).not.toContain(player.credential);
  });
});

describe('invitations from another browser', () => {
  it('seat the existing player, never a duplicate, and evict nobody', async () => {
    const arne = await newPlayer('Arne');
    const harald = await newPlayer('Harald');
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    const token = created.body.invitation.token;

    // Harald opens the link on his phone and enters his email there first.
    const phone = await secondBrowser(harald);
    const joined = await call('POST', '/invitations/redeem', { credential: phone.credential, body: { token } });
    expect(joined.status).toBe(200);
    expect(joined.body.game.players.black).toEqual({ id: harald.id, displayName: 'Harald' });

    // The same link from his laptop finds the same seat; a stranger can't take it.
    const laptop = await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token } });
    expect(laptop.status).toBe(200);
    expect(laptop.body.game.id).toBe(joined.body.game.id);
    const stranger = await newPlayer('Mallory');
    const taken = await call('POST', '/invitations/redeem', { credential: stranger.credential, body: { token } });
    expect(taken.body.error.code).toBe('invitation_used');

    // Arne's second browser opening his own link doesn't change the seats.
    const arnePhone = await secondBrowser(arne);
    const own = await call('POST', '/invitations/redeem', { credential: arnePhone.credential, body: { token } });
    expect(own.status).toBe(409);
    const [seats] = await sql`select count(*)::int as n from game_participants where game_id = ${created.body.game.id}`;
    expect(seats.n).toBe(2);
  });
});
