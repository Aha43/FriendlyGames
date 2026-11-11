// Yatzy rules proof (#84): the agreed scorecard, Forced and Free, banked throws, turn order for
// two to four players, the ranking with both tiebreak levels, and resuming from a saved record.
import { describe, expect, it } from 'vitest';
import { completeGame, ONE_THROW, play, type Scripted } from './fixtures';
import {
  applyScore,
  applyThrow,
  newRecord,
  openRows,
  preview,
  replay,
  ROWS,
  scoreRow,
  standings,
  throwCost,
  total,
  upperBonus,
  winners,
  type Die,
  type Row,
  type YatzyRecord,
  type YatzyState,
} from './rules';

const state = (record: YatzyRecord): YatzyState => {
  const s = replay(record);
  if ('error' in s) throw new Error(s.error.message);
  return s;
};
const roll = (dice: Die[]) => () => dice;

describe('scorecard rows (the agreed Norwegian card)', () => {
  const cases: [Row, Die[], number][] = [
    ['ones', [1, 1, 2, 3, 1], 3],
    ['ones', [2, 3, 4, 5, 6], 0],
    ['twos', [2, 2, 2, 2, 5], 8],
    ['threes', [3, 1, 1, 1, 1], 3],
    ['fours', [4, 4, 1, 2, 3], 8],
    ['fives', [5, 5, 5, 5, 5], 25],
    ['sixes', [6, 1, 6, 1, 6], 18],
    // One pair: the highest pair only.
    ['onePair', [3, 3, 5, 5, 1], 10],
    ['onePair', [6, 6, 6, 2, 1], 12],
    ['onePair', [1, 2, 3, 4, 6], 0],
    // Two pairs: two different faces; a four of a kind or five equal dice are not two pairs.
    ['twoPairs', [3, 3, 5, 5, 1], 16],
    ['twoPairs', [2, 2, 4, 4, 4], 12],
    ['twoPairs', [6, 6, 6, 6, 2], 0],
    ['twoPairs', [5, 5, 5, 5, 5], 0],
    ['twoPairs', [1, 1, 2, 3, 4], 0],
    // Sets sum only the matching dice; five equal dice qualify.
    ['threeOfAKind', [4, 4, 4, 6, 6], 12],
    ['threeOfAKind', [2, 2, 2, 2, 6], 6],
    ['threeOfAKind', [5, 5, 5, 5, 5], 15],
    ['threeOfAKind', [1, 1, 2, 2, 3], 0],
    ['fourOfAKind', [3, 3, 3, 3, 6], 12],
    ['fourOfAKind', [6, 6, 6, 6, 6], 24],
    ['fourOfAKind', [6, 6, 6, 5, 5], 0],
    // Straights: exactly 1–5 or 2–6, fixed points.
    ['smallStraight', [5, 3, 1, 4, 2], 15],
    ['smallStraight', [2, 3, 4, 5, 6], 0],
    ['largeStraight', [6, 2, 5, 3, 4], 20],
    ['largeStraight', [1, 2, 3, 4, 5], 0],
    ['largeStraight', [2, 3, 4, 5, 5], 0],
    // Full house: a triple and a pair of different faces, all five dice summed.
    ['fullHouse', [2, 2, 6, 6, 6], 22],
    ['fullHouse', [1, 1, 1, 2, 2], 7],
    ['fullHouse', [4, 4, 4, 4, 4], 0],
    ['fullHouse', [4, 4, 4, 4, 2], 0],
    ['fullHouse', [1, 1, 2, 2, 3], 0],
    ['chance', [1, 2, 3, 4, 6], 16],
    ['chance', [1, 1, 1, 1, 1], 5],
    ['yatzy', [3, 3, 3, 3, 3], 50],
    ['yatzy', [3, 3, 3, 3, 4], 0],
  ];
  it.each(cases)('%s with %j scores %i', (row, dice, points) => {
    expect(scoreRow(row, dice)).toBe(points);
  });

  it('has fifteen rows in card order', () => {
    expect(ROWS).toHaveLength(15);
    expect(ROWS[0]).toBe('ones');
    expect(ROWS[14]).toBe('yatzy');
  });

  it('awards the upper bonus of 50 at 63 or more, not at 62', () => {
    const upper = (scores: Partial<Record<Row, number>>) => upperBonus({ scores, tokens: 0 });
    expect(upper({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 })).toBe(50); // 63
    expect(upper({ ones: 2, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 })).toBe(0); // 62
    expect(upper({ sixes: 30, fives: 25, fours: 20 })).toBe(50); // 75
  });

  it('totals a full card: rows plus bonus', () => {
    const final = state(completeGame('free', 2));
    expect(final.players.map(total)).toEqual([330, 330]);
  });
});

describe('a turn', () => {
  it('starts with five fresh dice, keeps positions on later throws, and shows the score first', () => {
    let record = newRecord('free', 2);
    const first = applyThrow(record, [], roll([2, 5, 5, 1, 5]));
    if ('error' in first) throw first.error;
    record = first.record;
    expect(first.state.turn).toEqual({ throws: 1, dice: [2, 5, 5, 1, 5], kept: [] });
    // Keep the three fives (positions 1, 2, 4); only two dice are rolled.
    let asked = 0;
    const second = applyThrow(record, [4, 1, 2], (n) => {
      asked = n;
      return [5, 3];
    });
    if ('error' in second) throw second.error;
    expect(asked).toBe(2);
    expect(second.state.turn).toEqual({ throws: 2, dice: [5, 5, 5, 3, 5], kept: [1, 2, 4] });
    expect(preview(second.state, 'fourOfAKind')).toEqual({ points: 20, tokens: 1 });
    expect(preview(second.state, 'yatzy')).toEqual({ points: 0, tokens: 1 });
  });

  it('refuses keeping on the first throw, keeping all five, repeated or out-of-range positions', () => {
    const record = newRecord('free', 2);
    expect(applyThrow(record, [0], roll([1, 1, 1, 1]))).toMatchObject({ error: { code: 'bad_keep' } });
    const thrown = play(record, [{ throw: [1, 2, 3, 4, 5] }]);
    for (const keep of [[0, 1, 2, 3, 4], [1, 1], [5], [-1], [0.5], 'all', null]) {
      expect(applyThrow(thrown, keep, roll([1]))).toMatchObject({ error: { code: 'bad_keep' } });
    }
  });

  it('cannot score before throwing, a used row, or an unknown row', () => {
    const record = newRecord('free', 2);
    expect(applyScore(record, 'chance')).toMatchObject({ error: { code: 'not_thrown' } });
    // Seat 0 scores chance, seat 1 plays, then seat 0 tries chance again.
    const again = play(record, [
      { throw: [1, 2, 3, 4, 6] },
      { score: 'chance' },
      { throw: [1, 1, 1, 1, 1] },
      { score: 'yatzy' },
      { throw: [6, 6, 6, 6, 6] },
    ]);
    expect(applyScore(again, 'chance')).toMatchObject({ error: { code: 'row_used' } });
    expect(applyScore(again, 'bonus' as Row)).toMatchObject({ error: { code: 'bad_row' } });
  });

  it('records zero for a row the dice do not match', () => {
    const final = state(play(newRecord('free', 2), [{ throw: [1, 2, 3, 4, 6] }, { score: 'yatzy' }]));
    expect(final.players[0].scores).toEqual({ yatzy: 0 });
  });
});

describe('Forced and Free', () => {
  it('Forced offers only the next row on the card, top to bottom', () => {
    const record = play(newRecord('forced', 2), [{ throw: [6, 6, 6, 6, 6] }]);
    expect(openRows(state(record))).toEqual(['ones']);
    expect(applyScore(record, 'yatzy')).toMatchObject({ error: { code: 'row_order' } });
    const later = play(record, [{ score: 'ones' }, { throw: [1, 1, 1, 1, 1] }, { score: 'ones' }, { throw: [2, 2, 2, 2, 2] }]);
    expect(openRows(state(later))).toEqual(['twos']);
    expect(state(later).players[0].scores).toEqual({ ones: 0 });
  });

  it('Free offers every empty row after any throw', () => {
    const record = play(newRecord('free', 3), [{ throw: [6, 6, 6, 6, 6] }, { score: 'yatzy' }, { throw: [1, 2, 3, 4, 5] }]);
    expect(openRows(state(record))).toHaveLength(15);
    const back = play(record, [{ score: 'smallStraight' }, { throw: [2, 3, 4, 5, 6] }, { score: 'largeStraight' }, { throw: [1, 1, 2, 2, 2] }]);
    expect(openRows(state(back))).toEqual(ROWS.filter((r) => r !== 'yatzy'));
  });

  it('both modes bank and spend tokens identically', () => {
    for (const mode of ['forced', 'free'] as const) {
      const final = state(completeGame(mode, 2));
      expect(final.players.map((p) => p.tokens)).toEqual([30, 30]);
    }
  });
});

describe('banked throws (tokens)', () => {
  const scoreAfter = (throws: number): Scripted[] => [
    ...Array.from({ length: throws }, (_, i): Scripted => (i === 0 ? { throw: [1, 2, 3, 4, 6] } : { throw: [1, 2, 3, 4, 6], keep: [0, 1, 2, 3] })),
    { score: 'chance' },
  ];

  it('starts at zero and banks 2, 1 or 0 for scoring on the first, second or third throw', () => {
    expect(state(newRecord('free', 2)).players.map((p) => p.tokens)).toEqual([0, 0]);
    for (const [throws, banked] of [[1, 2], [2, 1], [3, 0]]) {
      const final = state(play(newRecord('free', 2), scoreAfter(throws)));
      expect(final.players[0].tokens, `scored after ${throws}`).toBe(banked);
    }
  });

  it('a fourth throw needs a token; with none it is refused', () => {
    const thirdThrow = play(newRecord('free', 2), scoreAfter(3).slice(0, 3));
    expect(throwCost(state(thirdThrow))).toEqual({ allowed: false, tokens: 1 });
    expect(applyThrow(thirdThrow, [0], roll([2, 3, 4, 6]))).toMatchObject({ error: { code: 'no_tokens' } });
  });

  it('spends one token per extra throw, several on one turn, up to the balance, and that turn banks nothing', () => {
    // Seat 0 banks 2 + 2 over two one-throw turns (4 tokens), seat 1 plays along.
    const banked = play(newRecord('free', 2), [
      ...scoreAfter(1),
      ...scoreAfter(1),
      { throw: [1, 2, 3, 4, 6] },
      { score: 'ones' },
      ...scoreAfter(1).map((a) => ('score' in a ? { score: 'twos' as Row } : a)),
    ]);
    expect(state(banked).players[0].tokens).toBe(4);
    // Chasing a Yatzy: three free throws, then four more spending all four tokens.
    const chase: Scripted[] = [{ throw: [6, 1, 2, 3, 4] }];
    for (let i = 0; i < 6; i++) chase.push({ throw: [6, 1, 2, 3, 4], keep: [0] });
    const spent = play(banked, chase);
    expect(state(spent).turn.throws).toBe(7);
    expect(state(spent).players[0].tokens).toBe(0);
    expect(throwCost(state(spent))).toEqual({ allowed: false, tokens: 1 });
    expect(preview(state(spent), 'sixes')).toEqual({ points: 6, tokens: 0 });
    const after = state(play(spent, [{ score: 'sixes' }]));
    expect(after.players[0].tokens).toBe(0);
    expect(after.players[0].scores.sixes).toBe(6);
  });
});

describe('turn order and the end of the game', () => {
  it.each([2, 3, 4])('%i players act in seat order and the game ends after every card is full', (players) => {
    let record = newRecord('free', players);
    const order: number[] = [];
    for (const row of ROWS) {
      for (let seat = 0; seat < players; seat++) {
        const s = state(record);
        order.push(s.current!);
        record = play(record, [{ throw: ONE_THROW[row] }, { score: row }]);
      }
    }
    expect(order).toEqual(Array.from({ length: 15 * players }, (_, i) => i % players));
    const final = state(record);
    expect(final.finished).toBe(true);
    expect(final.current).toBeNull();
    expect(applyThrow(record, [], roll([1, 1, 1, 1, 1]))).toMatchObject({ error: { code: 'game_finished' } });
  });

  it('allows two to four players only', () => {
    expect(() => newRecord('free', 1)).toThrow();
    expect(() => newRecord('free', 5)).toThrow();
    expect(replay({ ...newRecord('free', 2), players: 5 })).toMatchObject({ error: { code: 'bad_record' } });
  });

  // The last turn of each player decides: Yatzy (50) or a zero, and how many throws it took.
  const lastTurn =
    (byseat: Record<number, Scripted[]>) =>
    (seat: number, row: Row): Scripted[] | undefined =>
      row === 'yatzy' ? byseat[seat] : undefined;
  const yatzyOn = (throws: number): Scripted[] => [
    ...Array.from({ length: throws - 1 }, (_, i): Scripted => (i === 0 ? { throw: [6, 6, 6, 6, 1] } : { throw: [6, 6, 6, 6, 1], keep: [0, 1, 2, 3] })),
    throws === 1 ? { throw: [6, 6, 6, 6, 6] } : { throw: [6, 6, 6, 6, 6], keep: [0, 1, 2, 3] },
    { score: 'yatzy' },
  ];
  const miss: Scripted[] = [{ throw: [1, 2, 3, 4, 6] }, { score: 'yatzy' }];

  it('ranks by total first: the highest total wins', () => {
    const final = state(completeGame('free', 3, lastTurn({ 0: miss, 1: yatzyOn(3), 2: miss })));
    expect(standings(final)).toEqual([
      { seat: 1, total: 330, tokens: 28, place: 1 },
      { seat: 0, total: 280, tokens: 30, place: 2 },
      { seat: 2, total: 280, tokens: 30, place: 2 },
    ]);
    expect(winners(final)).toEqual([1]);
  });

  it('breaks a tie on points with unused tokens', () => {
    // Seats 0 and 1 both score the Yatzy; seat 1 needed two throws and banked one token less.
    const final = state(completeGame('forced', 3, lastTurn({ 0: yatzyOn(1), 1: yatzyOn(2), 2: miss })));
    expect(standings(final).map((s) => [s.seat, s.total, s.tokens, s.place])).toEqual([
      [0, 330, 30, 1],
      [1, 330, 29, 2],
      [2, 280, 30, 3],
    ]);
    expect(winners(final)).toEqual([0]);
  });

  it('makes players equal on both points and tokens joint winners (four players)', () => {
    const final = state(completeGame('free', 4, lastTurn({ 0: yatzyOn(2), 1: miss, 2: yatzyOn(2), 3: yatzyOn(3) })));
    expect(standings(final).map((s) => [s.seat, s.place])).toEqual([
      [0, 1],
      [2, 1],
      [3, 3],
      [1, 4],
    ]);
    expect(winners(final)).toEqual([0, 2]);
  });
});

describe('saving and resuming', () => {
  it('resumes mid-turn from the saved record with the same dice, kept positions, throw number and balances', () => {
    const record = play(newRecord('forced', 3), [
      { throw: [1, 1, 1, 2, 3] },
      { score: 'ones' },
      { throw: [4, 4, 2, 2, 6] },
      { throw: [4, 4, 2, 2, 1], keep: [0, 1, 2, 3] },
      { score: 'ones' },
      { throw: [5, 1, 3, 1, 1] },
      { throw: [6, 1, 2, 1, 1], keep: [1, 3, 4] },
    ]);
    // Saved as JSON (games.payload) and read back elsewhere, e.g. after a reload or on another device.
    const saved = JSON.parse(JSON.stringify(record)) as YatzyRecord;
    const resumed = state(saved);
    expect(resumed).toEqual(state(record));
    expect(resumed.current).toBe(2);
    expect(resumed.turn).toEqual({ throws: 2, dice: [6, 1, 2, 1, 1], kept: [1, 3, 4] });
    expect(resumed.players.map((p) => p.tokens)).toEqual([2, 1, 0]);
    expect(resumed.players.map((p) => p.scores)).toEqual([{ ones: 3 }, { ones: 1 }, {}]);
    // The game continues from there exactly as it would have.
    const next = applyScore(saved, 'ones');
    if ('error' in next) throw next.error;
    expect(next.state.players[2]).toEqual({ scores: { ones: 3 }, tokens: 1 }); // scored on the second throw
    expect(next.state.current).toBe(0);
  });

  it('reconstructs every score and balance of a finished game from its record alone', () => {
    const record = completeGame('free', 4);
    const final = state(JSON.parse(JSON.stringify(record)));
    expect(final.finished).toBe(true);
    expect(final.players.map(total)).toEqual([330, 330, 330, 330]);
    expect(final.players.map((p) => p.tokens)).toEqual([30, 30, 30, 30]);
    expect(winners(final)).toEqual([0, 1, 2, 3]);
    expect(record.log).toHaveLength(4 * 15 * 2);
  });

  it('is deterministic: the same record always replays to the same state', () => {
    const record = completeGame('forced', 3, (seat, row) => (row === 'chance' && seat === 1 ? [{ throw: [1, 1, 2, 2, 3] }, { score: 'chance' }] : undefined));
    expect(state(record)).toEqual(state(structuredClone(record)));
  });

  it('rejects a tampered record instead of guessing', () => {
    const record = play(newRecord('free', 2), [{ throw: [1, 2, 3, 4, 5] }, { throw: [1, 2, 6, 6, 6], keep: [0, 1] }]);
    const changedKept = structuredClone(record);
    (changedKept.log[1] as { dice: Die[] }).dice[0] = 6;
    expect(replay(changedKept)).toMatchObject({ error: { code: 'bad_dice' } });
    const badDie = structuredClone(record);
    (badDie.log[0] as { dice: number[] }).dice[4] = 7;
    expect(replay(badDie)).toMatchObject({ error: { code: 'bad_dice' } });
    expect(replay({ ...record, schemaVersion: 2 } as unknown as YatzyRecord)).toMatchObject({ error: { code: 'bad_record' } });
    expect(replay({ ...record, log: [{ t: 'score', row: 'chance' }] })).toMatchObject({ error: { code: 'not_thrown' } });
  });

  it('rejects malformed records and entries with a structured error, never throwing', () => {
    const good = play(newRecord('free', 2), [{ throw: [1, 2, 3, 4, 5] }]);
    const malformed: [string, unknown, string][] = [
      ['no record', null, 'bad_record'],
      ['a string', 'yatzy', 'bad_record'],
      ['an array', [], 'bad_record'],
      ['unknown mode', { ...good, mode: 'random' }, 'bad_record'],
      ['missing mode', { ...good, mode: undefined }, 'bad_record'],
      ['players as text', { ...good, players: '3' }, 'bad_record'],
      ['fractional players', { ...good, players: 2.5 }, 'bad_record'],
      ['one player', { ...good, players: 1 }, 'bad_record'],
      ['five players', { ...good, players: 5 }, 'bad_record'],
      ['NaN players', { ...good, players: Number.NaN }, 'bad_record'],
      ['missing players', { ...good, players: undefined }, 'bad_record'],
      ['log not a list', { ...good, log: {} }, 'bad_record'],
      ['a null entry', { ...good, log: [null] }, 'bad_entry'],
      ['a null entry after a throw', { ...good, log: [...good.log, null] }, 'bad_entry'],
      ['a text entry', { ...good, log: ['throw'] }, 'bad_entry'],
      ['an unknown entry', { ...good, log: [{ t: 'shuffle' }] }, 'bad_entry'],
      ['a throw without dice', { ...good, log: [{ t: 'throw', keep: [] }] }, 'bad_dice'],
      ['a throw without keep', { ...good, log: [{ t: 'throw', dice: [1, 2, 3, 4, 5] }] }, 'bad_keep'],
      ['a score of no row', { ...good, log: [...good.log, { t: 'score', row: null }] }, 'bad_row'],
    ];
    for (const [label, record, code] of malformed) {
      let result: ReturnType<typeof replay> | undefined;
      expect(() => (result = replay(record as YatzyRecord)), label).not.toThrow();
      expect(result, label).toMatchObject({ error: { code } });
    }
    // The same guard protects throwing and scoring on a malformed record.
    expect(applyThrow({ ...good, mode: 'random' } as unknown as YatzyRecord, [], roll([1, 1, 1, 1, 1]))).toMatchObject({
      error: { code: 'bad_record' },
    });
    expect(applyScore({ ...good, log: [null] } as unknown as YatzyRecord, 'chance')).toMatchObject({ error: { code: 'bad_entry' } });
  });
});
