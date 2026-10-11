// FriendlyGames shared-game API. See docs/backend.md for the contract.
import postgres from 'postgres';
import { handleRequest } from './api.ts';

// GAME_DB_URL overrides the platform-provided URL. The local stack needs it: Deno's resolver
// rejects the underscore in the local container hostname (supabase_db_<project>).
const databaseUrl = Deno.env.get('GAME_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL');
if (!databaseUrl) throw new Error('SUPABASE_DB_URL is not set');

const sql = postgres(databaseUrl, { max: 5, prepare: false });

// Production sets ALLOWED_ORIGINS (comma-separated) to the site's origin; unset allows any origin.
const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((o) => o.trim()).filter(Boolean) ?? null;
const config = { allowedOrigins, commit: Deno.env.get('GAME_API_COMMIT') ?? null };

Deno.serve((request) => handleRequest(request, sql, config));
