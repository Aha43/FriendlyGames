// @vitest-environment node
// The Fischer Random browser journey (#55) reaches a castle from whatever start the server draws.
// Proven here for all 960 starts, so the journey cannot meet a start it does not handle.
import { describe, expect, it } from 'vitest';
import { applyAction, legalCastles, replay, SCHEMA_VERSION, type Chess960Record } from '../../supabase/functions/_shared/chess960/rules.ts';
import { START_COUNT, startFen } from '../../supabase/functions/_shared/chess960/start.ts';
import { planCastle } from '../../e2e/chess960Setup';

describe('Fischer Random journey setup', () => {
  it('reaches a legal White castle from every one of the 960 starts with ordinary moves', () => {
    let longest = 0;
    for (let index = 0; index < START_COUNT; index++) {
      const initialFen = startFen(index);
      const { moves, castles } = planCastle(initialFen);
      // Replay as the server will: each planned move is an ordinary, legal move.
      let record: Chess960Record = { schemaVersion: SCHEMA_VERSION, initialFen, moves: [] };
      for (const { from, to } of moves) {
        const applied = applyAction(record, { type: 'move', from, to });
        if ('error' in applied) throw new Error(`start ${index}: ${from}${to} refused (${applied.error})`);
        record = applied.record;
      }
      const position = replay(record);
      expect(position.turn).toBe('white');
      expect(legalCastles(position)).toEqual(castles);
      expect(castles.length).toBeGreaterThan(0);
      longest = Math.max(longest, moves.length);
    }
    // Few enough to send through the API quickly in the journey.
    expect(longest).toBeLessThanOrEqual(24);
  });
});
