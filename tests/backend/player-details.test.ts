// Player details (#113), against the real local backend. The site builds the view from answers
// the player already gets: `/me` for their own details, their own Play with list for anyone
// else. So the access rules are checked here through the API: a player's email goes to that
// player alone, connected players are found by name and shared context only, and an outsider
// cannot be looked up at all. The creator-only recipient email of a pending game invitation is
// covered in friend-invitations.test.ts.
import { describe, expect, it } from 'vitest';
import { call, newPlayer, randomUUID, startGame, type TestPlayer } from './client';

const ALL = '?types=chess,chess960,yatzy';
const get = (p: TestPlayer | undefined, path: string) => call('GET', path, { credential: p?.credential });

describe('your own details', () => {
  it('give the signed-in player their own name and email, and nobody without their credential anything', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    expect(await get(arne, '/me')).toEqual({ status: 200, body: { player: { id: arne.id, displayName: arne.name, email: arne.email } } });
    const theirs = await get(harald, '/me');
    expect(theirs.body.player.email).toBe(harald.email);
    expect(JSON.stringify(theirs.body)).not.toContain(arne.email);
    for (const refused of [await get(undefined, '/me'), await call('GET', '/me', { credential: 'x'.repeat(43) })]) {
      expect(refused.status).toBe(401);
      expect(JSON.stringify(refused.body)).not.toContain('example.test');
    }
  });
});

describe('details about another player', () => {
  it('come from your own list: name and what you share, for friends and people you played, never an email', async () => {
    const [arne, friend, played, outsider] = [await newPlayer('Arne'), await newPlayer('Friend'), await newPlayer('Played'), await newPlayer('Outsider')];
    const link = await call('POST', '/friend-invitations', { credential: arne.credential, body: { requestId: randomUUID() } });
    const accepted = await call('POST', '/friend-invitations/accept', { credential: friend.credential, body: { token: link.body.invitation.token } });
    expect(accepted.status).toBe(200);
    const { game } = await startGame(arne, played);

    const list = await get(arne, '/opponents?friends=1');
    expect(list.status).toBe(200);
    const byId = new Map<string, Record<string, unknown>>(list.body.opponents.map((o: { id: string }) => [o.id, o]));
    // Exactly these fields: nothing to show beyond them, so the view invents nothing.
    expect(byId.get(friend.id)).toEqual({ id: friend.id, displayName: friend.name, sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: expect.any(String) });
    expect(byId.get(played.id)).toEqual({ id: played.id, displayName: played.name, sharedGames: 1, lastSharedGameUpdatedAt: expect.any(String), connectedAt: null });
    expect(byId.has(outsider.id)).toBe(false);
    expect(byId.has(arne.id)).toBe(false);

    // The other side sees the same of Arne, and not each other: the two never met.
    for (const other of [friend, played]) {
      const theirs = (await get(other, '/opponents?friends=1')).body.opponents as { id: string }[];
      expect(theirs.map((o) => o.id)).toEqual([arne.id]);
    }
    expect((await get(outsider, '/opponents?friends=1')).body.opponents).toEqual([]);

    // No answer about other people carries anybody's email, to anyone.
    const everyone = [arne, friend, played, outsider];
    for (const reader of everyone) {
      const answers = [
        await get(reader, '/opponents?friends=1'),
        await get(reader, '/opponents'),
        await get(reader, `/games${ALL}`),
        await get(reader, `/history${ALL}`),
        await get(reader, `/games/${game.id}${ALL}`),
        await get(reader, '/friend-invitations'),
        await call('POST', '/friend-invitations/preview', { credential: reader.credential, body: { token: link.body.invitation.token } }),
      ];
      const text = JSON.stringify(answers.map((a) => a.body)).toLowerCase();
      for (const player of everyone) expect(text).not.toContain(player.email.toLowerCase());
      expect(text).not.toContain('example.test');
    }
    expect(JSON.stringify(accepted.body)).not.toContain('example.test');
  });

  it('cannot be asked for by player ID: there is no such lookup, for a friend or a stranger', async () => {
    const [arne, friend, outsider] = [await newPlayer('Arne'), await newPlayer('Friend'), await newPlayer('Outsider')];
    const link = await call('POST', '/friend-invitations', { credential: arne.credential, body: { requestId: randomUUID() } });
    await call('POST', '/friend-invitations/accept', { credential: friend.credential, body: { token: link.body.invitation.token } });
    for (const target of [friend, outsider, arne]) {
      for (const path of [`/players/${target.id}`, `/players/${target.id}/details`, `/opponents/${target.id}`, `/me/${target.id}`]) {
        const answer = await get(arne, path);
        expect([404, 405], path).toContain(answer.status);
        expect(JSON.stringify(answer.body)).not.toContain('example.test');
        expect(JSON.stringify(answer.body)).not.toContain(target.name);
      }
    }
  });
});
