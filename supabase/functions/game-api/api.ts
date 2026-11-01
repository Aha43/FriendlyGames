// Request handling for the shared-game API. Clients submit actions; the server derives every
// position and outcome from the stored move list with the shared chess rules.
import type { Sql, TransactionSql } from 'postgres';
import {
  applyMove,
  gameStatus,
  newGame,
  outcomeOf,
  replay,
  type GameRecord,
  type GameResult,
  type PromotionPiece,
  type Termination,
} from '../_shared/chess/game.ts';

type Seat = 'white' | 'black';
type Db = Sql | TransactionSql;

interface Player {
  id: string;
  displayName: string;
}

export interface GameView {
  id: string;
  type: 'chess';
  schemaVersion: number;
  status: 'waiting' | 'active' | 'finished';
  result: GameResult | null;
  termination: Termination | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  players: Record<Seat, Player | null>;
  yourSeat: Seat;
  chess: { initialFen: string; moves: string[]; turn: Seat };
  /** The game started from this one with "Play again", if any. */
  rematchGameId: string | null;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface ApiConfig {
  /** Origins allowed to call the API from a browser; null allows any (local development). */
  allowedOrigins: string[] | null;
  /** The deployed commit, reported by GET /health. */
  commit: string | null;
  /** Whether the database is reached through the connection pooler, reported by GET /health. */
  pooled?: boolean;
}

function corsHeaders(request: Request, config: ApiConfig): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = config.allowedOrigins === null ? '*' : origin && config.allowedOrigins.includes(origin) ? origin : null;
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-device-credential',
    Vary: 'Origin',
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const SQUARE = /^[a-h][1-8]$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const MAX_BODY_BYTES = 4096;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleRequest(request: Request, sql: Sql, config: ApiConfig): Promise<Response> {
  const cors = corsHeaders(request, config);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const response = await route(request, sql, config);
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

async function route(request: Request, sql: Sql, config: ApiConfig): Promise<Response> {

  try {
    const path = new URL(request.url).pathname.replace(/^.*?\/game-api/, '') || '/';
    const route = `${request.method} ${path.replace(/\/+$/, '') || '/'}`;
    const gameMatch = path.match(/^\/games\/([^/]+)(\/actions|\/invitation|\/rematch)?\/?$/);

    if (route === 'GET /health') {
      await sql`select 1`;
      return json(200, { ok: true, commit: config.commit, pooled: config.pooled ?? false });
    }
    if (route === 'POST /players') {
      const { status, body } = await enterPlayer(sql, await readBody(request));
      return json(status, body);
    }

    const player = await authenticate(sql, request);
    if (route === 'GET /me') return json(200, { player: await loadMe(sql, player.id) });
    if (route === 'GET /games') return json(200, { games: await loadViews(sql, player.id) });
    if (route === 'GET /history') return json(200, { history: await loadHistory(sql, player.id) });
    if (route === 'POST /games') {
      const { status, body } = await createGame(sql, player, await readBody(request));
      return json(status, body);
    }
    if (route === 'POST /invitations/redeem') return json(200, await redeemInvitation(sql, player, await readBody(request)));
    if (gameMatch && !gameMatch[2] && request.method === 'GET') {
      return json(200, { game: await loadView(sql, player.id, gameMatch[1]) });
    }
    if (gameMatch && gameMatch[2] === '/rematch' && request.method === 'POST') {
      const { status, body } = await startRematch(sql, player, gameMatch[1]);
      return json(status, body);
    }
    if (gameMatch && gameMatch[2] === '/invitation' && request.method === 'POST') {
      return json(200, await regenerateInvitation(sql, player, gameMatch[1]));
    }
    if (gameMatch && gameMatch[2] === '/actions' && request.method === 'POST') {
      return json(200, await submitAction(sql, player, gameMatch[1], await readBody(request)));
    }
    throw new ApiError(404, 'not_found', 'No such endpoint.');
  } catch (error) {
    if (error instanceof ApiError) {
      return json(error.status, { error: { code: error.code, message: error.message, ...error.details } });
    }
    // Never log request bodies or headers: they carry device credentials and invitation tokens.
    console.error('game-api: unexpected error:', error instanceof Error ? error.message : 'unknown');
    return json(500, { error: { code: 'internal', message: 'Something went wrong.' } });
  }
}

// ---------- input ----------

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', 'Request body is too large.');
  try {
    const body = JSON.parse(text || '{}');
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new ApiError(400, 'bad_request', 'Request body must be a JSON object.');
}

function requireText(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new ApiError(400, 'bad_request', `"${field}" must be text of 1–${max} characters.`);
  }
  return value.trim();
}

function requireEmail(body: Record<string, unknown>, field: string): string {
  const email = requireText(body, field, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new ApiError(400, 'bad_request', `"${field}" must be an email address.`);
  return email;
}

// ---------- secrets ----------

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashHex(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- players ----------

/**
 * Email entry (#29, prototype): an email that belongs to a player opens that same player in this
 * browser; a new email creates one player, which needs a display name. Email ownership is NOT
 * checked: knowing the email is enough. Each call issues a fresh credential for this browser only;
 * the player's other browsers keep theirs. Repeating a call (e.g. after a lost response) is safe:
 * it reaches the same player again.
 */
async function enterPlayer(sql: Sql, body: Record<string, unknown>) {
  const email = requireEmail(body, 'email');
  const displayName = body.displayName === undefined || body.displayName === null ? null : requireText(body, 'displayName', 40);
  const deviceCredential = newSecret();
  const credentialHash = await hashHex(deviceCredential);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await addCredentialFor(sql, email, credentialHash);
    // An existing player keeps their own name, whatever this browser typed.
    if (existing) return { status: 200, body: { player: existing, deviceCredential, created: false } };
    if (displayName === null) {
      throw new ApiError(404, 'player_not_found', 'No player uses this email yet. Choose a name to create one.');
    }
    try {
      const player = await sql.begin(async (tx) => {
        const [row] = await tx`
          insert into players (display_name, credential_hash)
          values (${displayName}, decode(${credentialHash}, 'hex'))
          returning id`;
        await tx`
          insert into player_credentials (credential_hash, player_id)
          values (decode(${credentialHash}, 'hex'), ${row.id})
          on conflict (credential_hash) do nothing`;
        await tx`insert into player_contacts (player_id, email) values (${row.id}, ${email})`;
        return { id: row.id as string, displayName, email };
      });
      // The credential is returned once and never stored in readable form.
      return { status: 201, body: { player, deviceCredential, created: true } };
    } catch (error) {
      // Someone entered the same new email at the same moment and won: the whole transaction
      // (player, credential, contact) rolled back, so join the winner's player instead.
      if ((error as { constraint_name?: string }).constraint_name !== 'player_contacts_email_unique') throw error;
    }
  }
  throw new ApiError(503, 'try_again', 'Please try again.');
}

/** Gives the player with this email one more device credential; null if no player has the email. */
async function addCredentialFor(sql: Sql, email: string, credentialHash: string) {
  const [row] = await sql`
    with target as (
      select p.id, p.display_name, c.email
        from player_contacts c join players p on p.id = c.player_id
       where lower(btrim(c.email)) = ${email}
    ), issued as (
      insert into player_credentials (credential_hash, player_id)
      select decode(${credentialHash}, 'hex'), id from target
      returning player_id
    )
    select t.id, t.display_name, t.email from target t join issued i on i.player_id = t.id`;
  return row ? { id: row.id as string, displayName: row.display_name as string, email: row.email as string } : null;
}

async function authenticate(sql: Sql, request: Request): Promise<Player> {
  const credential = request.headers.get('x-device-credential') ?? '';
  if (!SECRET.test(credential)) throw new ApiError(401, 'unauthenticated', 'A valid device credential is required.');
  const [row] = await sql`
    select p.id, p.display_name
      from player_credentials c join players p on p.id = c.player_id
     where c.credential_hash = decode(${await hashHex(credential)}, 'hex')`;
  if (!row) throw new ApiError(401, 'unauthenticated', 'A valid device credential is required.');
  return { id: row.id, displayName: row.display_name };
}

/** The caller's own player. `email` is null if it was detached when reconciling duplicates (#27). */
async function loadMe(sql: Sql, playerId: string) {
  const [row] = await sql`
    select p.id, p.display_name, c.email
    from players p left join player_contacts c on c.player_id = p.id
    where p.id = ${playerId}`;
  return { id: row.id, displayName: row.display_name, email: row.email ?? null };
}

// ---------- games ----------

interface GameRow {
  id: string;
  schema_version: number;
  status: GameView['status'];
  result: GameResult | null;
  termination: Termination | null;
  revision: number;
  payload: { initialFen: string; moves: string[] };
  created_at: Date;
  updated_at: Date;
  your_seat: Seat;
  participants: { seat: Seat; id: string; displayName: string }[];
  rematch_id: string | null;
}

function toView(row: GameRow): GameView {
  const players: Record<Seat, Player | null> = { white: null, black: null };
  for (const p of row.participants) players[p.seat] = { id: p.id, displayName: p.displayName };
  const record: GameRecord = { schemaVersion: 1, ...row.payload };
  return {
    id: row.id,
    type: 'chess',
    schemaVersion: row.schema_version,
    status: row.status,
    result: row.result,
    termination: row.termination,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    players,
    yourSeat: row.your_seat,
    chess: { ...row.payload, turn: replay(record).turn() === 'w' ? 'white' : 'black' },
    rematchGameId: row.rematch_id,
  };
}

/** Games the player takes part in, newest activity first; `gameId` narrows to one. */
async function loadViews(sql: Db, playerId: string, gameId: string | null = null): Promise<GameView[]> {
  const rows = await sql<GameRow[]>`
    select g.id, g.schema_version, g.status, g.result, g.termination, g.revision, g.payload,
           g.created_at, g.updated_at, me.seat as your_seat,
           (select json_agg(json_build_object('seat', p.seat, 'id', p.player_id, 'displayName', pl.display_name))
              from game_participants p join players pl on pl.id = p.player_id
             where p.game_id = g.id) as participants,
           (select r.id from games r where r.rematch_of = g.id) as rematch_id
      from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${playerId}
     where ${gameId}::uuid is null or g.id = ${gameId}::uuid
     order by g.updated_at desc
     limit 200`;
  return rows.map(toView);
}

/** One game, only for its participants. Anyone else gets the same answer as for a missing game. */
async function loadView(sql: Db, playerId: string, gameId: string): Promise<GameView> {
  const [view] = UUID.test(gameId) ? await loadViews(sql, playerId, gameId) : [];
  if (!view) throw new ApiError(404, 'game_not_found', 'Game not found.');
  return view;
}

async function createGame(sql: Sql, player: Player, body: Record<string, unknown>) {
  const friendEmail = requireEmail(body, 'friendEmail');
  const requestId = body.requestId ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !UUID.test(requestId))) {
    throw new ApiError(400, 'bad_request', '"requestId" must be a UUID.');
  }
  const { initialFen, moves } = newGame();

  const created = await sql.begin(async (tx) => {
    // A request ID makes creation retryable: a second request with it finds the first game.
    const [game] = await tx`
      insert into games (game_type, status, payload, created_by, create_request_id)
      values ('chess', 'waiting', ${tx.json({ initialFen, moves })}, ${player.id}, ${requestId})
      on conflict (created_by, create_request_id) do nothing
      returning id`;
    if (!game) {
      const [earlier] = await tx`
        select id from games where created_by = ${player.id} and create_request_id = ${requestId}`;
      // The first response (and its token) may have been lost: issue a fresh link if still unused.
      return { gameId: earlier.id as string, token: await reissueInvitation(tx, earlier.id), duplicate: true };
    }

    const token = newSecret();
    await tx`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${player.id}, 'white')`;
    await tx`
      insert into game_invitations (game_id, token_hash, seat, invited_email)
      values (${game.id}, decode(${await hashHex(token)}, 'hex'), 'black', ${friendEmail})`;
    return { gameId: game.id as string, token, duplicate: false };
  });

  // Invitation tokens are only ever returned to the creator, for sharing by hand.
  return {
    status: created.duplicate ? 200 : 201,
    body: {
      game: await loadView(sql, player.id, created.gameId),
      invitation: created.token ? { token: created.token } : null,
      duplicate: created.duplicate,
    },
  };
}

/**
 * Replace a game's unused invitation with a new one and return its token; null once redeemed.
 * The earlier link stops working. Locks the invitation row, as redeeming does, so the two serialise.
 */
async function reissueInvitation(tx: TransactionSql, gameId: string): Promise<string | null> {
  const [invitation] = await tx`
    select redeemed_by from game_invitations where game_id = ${gameId} for update`;
  if (!invitation || invitation.redeemed_by) return null;
  const token = newSecret();
  await tx`
    update game_invitations set token_hash = decode(${await hashHex(token)}, 'hex'), created_at = now()
     where game_id = ${gameId}`;
  return token;
}

/** A new invitation link for the creator of a game nobody has joined yet. */
async function regenerateInvitation(sql: Sql, player: Player, gameId: string) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const [game] = await sql`
    select g.created_by from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
     where g.id = ${gameId}`;
  if (!game) throw new ApiError(404, 'game_not_found', 'Game not found.');
  if (game.created_by !== player.id) {
    throw new ApiError(403, 'not_creator', 'Only the player who created the game can invite.');
  }
  const token = await sql.begin((tx) => reissueInvitation(tx, gameId));
  if (!token) throw new ApiError(409, 'invitation_used', 'Your friend has already joined.');
  return { game: await loadView(sql, player.id, gameId), invitation: { token } };
}

async function redeemInvitation(sql: Sql, player: Player, body: Record<string, unknown>) {
  const token = body.token;
  if (typeof token !== 'string' || !SECRET.test(token)) {
    throw new ApiError(404, 'invitation_not_found', 'Invitation not found.');
  }
  const tokenHash = await hashHex(token);

  const gameId = await sql.begin(async (tx) => {
    // Locking the invitation serialises competing claims: exactly one can take the seat.
    const [invitation] = await tx`
      select game_id, seat, redeemed_by from game_invitations
       where token_hash = decode(${tokenHash}, 'hex')
         for update`;
    if (!invitation) throw new ApiError(404, 'invitation_not_found', 'Invitation not found.');
    if (invitation.redeemed_by === player.id) return invitation.game_id as string; // retry by the same player
    if (invitation.redeemed_by) throw new ApiError(409, 'invitation_used', 'This invitation has already been used.');

    const [seated] = await tx`
      select seat from game_participants where game_id = ${invitation.game_id} and player_id = ${player.id}`;
    if (seated) throw new ApiError(409, 'already_participant', 'You are already playing in this game.');

    await tx`
      insert into game_participants (game_id, player_id, seat)
      values (${invitation.game_id}, ${player.id}, ${invitation.seat})`;
    await tx`
      update game_invitations set redeemed_at = now(), redeemed_by = ${player.id}
       where game_id = ${invitation.game_id}`;
    await tx`
      update games set status = 'active', revision = revision + 1, updated_at = now()
       where id = ${invitation.game_id} and status = 'waiting'`;
    return invitation.game_id as string;
  });
  return { game: await loadView(sql, player.id, gameId) };
}

// ---------- history and rematches ----------

export interface HistoryEntry {
  gameType: 'chess';
  opponent: Player;
  wins: number;
  draws: number;
  losses: number;
  games: {
    id: string;
    finishedAt: string;
    outcome: 'win' | 'loss' | 'draw';
    termination: Termination;
    yourSeat: Seat;
    moveCount: number;
  }[];
}

/** Finished games per opponent, newest first, with an exact tally. Only the player's own games. */
async function loadHistory(sql: Sql, playerId: string): Promise<HistoryEntry[]> {
  const rows = await sql`
    select g.id, g.result, g.termination, g.updated_at as finished_at, me.seat as your_seat,
           jsonb_array_length(g.payload -> 'moves') as move_count,
           opp.player_id as opponent_id, pl.display_name as opponent_name
      from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${playerId}
      join game_participants opp on opp.game_id = g.id and opp.player_id <> ${playerId}
      join players pl on pl.id = opp.player_id
     where g.status = 'finished' and g.game_type = 'chess'
     order by g.updated_at desc, g.id`;

  const byOpponent = new Map<string, HistoryEntry>();
  for (const row of rows) {
    let entry = byOpponent.get(row.opponent_id);
    if (!entry) {
      entry = {
        gameType: 'chess',
        opponent: { id: row.opponent_id, displayName: row.opponent_name },
        wins: 0,
        draws: 0,
        losses: 0,
        games: [],
      };
      byOpponent.set(row.opponent_id, entry);
    }
    const outcome = row.result === 'draw' ? 'draw' : row.result === row.your_seat ? 'win' : 'loss';
    entry[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws']++;
    entry.games.push({
      id: row.id,
      finishedAt: (row.finished_at as Date).toISOString(),
      outcome,
      termination: row.termination,
      yourSeat: row.your_seat,
      moveCount: row.move_count,
    });
  }
  return [...byOpponent.values()];
}

/**
 * "Play again": a new game between the same two players, colours swapped, no invitation needed.
 * Each finished game has at most one rematch, so a second request (from either player) finds it.
 */
async function startRematch(sql: Sql, player: Player, gameId: string) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const { initialFen, moves } = newGame();

  const started = await sql.begin(async (tx) => {
    const [source] = await tx`
      select g.status from games g
        join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
       where g.id = ${gameId}`;
    if (!source) throw new ApiError(404, 'game_not_found', 'Game not found.');
    if (source.status !== 'finished') throw new ApiError(409, 'not_finished', 'This game is still going.');

    const [game] = await tx`
      insert into games (game_type, status, payload, created_by, rematch_of)
      values ('chess', 'active', ${tx.json({ initialFen, moves })}, ${player.id}, ${gameId})
      on conflict (rematch_of) do nothing
      returning id`;
    if (!game) {
      const [existing] = await tx`select id from games where rematch_of = ${gameId}`;
      return { gameId: existing.id as string, duplicate: true };
    }
    await tx`
      insert into game_participants (game_id, player_id, seat)
      select ${game.id}, player_id, case seat when 'white' then 'black' else 'white' end
        from game_participants where game_id = ${gameId}`;
    return { gameId: game.id as string, duplicate: false };
  });

  return {
    status: started.duplicate ? 200 : 201,
    body: { game: await loadView(sql, player.id, started.gameId), duplicate: started.duplicate },
  };
}

type Action = { type: 'move'; from: string; to: string; promotion?: PromotionPiece } | { type: 'resign' };

function parseAction(body: Record<string, unknown>): { requestId: string; expectedRevision: number; action: Action } {
  const { requestId, expectedRevision, action } = body as {
    requestId?: unknown;
    expectedRevision?: unknown;
    action?: Record<string, unknown>;
  };
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    throw new ApiError(400, 'bad_request', '"requestId" must be a UUID.');
  }
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new ApiError(400, 'bad_request', '"expectedRevision" must be a non-negative integer.');
  }
  if (action?.type === 'resign') return { requestId, expectedRevision: expectedRevision as number, action: { type: 'resign' } };
  if (action?.type === 'move') {
    const { from, to, promotion } = action;
    if (
      typeof from === 'string' && SQUARE.test(from) &&
      typeof to === 'string' && SQUARE.test(to) &&
      (promotion === undefined || (typeof promotion === 'string' && ['q', 'r', 'b', 'n'].includes(promotion)))
    ) {
      return {
        requestId,
        expectedRevision: expectedRevision as number,
        action: { type: 'move', from, to, promotion: promotion as PromotionPiece | undefined },
      };
    }
  }
  throw new ApiError(400, 'bad_request', '"action" must be a move {type, from, to, promotion?} or {type: "resign"}.');
}

async function submitAction(sql: Sql, player: Player, gameId: string, body: Record<string, unknown>) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const { requestId, expectedRevision, action } = parseAction(body);
  const requested = action.type === 'move' ? `${action.from}${action.to}${action.promotion ?? ''}` : null;

  return await sql.begin(async (tx) => {
    // The row lock serialises actions on one game; the revision check rejects stale clients.
    const [game] = await tx`
      select g.status, g.revision, g.payload, me.seat
        from games g
        join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
       where g.id = ${gameId}
         for update of g`;
    if (!game) throw new ApiError(404, 'game_not_found', 'Game not found.');

    const [earlier] = await tx`
      select kind, move from game_actions
       where game_id = ${gameId} and player_id = ${player.id} and request_id = ${requestId}`;
    if (earlier) {
      if (earlier.kind === action.type && earlier.move === requested) {
        return { game: await loadView(tx, player.id, gameId), duplicate: true };
      }
      throw new ApiError(409, 'request_id_reused', 'This request ID was already used for a different action.');
    }

    if (game.revision !== expectedRevision) {
      throw new ApiError(409, 'stale_revision', 'The game has changed. Refresh and try again.', {
        game: await loadView(tx, player.id, gameId),
      });
    }
    if (game.status === 'waiting') throw new ApiError(409, 'not_started', 'Waiting for your friend to join.');
    if (game.status === 'finished') throw new ApiError(409, 'game_finished', 'This game is over.');

    const seat = game.seat as Seat;
    let record: GameRecord = { schemaVersion: 1, ...game.payload };
    let outcome: { result: GameResult; termination: Termination } | null;

    if (action.type === 'move') {
      if ((replay(record).turn() === 'w' ? 'white' : 'black') !== seat) {
        throw new ApiError(409, 'not_your_turn', 'It is not your turn.');
      }
      const next = applyMove(record, action.from, action.to, action.promotion);
      if (!next) throw new ApiError(422, 'illegal_move', 'That move is not allowed.');
      record = next;
      outcome = outcomeOf(gameStatus(replay(record)));
    } else {
      outcome = { result: seat === 'white' ? 'black' : 'white', termination: 'resignation' };
    }

    const revision = game.revision + 1;
    await tx`
      update games
         set payload = ${tx.json({ initialFen: record.initialFen, moves: record.moves })},
             revision = ${revision},
             status = ${outcome ? 'finished' : 'active'},
             result = ${outcome?.result ?? null},
             termination = ${outcome?.termination ?? null},
             updated_at = now()
       where id = ${gameId}`;
    await tx`
      insert into game_actions (game_id, player_id, request_id, kind, move, revision)
      values (${gameId}, ${player.id}, ${requestId}, ${action.type}, ${requested}, ${revision})`;

    return { game: await loadView(tx, player.id, gameId), duplicate: false };
  });
}
