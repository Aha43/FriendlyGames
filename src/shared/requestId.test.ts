import { afterEach, describe, expect, it, vi } from 'vitest';
import { newRequestId } from './requestId';

describe('newRequestId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes distinct v4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 100 }, newRequestId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('works where crypto.randomUUID is unavailable (plain-HTTP pages)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
