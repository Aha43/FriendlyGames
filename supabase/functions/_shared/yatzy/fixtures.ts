// Deterministic Yatzy records for tests (#84): no randomness, every throw's dice written out.
import { applyScore, applyThrow, newRecord, ROWS, type Die, type Mode, type Row, type YatzyRecord } from './rules.ts';

/** A scripted action: a throw that lands exactly `dice` (kept positions must already show those), or a score. */
export type Scripted = { throw: Die[]; keep?: number[] } | { score: Row };

/** Plays `script` from `record`, failing loudly on the first illegal step. */
export function play(record: YatzyRecord, script: Scripted[]): YatzyRecord {
  let current = record;
  for (const [i, action] of script.entries()) {
    const result =
      'score' in action
        ? applyScore(current, action.score)
        : applyThrow(current, action.keep ?? [], (n) => {
            const keep = action.keep ?? [];
            const fresh = action.throw.filter((_, p) => !keep.includes(p));
            if (fresh.length !== n) throw new Error(`step ${i}: expected ${n} fresh dice`);
            return fresh;
          });
    if ('error' in result) throw new Error(`step ${i}: ${result.error.code} ${result.error.message}`);
    current = result.record;
  }
  return current;
}

/** One throw per row that scores it well: 63 in the upper section (bonus), 330 in all. */
export const ONE_THROW: Record<Row, Die[]> = {
  ones: [1, 1, 1, 2, 3],
  twos: [2, 2, 2, 1, 3],
  threes: [3, 3, 3, 1, 2],
  fours: [4, 4, 4, 1, 2],
  fives: [5, 5, 5, 1, 2],
  sixes: [6, 6, 6, 1, 2],
  onePair: [6, 6, 1, 2, 3],
  twoPairs: [6, 6, 5, 5, 1],
  threeOfAKind: [6, 6, 6, 1, 2],
  fourOfAKind: [6, 6, 6, 6, 1],
  smallStraight: [1, 2, 3, 4, 5],
  largeStraight: [2, 3, 4, 5, 6],
  fullHouse: [6, 6, 6, 5, 5],
  chance: [6, 6, 6, 5, 5],
  yatzy: [6, 6, 6, 6, 6],
};

/**
 * A complete game: every player scores each row in card order with one throw (so every turn
 * banks two tokens). `override(seat, row)` can change a turn's script.
 */
export function completeGame(
  mode: Mode,
  players: number,
  override: (seat: number, row: Row) => Scripted[] | undefined = () => undefined,
): YatzyRecord {
  const script: Scripted[] = [];
  for (const row of ROWS) {
    for (let seat = 0; seat < players; seat++) {
      script.push(...(override(seat, row) ?? [{ throw: ONE_THROW[row] }, { score: row }]));
    }
  }
  return play(newRecord(mode, players), script);
}
