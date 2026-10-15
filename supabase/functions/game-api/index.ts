// FriendlyGames shared-game API. See docs/backend.md for the contract.
import postgres from 'postgres';
import { handleRequest } from './api.ts';
import { databaseUrl } from './databaseUrl.ts';

const provided = Deno.env.get('SUPABASE_DB_URL');
if (!provided) throw new Error('SUPABASE_DB_URL is not set');

const sql = postgres(databaseUrl(provided), { max: 5, prepare: false });

// Production sets ALLOWED_ORIGINS (comma-separated) to the site's origin; unset allows any origin.
const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((o) => o.trim()).filter(Boolean) ?? null;
const config = { allowedOrigins, commit: Deno.env.get('GAME_API_COMMIT') ?? null };

Deno.serve((request) => handleRequest(request, sql, config));
