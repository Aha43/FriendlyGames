import { describe, expect, it } from 'vitest';
import { databaseConnection, databaseUrl } from './databaseUrl.ts';

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
    const pooler = 'postgresql://postgres.ref:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';
    expect(databaseConnection(env({ GAME_DB_POOLER_URL: pooler, SUPABASE_DB_URL: 'postgresql://x@db.ref.supabase.co:5432/postgres' }))).toEqual({
      url: pooler,
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
