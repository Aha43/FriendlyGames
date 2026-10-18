// FriendlyGames shared-game API. See docs/backend.md for the contract.
import postgres from 'postgres';
import { handleRequest } from './api.ts';
import { databaseConnection } from './databaseUrl.ts';

const database = databaseConnection(Deno.env);

// Few connections per instance, closed when idle: Supabase starts many short-lived instances.
// prepare: false is required by the pooler's transaction mode.
const sql = postgres(database.url, { max: 2, idle_timeout: 10, prepare: false });

// Production sets ALLOWED_ORIGINS (comma-separated) to the site's origin; unset allows any origin.
const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((o) => o.trim()).filter(Boolean) ?? null;
const config = { allowedOrigins, commit: Deno.env.get('GAME_API_COMMIT') ?? null, pooled: database.pooled };

Deno.serve((request) => handleRequest(request, sql, config));
