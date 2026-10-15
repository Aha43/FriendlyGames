import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { handleRequest } from './api.ts';

const noDatabase = {} as Sql; // preflight requests never reach the database

function preflight(origin: string, allowedOrigins: string[] | null) {
  return handleRequest(
    new Request('https://api.example/functions/v1/game-api/games', { method: 'OPTIONS', headers: { origin } }),
    noDatabase,
    { allowedOrigins, commit: null },
  );
}

describe('CORS', () => {
  it('allows any origin when no allow-list is configured (local development)', async () => {
    const response = await preflight('http://10.0.0.9:5173', null);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('allows only listed origins in production', async () => {
    const allowed = await preflight('https://friendlygames.pages.dev', ['https://friendlygames.pages.dev']);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://friendlygames.pages.dev');
    expect(allowed.headers.get('vary')).toBe('Origin');

    const other = await preflight('https://evil.example', ['https://friendlygames.pages.dev']);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
