// Fischer Random (Chess960) through the real API (#54). Starts are random, so tests that need
// a particular position set the saved start of a new game directly (a fixture) and then play
// through the API like any client.
import { afterAll, describe, expect, it } from 'vitest';
import { startFen } from '../../supabase/functions/_shared/chess960/start';
import { call, db, newPlayer, randomUUID, type TestPlayer } from './client';

const sql = db();
afterAll(() => sql.end());

/** A client that reads both types, as the web client will from #55. */
const BOTH = '?types=chess,chess960';
const ALL_STARTS = new Set(Array.from({ length: 960 }, (_, i) => startFen(i)));

// King b1 between rooks a1 and h1, both sides free to castle at once: O-O-O lands the king
// on c1, the same square as an ordinary king step.
const OPEN_CORNERS = 'rk5r/pppppppp/8/8/8/8/PPPPPPPP/RK5R w HAha - 0 1';

type Action = Record<string, unknown>;

function create(player: TestPlayer, friend: TestPlayer, body: Action = {}, query = BOTH) {
  return call('POST', `/games${query}`, {
    credential: player.credential,
    body: { friendEmail: friend.email, type: 'chess960', ...body },
  });
}

function act(player: TestPlayer, gameId: string, revision: number, action: Action, requestId = randomUUID(), query = BOTH) {
  return call('POST', `/games/${gameId}/actions${query}`, {
    credential: player.credential,
    body: { requestId, expectedRevision: revision, action },
  });
}

const castle = (side: 'kingside' | 'queenside') => ({ type: 'castle', side });
const move = (uci: string) => ({
  type: 'move',
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  ...(uci[4] ? { promotion: uci[4] } : {}),
});

/** A new Chess960 game, optionally from a fixture start; joined unless `join` is false. */
async function newGame(start?: string, { join = true } = {}) {
  const [white, black] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
  const created = await create(white, black);
  expect(created.status).toBe(201);
  const id = created.body.game.id as string;
  const token = created.body.invitation.token as string;
  if (start) await sql`update games set payload = ${sql.json({ initialFen: start, moves: [] })} where id = ${id}`;
  if (join) expect((await call('POST', `/invitations/redeem${BOTH}`, { credential: black.credential, body: { token } })).status).toBe(200);
  const game = (await call('GET', `/games/${id}${BOTH}`, { credential: white.credential })).body.game;
  return { white, black, id, token, game };
}

async function stored(gameId: string) {
  const [row] = await sql`select status, revision, result, termination, payload from games where id = ${gameId}`;
  const actions = await sql`select kind, move, revision from game_actions where game_id = ${gameId} order by revision`;
  return { ...row, actions: actions.map((a) => ({ ...a })) };
}

describe('creating Chess960', () => {
  it('saves one fair start before answering, and a retry never draws another', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const requestId = randomUUID();
    const first = await create(arne, harald, { requestId });
    expect(first.status).toBe(201);
    const game = first.body.game;
    expect(game).toMatchObject({ type: 'chess960', schemaVersion: 1, status: 'waiting', turn: 'white', moveCount: 0 });
    expect(game).not.toHaveProperty('chess');
    expect(game.chess960).toMatchObject({ moves: [], turn: 'white' });
    expect(ALL_STARTS.has(game.chess960.initialFen)).toBe(true);
    const [row] = await sql`select game_type, schema_version, payload from games where id = ${game.id}`;
    expect(row).toEqual({ game_type: 'chess960', schema_version: 1, payload: { initialFen: game.chess960.initialFen, moves: [] } });

    // The reply was lost: the retry finds the same game and start, with a new working link.
    const retry = await create(arne, harald, { requestId });
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ duplicate: true, game: { id: game.id, chess960: { initialFen: game.chess960.initialFen } } });
    expect(retry.body.invitation.token).not.toBe(first.body.invitation.token);
    const joined = await call('POST', `/invitations/redeem${BOTH}`, {
      credential: harald.credential,
      body: { token: retry.body.invitation.token },
    });
    expect(joined.body.game).toMatchObject({ id: game.id, status: 'active', chess960: { initialFen: game.chess960.initialFen } });

    // The same request ID for standard chess, or for another friend, is a different game:
    // refused, not answered with the wrong game, and its invitation is left alone.
    const invitation = () => sql`select token_hash, redeemed_by from game_invitations where game_id = ${game.id}`;
    const before = await invitation();
    const other = await newPlayer('Mallory');
    for (const body of [{ requestId, type: 'chess' }, { requestId, friendEmail: other.email }]) {
      const reused = await create(arne, harald, body);
      expect(reused.status).toBe(409);
      expect(reused.body.error.code).toBe('request_id_reused');
    }
    expect(await invitation()).toEqual(before);
    // The friend's email in other letter case is the same friend.
    const sameFriend = await create(arne, harald, { requestId, friendEmail: harald.email.toUpperCase() });
    expect(sameFriend.body).toMatchObject({ duplicate: true, game: { id: game.id }, invitation: null });
  });

  it('treats a standard-chess creation retry for another friend as a different game', async () => {
    const [arne, harald, other] = await Promise.all([newPlayer('Arne'), newPlayer('Harald'), newPlayer('Mallory')]);
    const requestId = randomUUID();
    const body = { friendEmail: harald.email, requestId };
    expect((await call('POST', '/games', { credential: arne.credential, body })).status).toBe(201);
    const reused = await call('POST', '/games', { credential: arne.credential, body: { ...body, friendEmail: other.email } });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('request_id_reused');
    expect((await call('POST', '/games', { credential: arne.credential, body })).body.duplicate).toBe(true);
  });

  it('creates one game when the same creation arrives twice at once', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const requestId = randomUUID();
    const answers = await Promise.all([create(arne, harald, { requestId }), create(arne, harald, { requestId })]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 201]);
    expect(answers[0].body.game.id).toBe(answers[1].body.game.id);
    expect(answers[0].body.game.chess960.initialFen).toBe(answers[1].body.game.chess960.initialFen);
    const [count] = await sql`select count(*)::int as n from games where created_by = ${arne.id}`;
    expect(count.n).toBe(1);
  });

  it('draws starts from the whole set', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    const games = await Promise.all(Array.from({ length: 12 }, () => create(arne, harald)));
    const starts = new Set(games.map((g) => g.body.game.chess960.initialFen));
    for (const start of starts) expect(ALL_STARTS.has(start)).toBe(true);
    // 12 draws from 960 are all alike with probability 960^-11; this only shows it is not fixed.
    expect(starts.size).toBeGreaterThan(1);
  });

  it('is only for clients that read it', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    for (const query of ['', '?types=chess']) {
      const refused = await create(arne, harald, {}, query);
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('unsupported_game_type');
    }
    const [count] = await sql`select count(*)::int as n from games where created_by = ${arne.id}`;
    expect(count.n).toBe(0);
  });
});

describe('a client that reads only chess (every client before #55)', () => {
  it('sees its chess games and history as before, and is refused the Chess960 ones without changes', async () => {
    const [arne, harald] = await Promise.all([newPlayer('Arne'), newPlayer('Harald')]);
    // A finished chess game and a finished and an open Chess960 game against the same friend.
    const chess = await call('POST', '/games', { credential: arne.credential, body: { friendEmail: harald.email } });
    await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: chess.body.invitation.token } });
    await act(harald, chess.body.game.id, 1, { type: 'resign' }, randomUUID(), '');
    const finished = await create(arne, harald);
    await call('POST', `/invitations/redeem${BOTH}`, { credential: harald.credential, body: { token: finished.body.invitation.token } });
    await act(harald, finished.body.game.id, 1, { type: 'resign' });
    const open = await create(arne, harald);
    const openId = open.body.game.id;
    const before = await stored(openId);

    const list = await call('GET', '/games', { credential: arne.credential });
    expect(list.body.games.map((g: { id: string }) => g.id)).toEqual([chess.body.game.id]);
    expect(JSON.stringify(list.body)).not.toContain('chess960');
    const history = await call('GET', '/history', { credential: arne.credential });
    expect(history.body.history).toEqual([expect.objectContaining({ gameType: 'chess', wins: 1, losses: 0 })]);

    const refusals = [
      await call('GET', `/games/${openId}`, { credential: arne.credential }),
      await act(arne, openId, 0, move('e2e4'), randomUUID(), ''),
      await call('POST', `/games/${openId}/invitation`, { credential: arne.credential }),
      await call('POST', '/invitations/redeem', { credential: harald.credential, body: { token: open.body.invitation.token } }),
      await call('POST', `/games/${finished.body.game.id}/rematch`, { credential: arne.credential }),
    ];
    for (const refusal of refusals) {
      expect(refusal.status).toBe(422);
      expect(refusal.body.error.code).toBe('unsupported_game');
    }
    expect(await stored(openId)).toEqual(before);
    const [seats] = await sql`select count(*)::int as n from game_participants where game_id = ${openId}`;
    expect(seats.n).toBe(1);

    // A client that reads both sees everything, each game as its own type.
    const both = await call('GET', `/games${BOTH}`, { credential: arne.credential });
    expect(both.body.games.map((g: { type: string }) => g.type).sort()).toEqual(['chess', 'chess960', 'chess960']);
    const bothHistory = await call('GET', `/history${BOTH}`, { credential: arne.credential });
    expect(bothHistory.body.history.map((h: { gameType: string; wins: number }) => [h.gameType, h.wins]).sort()).toEqual([
      ['chess', 1],
      ['chess960', 1],
    ]);
  });
});

describe('castling', () => {
  it('castles each way for both colours, saved as king onto rook, and replays the same', async () => {
    const { white, black, id } = await newGame(OPEN_CORNERS);
    const short = await act(white, id, 1, castle('kingside'));
    expect(short.status).toBe(200);
    expect(short.body.game).toMatchObject({ turn: 'black', moveCount: 1, chess960: { moves: ['b1h1'] } });
    const long = await act(black, id, 2, castle('queenside'));
    expect(long.body.game.chess960.moves).toEqual(['b1h1', 'b8a8']);
    expect((await stored(id)).actions).toEqual([
      { kind: 'castle', move: 'b1h1', revision: 2 },
      { kind: 'castle', move: 'b8a8', revision: 3 },
    ]);
    // Play continues from the replayed position, and a fresh read shows the same record.
    expect((await act(white, id, 3, move('f2f4'))).status).toBe(200);
    expect((await call('GET', `/games/${id}${BOTH}`, { credential: black.credential })).body.game.chess960.moves).toEqual([
      'b1h1',
      'b8a8',
      'f2f4',
    ]);
    // Castling twice is refused: the rights went with the first castle.
    expect((await act(black, id, 4, castle('kingside'))).body.error.code).toBe('illegal_castle');
  });

  it('never mistakes an ordinary king move for castling, or the other way round', async () => {
    const { white, black, id } = await newGame(OPEN_CORNERS);
    // Onto its own rook, or two squares: a castle, which must be asked for as one.
    for (const uci of ['b1a1', 'b1h1']) {
      const refused = await act(white, id, 1, move(uci));
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('use_castle_action');
    }
    // b1→c1 is where O-O-O puts the king, but as a move it is just a king step: the rook stays.
    const step = await act(white, id, 1, move('b1c1'));
    expect(step.status).toBe(200);
    expect((await stored(id)).actions).toEqual([{ kind: 'move', move: 'b1c1', revision: 2 }]);
    await act(black, id, 2, move('a7a6'));
    // The king has moved: no castling on either side any more, and nothing is saved.
    const before = await stored(id);
    for (const side of ['kingside', 'queenside'] as const) {
      expect((await act(white, id, 3, castle(side))).body.error.code).toBe('illegal_castle');
    }
    expect(await stored(id)).toEqual(before);
  });

  it('takes kingside as the rook to the king’s right, wherever it stands', async () => {
    // Rooks on b and g: kingside is the g rook. King e1 onto g1 is saved as "e1g1".
    const { white, black, id } = await newGame('1r2k1r1/pppppppp/8/8/8/8/PPPPPPPP/1R2K1R1 w GBgb - 0 1');
    expect((await act(white, id, 1, castle('kingside'))).body.game.chess960.moves).toEqual(['e1g1']);
    expect((await act(black, id, 2, castle('queenside'))).body.game.chess960.moves).toEqual(['e1g1', 'e8b8']);
  });

  it('refuses a castle the rules do not allow and changes nothing', async () => {
    // Black rook on f8 attacks f1, which the king crosses castling kingside (b1→g1); queenside is free.
    const { white, id } = await newGame('rk3r2/ppppp1pp/8/8/8/8/PPPPP1PP/RK5R w HAa - 0 1');
    const before = await stored(id);
    const refused = await act(white, id, 1, castle('kingside'));
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('illegal_castle');
    expect((await act(white, id, 1, { type: 'castle', side: 'h' })).body.error.code).toBe('bad_request');
    expect(await stored(id)).toEqual(before);
    expect((await act(white, id, 1, castle('queenside'))).body.game.chess960.moves).toEqual(['b1a1']);
  });
});

describe('a castle retried after its reply was lost', () => {
  it('is recognised by its side after the turn changed and after a reply, and another action with its ID is refused', async () => {
    const { white, black, id } = await newGame(OPEN_CORNERS);
    const requestId = randomUUID();
    expect((await act(white, id, 1, castle('kingside'), requestId)).status).toBe(200);

    // Retried with the revision it was based on: now Black's turn, rights gone.
    const retry = await act(white, id, 1, castle('kingside'), requestId);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ duplicate: true, game: { revision: 2, chess960: { moves: ['b1h1'] } } });

    await act(black, id, 2, move('a7a6'));
    const later = await act(white, id, 1, castle('kingside'), requestId);
    expect(later.body).toMatchObject({ duplicate: true, game: { revision: 3, chess960: { moves: ['b1h1', 'a7a6'] } } });

    for (const other of [castle('queenside'), move('b1h1'), { type: 'resign' }]) {
      const reused = await act(white, id, 1, other, requestId);
      expect(reused.status).toBe(409);
      expect(reused.body.error.code).toBe('request_id_reused');
    }
    expect((await stored(id)).actions).toHaveLength(2);
  });

  it('works for an opening castle while waiting, before and after the friend joins', async () => {
    const { white, black, id, token } = await newGame(OPEN_CORNERS, { join: false });
    const requestId = randomUUID();
    const opening = await act(white, id, 0, castle('queenside'), requestId);
    expect(opening.status).toBe(200);
    expect(opening.body.game).toMatchObject({ status: 'waiting', revision: 1, turn: 'black', chess960: { moves: ['b1a1'] } });
    // A second creator turn and resigning while waiting stay refused.
    expect((await act(white, id, 1, move('h2h3'))).body.error.code).toBe('not_your_turn');
    expect((await act(white, id, 1, { type: 'resign' })).body.error.code).toBe('not_started');
    expect((await act(white, id, 0, castle('queenside'), requestId)).body.duplicate).toBe(true);

    // The friend joins the saved position and can reply at once; the retry still finds the castle.
    const joined = await call('POST', `/invitations/redeem${BOTH}`, { credential: black.credential, body: { token } });
    expect(joined.body.game).toMatchObject({ status: 'active', turn: 'black', chess960: { initialFen: OPEN_CORNERS, moves: ['b1a1'] } });
    expect((await act(white, id, 0, castle('queenside'), requestId)).body).toMatchObject({ duplicate: true, game: { revision: 2 } });
    expect((await act(black, id, 2, castle('kingside'))).body.game.chess960.moves).toEqual(['b1a1', 'b8h8']);
    expect((await stored(id)).actions.map((a) => a.kind)).toEqual(['castle', 'castle']);
  });

  it('lets exactly one of two racing actions at the same revision through', async () => {
    const { white, id } = await newGame(OPEN_CORNERS);
    const answers = await Promise.all([act(white, id, 1, castle('kingside')), act(white, id, 1, move('a2a3'))]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect((await stored(id)).actions).toHaveLength(1);
  });
});

describe('other rules', () => {
  it('requires a promotion piece exactly when promoting, and plays en passant', async () => {
    const { white, black, id } = await newGame('7k/1P6/8/8/1p6/8/P7/K7 w - - 0 1');
    const before = await stored(id);
    expect((await act(white, id, 1, move('b7b8'))).body.error.code).toBe('illegal_move');
    expect((await act(white, id, 1, move('a2a3q'))).body.error.code).toBe('illegal_move');
    expect(await stored(id)).toEqual(before);
    expect((await act(white, id, 1, move('a2a4'))).status).toBe(200);
    const enPassant = await act(black, id, 2, move('b4a3'));
    expect(enPassant.body.game.chess960.moves).toEqual(['a2a4', 'b4a3']);
    const promoted = await act(white, id, 3, move('b7b8n'));
    expect(promoted.body.game.chess960.moves.at(-1)).toBe('b7b8n');
  });

  it('ends by checkmate, scores per type, and plays again as Chess960 with a fresh start, once', async () => {
    const { white, black, id } = await newGame('k7/8/1K6/8/8/8/8/7R w - - 0 1');
    const mate = await act(white, id, 1, move('h1h8'));
    expect(mate.body.game).toMatchObject({ status: 'finished', result: 'white', termination: 'checkmate' });
    expect((await act(black, id, 2, move('a8a7'))).body.error.code).toBe('game_finished');

    const history = await call('GET', `/history${BOTH}`, { credential: white.credential });
    expect(history.body.history).toEqual([
      expect.objectContaining({ gameType: 'chess960', wins: 1, games: [expect.objectContaining({ id, moveCount: 1, outcome: 'win' })] }),
    ]);

    // Both ask at once: one new game, same type and start, colours swapped.
    const [a, b] = await Promise.all([
      call('POST', `/games/${id}/rematch${BOTH}`, { credential: white.credential }),
      call('POST', `/games/${id}/rematch${BOTH}`, { credential: black.credential }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.game.id).toBe(b.body.game.id);
    const rematch = a.body.game;
    expect(rematch).toMatchObject({ type: 'chess960', status: 'active', yourSeat: 'black', chess960: { moves: [] } });
    expect(ALL_STARTS.has(rematch.chess960.initialFen)).toBe(true);
    expect(b.body.game.chess960.initialFen).toBe(rematch.chess960.initialFen);
    const again = await call('POST', `/games/${id}/rematch${BOTH}`, { credential: white.credential });
    expect(again.body).toMatchObject({ duplicate: true, game: { id: rematch.id, chess960: { initialFen: rematch.chess960.initialFen } } });
  });
});

describe('the database', () => {
  it('accepts castles only with notation, and only the two game types', async () => {
    const { white, id } = await newGame(OPEN_CORNERS);
    const insert = (kind: string, move: string | null) => sql`
      insert into game_actions (game_id, player_id, request_id, kind, move, revision)
      values (${id}, ${white.id}, ${randomUUID()}, ${kind}, ${move}, 99)`;
    await expect(insert('castle', null)).rejects.toThrow(/move_has_notation/);
    await expect(insert('resign', 'b1h1')).rejects.toThrow(/move_has_notation/);
    await expect(insert('swap', 'b1h1')).rejects.toThrow(/game_actions_kind_check/);
    await expect(sql`update games set game_type = 'checkers' where id = ${id}`).rejects.toThrow(/games_game_type_check/);
  });
});
