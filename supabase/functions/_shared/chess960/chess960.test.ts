// Chess960 proof (#52) under Vitest/Node. The same fixtures also run in the browser bundle,
// Deno and the Supabase Edge runtime (see docs/decisions/0001-chess960-engine.md).
import { Chess as ChessJs } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { CHECKS } from './fixtures.ts';
import { randomStartIndex, START_COUNT } from './start.ts';

describe('Chess960 fixtures', () => {
  for (const [name, check] of Object.entries(CHECKS)) {
    it(name, () => {
      const failures: string[] = [];
      check((message) => failures.push(message));
      expect(failures).toEqual([]);
    });
  }
});

describe('why the current engine is not enough', () => {
  it('chess.js 1.4.0 castles Kc1/Rh1 by moving the king to e1 (orthodox), not g1', () => {
    const chess = new ChessJs('4k3/8/8/8/8/8/8/R1K4R w K - 0 1');
    const castles = chess.moves({ verbose: true }).filter((m) => m.isKingsideCastle());
    expect(castles.map((m) => `${m.from}${m.to}`)).toEqual(['c1e1']);
  });
});

describe('random starts', () => {
  /** A random source that hands out these 16-bit values in order. */
  const feed = (values: number[]) => {
    let next = 0;
    const source = (buffer: Uint16Array<ArrayBuffer>) => {
      buffer[0] = values[next++];
      return buffer;
    };
    return { source, used: () => next };
  };

  it('maps each of the 65280 accepted values to a start, 68 times per start', () => {
    const counts = new Map<number, number>();
    for (let value = 0; value < 65280; value++) {
      const index = randomStartIndex(feed([value]).source);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    expect(counts.size).toBe(START_COUNT);
    expect(new Set(counts.values())).toEqual(new Set([68]));
  });

  it('rejects the top 256 values instead of folding them (no modulo bias)', () => {
    const random = feed([65280, 65535, 961]);
    expect(randomStartIndex(random.source)).toBe(1);
    expect(random.used()).toBe(3);
  });

  it('uses the platform’s cryptographic random source by default', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomStartIndex()));
    expect(seen.size).toBeGreaterThan(150);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(START_COUNT);
    }
  });
});
