// Request handling for the shared-game API. Clients submit actions; the server derives every
// position and outcome from the stored record with the rules of the game's type (gameTypes.ts).
import type { Sql, TransactionSql } from 'postgres';
import type { Termination } from '../_shared/chess/game.ts';
import {
  adapterFor,
  clientTypes,
  creatableAdapter,
  TABLE_SEATS,
  yatzyOptions,
  type GameTypeAdapter,
  type Outcome,
  type SeatedPlayer,
  type Seat,
  type TypedAction,
} from './gameTypes.ts';

type Db = Sql | TransactionSql;

interface Player {
  id: string;
  displayName: string;
}

export interface GameView {
  id: string;
  /** The game type, e.g. "chess". Clients read type-specific fields (e.g. `chess`) only for types they know. */
  type: string;
  schemaVersion: number;
  status: 'waiting' | 'active' | 'finished';
  result: Outcome['result'] | null;
  termination: Outcome['termination'] | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Chess family: `white` and `black` (null while open). A table: its seats `p1`.. in turn order. */
  players: Partial<Record<Seat, Player | null>>;
  yourSeat: Seat;
  /** The seat to move, for any type (#53); null when nobody is (a finished table). */
  turn: Seat | null;
  /** Moves played so far, for any type (#53). */
  moveCount: number;
  /** Standard chess only: the saved record and the side to move. */
  chess?: { initialFen: string; moves: string[]; turn: Seat };
  /** The game started from this one with "Play again", if any. */
  rematchGameId: string | null;
}

/** A game this client cannot read: its type was not asked for (`types`) or this server lacks it. */
const UNSUPPORTED = () =>
  new ApiError(422, 'unsupported_game', 'This game needs a newer version of FriendlyGames. Reload the page to update.');

/** The adapter for a stored game the client can read, or an unsupported_game error. */
function readable(row: Record<string, unknown>, types: string[]): GameTypeAdapter {
  const type = row.game_type as string;
  const adapter = types.includes(type) ? adapterFor(type, row.schema_version as number) : null;
  if (!adapter) throw UNSUPPORTED();
  return adapter;
}

/** A flow the game's type does not have (e.g. resigning or rematching a Yatzy table). */
const NOT_FOR_THIS_GAME = (what: string) => new ApiError(422, 'unsupported_action', `${what} is not available for this game.`);

/**
 * Seats that do not fit the game's type, count or order (#85): written by something other than
 * this API. Such a game is left out of lists and refused here, its rows untouched.
 */
const INVALID_SEATS = () => new ApiError(409, 'invalid_seats', 'This game’s players are not set up correctly.');

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
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/game-api/, '') || '/';
    const types = clientTypes(url);
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
    if (route === 'GET /games') return json(200, { games: await loadViews(sql, player.id, types) });
    if (route === 'GET /history') {
      // `tables` only for clients that ask for a table type; older clients get exactly `history`.
      const history = await loadHistory(sql, player.id, types);
      const asksForTables = types.some((type) => creatableAdapter(type)?.family === 'table');
      return json(200, asksForTables ? { history, tables: await loadTables(sql, player.id, types) } : { history });
    }
    if (route === 'GET /opponents') return json(200, { opponents: await loadOpponents(sql, player.id) });
    if (route === 'POST /games') {
      const { status, body } = await createGame(sql, player, await readBody(request), types);
      return json(status, body);
    }
    if (route === 'POST /invitations/redeem') return json(200, await redeemInvitation(sql, player, await readBody(request), types));
    if (gameMatch && !gameMatch[2] && request.method === 'GET') {
      return json(200, { game: await loadView(sql, player.id, gameMatch[1], types) });
    }
    if (gameMatch && gameMatch[2] === '/rematch' && request.method === 'POST') {
      const { status, body } = await startRematch(sql, player, gameMatch[1], types);
      return json(status, body);
    }
    if (gameMatch && gameMatch[2] === '/invitation' && request.method === 'POST') {
      return json(200, await regenerateInvitation(sql, player, gameMatch[1], types));
    }
    if (gameMatch && gameMatch[2] === '/actions' && request.method === 'POST') {
      return json(200, await submitAction(sql, player, gameMatch[1], await readBody(request), types));
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

  // A name collision is only reported once this email is known not to have a player of its
  // own: a simultaneous sign-up with the same email and name may be what took the name (#76).
  let nameTaken = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await addCredentialFor(sql, email, credentialHash);
    // An existing player keeps their own name, whatever this browser typed.
    if (existing) return { status: 200, body: { player: existing, deviceCredential, created: false } };
    if (displayName === null) {
      throw new ApiError(404, 'player_not_found', 'No player uses this email yet. Choose a name to create one.');
    }
    if (nameTaken) {
      // Never says who has it: names are public, but emails and accounts are not.
      throw new ApiError(409, 'name_taken', 'That name is already in use. Choose another.');
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
      // The whole transaction (player, credential, contact) rolled back. Either someone entered
      // the same new email at the same moment and won (join their player on the next round), or
      // the name is taken (players_display_name_unique, #76): the next round first checks
      // whether that was this same email, then refuses the name.
      const constraint = (error as { constraint_name?: string }).constraint_name;
      if (constraint === 'players_display_name_unique') nameTaken = true;
      else if (constraint !== 'player_contacts_email_unique') throw error;
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
  game_type: string;
  schema_version: number;
  status: GameView['status'];
  result: Outcome['result'] | null;
  termination: Outcome['termination'] | null;
  revision: number;
  payload: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  your_seat: Seat;
  participants: { seat: Seat; id: string; displayName: string }[];
  rematch_id: string | null;
}

const seatsValid = (row: GameRow, adapter: GameTypeAdapter) =>
  adapter.seatsValid(row.payload, row.participants.map((p) => ({ seat: p.seat, playerId: p.id })), row.created_by, row.status);

/** Every seat of a game, for the seat check where the game is not loaded as a view. */
const ROSTER = (sql: Db) => sql`
  (select json_agg(json_build_object('seat', p.seat, 'playerId', p.player_id))
     from game_participants p where p.game_id = g.id)`;

/**
 * The adapter for a stored game the client can read and whose seats fit it; otherwise an error.
 * `row` carries game_type, schema_version, payload, created_by, status and roster.
 */
function playable(row: Record<string, unknown>, types: string[]): GameTypeAdapter {
  const adapter = readable(row, types);
  const roster = (row.roster ?? []) as SeatedPlayer[];
  if (!adapter.seatsValid(row.payload, roster, row.created_by as string, row.status as GameView['status'])) throw INVALID_SEATS();
  return adapter;
}

function toView(row: GameRow, adapter: GameTypeAdapter): GameView {
  const players: GameView['players'] = adapter.family === 'chess' ? { white: null, black: null } : {};
  for (const p of [...row.participants].sort((a, b) => a.seat.localeCompare(b.seat))) {
    players[p.seat] = { id: p.id, displayName: p.displayName };
  }
  return {
    id: row.id,
    type: row.game_type,
    schemaVersion: row.schema_version,
    status: row.status,
    result: row.result,
    termination: row.termination,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    players,
    yourSeat: row.your_seat,
    turn: adapter.turn(row.payload),
    moveCount: adapter.moveCount(row.payload),
    ...adapter.view(row.payload),
    rematchGameId: row.rematch_id,
  };
}

async function loadRows(
  sql: Db,
  playerId: string,
  gameId: string | null,
  types: string[] | null,
  status: GameView['status'] | null = null,
): Promise<GameRow[]> {
  return await sql<GameRow[]>`
    select g.id, g.game_type, g.schema_version, g.status, g.result, g.termination, g.revision, g.payload,
           g.created_at, g.updated_at, g.created_by, me.seat as your_seat,
           (select json_agg(json_build_object('seat', p.seat, 'id', p.player_id, 'displayName', pl.display_name))
              from game_participants p join players pl on pl.id = p.player_id
             where p.game_id = g.id) as participants,
           (select r.id from games r where r.rematch_of = g.id) as rematch_id
      from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${playerId}
     where (${gameId}::uuid is null or g.id = ${gameId}::uuid)
       and (${types}::text[] is null or g.game_type = any(${types}::text[]))
       and (${status}::text is null or g.status = ${status}::text)
     order by g.updated_at desc
     limit 200`;
}

/**
 * The player's games of the types this client reads, newest activity first. A game stored in a
 * schema version this server cannot read is left out (and left untouched), never guessed at.
 */
async function loadViews(sql: Db, playerId: string, types: string[]): Promise<GameView[]> {
  const rows = await loadRows(sql, playerId, null, types);
  return rows.flatMap((row) => {
    const adapter = adapterFor(row.game_type, row.schema_version);
    return adapter && seatsValid(row, adapter) ? viewOrNothing(row, adapter) : [];
  });
}

/**
 * One game of a list as a view; a record the rules cannot read is left out (and logged by ID
 * only), so one bad row never takes the player's whole list down.
 */
function viewOrNothing(row: GameRow, adapter: GameTypeAdapter): GameView[] {
  try {
    return [toView(row, adapter)];
  } catch {
    console.error('game-api: unreadable game left out of a list:', row.id);
    return [];
  }
}

/** One game, only for its participants (anyone else: not found); unsupported_game if unreadable. */
async function loadView(sql: Db, playerId: string, gameId: string, types: string[]): Promise<GameView> {
  const [row] = UUID.test(gameId) ? await loadRows(sql, playerId, gameId, null) : [];
  if (!row) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const adapter = readable(row as unknown as Record<string, unknown>, types);
  if (!seatsValid(row, adapter)) throw INVALID_SEATS();
  return toView(row, adapter);
}

/**
 * The caller's previous opponents (#72): everyone seated with them in at least one game, of any
 * type or stored version (a person is listed even when every shared game is one this client cannot
 * show; those games are never returned or decoded here). Someone only named in an unredeemed
 * invitation has no seat and is not listed. Aggregates cover only the caller's shared games:
 * `sharedGames` counts distinct games; `lastSharedGameUpdatedAt` is the latest time any of them
 * was created, joined or had an action (a move, castle or resignation) — not proof a move was played.
 * No emails, credentials or tokens; nobody else's relationships.
 */
async function loadOpponents(sql: Db, playerId: string) {
  const rows = await sql<{ id: string; display_name: string; shared_games: number; last_updated: Date }[]>`
    select o.player_id as id, pl.display_name,
           count(distinct me.game_id)::int as shared_games,
           max(g.updated_at) as last_updated
      from game_participants me
      join game_participants o on o.game_id = me.game_id and o.player_id <> me.player_id
      join players pl on pl.id = o.player_id
      join games g on g.id = me.game_id
     where me.player_id = ${playerId}
     group by o.player_id, pl.display_name
     order by max(g.updated_at) desc, pl.display_name, o.player_id
     limit 500`;
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    sharedGames: r.shared_games,
    lastSharedGameUpdatedAt: r.last_updated.toISOString(),
  }));
}

/** Who a new game is for: an email to invite (the original path) or a previous opponent (#72). */
type CreateTarget = { mode: 'email'; email: string } | { mode: 'player'; playerId: string };

function createTarget(body: Record<string, unknown>): CreateTarget {
  if (body.friendPlayerId !== undefined && body.friendEmail !== undefined) {
    throw new ApiError(400, 'bad_request', 'Give either "friendEmail" or "friendPlayerId", not both.');
  }
  if (body.friendPlayerId === undefined) return { mode: 'email', email: requireEmail(body, 'friendEmail') };
  const id = body.friendPlayerId;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(400, 'bad_request', '"friendPlayerId" must be a player ID.');
  return { mode: 'player', playerId: id.toLowerCase() };
}

// The same answer for yourself, an unknown ID and someone you have never played: it never reveals
// whether an account exists.
const NOT_AN_OPPONENT = () =>
  new ApiError(404, 'opponent_not_found', 'You have no earlier game with that player. Invite them by email instead.');

async function createGame(sql: Sql, player: Player, body: Record<string, unknown>, types: string[]) {
  const requestId = body.requestId ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !UUID.test(requestId))) {
    throw new ApiError(400, 'bad_request', '"requestId" must be a UUID.');
  }
  // Omitted type means standard chess, as for every client before #53.
  const type = body.type ?? 'chess';
  const adapter = typeof type === 'string' && types.includes(type) ? creatableAdapter(type) : null;
  if (!adapter) throw new ApiError(400, 'unsupported_game_type', 'This game type is not available.');
  if (adapter.family === 'table') return await createTable(sql, player, body, requestId, adapter, types);
  if (body.friendPlayerIds !== undefined || body.mode !== undefined) {
    throw new ApiError(400, 'bad_request', '"friendPlayerIds" and "mode" are for tables, not this game type.');
  }
  const target = createTarget(body);

  const direct = target.mode === 'player';
  const created = await sql.begin(async (tx) => {
    if (direct) {
      // Only someone the caller has actually sat at a game with (any type or version), never a
      // client-supplied name or list. Seats are never removed, so this cannot become untrue later.
      const [shared] =
        target.playerId === player.id
          ? []
          : await tx`
              select 1 from game_participants me
                join game_participants o on o.game_id = me.game_id and o.player_id = ${target.playerId}
               where me.player_id = ${player.id}
               limit 1`;
      if (!shared) throw NOT_AN_OPPONENT();
    }

    // A request ID makes creation retryable: a second request with it finds the first game. A
    // direct game starts active with both seated (no invitation, link or acceptance step).
    const [game] = await tx`
      insert into games (game_type, schema_version, status, payload, created_by, create_request_id)
      values (${adapter.type}, ${adapter.schemaVersion}, ${direct ? 'active' : 'waiting'},
              ${tx.json(adapter.create() as never)}, ${player.id}, ${requestId})
      on conflict (created_by, create_request_id) do nothing
      returning id`;
    if (!game) {
      // The request's identity is its type, target mode and recipient, all read back from the rows
      // the first request wrote (no migration): an email game always keeps its invitation and the
      // invited email; a direct game never has an invitation, and its Black seat is the chosen
      // player. The same ID for anything else is a different game (a client bug): refused before
      // anything is modified, rather than answered with the wrong game.
      const [earlier] = await tx`
        select g.id, g.game_type, g.schema_version, lower(i.invited_email) as invited_email,
               (i.game_id is not null) as has_invitation,
               (select b.player_id from game_participants b where b.game_id = g.id and b.seat = 'black') as black_id
          from games g
          left join game_invitations i on i.game_id = g.id
         where g.created_by = ${player.id} and g.create_request_id = ${requestId}`;
      const sameTarget = direct
        ? !earlier.has_invitation && earlier.black_id === target.playerId
        : earlier.has_invitation && earlier.invited_email === target.email;
      if (earlier.game_type !== adapter.type || !sameTarget) throw REQUEST_ID_REUSED();
      // Same type, but possibly a stored version this server or client cannot read: refuse before
      // touching its invitation, as POST /games/:id/invitation does.
      readable(earlier, types);
      // The first response (and its token) may have been lost: issue a fresh link if still unused.
      // A direct game has no invitation to renew.
      return { gameId: earlier.id as string, token: direct ? null : await reissueInvitation(tx, earlier.id), duplicate: true };
    }

    await tx`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${player.id}, 'white')`;
    if (direct) {
      // Creator White, chosen opponent Black, White to move: as every new game.
      await tx`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${target.playerId}, 'black')`;
      return { gameId: game.id as string, token: null, duplicate: false };
    }
    const token = newSecret();
    await tx`
      insert into game_invitations (game_id, token_hash, seat, invited_email)
      values (${game.id}, decode(${await hashHex(token)}, 'hex'), 'black', ${target.email})`;
    return { gameId: game.id as string, token, duplicate: false };
  });

  // Invitation tokens are only ever returned to the creator, for sharing by hand.
  return {
    status: created.duplicate ? 200 : 201,
    body: {
      game: await loadView(sql, player.id, created.gameId, types),
      invitation: created.token ? { token: created.token } : null,
      duplicate: created.duplicate,
    },
  };
}

const REQUEST_ID_REUSED = () =>
  new ApiError(409, 'request_id_reused', 'This request ID was already used to create a different game.');

/**
 * A table (#85, Yatzy): the host and one to three previous opponents, all seated at once in the
 * order chosen (host first), active immediately, no invitation. `friendPlayerIds` are player IDs
 * the host has sat at a game with; names and emails are never accepted here.
 */
async function createTable(
  sql: Sql,
  player: Player,
  body: Record<string, unknown>,
  requestId: string | null,
  adapter: GameTypeAdapter,
  types: string[],
) {
  if (body.friendEmail !== undefined || body.friendPlayerId !== undefined) {
    throw new ApiError(400, 'bad_request', 'A table takes "friendPlayerIds", not "friendEmail" or "friendPlayerId".');
  }
  const ids = body.friendPlayerIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > TABLE_SEATS.length - 1 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    throw new ApiError(400, 'bad_request', `"friendPlayerIds" must be 1–${TABLE_SEATS.length - 1} player IDs.`);
  }
  const guests = (ids as string[]).map((id) => id.toLowerCase());
  if (new Set(guests).size !== guests.length) {
    throw new ApiError(400, 'bad_request', '"friendPlayerIds" must name each player once.');
  }
  const options = yatzyOptions(body.mode, guests.length + 1);
  if (!options) throw new ApiError(400, 'bad_request', '"mode" must be "forced" or "free".');
  const roster = [player.id, ...guests]; // turn order: host, then guests as chosen

  const created = await sql.begin(async (tx) => {
    // Every guest must be someone the host has sat at a game with (any type). One answer for
    // yourself, an unknown ID and a stranger, whichever guest it is.
    if (guests.includes(player.id)) throw NOT_AN_OPPONENT();
    const known = await tx<{ id: string }[]>`
      select distinct o.player_id as id
        from game_participants me
        join game_participants o on o.game_id = me.game_id
       where me.player_id = ${player.id} and o.player_id = any(${guests}::uuid[])`;
    if (known.length !== guests.length) throw NOT_AN_OPPONENT();

    const [game] = await tx`
      insert into games (game_type, schema_version, status, payload, created_by, create_request_id)
      values (${adapter.type}, ${adapter.schemaVersion}, 'active',
              ${tx.json(adapter.create(options) as never)}, ${player.id}, ${requestId})
      on conflict (created_by, create_request_id) do nothing
      returning id`;
    if (!game) {
      // The request's identity is its type, mode and ordered roster, read back from the first
      // request's rows. The same ID for anything else is refused before anything is modified.
      const [earlier] = await tx`
        select g.id, g.game_type, g.schema_version, g.payload->>'mode' as mode,
               (select array_agg(p.player_id order by p.seat) from game_participants p where p.game_id = g.id) as roster
          from games g
         where g.created_by = ${player.id} and g.create_request_id = ${requestId}`;
      const sameRoster = Array.isArray(earlier.roster) && earlier.roster.join() === roster.join();
      if (earlier.game_type !== adapter.type || earlier.mode !== options.mode || !sameRoster) throw REQUEST_ID_REUSED();
      readable(earlier, types);
      return { gameId: earlier.id as string, duplicate: true };
    }
    for (const [index, id] of roster.entries()) {
      await tx`insert into game_participants (game_id, player_id, seat) values (${game.id}, ${id}, ${TABLE_SEATS[index]})`;
    }
    return { gameId: game.id as string, duplicate: false };
  });

  return {
    status: created.duplicate ? 200 : 201,
    body: { game: await loadView(sql, player.id, created.gameId, types), invitation: null, duplicate: created.duplicate },
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
async function regenerateInvitation(sql: Sql, player: Player, gameId: string, types: string[]) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const [game] = await sql`
    select g.created_by, g.game_type, g.schema_version, g.payload, g.status, ${ROSTER(sql)} as roster from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
     where g.id = ${gameId}`;
  if (!game) throw new ApiError(404, 'game_not_found', 'Game not found.');
  if (readable(game, types).family !== 'chess') throw NOT_FOR_THIS_GAME('An invitation link');
  playable(game, types);
  if (game.created_by !== player.id) {
    throw new ApiError(403, 'not_creator', 'Only the player who created the game can invite.');
  }
  const token = await sql.begin((tx) => reissueInvitation(tx, gameId));
  if (!token) throw new ApiError(409, 'invitation_used', 'Your friend has already joined.');
  return { game: await loadView(sql, player.id, gameId, types), invitation: { token } };
}

async function redeemInvitation(sql: Sql, player: Player, body: Record<string, unknown>, types: string[]) {
  const token = body.token;
  if (typeof token !== 'string' || !SECRET.test(token)) {
    throw new ApiError(404, 'invitation_not_found', 'Invitation not found.');
  }
  const tokenHash = await hashHex(token);

  const gameId = await sql.begin(async (tx) => {
    // Locking the invitation serialises competing claims: exactly one can take the seat.
    const [invitation] = await tx`
      select i.game_id, i.seat, i.redeemed_by, g.game_type, g.schema_version, g.payload, g.created_by, g.status,
             ${ROSTER(tx)} as roster
        from game_invitations i join games g on g.id = i.game_id
       where i.token_hash = decode(${tokenHash}, 'hex')
         for update of i`;
    if (!invitation) throw new ApiError(404, 'invitation_not_found', 'Invitation not found.');
    // Refused before any write: a game the client cannot show, a game that has no invitations
    // (a table seats everyone when it is created), or one whose seats do not fit it.
    if (readable(invitation, types).family !== 'chess') throw NOT_FOR_THIS_GAME('An invitation');
    playable(invitation, types);
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
  return { game: await loadView(sql, player.id, gameId, types) };
}

// ---------- history and rematches ----------

export interface HistoryEntry {
  gameType: string;
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

/**
 * Finished games per opponent, newest first, with an exact tally. Only the player's own games,
 * and only chess-family types: a table has one ranking for everyone at it and never adds to a
 * per-opponent win/loss tally (see loadTables).
 */
async function loadHistory(sql: Sql, playerId: string, asked: string[]): Promise<HistoryEntry[]> {
  const types = asked.filter((type) => creatableAdapter(type)?.family === 'chess');
  const rows = await sql`
    select g.id, g.game_type, g.schema_version, g.payload, g.result, g.termination,
           g.updated_at as finished_at, me.seat as your_seat, g.created_by, ${ROSTER(sql)} as roster,
           opp.player_id as opponent_id, pl.display_name as opponent_name
      from games g
      join game_participants me on me.game_id = g.id and me.player_id = ${playerId}
      join game_participants opp on opp.game_id = g.id and opp.player_id <> ${playerId}
      join players pl on pl.id = opp.player_id
     where g.status = 'finished' and g.game_type = any(${types}::text[])
     order by g.updated_at desc, g.id`;

  // One entry per game type AND opponent: results of different types are never combined.
  const byOpponent = new Map<string, HistoryEntry>();
  for (const row of rows) {
    const adapter = adapterFor(row.game_type, row.schema_version);
    if (!adapter || adapter.family !== 'chess') continue; // unreadable here: left out, left untouched
    // Seats that do not fit the game (e.g. a third player): never counted towards any tally.
    if (!adapter.seatsValid(row.payload, row.roster as SeatedPlayer[], row.created_by, 'finished')) continue;
    const key = `${row.game_type}:${row.opponent_id}`;
    let entry = byOpponent.get(key);
    if (!entry) {
      entry = {
        gameType: row.game_type,
        opponent: { id: row.opponent_id, displayName: row.opponent_name },
        wins: 0,
        draws: 0,
        losses: 0,
        games: [],
      };
      byOpponent.set(key, entry);
    }
    const outcome = row.result === 'draw' ? 'draw' : row.result === row.your_seat ? 'win' : 'loss';
    entry[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'draws']++;
    entry.games.push({
      id: row.id,
      finishedAt: (row.finished_at as Date).toISOString(),
      outcome,
      termination: row.termination,
      yourSeat: row.your_seat,
      moveCount: adapter.moveCount(row.payload),
    });
  }
  return [...byOpponent.values()];
}

export interface TableResult {
  id: string;
  gameType: string;
  finishedAt: string;
  yourSeat: Seat;
  /** The finished table as its players see it: seats with names, and the type's ranking. */
  players: GameView['players'];
  result: Record<string, unknown>;
}

/**
 * Finished tables the player sat at, newest first (#85): each with its own ranking, kept apart
 * from the per-opponent chess tallies. Only asked-for table types this server reads.
 */
async function loadTables(sql: Sql, playerId: string, asked: string[]): Promise<TableResult[]> {
  const types = asked.filter((type) => creatableAdapter(type)?.family === 'table');
  if (types.length === 0) return [];
  // Finished tables only, chosen by the query: unfinished ones never crowd a result out of the limit.
  const rows = await loadRows(sql, playerId, null, types, 'finished');
  return rows.flatMap((row) => {
    const adapter = adapterFor(row.game_type, row.schema_version);
    if (!adapter || adapter.family !== 'table' || !seatsValid(row, adapter)) return [];
    const [view] = viewOrNothing(row, adapter);
    if (!view) return [];
    return [
      {
        id: row.id,
        gameType: row.game_type,
        finishedAt: row.updated_at.toISOString(),
        yourSeat: row.your_seat,
        players: view.players,
        result: adapter.view(row.payload),
      },
    ];
  });
}

/**
 * "Play again": a new game between the same two players, colours swapped, no invitation needed.
 * Each finished game has at most one rematch, so a second request (from either player) finds it.
 */
async function startRematch(sql: Sql, player: Player, gameId: string, types: string[]) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');

  const started = await sql.begin(async (tx) => {
    const [source] = await tx`
      select g.status, g.game_type, g.schema_version, g.payload, g.created_by, ${ROSTER(tx)} as roster
        from games g
        join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
       where g.id = ${gameId}`;
    if (!source) throw new ApiError(404, 'game_not_found', 'Game not found.');
    if (readable(source, types).family !== 'chess') throw NOT_FOR_THIS_GAME('Play again');
    // Never continue a game whose seats do not fit it: the rematch would copy them.
    playable(source, types);
    if (source.status !== 'finished') throw new ApiError(409, 'not_finished', 'This game is still going.');
    // "Play again" keeps the game type, with that type's current rules and a fresh start.
    const adapter = creatableAdapter(source.game_type);
    if (!adapter) throw UNSUPPORTED();

    const [game] = await tx`
      insert into games (game_type, schema_version, status, payload, created_by, rematch_of)
      values (${adapter.type}, ${adapter.schemaVersion}, 'active', ${tx.json(adapter.create() as never)}, ${player.id}, ${gameId})
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
    body: { game: await loadView(sql, player.id, started.gameId, types), duplicate: started.duplicate },
  };
}

/** The common parts of an action request; the action itself is read by the game's type. */
function parseActionRequest(body: Record<string, unknown>): {
  requestId: string;
  expectedRevision: number;
  action: Record<string, unknown> | undefined;
} {
  const { requestId, expectedRevision, action } = body as {
    requestId?: unknown;
    expectedRevision?: unknown;
    action?: unknown;
  };
  if (typeof requestId !== 'string' || !UUID.test(requestId)) {
    throw new ApiError(400, 'bad_request', '"requestId" must be a UUID.');
  }
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new ApiError(400, 'bad_request', '"expectedRevision" must be a non-negative integer.');
  }
  const raw = action && typeof action === 'object' && !Array.isArray(action) ? (action as Record<string, unknown>) : undefined;
  return { requestId, expectedRevision: expectedRevision as number, action: raw };
}

async function submitAction(sql: Sql, player: Player, gameId: string, body: Record<string, unknown>, types: string[]) {
  if (!UUID.test(gameId)) throw new ApiError(404, 'game_not_found', 'Game not found.');
  const { requestId, expectedRevision, action: raw } = parseActionRequest(body);

  return await sql.begin(async (tx) => {
    // The row lock serialises actions on one game; the revision check rejects stale clients.
    const [game] = await tx`
      select g.game_type, g.schema_version, g.status, g.revision, g.payload, g.created_by, me.seat,
             ${ROSTER(tx)} as roster
        from games g
        join game_participants me on me.game_id = g.id and me.player_id = ${player.id}
       where g.id = ${gameId}
         for update of g`;
    if (!game) throw new ApiError(404, 'game_not_found', 'Game not found.');
    const adapter = playable(game, types);

    // Resigning is common to the chess family; anything else is read by the game's type.
    const resignable = adapter.family === 'chess';
    if (raw?.type === 'resign' && !resignable) throw NOT_FOR_THIS_GAME('Resigning');
    const action: TypedAction | null = raw?.type === 'resign' ? { type: 'resign' } : adapter.parseAction(raw);
    if (!action) {
      throw new ApiError(400, 'bad_request', `"action" is not a valid ${adapter.type} action${resignable ? ' or {type: "resign"}' : ''}.`);
    }

    // A request ID seen before: the same action again (a retry after a lost reply) gets the
    // current game; anything else is a client bug. Decided before the turn, revision or rules,
    // which may all have moved on since the first attempt was saved.
    const [earlier] = await tx`
      select kind, move from game_actions
       where game_id = ${gameId} and player_id = ${player.id} and request_id = ${requestId}`;
    if (earlier) {
      const same =
        action.type === 'resign'
          ? earlier.kind === 'resign'
          : adapter.isRetryOf({ kind: earlier.kind as string, move: earlier.move as string | null }, action);
      if (same) {
        return { game: await loadView(tx, player.id, gameId, types), duplicate: true };
      }
      throw new ApiError(409, 'request_id_reused', 'This request ID was already used for a different action.');
    }

    if (game.revision !== expectedRevision) {
      throw new ApiError(409, 'stale_revision', 'The game has changed. Refresh and try again.', {
        game: await loadView(tx, player.id, gameId, types),
      });
    }
    // While waiting for the friend (#33), only the creator may act, and only by moving on their
    // own colour's turn (the turn check below): White's opening, as the creator plays White.
    // Resigning a game nobody has joined is not possible.
    if (game.status === 'waiting' && (action.type === 'resign' || game.created_by !== player.id)) {
      throw new ApiError(409, 'not_started', 'Waiting for your friend to join.');
    }
    if (game.status === 'finished') throw new ApiError(409, 'game_finished', 'This game is over.');

    const seat = game.seat as Seat;
    let payload: unknown = game.payload;
    let outcome: Outcome | null;
    let stored: { kind: string; move: string | null } = { kind: 'resign', move: null };

    if (action.type === 'resign') {
      outcome = { result: seat === 'white' ? 'black' : 'white', termination: 'resignation' };
    } else {
      if (adapter.turn(payload) !== seat) throw new ApiError(409, 'not_your_turn', 'It is not your turn.');
      const applied = adapter.apply(payload, seat, action);
      if ('error' in applied) throw new ApiError(applied.error.status, applied.error.code, applied.error.message);
      payload = applied.payload;
      outcome = applied.outcome;
      stored = applied.stored;
    }

    const revision = game.revision + 1;
    await tx`
      update games
         set payload = ${tx.json(payload as never)},
             revision = ${revision},
             status = ${outcome ? 'finished' : game.status},
             result = ${outcome?.result ?? null},
             termination = ${outcome?.termination ?? null},
             updated_at = now()
       where id = ${gameId}`;
    await tx`
      insert into game_actions (game_id, player_id, request_id, kind, move, revision)
      values (${gameId}, ${player.id}, ${requestId}, ${stored.kind}, ${stored.move}, ${revision})`;

    return { game: await loadView(tx, player.id, gameId, types), duplicate: false };
  });
}
