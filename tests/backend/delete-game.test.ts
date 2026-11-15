// Deleting finished games (#93), against the real local backend: any participant, finished games
// only, for everyone; what goes and what stays; rematches; retries; late creation retries; and
// who would leave "Play with".
import { afterAll, describe, expect, it } from 'vitest';
import { completeGame } from '../../supabase/functions/_shared/yatzy/fixtures';
import { replay, ROWS, type YatzyRecord } from '../../supabase/functions/_shared/yatzy/rules';
import { call, db, newPlayer, randomUUID, startGame, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

const ALL = '?types=chess,chess960,yatzy';
const CHESS = '?types=chess,chess960';

const remove = (p: TestPlayer, gameId: string, query = ALL) => call('DELETE', `/games/${gameId}${query}`, { credential: p.credential });
const preview = (p: TestPlayer, gameId: string, query = ALL) => call('GET', `/games/${gameId}/deletion${query}`, { credential: p.credential });
const read = (p: TestPlayer, gameId: string) => call('GET', `/games/${gameId}${ALL}`, { credential: p.credential });
const list = async (p: TestPlayer) => (await call('GET', `/games${ALL}`, { credential: p.credential })).body.games.map((g: { id: string }) => g.id) as string[];
const history = async (p: TestPlayer) => (await call('GET', `/history${ALL}`, { credential: p.credential })).body;
const opponents = async (p: TestPlayer) =>
  (await call('GET', '/opponents', { credential: p.credential })).body.opponents.map((o: { id: string }) => o.id) as string[];
const act = (p: TestPlayer, gameId: string, revision: number, action: unknown) =>
  call('POST', `/games/${gameId}/actions${ALL}`, { credential: p.credential, body: { requestId: randomUUID(), expectedRevision: revision, action } });
const rematch = (p: TestPlayer, gameId: string) => call('POST', `/games/${gameId}/rematch${ALL}`, { credential: p.credential });
const rowsOf = async (gameId: string) =>
  (
    await sql`
      select (select count(*)::int from games where id = ${gameId}) as games,
             (select count(*)::int from game_participants where game_id = ${gameId}) as seats,
             (select count(*)::int from game_invitations where game_id = ${gameId}) as invitations,
             (select count(*)::int from game_actions where game_id = ${gameId}) as actions`
  )[0];
/** A hash of a game's own row and everything hanging on it: proof it was not touched. */
const hashOf = async (gameId: string) =>
  (
    await sql`
      select md5(
        coalesce((select g::text from games g where id = ${gameId}), '') ||
        coalesce((select string_agg(p::text, '|' order by seat) from game_participants p where game_id = ${gameId}), '') ||
        coalesce((select string_agg(i::text, '|') from game_invitations i where game_id = ${gameId}), '') ||
        coalesce((select string_agg(a::text, '|' order by id) from game_actions a where game_id = ${gameId}), '')) as h`
  )[0].h as string;

/** A chess-family game between two players, finished by Black resigning after one move. */
async function finishedChess(white: TestPlayer, black: TestPlayer, type = 'chess') {
  const created = await call('POST', `/games${ALL}`, { credential: white.credential, body: { friendEmail: black.email, type } });
  const joined = await call('POST', `/invitations/redeem${ALL}`, { credential: black.credential, body: { token: created.body.invitation.token } });
  const over = await act(black, joined.body.game.id, joined.body.game.revision, { type: 'resign' });
  expect(over.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'resignation' });
  return over.body.game.id as string;
}

/** A Yatzy table stored as the API leaves it after `record` (dice cannot be asked to finish quickly). */
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

describe('deleting a finished game', () => {
  it('any participant, not only the creator, deletes a chess game finished by resignation, for everyone', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const other = await startGame(arne, harald); // an ongoing game between the same two
    const gameId = await finishedChess(arne, harald);
    expect(await rowsOf(gameId)).toEqual({ games: 1, seats: 2, invitations: 1, actions: 1 });
    expect((await history(arne)).history[0]).toMatchObject({ wins: 1, losses: 0, games: [{ id: gameId }] });
    expect((await history(harald)).history[0]).toMatchObject({ wins: 0, losses: 1 });
    const otherBefore = await hashOf(other.game.id);

    // Harald was invited (he did not create the game) and lost it; he may still delete it.
    const deleted = await remove(harald, gameId);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, gameId, removesFromPlayWith: [] });

    // Gone for both, on every path: its page, the lists, history and the tally.
    for (const player of [arne, harald]) {
      const opened = await read(player, gameId);
      expect(opened.status).toBe(404);
      expect(opened.body.error.code).toBe('game_not_found');
      expect(await list(player)).toEqual([other.game.id]);
      expect((await history(player)).history).toEqual([]);
      expect((await act(player, gameId, 2, { type: 'resign' })).status).toBe(404);
      expect((await rematch(player, gameId)).status).toBe(404);
    }
    // The game and everything that hung on it, and nothing else.
    expect(await rowsOf(gameId)).toEqual({ games: 0, seats: 0, invitations: 0, actions: 0 });
    expect(await hashOf(other.game.id)).toBe(otherBefore);
    expect((await sql`select count(*)::int as n from players where id in (${arne.id}, ${harald.id})`)[0].n).toBe(2);
    expect((await call('GET', '/me', { credential: harald.credential })).status).toBe(200);
    // They still share the other game, so they still find each other in "Play with".
    expect(await opponents(arne)).toEqual([harald.id]);
  });

  it('deletes a finished Fischer Random game and a finished Yatzy table, by a guest', async () => {
    const [host, a, b] = [await newPlayer('Host'), await newPlayer('GuestA'), await newPlayer('GuestB')];
    await startGame(host, a);
    await startGame(host, b);
    const fischer = await finishedChess(host, a, 'chess960');
    expect((await read(a, fischer)).body.game).toMatchObject({ type: 'chess960', status: 'finished', canDelete: true });
    expect((await remove(a, fischer)).status).toBe(200);
    expect((await read(host, fischer)).status).toBe(404);

    const table = await storedTable([host, a, b], completeGame('free', 3));
    for (const player of [host, a, b]) expect((await history(player)).tables.map((t: { id: string }) => t.id)).toEqual([table]);
    expect((await read(b, table)).body.game).toMatchObject({ type: 'yatzy', status: 'finished', yourSeat: 'p3', canDelete: true });
    const deleted = await remove(b, table);
    expect(deleted.status).toBe(200);
    // The two guests met only at this table: each leaves the other's "Play with".
    expect(deleted.body.removesFromPlayWith).toEqual([{ id: a.id, displayName: a.name }]);
    for (const player of [host, a, b]) {
      expect((await read(player, table)).status).toBe(404);
      expect((await history(player)).tables).toEqual([]);
      expect(await list(player)).not.toContain(table);
    }
    expect(await rowsOf(table)).toEqual({ games: 0, seats: 0, invitations: 0, actions: 0 });
  });

  it('says in the view whether the game can be deleted: finished yes, waiting and active no', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const waiting = await call('POST', `/games${ALL}`, { credential: arne.credential, body: { friendEmail: `nobody-${randomUUID()}@example.test` } });
    const active = await startGame(arne, harald);
    const finished = await finishedChess(arne, harald);
    expect(waiting.body.game.canDelete).toBe(false);
    expect((await read(arne, active.game.id)).body.game.canDelete).toBe(false);
    expect((await read(harald, finished)).body.game.canDelete).toBe(true);
    const listed = (await call('GET', `/games${ALL}`, { credential: arne.credential })).body.games;
    expect(Object.fromEntries(listed.map((g: { id: string; canDelete: boolean }) => [g.id, g.canDelete]))).toEqual({
      [waiting.body.game.id]: false,
      [active.game.id]: false,
      [finished]: true,
    });
  });
});

describe('what cannot be deleted', () => {
  it('refuses waiting and active games of every type, also straight through the API, changing nothing', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    const waiting = (await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendEmail: `nobody-${randomUUID()}@example.test` } })).body.game.id;
    const activeChess = (await startGame(host, guest)).game.id;
    const fischer = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, type: 'chess960' } });
    const table = await call('POST', `/games${ALL}`, { credential: host.credential, body: { type: 'yatzy', mode: 'free', friendPlayerIds: [guest.id] } });
    for (const gameId of [waiting, activeChess, fischer.body.game.id, table.body.game.id] as string[]) {
      const before = await hashOf(gameId);
      for (const player of gameId === waiting ? [host] : [host, guest]) {
        for (const attempt of [await remove(player, gameId), await preview(player, gameId)]) {
          expect(attempt.status).toBe(409);
          expect(attempt.body.error.code).toBe('not_finished');
        }
      }
      expect(await hashOf(gameId)).toBe(before);
      expect((await read(host, gameId)).status).toBe(200);
    }
  });

  it('gives someone who is not at the game the same answer as for a game that does not exist', async () => {
    const [arne, harald, outsider] = [await newPlayer('Arne'), await newPlayer('Harald'), await newPlayer('Outsider')];
    await startGame(outsider, arne); // knows a participant, but is not in this game
    const gameId = await finishedChess(arne, harald);
    const before = await hashOf(gameId);
    const answers = [
      await remove(outsider, gameId),
      await preview(outsider, gameId),
      await remove(outsider, randomUUID()),
      await preview(arne, randomUUID()),
      await remove(arne, 'not-a-game'),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body.error).toEqual({ code: 'game_not_found', message: 'Game not found.' });
    }
    expect((await call('DELETE', `/games/${gameId}${ALL}`, {})).status).toBe(401);
    expect(await hashOf(gameId)).toBe(before);
    expect((await read(harald, gameId)).status).toBe(200);
  });

  it('a client that cannot show the game cannot delete it', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    await startGame(host, guest);
    const table = await storedTable([host, guest], completeGame('forced', 2));
    for (const query of ['', '?types=chess', CHESS]) {
      for (const attempt of [await remove(host, table, query), await preview(host, table, query)]) {
        expect(attempt.status).toBe(422);
        expect(attempt.body.error.code).toBe('unsupported_game');
      }
    }
    expect((await read(guest, table)).status).toBe(200);
  });
});

describe('repeating a deletion', () => {
  it('a second request finds nothing, and four at once delete exactly once', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const first = await finishedChess(arne, harald);
    expect((await remove(arne, first)).status).toBe(200);
    for (const player of [arne, harald]) {
      const again = await remove(player, first); // the reply was lost: the retry has no further effect
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe('game_not_found');
    }
    const second = await finishedChess(arne, harald);
    const kept = await finishedChess(arne, harald);
    const keptBefore = await hashOf(kept);
    const answers = await Promise.all([remove(arne, second), remove(harald, second), remove(arne, second), remove(harald, second)]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 404, 404, 404]);
    expect(await hashOf(kept)).toBe(keptBefore);
    expect((await history(arne)).history[0]).toMatchObject({ wins: 1, games: [{ id: kept }] });
  });
});

describe('rematches', () => {
  it('an active or finished rematch survives its source as a game of its own, unchanged', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    // Source → an active rematch.
    const source = await finishedChess(arne, harald);
    const active = (await rematch(harald, source)).body.game;
    await act(harald, active.id, active.revision, { type: 'move', from: 'e2', to: 'e4' });
    const activeBefore = await read(arne, active.id);
    expect((await remove(arne, source)).status).toBe(200);
    expect((await read(arne, active.id)).body).toEqual(activeBefore.body);
    expect((await sql`select rematch_of, status, revision from games where id = ${active.id}`)[0]).toMatchObject({ rematch_of: null, status: 'active', revision: 1 });
    // It is still played and finished as usual.
    const over = await act(arne, active.id, 1, { type: 'resign' });
    expect(over.body.game).toMatchObject({ status: 'finished', result: 'white' });

    // Source → a finished rematch: every other column of the finished rematch stays as it was.
    const source2 = await finishedChess(arne, harald);
    const second = (await rematch(arne, source2)).body.game;
    await act(arne, second.id, second.revision, { type: 'resign' });
    const [before] = await sql`select (to_jsonb(g) - 'rematch_of')::text as row, rematch_of from games g where id = ${second.id}`;
    expect(before.rematch_of).toBe(source2);
    expect((await remove(harald, source2)).status).toBe(200);
    const [after] = await sql`select (to_jsonb(g) - 'rematch_of')::text as row, rematch_of from games g where id = ${second.id}`;
    expect(after).toEqual({ row: before.row, rematch_of: null });
    const tally = (await history(arne)).history[0];
    expect(tally.games.map((g: { id: string }) => g.id).sort()).toEqual([active.id, second.id].sort());
  });

  it('deleting a finished rematch makes Play again available on its source', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const source = await finishedChess(arne, harald);
    const first = (await rematch(arne, source)).body.game;
    await act(harald, first.id, first.revision, { type: 'resign' });
    expect((await read(arne, source)).body.game.rematchGameId).toBe(first.id);
    const sourceBefore = await hashOf(source);

    expect((await remove(arne, first.id)).status).toBe(200);
    expect(await hashOf(source)).toBe(sourceBefore);
    expect((await read(harald, source)).body.game.rematchGameId).toBeNull();
    const again = await rematch(harald, source);
    expect(again.status).toBe(201);
    expect(again.body.game.id).not.toBe(first.id);
    expect((await read(arne, source)).body.game.rematchGameId).toBe(again.body.game.id);
  });

  it('Play again and Delete at the same moment end coherently: the rematch survives, or it was refused', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const outcomes = new Set<string>();
    for (let round = 0; round < 8; round++) {
      const source = await finishedChess(arne, harald);
      const [played, deleted] = round % 2 ? await Promise.all([rematch(harald, source), remove(arne, source)]) : (await Promise.all([remove(arne, source), rematch(harald, source)])).reverse();
      expect(deleted.status).toBe(200);
      expect([201, 404]).toContain(played.status);
      outcomes.add(String(played.status));
      expect(await rowsOf(source)).toEqual({ games: 0, seats: 0, invitations: 0, actions: 0 });
      const orphans = await sql`select id from games where rematch_of = ${source}`;
      expect(orphans).toHaveLength(0);
      if (played.status === 201) {
        // The rematch exists on its own, both seated, and is playable.
        const game = (await read(arne, played.body.game.id)).body.game;
        expect(game).toMatchObject({ status: 'active', players: { white: { id: harald.id }, black: { id: arne.id } } });
        expect((await act(harald, game.id, game.revision, { type: 'move', from: 'd2', to: 'd4' })).status).toBe(200);
      } else {
        expect(played.body.error.code).toBe('game_not_found');
      }
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  });
});

describe('a creation retried after its game was deleted', () => {
  const finishTable = async (players: TestPlayer[], gameId: string) => {
    let game = (await read(players[0], gameId)).body.game;
    while (game.status !== 'finished') {
      const seat = Number(game.turn.slice(1)) - 1;
      if (game.yatzy.turn.throws === 0) game = (await act(players[seat], gameId, game.revision, { type: 'throw', keep: [] })).body.game;
      const row = ROWS.find((r) => game.yatzy.players[seat].scores[r] === undefined);
      game = (await act(players[seat], gameId, game.revision, { type: 'score', row })).body.game;
    }
  };

  it('is answered 410 game_deleted for an email invitation, a direct start and a Yatzy table, creating nothing', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    await startGame(host, guest);
    const create = (body: Record<string, unknown>) => call('POST', `/games${ALL}`, { credential: host.credential, body });

    const requests: Record<string, unknown>[] = [
      { friendEmail: guest.email, type: 'chess', requestId: randomUUID() },
      { friendPlayerId: guest.id, type: 'chess960', requestId: randomUUID() },
      { type: 'yatzy', mode: 'forced', friendPlayerIds: [guest.id], requestId: randomUUID() },
    ];
    for (const request of requests) {
      const created = await create(request);
      expect(created.status).toBe(201);
      const gameId = created.body.game.id as string;
      if (request.type === 'yatzy') {
        await finishTable([host, guest], gameId);
      } else {
        if (created.body.invitation) await call('POST', `/invitations/redeem${ALL}`, { credential: guest.credential, body: { token: created.body.invitation.token } });
        const game = (await read(guest, gameId)).body.game;
        await act(guest, gameId, game.revision, { type: 'resign' });
      }
      // Before deletion a retry finds the game, as always.
      expect((await create(request)).body).toMatchObject({ duplicate: true, game: { id: gameId } });
      expect((await remove(guest, gameId)).status).toBe(200);

      const games = (await sql`select count(*)::int as n from games where created_by = ${host.id}`)[0].n;
      for (const late of [await create(request), await create(request)]) {
        expect(late.status).toBe(410);
        expect(late.body.error).toEqual({ code: 'game_deleted', message: 'That game was deleted. Start a new one if you want to play again.' });
      }
      // The same ID for anything else is told the same: that ID belonged to a game now deleted.
      expect((await create({ friendEmail: `else-${randomUUID()}@example.test`, requestId: request.requestId })).status).toBe(410);
      expect((await sql`select count(*)::int as n from games where created_by = ${host.id}`)[0].n).toBe(games);
      // A deliberate new start, with a fresh request ID, works.
      const fresh = await create({ ...request, requestId: randomUUID() });
      expect(fresh.status).toBe(201);
      expect(fresh.body.game.id).not.toBe(gameId);
    }
    // Only the creator and the request ID are kept of a deleted game.
    const kept = await sql`select created_by, create_request_id from deleted_game_requests where created_by = ${host.id}`;
    expect(kept.map((k) => k.create_request_id).sort()).toEqual(requests.map((r) => r.requestId).sort());
    expect((await sql`select column_name from information_schema.columns where table_name = 'deleted_game_requests' order by 1`).map((c) => c.column_name)).toEqual([
      'create_request_id',
      'created_by',
      'deleted_at',
    ]);
  });

  it('says game_deleted, not opponent_not_found, when the pair’s only other game is deleted too', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    const first = await finishedChess(host, guest);
    const request = { friendPlayerId: guest.id, requestId: randomUUID() };
    const started = await call('POST', `/games${ALL}`, { credential: host.credential, body: request });
    await act(guest, started.body.game.id, started.body.game.revision, { type: 'resign' });
    expect((await remove(guest, started.body.game.id)).status).toBe(200);
    expect((await remove(guest, first)).status).toBe(200);
    expect(await opponents(host)).toEqual([]);

    const late = await call('POST', `/games${ALL}`, { credential: host.credential, body: request });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('game_deleted');
    // A deliberate new start now needs an invitation again: they share no game.
    const fresh = await call('POST', `/games${ALL}`, { credential: host.credential, body: { ...request, requestId: randomUUID() } });
    expect(fresh.status).toBe(404);
    expect(fresh.body.error.code).toBe('opponent_not_found');
  });

  it('a retry racing the deletion finds the game or is told it was deleted; it never makes it again', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    await startGame(host, guest);
    for (let round = 0; round < 8; round++) {
      const request = { friendPlayerId: guest.id, requestId: randomUUID() };
      const started = await call('POST', `/games${ALL}`, { credential: host.credential, body: request });
      const gameId = started.body.game.id as string;
      await act(guest, gameId, started.body.game.revision, { type: 'resign' });
      const retry = () => call('POST', `/games${ALL}`, { credential: host.credential, body: request });
      const [a, gone, b, c] = await Promise.all([retry(), remove(guest, gameId), retry(), retry()]);
      expect(gone.status).toBe(200);
      for (const answer of [a, b, c]) {
        expect([200, 410]).toContain(answer.status);
        if (answer.status === 200) expect(answer.body).toMatchObject({ duplicate: true, game: { id: gameId } });
        else expect(answer.body.error.code).toBe('game_deleted');
      }
      expect((await retry()).status).toBe(410);
      expect(await sql`select id from games where created_by = ${host.id} and create_request_id = ${request.requestId}`).toHaveLength(0);
    }
  });

  it('keeps request_id_reused for surviving games, and one player’s deleted request never blocks another’s', async () => {
    const [host, guest] = [await newPlayer('Host'), await newPlayer('Guest')];
    await startGame(host, guest);
    const requestId = randomUUID();
    const surviving = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, requestId } });
    expect(surviving.status).toBe(201);
    const conflicting = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, type: 'chess960', requestId } });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('request_id_reused');

    // The host deletes a game created under some ID; the guest happens to use the same ID.
    const shared = randomUUID();
    const mine = await call('POST', `/games${ALL}`, { credential: host.credential, body: { friendPlayerId: guest.id, requestId: shared } });
    await act(guest, mine.body.game.id, mine.body.game.revision, { type: 'resign' });
    expect((await remove(host, mine.body.game.id)).status).toBe(200);
    const theirs = await call('POST', `/games${ALL}`, { credential: guest.credential, body: { friendPlayerId: host.id, requestId: shared } });
    expect(theirs.status).toBe(201);
    // A game created without a request ID leaves nothing behind.
    const before = (await sql`select count(*)::int as n from deleted_game_requests where created_by = ${host.id}`)[0].n;
    const plain = await finishedChess(host, guest);
    expect((await remove(host, plain)).status).toBe(200);
    expect((await sql`select count(*)::int as n from deleted_game_requests where created_by = ${host.id}`)[0].n).toBe(before);
  });
});

describe('the last shared game', () => {
  it('names who would leave Play with, by the picker’s own rule, before and when deleting', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const only = await finishedChess(arne, harald);
    for (const [me, other] of [[arne, harald], [harald, arne]]) {
      const asked = await preview(me, only);
      expect(asked.status).toBe(200);
      expect(asked.body).toEqual({ deletion: { gameId: only, removesFromPlayWith: [{ id: other.id, displayName: other.name }] } });
    }
    expect(await hashOf(only)).toBeTruthy(); // asking changed nothing
    expect((await read(arne, only)).status).toBe(200);

    const deleted = await remove(arne, only);
    expect(deleted.body.removesFromPlayWith).toEqual([{ id: harald.id, displayName: harald.name }]);
    // And so it is: neither finds the other, and a direct start is refused until they share a game again.
    expect(await opponents(arne)).toEqual([]);
    expect(await opponents(harald)).toEqual([]);
    const direct = await call('POST', `/games${ALL}`, { credential: arne.credential, body: { friendPlayerId: harald.id } });
    expect(direct.body.error.code).toBe('opponent_not_found');
    await startGame(arne, harald);
    expect(await opponents(arne)).toEqual([harald.id]);
  });

  it('names nobody when every co-player is still shared through another game, of any status or type', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const finished = await finishedChess(arne, harald);
    await call('POST', `/games${ALL}`, { credential: arne.credential, body: { type: 'yatzy', mode: 'free', friendPlayerIds: [harald.id] } }); // an active table
    expect((await preview(arne, finished)).body.deletion.removesFromPlayWith).toEqual([]);
    expect((await remove(harald, finished)).body.removesFromPlayWith).toEqual([]);
    expect(await opponents(arne)).toEqual([harald.id]);
  });

  it('at a group table names only the co-players who would drop out, for each requester', async () => {
    const [host, a, b, c] = [await newPlayer('Host'), await newPlayer('GuestA'), await newPlayer('GuestB'), await newPlayer('GuestC')];
    const table = await storedTable([host, a, b, c], completeGame('free', 4));
    // Besides the table: the host shares a chess game with A; A and B share one; nobody else does.
    await startGame(host, a);
    await startGame(a, b);
    const names = async (p: TestPlayer) => (await preview(p, table)).body.deletion.removesFromPlayWith.map((o: { displayName: string }) => o.displayName);
    expect(await names(host)).toEqual([b.name, c.name]);
    expect(await names(a)).toEqual([c.name]);
    expect(await names(b)).toEqual([host.name, c.name]);
    expect(await names(c)).toEqual([host.name, a.name, b.name]);

    const deleted = await remove(a, table);
    expect(deleted.body.removesFromPlayWith).toEqual([{ id: c.id, displayName: c.name }]);
    expect((await opponents(host)).sort()).toEqual([a.id].sort());
    expect((await opponents(a)).sort()).toEqual([host.id, b.id].sort());
    expect(await opponents(c)).toEqual([]);
  });
});

describe('finished games that stay', () => {
  it('are still frozen: only a rematch link going to null may change, alone', async () => {
    const [arne, harald] = [await newPlayer('Arne'), await newPlayer('Harald')];
    const source = await finishedChess(arne, harald);
    const second = (await rematch(arne, source)).body.game;
    await act(arne, second.id, second.revision, { type: 'resign' });
    const other = await finishedChess(arne, harald);
    const before = await hashOf(second.id);
    const refused = (statement: Promise<unknown>) => expect(statement).rejects.toThrow(/is finished and cannot be changed/);
    await refused(sql`update games set payload = '{}' where id = ${second.id}`);
    await refused(sql`update games set result = 'draw' where id = ${second.id}`);
    await refused(sql`update games set revision = revision + 1 where id = ${second.id}`);
    await refused(sql`update games set rematch_of = null, updated_at = now() where id = ${second.id}`);
    await refused(sql`update games set rematch_of = null, result = 'draw' where id = ${second.id}`);
    await refused(sql`update games set rematch_of = ${other} where id = ${second.id}`);
    await refused(sql`update games set rematch_of = ${second.id} where id = ${other}`);
    expect(await hashOf(second.id)).toBe(before);
  });
});
