// Friends before games (#110), against the real local backend: single-use friend links, lasting
// connections, the pending list with replacement, expiry and the cap, old-client compatibility,
// and the creator-only recipient email of a pending game invitation.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, newPlayer, randomUUID, resign, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const ALL = '?types=chess,chess960,yatzy';

const invite = (p: TestPlayer, requestId = randomUUID()) => call('POST', '/friend-invitations', { credential: p.credential, body: { requestId } });
const pending = (p: TestPlayer) => call('GET', '/friend-invitations', { credential: p.credential });
const replace = (p: TestPlayer, id: string) => call('POST', `/friend-invitations/${id}/replacement`, { credential: p.credential });
const preview = (token: unknown, p?: TestPlayer) => call('POST', '/friend-invitations/preview', { credential: p?.credential, body: { token } });
const accept = (p: TestPlayer, token: unknown) => call('POST', '/friend-invitations/accept', { credential: p.credential, body: { token } });
/** The picker as a client from before #110 asks for it, and as a new client does. */
const oldOpponents = async (p: TestPlayer) => (await call('GET', '/opponents', { credential: p.credential })).body.opponents;
const opponents = async (p: TestPlayer) => (await call('GET', '/opponents?friends=1', { credential: p.credential })).body.opponents;
const connections = async (a: TestPlayer, b: TestPlayer) =>
  sql`select player_low, player_high from player_connections where player_low in (${a.id}, ${b.id}) and player_high in (${a.id}, ${b.id})`;
const UNAVAILABLE = { status: 404, body: { error: { code: 'friend_invitation_unavailable', message: expect.any(String) } } };

/** Two players connected by an accepted friend invitation, who have never shared a game. */
async function friends(a = 'Arne', b = 'Harald') {
  const [host, guest] = [await newPlayer(a), await newPlayer(b)];
  const created = await invite(host);
  expect(created.status).toBe(201);
  expect((await accept(guest, created.body.invitation.token)).status).toBe(200);
  return { host, guest, invitation: created.body.invitation as { id: string; token: string } };
}

describe('inviting a friend without choosing a game', () => {
  it('creates a link without a game or an email, shows the holder who invites, and connects both on acceptance', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const before = Date.now();
    const created = await invite(arne);
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      invitation: { id: expect.any(String), createdAt: expect.any(String), expiresAt: expect.any(String), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) },
      duplicate: false,
    });
    const { token, id } = created.body.invitation;
    const days = (Date.parse(created.body.invitation.expiresAt) - Date.parse(created.body.invitation.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(30, 3);
    expect(Date.parse(created.body.invitation.createdAt)).toBeGreaterThan(before - 60_000);
    // Only the hash is stored, and nothing about a recipient.
    const [stored] = await sql`select encode(token_hash, 'hex') as hash, accepted_by, to_jsonb(i) as row from friend_invitations i where id = ${id}`;
    expect(JSON.stringify(stored.row)).not.toContain(token);
    expect(stored.accepted_by).toBeNull();
    expect((await call('GET', `/games${ALL}`, { credential: arne.credential })).body.games).toEqual([]);

    // The holder of the link sees the inviter's name and nothing else: before having a player,
    // and as Harald. Arne is told it is his own.
    expect(await preview(token)).toEqual({ status: 200, body: { invitation: { inviter: { displayName: arne.name }, state: 'open' } } });
    expect((await preview(token, harald)).body.invitation).toEqual({ inviter: { displayName: arne.name }, state: 'open' });
    expect((await preview(token, arne)).body.invitation).toEqual({ inviter: { displayName: arne.name }, state: 'own' });
    expect(await connections(arne, harald)).toHaveLength(0);
    expect(await opponents(harald)).toEqual([]);

    const accepted = await accept(harald, token);
    expect(accepted).toEqual({ status: 200, body: { friend: { id: arne.id, displayName: arne.name }, duplicate: false } });
    expect(await connections(arne, harald)).toHaveLength(1);
    // Connected both ways, with no game and no invented date.
    for (const [me, other] of [
      [arne, harald],
      [harald, arne],
    ]) {
      expect(await opponents(me)).toEqual([
        { id: other.id, displayName: other.name, sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: expect.any(String) },
      ]);
      expect((await call('GET', `/games${ALL}`, { credential: me.credential })).body.games).toEqual([]);
    }
    expect((await pending(arne)).body.invitations).toEqual([]);
    // No email, credential or token anywhere in what either side was given.
    for (const response of [accepted, await preview(token, harald), { body: await opponents(arne) }, await pending(arne)]) {
      const text = JSON.stringify(response.body);
      for (const secret of [arne.email, harald.email, arne.credential, harald.credential, token]) expect(text).not.toContain(secret);
    }
  });

  it('lets connected friends who never played start Chess, Fischer Random and a Yatzy table, either way round', async () => {
    const { host, guest } = await friends();
    const third = await newPlayer('William');
    const viaLink = await invite(guest);
    await accept(third, viaLink.body.invitation.token);

    const chess = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, requestId: randomUUID() } });
    expect(chess.status).toBe(201);
    expect(chess.body.game).toMatchObject({ type: 'chess', status: 'active', players: { white: { id: host.id }, black: { id: guest.id } } });
    const fischer = await call('POST', `/games${ALL}`, { credential: guest.credential, body: { friendPlayerId: third.id, type: 'chess960', requestId: randomUUID() } });
    expect(fischer.status).toBe(201);
    // A table needs the host connected to every guest: Harald knows both, Arne does not know William.
    const table = (who: TestPlayer, ids: string[]) =>
      call('POST', `/games${ALL}`, { credential: who.credential, body: { type: 'yatzy', mode: 'free', friendPlayerIds: ids, requestId: randomUUID() } });
    const refused = await table(host, [guest.id, third.id]);
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('opponent_not_found');
    const seated = await table(guest, [host.id, third.id]);
    expect(seated.status).toBe(201);
    expect(seated.body.game.players).toMatchObject({ p1: { id: guest.id }, p2: { id: host.id }, p3: { id: third.id } });
    // A client from before #110 may start with a connected friend too: authorization is the server's.
    const old = await call('POST', '/games', { credential: third.credential, body: { friendPlayerId: guest.id, requestId: randomUUID() } });
    expect(old.status).toBe(201);
    // Still nobody for a stranger.
    const stranger = await newPlayer('Stranger');
    const no = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: stranger.id, requestId: randomUUID() } });
    expect(no.status).toBe(404);
  });

  it('gives the same player the same connection again, and nobody else the link', async () => {
    const [arne, harald, other] = [await newPlayer('Arne'), await newPlayer('Harald'), await newPlayer('Other')];
    const { token } = (await invite(arne)).body.invitation;
    const first = await accept(harald, token);
    const again = await accept(harald, token);
    expect(first.body.duplicate).toBe(false);
    expect(again).toEqual({ status: 200, body: { friend: { id: arne.id, displayName: arne.name }, duplicate: true } });
    expect(await connections(arne, harald)).toHaveLength(1);
    // A reload on Harald's side shows it as accepted; for anyone else it is simply not available.
    expect((await preview(token, harald)).body.invitation).toEqual({ inviter: { displayName: arne.name }, state: 'accepted' });
    expect(await preview(token)).toMatchObject(UNAVAILABLE);
    expect(await preview(token, other)).toMatchObject(UNAVAILABLE);
    expect(await preview(token, arne)).toMatchObject(UNAVAILABLE);
    expect(await accept(other, token)).toMatchObject(UNAVAILABLE);
    expect(await connections(arne, other)).toHaveLength(0);
    expect(await opponents(other)).toEqual([]);
  });

  it('refuses your own link, malformed and unknown links, and requests without identity', async () => {
    const arne = await newPlayer('Arne');
    const { token, id } = (await invite(arne)).body.invitation;
    const own = await accept(arne, token);
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('own_friend_invitation');
    expect((await pending(arne)).body.invitations.map((i: { id: string }) => i.id)).toEqual([id]); // still usable by a friend
    for (const bad of [undefined, 42, '', 'short', `${token}x`, token.slice(1), randomUUID()]) {
      expect(await preview(bad)).toMatchObject(UNAVAILABLE);
      expect(await accept(arne, bad)).toMatchObject(UNAVAILABLE);
    }
    const unknown = token.split('').reverse().join('');
    expect(await preview(unknown)).toMatchObject(UNAVAILABLE);
    for (const response of [
      await call('POST', '/friend-invitations', { body: { requestId: randomUUID() } }),
      await call('GET', '/friend-invitations'),
      await call('POST', '/friend-invitations/accept', { body: { token } }),
      await call('POST', `/friend-invitations/${id}/replacement`),
      await call('POST', '/friend-invitations/preview', { credential: 'x'.repeat(43), body: { token } }),
    ]) {
      expect(response.status).toBe(401);
    }
    expect((await invite(arne, 'not-a-uuid' as never)).status).toBe(400);
    expect((await call('POST', '/friend-invitations', { credential: arne.credential, body: {} })).status).toBe(400);
  });

  it('connects once when the two already share games or are already connected, and uses the link up', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    await startGame(arne, harald);
    const one = (await invite(arne)).body.invitation.token;
    expect((await accept(harald, one)).body).toMatchObject({ duplicate: false });
    // The other way round as well: still one connection, and that second link is spent.
    const two = (await invite(harald)).body.invitation.token;
    expect((await accept(arne, two)).status).toBe(200);
    expect(await connections(arne, harald)).toHaveLength(1);
    expect((await pending(harald)).body.invitations).toEqual([]);
    const listed = await opponents(arne);
    expect(listed).toEqual([{ id: harald.id, displayName: harald.name, sharedGames: 1, lastSharedGameUpdatedAt: expect.any(String), connectedAt: expect.any(String) }]);
  });

  it('gives exactly one of several players accepting at once the link', async () => {
    const arne = await newPlayer('Arne');
    for (let round = 0; round < 4; round++) {
      const guests = [await newPlayer('GuestA'), await newPlayer('GuestB'), await newPlayer('GuestC')];
      const { token } = (await invite(arne)).body.invitation;
      const answers = await Promise.all([...guests, guests[0]].map((g) => accept(g, token)));
      const won = new Set(answers.flatMap((a, i) => (a.status === 200 ? [[...guests, guests[0]][i].id] : [])));
      expect(won.size).toBe(1);
      for (const a of answers) expect([200, 404]).toContain(a.status);
      const [{ n }] = await sql`
        select count(*)::int as n from player_connections
         where (player_low = ${arne.id} and player_high = any(${guests.map((g) => g.id)}::uuid[]))
            or (player_high = ${arne.id} and player_low = any(${guests.map((g) => g.id)}::uuid[]))`;
      expect(n).toBe(1);
    }
  });
});

describe('creating again after a lost answer', () => {
  it('finds the same invitation, hands out a new link for it, and the lost link stops working', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const requestId = randomUUID();
    const first = await invite(arne, requestId);
    const retry = await invite(arne, requestId);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({
      invitation: { id: first.body.invitation.id, createdAt: first.body.invitation.createdAt, expiresAt: first.body.invitation.expiresAt, token: expect.any(String) },
      duplicate: true,
    });
    expect(retry.body.invitation.token).not.toBe(first.body.invitation.token);
    expect((await pending(arne)).body.invitations).toHaveLength(1);
    expect(await preview(first.body.invitation.token)).toMatchObject(UNAVAILABLE);
    expect(await accept(harald, first.body.invitation.token)).toMatchObject(UNAVAILABLE);
    expect((await accept(harald, retry.body.invitation.token)).status).toBe(200);

    // Once accepted there is no link left to hand out; the connection is not disturbed.
    const late = await invite(arne, requestId);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('friend_invitation_accepted');
    expect(await connections(arne, harald)).toHaveLength(1);
    expect((await sql`select count(*)::int as n from friend_invitations where created_by = ${arne.id}`)[0].n).toBe(1);
  });

  it('makes one invitation when the same request arrives several times at once, and keeps request IDs per player', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const requestId = randomUUID();
    const answers = await Promise.all([invite(arne, requestId), invite(arne, requestId), invite(arne, requestId), invite(arne, requestId)]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(answers.map((a) => a.body.invitation.id)).size).toBe(1);
    expect((await pending(arne)).body.invitations).toHaveLength(1);
    // Exactly one of the links handed out still works: the last one issued.
    const live = await Promise.all(answers.map((a) => preview(a.body.invitation.token)));
    expect(live.filter((p) => p.status === 200)).toHaveLength(1);
    // The same ID from another player is that player's own invitation.
    const theirs = await invite(harald, requestId);
    expect(theirs.status).toBe(201);
    expect(theirs.body.invitation.id).not.toBe(answers[0].body.invitation.id);
  });
});

describe('expiry: 30 days, for links nobody accepted', () => {
  const expireAt = (id: string, when: string) => sql`update friend_invitations set expires_at = now() + ${when}::interval where id = ${id}`;

  it('works until the moment it expires and not after; an expired link leaves the list and cannot be replaced', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const requestId = randomUUID();
    const { id, token } = (await invite(arne, requestId)).body.invitation;
    await expireAt(id, '1 minute');
    expect((await preview(token)).status).toBe(200);
    expect((await pending(arne)).body.invitations).toHaveLength(1);

    await expireAt(id, '-1 second');
    expect(await preview(token)).toMatchObject(UNAVAILABLE);
    expect(await preview(token, arne)).toMatchObject(UNAVAILABLE);
    expect(await accept(harald, token)).toMatchObject(UNAVAILABLE);
    expect(await connections(arne, harald)).toHaveLength(0);
    expect((await pending(arne)).body.invitations).toEqual([]);
    const replaced = await replace(arne, id);
    expect(replaced.status).toBe(404);
    expect(replaced.body.error.code).toBe('friend_invitation_not_found');
    // Its request ID is spent: a late retry does not revive it. A new invitation is a new request.
    const late = await invite(arne, requestId);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('friend_invitation_expired');
    expect((await invite(arne)).status).toBe(201);
  });

  it('never touches a connection or a started game, however old', async () => {
    const { host, guest, invitation } = await friends();
    const game = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, requestId: randomUUID() } });
    await sql`update friend_invitations set created_at = now() - interval '400 days', expires_at = now() - interval '370 days' where id = ${invitation.id}`;
    await sql`update player_connections set created_at = now() - interval '400 days' where player_low in (${host.id}, ${guest.id}) and player_high in (${host.id}, ${guest.id})`;
    await sql`update games set created_at = now() - interval '400 days', updated_at = now() - interval '400 days' where id = ${game.body.game.id}`;
    expect((await opponents(host)).map((o: { id: string }) => o.id)).toEqual([guest.id]);
    expect((await accept(guest, invitation.token)).body).toMatchObject({ duplicate: true });
    const still = await call('GET', `/games/${game.body.game.id}${ALL}`, { credential: guest.credential });
    expect(still.body.game).toMatchObject({ status: 'active', revision: 0 });
    expect((await resign(guest, game.body.game.id, 0)).status).toBe(200);
  });
});

describe('the cap: 20 unused, unexpired links per player', () => {
  it('refuses the 21st, counts neither accepted nor expired ones, and replacement works at the cap', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const made = [];
    for (let i = 0; i < 20; i++) made.push((await invite(arne)).body.invitation);
    const listed = await pending(arne);
    expect(listed.body).toMatchObject({ limit: 20, validDays: 30 });
    expect(listed.body.invitations.map((i: { id: string }) => i.id)).toEqual(made.map((i) => i.id)); // oldest first
    for (const item of listed.body.invitations) expect(Object.keys(item).sort()).toEqual(['createdAt', 'expiresAt', 'id']);

    const over = await invite(arne);
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'friend_invitation_limit', limit: 20 });
    // A retry of one already made is not a 21st.
    expect((await sql`select count(*)::int as n from friend_invitations where created_by = ${arne.id}`)[0].n).toBe(20);

    // Replacement at the cap: same invitation and slot, a new link with a fresh 30 days, the old link dead.
    await sql`update friend_invitations set expires_at = now() + interval '2 days' where id = ${made[3].id}`;
    const replaced = await replace(arne, made[3].id);
    expect(replaced.status).toBe(200);
    expect(replaced.body.invitation).toMatchObject({ id: made[3].id, createdAt: made[3].createdAt, token: expect.any(String) });
    expect((Date.parse(replaced.body.invitation.expiresAt) - Date.now()) / 86_400_000).toBeCloseTo(30, 1);
    expect(replaced.body.invitation.token).not.toBe(made[3].token);
    expect(await preview(made[3].token)).toMatchObject(UNAVAILABLE);
    expect((await preview(replaced.body.invitation.token)).status).toBe(200);
    expect((await pending(arne)).body.invitations).toHaveLength(20);
    expect((await invite(arne)).status).toBe(409);
    // Replacing again after a lost answer: still one invitation, the newest link works.
    const again = await replace(arne, made[3].id);
    expect(again.status).toBe(200);
    expect(await preview(replaced.body.invitation.token)).toMatchObject(UNAVAILABLE);
    expect((await pending(arne)).body.invitations).toHaveLength(20);

    // An accepted one frees a slot; so does an expired one. Creating never cancels another.
    expect((await accept(harald, made[0].token)).status).toBe(200);
    expect((await invite(arne)).status).toBe(201);
    expect((await invite(arne)).status).toBe(409);
    await sql`update friend_invitations set expires_at = now() - interval '1 second' where id = ${made[1].id}`;
    expect((await invite(arne)).status).toBe(201);
    expect((await invite(arne)).status).toBe(409);
    for (const kept of [made[2], made[4], made[19]]) expect((await preview(kept.token)).status).toBe(200);
    // Another player's cap is their own.
    expect((await invite(harald)).status).toBe(201);
  });

  it('holds when many creations arrive at once', async () => {
    const arne = await newPlayer('Arne');
    for (let i = 0; i < 17; i++) await invite(arne);
    const answers = await Promise.all(Array.from({ length: 8 }, () => invite(arne)));
    expect(answers.filter((a) => a.status === 201)).toHaveLength(3);
    expect(answers.filter((a) => a.status === 409 && a.body.error.code === 'friend_invitation_limit')).toHaveLength(5);
    expect((await pending(arne)).body.invitations).toHaveLength(20);
  });
});

describe('replacing a pending invitation', () => {
  it('is for its creator only, and not for an accepted one', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const { id, token } = (await invite(arne)).body.invitation;
    for (const refused of [await replace(harald, id), await replace(arne, randomUUID()), await replace(arne, 'not-an-id')]) {
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('friend_invitation_not_found');
    }
    expect((await preview(token)).status).toBe(200); // untouched by the refusals
    await accept(harald, token);
    const late = await replace(arne, id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('friend_invitation_accepted');
    expect(await connections(arne, harald)).toHaveLength(1);
  });

  it('racing an acceptance: the acceptance wins or the replacement wins, and one link never connects two people', async () => {
    const arne = await newPlayer('Arne');
    const outcomes = new Set<string>();
    for (let round = 0; round < 10; round++) {
      const [first, second] = [await newPlayer('First'), await newPlayer('Second')];
      const { id, token } = (await invite(arne)).body.invitation;
      const [accepted, replaced] = round % 2 ? await Promise.all([accept(first, token), replace(arne, id)]) : (await Promise.all([replace(arne, id), accept(first, token)])).reverse();
      if (accepted.status === 200) {
        // The acceptance came first: the replacement is told so and hands out no link.
        expect(replaced.status).toBe(409);
        expect(replaced.body.error.code).toBe('friend_invitation_accepted');
        expect(await connections(arne, first)).toHaveLength(1);
        outcomes.add('accepted');
      } else {
        // The replacement came first: the old link is dead and the new one is for one person.
        expect(accepted).toMatchObject(UNAVAILABLE);
        expect(replaced.status).toBe(200);
        expect(await connections(arne, first)).toHaveLength(0);
        expect((await accept(second, replaced.body.invitation.token)).status).toBe(200);
        expect(await accept(first, replaced.body.invitation.token)).toMatchObject(UNAVAILABLE);
        outcomes.add('replaced');
      }
      const [{ n }] = await sql`select count(*)::int as n from player_connections where player_low = ${arne.id} or player_high = ${arne.id}`;
      expect(n).toBe(round + 1); // exactly one new friend per invitation
      expect((await pending(arne)).body.invitations).toEqual([]);
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });
});

describe('older clients and the picker', () => {
  it('gives a client that does not ask exactly the list and fields it always had', async () => {
    const { host, guest } = await friends();
    const played = await newPlayer('Played');
    await startGame(host, played);
    // Before #110: only people with a shared game, each with a count and a real date, no new field.
    const old = await oldOpponents(host);
    expect(old).toEqual([{ id: played.id, displayName: played.name, sharedGames: 1, lastSharedGameUpdatedAt: expect.any(String) }]);
    for (const o of old) expect(Number.isNaN(Date.parse(o.lastSharedGameUpdatedAt))).toBe(false);
    expect(await oldOpponents(guest)).toEqual([]);
    for (const query of ['?friends=0', '?friends=true', '?friends=', '?friend=1']) {
      expect((await call('GET', `/opponents${query}`, { credential: host.credential })).body.opponents).toEqual(old);
    }
    // A client that asks gets both, most recent first, and can tell them apart.
    expect(await opponents(host)).toEqual([
      { id: played.id, displayName: played.name, sharedGames: 1, lastSharedGameUpdatedAt: expect.any(String), connectedAt: null },
      { id: guest.id, displayName: guest.name, sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: expect.any(String) },
    ]);
    // Once the friends share a game, the old client sees them too.
    await call('POST', '/games', { credential: host.credential, body: { friendPlayerId: guest.id, requestId: randomUUID() } });
    expect((await oldOpponents(host)).map((o: { id: string }) => o.id)).toEqual([guest.id, played.id]);
    expect((await oldOpponents(guest)).map((o: { id: string }) => o.id)).toEqual([host.id]);
  });

  it('keeps game invitations as they were: joining a game connects nobody for good', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const { game, token } = await startGame(arne, harald);
    expect(await connections(arne, harald)).toHaveLength(0);
    // A game link is not a friend link, and the other way round.
    expect(await preview(token)).toMatchObject(UNAVAILABLE);
    const friendToken = (await invite(arne)).body.invitation.token;
    const wrong = await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: friendToken } });
    expect(wrong.status).toBe(404);
    expect((await preview(friendToken)).status).toBe(200);
    expect(game.status).toBe('active');
  });
});

describe('deleting the last shared game of connected friends', () => {
  const finished = async (white: TestPlayer, black: TestPlayer) => {
    const { game } = await startGame(white, black);
    await resign(black, game.id, game.revision);
    return game.id as string;
  };
  const deletion = (p: TestPlayer, gameId: string) => call('GET', `/games/${gameId}/deletion${ALL}`, { credential: p.credential });
  const remove = (p: TestPlayer, gameId: string, warned: string[]) =>
    call('DELETE', `/games/${gameId}${ALL}&warned=${warned.join(',')}`, { credential: p.credential });

  it('warns about nobody, deletes, and both stay in Play with and can start again', async () => {
    const { host, guest } = await friends();
    const gameId = await finished(host, guest);
    expect((await deletion(guest, gameId)).body.deletion.removesFromPlayWith).toEqual([]);
    expect((await remove(guest, gameId, [])).status).toBe(200);
    expect(await opponents(host)).toEqual([{ id: guest.id, displayName: guest.name, sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: expect.any(String) }]);
    expect(await oldOpponents(host)).toEqual([]); // an old client: nobody without a shared game
    const again = await call('POST', `/games${ALL}`, { credential: guest.credential, body: { friendPlayerId: host.id, requestId: randomUUID() } });
    expect(again.status).toBe(201);
  });

  it('still warns about people who only share that game, at the same table as a connected friend', async () => {
    const { host, guest } = await friends();
    const third = await newPlayer('William');
    await startGame(host, third); // so the host may seat William
    const table = await call('POST', `/games${ALL}`, {
      credential: host.credential,
      body: { type: 'yatzy', mode: 'free', friendPlayerIds: [guest.id, third.id], requestId: randomUUID() },
    });
    expect(table.status).toBe(201);
    // Stored as finished, as the API would leave it: only the warning is under test here.
    const done = await import('../../supabase/functions/_shared/yatzy/fixtures').then((f) => f.completeGame('free', 3));
    await sql`update games set status = 'finished', result = 'scored', termination = 'scorecards-complete', revision = ${done.log.length},
                     payload = ${sql.json({ mode: done.mode, players: done.players, log: done.log } as never)}
               where id = ${table.body.game.id}`;
    // Harald: connected to the host (stays), shares only this table with William (leaves).
    const asked = await deletion(guest, table.body.game.id);
    expect(asked.body.deletion.removesFromPlayWith).toEqual([{ id: third.id, displayName: third.name }]);
    // Accepting a friend link while the confirmation is open changes who is affected: asked again.
    const link = (await invite(third)).body.invitation.token;
    await accept(guest, link);
    const stale = await remove(guest, table.body.game.id, [third.id]);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'deletion_changed', deletion: { removesFromPlayWith: [] } });
    expect((await remove(guest, table.body.game.id, [])).status).toBe(200);
    expect((await opponents(guest)).map((o: { id: string }) => o.id).sort()).toEqual([host.id, third.id].sort());
  });
});

describe('the recipient email of a pending game invitation', () => {
  const who = (p: TestPlayer | undefined, gameId: string, query = ALL) => call('GET', `/games/${gameId}/invitation${query}`, { credential: p?.credential });

  it('is shown to the creator only, while nobody has joined, and never in a game view', async () => {
    const [arne, harald, outsider] = [await newPlayer('Arne'), await newPlayer('Harald'), await newPlayer('Outsider')];
    // The recipient need not be a player at all.
    const typed = `Someone.New-${randomUUID().slice(0, 8)}@Example.test`;
    const waiting = await call('POST', `/games${ALL}`, { credential: arne.credential, body: { friendEmail: typed } });
    const gameId = waiting.body.game.id as string;
    const shown = await who(arne, gameId);
    expect(shown).toEqual({ status: 200, body: { invitation: { gameId, invitedEmail: typed.toLowerCase(), createdAt: expect.any(String) } } });
    expect((await who(arne, gameId, '')).status).toBe(200); // a chess-only client as well

    for (const refused of [await who(outsider, gameId), await who(harald, gameId), await who(arne, randomUUID()), await who(arne, 'nope')]) {
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('game_not_found');
      expect(JSON.stringify(refused.body)).not.toContain('xample.test');
    }
    expect((await who(undefined, gameId)).status).toBe(401);
    // Not in the game view, the list, the picker, or what the link's holder gets.
    for (const response of [
      await call('GET', `/games/${gameId}${ALL}`, { credential: arne.credential }),
      await call('GET', `/games${ALL}`, { credential: arne.credential }),
      await call('GET', '/opponents?friends=1', { credential: arne.credential }),
    ]) {
      expect(JSON.stringify(response.body).toLowerCase()).not.toContain(typed.toLowerCase());
    }
  });

  it('is refused to the player who joined, and gone once they have', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const created = await call('POST', `/games${ALL}`, { credential: arne.credential, body: { friendEmail: harald.email } });
    const gameId = created.body.game.id as string;
    expect((await who(arne, gameId)).body.invitation.invitedEmail).toBe(harald.email);
    const joined = await call('POST', `/invitations/redeem${ALL}`, { credential: harald.credential, body: { token: created.body.invitation.token } });
    expect(JSON.stringify(joined.body)).not.toContain(harald.email);
    const guest = await who(harald, gameId);
    expect(guest.status).toBe(403);
    expect(guest.body.error.code).toBe('not_creator');
    const after = await who(arne, gameId);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('invitation_used');
    expect(JSON.stringify([guest.body, after.body])).not.toContain(harald.email);
    // A game started by name has no invitation; a table has none either.
    const direct = await call('POST', `/games${ALL}`, { credential: arne.credential, body: { friendPlayerId: harald.id, requestId: randomUUID() } });
    expect((await who(arne, direct.body.game.id)).status).toBe(409);
    const table = await call('POST', `/games${ALL}`, {
      credential: arne.credential,
      body: { type: 'yatzy', mode: 'free', friendPlayerIds: [harald.id], requestId: randomUUID() },
    });
    expect((await who(arne, table.body.game.id)).status).toBe(409);
    expect((await who(arne, table.body.game.id, '')).status).toBe(422); // a client that did not ask for tables
  });

  it('works for a waiting game stored before this change', async () => {
    const arne = await newPlayer('Arne');
    const created = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: 'old-friend@example.test' } });
    const gameId = created.body.game.id as string;
    await sql`update games set created_at = now() - interval '60 days', updated_at = now() - interval '60 days' where id = ${gameId}`;
    await sql`update game_invitations set created_at = now() - interval '60 days' where game_id = ${gameId}`;
    const shown = await who(arne, gameId);
    expect(shown.status).toBe(200);
    expect(shown.body.invitation.invitedEmail).toBe('old-friend@example.test');
    // A game invitation never expires: the old link still seats a friend.
    const harald = await newPlayer('Harald');
    expect((await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: created.body.invitation.token } })).status).toBe(200);
  });
});
