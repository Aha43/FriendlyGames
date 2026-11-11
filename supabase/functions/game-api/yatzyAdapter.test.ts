// The Yatzy adapter (#85) with chosen dice: what the service saves and shows for a throw and a
// score, what it reads from a request, and fair server dice.
import { describe, expect, it } from 'vitest';
import type { Die } from '../_shared/yatzy/rules.ts';
import { rollDice, yatzyAdapter, yatzyOptions } from './gameTypes.ts';

const fixed = (dice: Die[]) => (count: number) => dice.slice(0, count);

describe('the Yatzy adapter', () => {
  it('rolls with the server’s dice, keeps positions, and stores the intent as notation', () => {
    const adapter = yatzyAdapter(fixed([6, 6, 6, 6, 6]));
    let payload = adapter.create(yatzyOptions('free', 3));
    expect(payload).toEqual({ mode: 'free', players: 3, log: [] });
    expect(adapter.turn(payload)).toBe('p1');

    const first = adapter.apply(payload, 'p1', adapter.parseAction({ type: 'throw' })!);
    if ('error' in first) throw new Error(first.error.code);
    expect(first.stored).toEqual({ kind: 'throw', move: 'keep:' });
    expect(first.outcome).toBeNull();
    payload = first.payload;

    const second = yatzyAdapter(fixed([1, 2])).apply(payload, 'p1', adapter.parseAction({ type: 'throw', keep: [4, 0, 2] })!);
    if ('error' in second) throw new Error(second.error.code);
    expect(second.stored).toEqual({ kind: 'throw', move: 'keep:024' });
    expect((second.payload as { log: unknown[] }).log.at(-1)).toEqual({ t: 'throw', keep: [0, 2, 4], dice: [6, 1, 6, 2, 6] });

    const scored = adapter.apply(second.payload, 'p1', adapter.parseAction({ type: 'score', row: 'sixes' })!);
    if ('error' in scored) throw new Error(scored.error.code);
    expect(scored.stored).toEqual({ kind: 'score', move: 'row:sixes' });
    expect(adapter.turn(scored.payload)).toBe('p2');
    expect(adapter.moveCount(scored.payload)).toBe(3);
    const view = adapter.view(scored.payload).yatzy as { players: { seat: string; scores: unknown; tokens: number; total: number }[] };
    expect(view.players[0]).toMatchObject({ seat: 'p1', scores: { sixes: 18 }, tokens: 1, total: 18 });
  });

  it('reads only a keep list or a row from a request', () => {
    const adapter = yatzyAdapter();
    expect(adapter.parseAction({ type: 'throw', keep: [3, 1] })).toEqual({ type: 'throw', keep: [1, 3] });
    expect(adapter.parseAction({ type: 'throw' })).toEqual({ type: 'throw', keep: [] });
    expect(adapter.parseAction({ type: 'score', row: 'fullHouse' })).toEqual({ type: 'score', row: 'fullHouse' });
    for (const raw of [
      { type: 'throw', keep: [], dice: [1, 1, 1, 1, 1] },
      { type: 'throw', keep: [0, 1, 2, 3, 4] },
      { type: 'throw', keep: [1, 1] },
      { type: 'score', row: 'chance', points: 30 },
      { type: 'score', row: 'toString' },
      { type: 'move', from: 'e2', to: 'e4' },
      undefined,
    ]) {
      expect(adapter.parseAction(raw as Record<string, unknown> | undefined), JSON.stringify(raw)).toBeNull();
    }
  });

  it('recognises a retry by its intent, never by the dice', () => {
    const adapter = yatzyAdapter();
    expect(adapter.isRetryOf({ kind: 'throw', move: 'keep:13' }, { type: 'throw', keep: [1, 3] })).toBe(true);
    expect(adapter.isRetryOf({ kind: 'throw', move: 'keep:13' }, { type: 'throw', keep: [1] })).toBe(false);
    expect(adapter.isRetryOf({ kind: 'throw', move: 'keep:' }, { type: 'score', row: 'ones' })).toBe(false);
    expect(adapter.isRetryOf({ kind: 'score', move: 'row:ones' }, { type: 'score', row: 'ones' })).toBe(true);
    expect(adapter.isRetryOf({ kind: 'score', move: 'row:ones' }, { type: 'score', row: 'twos' })).toBe(false);
  });

  it('accepts exactly the seats p1..pN for a record of N players', () => {
    const adapter = yatzyAdapter();
    const three = adapter.create(yatzyOptions('forced', 3));
    expect(adapter.seatsValid(three, ['p2', 'p1', 'p3'])).toBe(true);
    for (const seats of [['p1', 'p2'], ['p1', 'p2', 'p4'], ['p1', 'p2', 'p3', 'p4'], ['white', 'black', 'p3'], ['p1', 'p1', 'p2'], []]) {
      expect(adapter.seatsValid(three, seats), seats.join()).toBe(false);
    }
    expect(adapter.seatsValid({ mode: 'free', log: [] }, ['p1', 'p2'])).toBe(false);
    expect(yatzyOptions('free', 1)).toBeNull();
    expect(yatzyOptions('free', 5)).toBeNull();
    expect(yatzyOptions('fast', 2)).toBeNull();
  });

  it('ends a table as scored when the last card is full', () => {
    const adapter = yatzyAdapter(fixed([1, 2, 3, 4, 6]));
    let payload = adapter.create(yatzyOptions('forced', 2));
    let outcome = null;
    for (let turn = 0; turn < 30; turn++) {
      const seat = adapter.turn(payload)!;
      const thrown = adapter.apply(payload, seat, { type: 'throw', keep: [] });
      if ('error' in thrown) throw new Error(thrown.error.code);
      const state = adapter.view(thrown.payload).yatzy as { players: { scores: Record<string, number> }[] };
      const next = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'onePair', 'twoPairs', 'threeOfAKind', 'fourOfAKind', 'smallStraight', 'largeStraight', 'fullHouse', 'chance', 'yatzy'].find(
        (row) => state.players[seat === 'p1' ? 0 : 1].scores[row] === undefined,
      )!;
      const scored = adapter.apply(thrown.payload, seat, { type: 'score', row: next });
      if ('error' in scored) throw new Error(scored.error.code);
      payload = scored.payload;
      outcome = scored.outcome;
    }
    expect(outcome).toEqual({ result: 'scored', termination: 'scorecards-complete' });
    expect(adapter.turn(payload)).toBeNull();
    const view = adapter.view(payload).yatzy as { winners: string[]; standings: { place: number }[] };
    expect(view.winners).toEqual(['p1', 'p2']);
    expect(view.standings.map((s) => s.place)).toEqual([1, 1]);
    expect(adapter.apply(payload, 'p1', { type: 'throw', keep: [] })).toMatchObject({ error: { status: 409, code: 'game_finished' } });
  });
});

describe('server dice', () => {
  it('are 1–6, as many as asked, with every face about equally often', () => {
    expect(rollDice(0)).toEqual([]);
    expect(rollDice(5)).toHaveLength(5);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const die of rollDice(60_000)) counts[die]++;
    expect(counts[0]).toBe(0);
    // Each face expects 10,000; ±500 is about seven standard deviations.
    for (let face = 1; face <= 6; face++) expect(Math.abs(counts[face] - 10_000)).toBeLessThan(500);
  });
});
