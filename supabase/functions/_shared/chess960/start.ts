// Fischer Random (Chess960) starting positions (#52). The 960 legal back ranks are numbered
// 0–959 with the standard Scharnagl scheme (518 is the orthodox RNBQKBNR), as in the FIDE
// Chess960 guidelines. This only arranges pieces; the rules live in rules.ts (chessops).

export const START_COUNT = 960;
export const ORTHODOX_INDEX = 518;

/** Knight placements on the five squares left after bishops and queen (Scharnagl's table). */
const KNIGHTS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
];

/** The white back rank, a → h, for start `index` (0–959), e.g. "RNBQKBNR" for 518. */
export function backRank(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= START_COUNT) throw new RangeError(`no Chess960 start ${index}`);
  const rank: (string | null)[] = Array(8).fill(null);
  let n = index;
  rank[2 * (n % 4) + 1] = 'B'; // light-squared bishop: b, d, f or h
  n = Math.floor(n / 4);
  rank[2 * (n % 4)] = 'B'; // dark-squared bishop: a, c, e or g
  n = Math.floor(n / 4);
  const empty = () => rank.flatMap((piece, file) => (piece ? [] : [file]));
  rank[empty()[n % 6]] = 'Q';
  n = Math.floor(n / 6);
  const [first, second] = KNIGHTS[n];
  const forKnights = empty();
  rank[forKnights[first]] = 'N';
  rank[forKnights[second]] = 'N';
  // The three squares left take rook, king, rook in order: the king is always between the rooks.
  const [a, k, h] = empty();
  rank[a] = 'R';
  rank[k] = 'K';
  rank[h] = 'R';
  return rank.join('');
}

/**
 * The starting position as Shredder-FEN: castling rights name the rooks' files (e.g. "HAha"),
 * so the saved position says exactly which rook each right belongs to.
 */
export function startFen(index: number): string {
  const rank = backRank(index);
  const files = [rank.indexOf('R'), rank.lastIndexOf('R')].map((f) => 'abcdefgh'[f]);
  const rights = `${files[1].toUpperCase()}${files[0].toUpperCase()}${files[1]}${files[0]}`;
  return `${rank.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${rank} w ${rights} - 0 1`;
}

/** A uniformly random start index from a cryptographic source (no modulo bias). */
export function randomStartIndex(
  random: (buffer: Uint16Array<ArrayBuffer>) => Uint16Array = (buffer) => crypto.getRandomValues(buffer),
): number {
  const limit = Math.floor(65536 / START_COUNT) * START_COUNT; // 65280: a whole number of 960s
  const buffer = new Uint16Array(1);
  for (;;) {
    const value = random(buffer)[0];
    if (value < limit) return value % START_COUNT;
  }
}
