import { describe, expect, it } from 'vitest';
import { databaseConnection, databaseUrl } from './databaseUrl.ts';

// A recognisable marker standing in for the password part of a URL, so tests can check error
// messages never repeat it. Not a credential; built at runtime so secret scanners see no
// hard-coded password.
const MARKER = ['leak', 'check', 'marker'].join('-');
const pooler = (port: string, host = 'aws-1-eu-central-1.pooler.supabase.com') =>
  `postgresql://postgres.abcdefghijklmnop:${MARKER}@${host}${port ? `:${port}` : ''}/postgres`;

describe('databaseUrl', () => {
  it('reaches the local database container by its resolvable alias', () => {
    expect(databaseUrl('postgresql://postgres:postgres@supabase_db_friendlygames:5432/postgres')).toBe(
      'postgresql://postgres:postgres@db.supabase.internal:5432/postgres',
    );
  });

  it('leaves hosted database URLs unchanged', () => {
    const hosted = 'postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
    expect(databaseUrl(hosted)).toBe(hosted);
    const direct = 'postgresql://postgres:secret@db.abcdefghijklmnop.supabase.co:5432/postgres';
    expect(databaseUrl(direct)).toBe(direct);
  });
});

describe('databaseConnection', () => {
  const env = (vars: Record<string, string>) => ({ get: (name: string) => vars[name] });

  it('uses the pooler secret when it is set', () => {
    const url = pooler('6543');
    expect(databaseConnection(env({ GAME_DB_POOLER_URL: url, SUPABASE_DB_URL: 'postgresql://x@db.ref.supabase.co:5432/postgres' }))).toEqual({
      url,
      pooled: true,
    });
  });

  it('falls back to the platform URL (locally: via the container alias)', () => {
    expect(databaseConnection(env({ SUPABASE_DB_URL: 'postgresql://postgres:postgres@supabase_db_friendlygames:5432/postgres' }))).toEqual({
      url: 'postgresql://postgres:postgres@db.supabase.internal:5432/postgres',
      pooled: false,
    });
  });

  it('fails clearly without any database URL', () => {
    expect(() => databaseConnection(env({}))).toThrow('SUPABASE_DB_URL is not set');
  });
});

describe('pooler validation', () => {
  const env = (vars: Record<string, string>) => ({ get: (name: string) => vars[name] });
  const attempt = (pooler: string) => () => databaseConnection(env({ GAME_DB_POOLER_URL: pooler, SUPABASE_DB_URL: 'postgresql://x@db.ref.supabase.co:5432/postgres' }));

  it.each([
    ['the session pooler (port 5432)', pooler('5432')],
    ['a direct database connection', pooler('5432', 'db.abcdefghijklmnop.supabase.co')],
    ['a direct connection on 6543', pooler('6543', 'db.abcdefghijklmnop.supabase.co')],
    ['the pooler without a port', pooler('')],
    ['another scheme', pooler('6543').replace('postgresql:', 'https:')],
  ])('rejects %s without revealing the URL', (_name, url) => {
    expect(attempt(url)).toThrow(/must be Supabase's transaction pooler/);
    try {
      attempt(url)();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(MARKER);
      expect(String((error as Error).message)).not.toContain('abcdefghijklmnop');
    }
  });

  it('rejects text that is not a URL without echoing it', () => {
    expect(attempt(`not a url ${MARKER}`)).toThrow('GAME_DB_POOLER_URL is not a valid URL.');
  });
});
