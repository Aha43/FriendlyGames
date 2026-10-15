import { describe, expect, it } from 'vitest';
import { databaseUrl } from './databaseUrl.ts';

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
