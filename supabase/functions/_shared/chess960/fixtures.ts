// Executable Chess960 fixtures (#52), runnable in any runtime: Vitest (Node), the browser
// bundle, Deno and the Supabase Edge runtime all call runSelfCheck() and must report no failures.
// Board strings compare rank 1 (or 8) after the action, written as in FEN.
import { backRank, ORTHODOX_INDEX, START_COUNT, startFen } from './start.ts';
import {
  applyAction,
  capturedPieces,
  fenOf,
  legalCastles,
  newRecord,
  replay,
  sanMoves,
  status,
  type CastleSide,
  type Chess960Action,
  type Chess960Record,
} from './rules.ts';

interface CastleCase {
  name: string;
  fen: string;
  side: CastleSide;
  /** Expected rank after castling (rank 1 for White, 8 for Black), or null if castling is illegal. */
  rank: string | null;
}

/** Every castling form the FIDE guidelines describe, and every reason castling can be refused. */
export const CASTLES: CastleCase[] = [
  { name: 'kingside: king and rook both move (Kc1, Rh1 → Kg1, Rf1)', fen: '4k3/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'kingside', rank: 'R4RK1' },
  { name: 'queenside, king stays on c1 (Ra1 → d1)', fen: '4k3/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'queenside', rank: '2KR3R' },
  { name: 'kingside, rook only moves (Kg1 stays, Rh1 → f1)', fen: '4k3/8/8/8/8/8/8/R5KR w HA - 0 1', side: 'kingside', rank: 'R4RK1' },
  { name: 'queenside from g1 (Kg1 → c1, Ra1 → d1)', fen: '4k3/8/8/8/8/8/8/R5KR w HA - 0 1', side: 'queenside', rank: '2KR3R' },
  { name: 'kingside, king only moves (Kb1 → g1, Rf1 stays)', fen: '4k3/8/8/8/8/8/8/1K3R2 w F - 0 1', side: 'kingside', rank: '5RK1' },
  { name: 'kingside swap (Kf1/Rg1 → Kg1/Rf1)', fen: '4k3/8/8/8/8/8/8/5KR1 w G - 0 1', side: 'kingside', rank: '5RK1' },
  { name: 'queenside swap (Kd1/Rc1 → Kc1/Rd1)', fen: '4k3/8/8/8/8/8/8/2RK4 w C - 0 1', side: 'queenside', rank: '2KR4' },
  { name: 'Black kingside, mirrored (Kc8, Rh8 → Kg8, Rf8)', fen: 'r1k4r/8/8/8/8/8/8/4K3 b ha - 0 1', side: 'kingside', rank: 'r4rk1' },
  { name: 'Black queenside, king stays (Ra8 → d8)', fen: 'r1k4r/8/8/8/8/8/8/4K3 b ha - 0 1', side: 'queenside', rank: '2kr3r' },
  { name: 'refused: king path blocked (Bf1)', fen: '4k3/8/8/8/8/8/8/R1K2B1R w HA - 0 1', side: 'kingside', rank: null },
  { name: 'allowed: the other side is not blocked', fen: '4k3/8/8/8/8/8/8/R1K2B1R w HA - 0 1', side: 'queenside', rank: '2KR1B1R' },
  { name: 'refused: rook path blocked (Nb1)', fen: '4k3/8/8/8/8/8/8/RNK4R w HA - 0 1', side: 'queenside', rank: null },
  { name: 'refused: king in check', fen: '2r1k3/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'kingside', rank: null },
  { name: 'refused: king passes an attacked square (e1)', fen: '4r1k1/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'kingside', rank: null },
  { name: 'allowed: king does not move through the attack', fen: '4r1k1/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'queenside', rank: '2KR3R' },
  { name: 'refused: king destination attacked (g1)', fen: '6r1/1k6/8/8/8/8/8/R1K4R w HA - 0 1', side: 'kingside', rank: null },
  { name: 'allowed: only the rook passes an attacked square (b1)', fen: '1r2k3/8/8/8/8/8/8/R1K4R w HA - 0 1', side: 'queenside', rank: '2KR3R' },
  { name: 'refused: the rook leaving uncovers an attack on the king (Kf1 Rg1 vs rh1)', fen: '4k3/8/8/8/8/8/8/5KRr w G - 0 1', side: 'kingside', rank: null },
  { name: 'refused: no right on that side', fen: '4k3/8/8/8/8/8/8/R1K4R w A - 0 1', side: 'kingside', rank: null },
];

type Check = (fail: (message: string) => void) => void;

function rankOf(record: Chess960Record, color: 'w' | 'b'): string {
  const board = fenOf(record).split(' ')[0].split('/');
  return color === 'w' ? board[7] : board[0];
}

function play(fen: string, ...actions: (string | Chess960Action)[]): Chess960Record {
  let record = newRecord(fen);
  for (const a of actions) {
    const action: Chess960Action =
      typeof a === 'string' ? { type: 'move', from: a.slice(0, 2), to: a.slice(2, 4), ...(a[4] ? { promotion: a[4] as 'q' } : {}) } : a;
    const result = applyAction(record, action);
    if ('error' in result) throw new Error(`${JSON.stringify(action)} refused: ${result.error}`);
    record = result.record;
  }
  return record;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const CHECKS: Record<string, Check> = {
  'all 960 starts are distinct, legal and FIDE-shaped': (fail) => {
    const seen = new Set<string>();
    for (let i = 0; i < START_COUNT; i++) {
      const rank = backRank(i);
      seen.add(rank);
      const sorted = rank.split('').sort().join('');
      if (sorted !== 'BBKNNQRR') fail(`${i}: pieces ${rank}`);
      const bishops = [rank.indexOf('B'), rank.lastIndexOf('B')];
      if (bishops[0] % 2 === bishops[1] % 2) fail(`${i}: bishops on the same colour (${rank})`);
      const [r1, k, r2] = [rank.indexOf('R'), rank.indexOf('K'), rank.lastIndexOf('R')];
      if (!(r1 < k && k < r2)) fail(`${i}: king not between the rooks (${rank})`);
      const fen = startFen(i);
      const [board, turn] = fen.split(' ');
      const ranks = board.split('/');
      if (ranks[0] !== rank.toLowerCase() || ranks[7] !== rank || ranks[1] !== 'pppppppp' || ranks[6] !== 'PPPPPPPP') fail(`${i}: ${fen}`);
      if (turn !== 'w') fail(`${i}: White does not start`);
      const record = newRecord(fen); // legal for chessops
      if (status(record).kind !== 'playing') fail(`${i}: not playable`);
      // At move 0 only a king and rook that simply swap squares can castle (e.g. BQNNRKRB: Kf1/Rg1).
      for (const c of legalCastles(replay(record))) {
        if (c.king.to !== c.rook.from || c.rook.to !== c.king.from) fail(`${i}: castling at move 0 (${rank})`);
      }
    }
    if (seen.size !== START_COUNT) fail(`only ${seen.size} distinct starts`);
    if (backRank(ORTHODOX_INDEX) !== 'RNBQKBNR') fail(`518 is ${backRank(ORTHODOX_INDEX)}`);
  },

  'castling: every form, and every refusal': (fail) => {
    for (const c of CASTLES) {
      const record = newRecord(c.fen);
      const color = c.fen.split(' ')[1] as 'w' | 'b';
      const result = applyAction(record, { type: 'castle', side: c.side });
      if (c.rank === null) {
        if (!('error' in result)) fail(`${c.name}: was allowed`);
        else if (result.error !== 'illegal_castle') fail(`${c.name}: ${result.error}`);
        if (legalCastles(replay(record)).some((x) => x.side === c.side)) fail(`${c.name}: offered`);
      } else if ('error' in result) {
        fail(`${c.name}: refused (${result.error})`);
      } else if (rankOf(result.record, color) !== c.rank) {
        fail(`${c.name}: rank ${rankOf(result.record, color)}, expected ${c.rank}`);
      } else {
        const [king, rook] = result.move.match(/../g)!;
        const offered = legalCastles(replay(record)).find((x) => x.side === c.side);
        if (!offered || offered.king.from !== king || offered.rook.from !== rook) fail(`${c.name}: saved ${result.move}`);
        if (!/^O-O/.test(sanMoves(result.record)[0])) fail(`${c.name}: notation ${sanMoves(result.record)[0]}`);
        if (!same(capturedPieces(result.record), { w: [], b: [] })) fail(`${c.name}: castling counted as a capture`);
      }
    }
  },

  'an ordinary-looking king move never castles': (fail) => {
    const fen = '4k3/8/8/8/8/8/8/R1K4R w HA - 0 1';
    for (const to of ['e1', 'h1', 'a1']) {
      const result = applyAction(newRecord(fen), { type: 'move', from: 'c1', to });
      if (!('error' in result) || result.error !== 'use_castle_action') fail(`Kc1-${to}: ${JSON.stringify(result)}`);
    }
    // Kb1 → c1 is an ordinary step even though queenside castling would also put the king on c1.
    const step = applyAction(newRecord('4k3/8/8/8/8/8/8/RK5R w HA - 0 1'), { type: 'move', from: 'b1', to: 'c1' });
    if ('error' in step || step.move !== 'b1c1' || rankOf(step.record, 'w') !== 'R1K4R') fail(`Kb1-c1: ${JSON.stringify(step)}`);
    else if (legalCastles(replay(step.record)).length) fail('rights kept after an ordinary king move');
    // Queenside castling from b1 ends on the same square but is saved as king-onto-rook.
    const castle = applyAction(newRecord('4k3/8/8/8/8/8/8/RK5R w HA - 0 1'), { type: 'castle', side: 'queenside' });
    if ('error' in castle || castle.move !== 'b1a1' || rankOf(castle.record, 'w') !== '2KR3R') fail(`O-O-O from b1: ${JSON.stringify(castle)}`);
  },

  'rights: lost by moving away and back, or a replaced rook; never inferred from placement': (fail) => {
    const start = '4k3/8/8/8/8/8/8/R1K4R w HA - 0 1';
    const kingBack = play(start, 'c1d1', 'e8e7', 'd1c1', 'e7e8');
    if (fenOf(kingBack).split(' ')[0] !== fenOf(newRecord(start)).split(' ')[0]) fail('king did not return');
    if (legalCastles(replay(kingBack)).length) fail('castling after the king moved away and back');
    const rookBack = play(start, 'h1h2', 'e8e7', 'h2h1', 'e7e8');
    const sides = legalCastles(replay(rookBack)).map((c) => c.side);
    if (!same(sides, ['queenside'])) fail(`after Rh1-h2-h1: ${sides}`);
    // The h1 rook is captured, another white rook later stands on h1: no kingside right.
    const replaced = play('4k3/8/2b5/7R/8/8/8/R1K4R b HA - 0 1', 'c6h1', 'h5h1', 'e8e7', 'a1a2', 'e7e8');
    const left = legalCastles(replay(replaced)).map((c) => c.side);
    if (left.length !== 0) fail(`replaced rook / moved rook: ${left}`);
    const replacedOnly = play('4k3/8/2b5/7R/8/8/8/R1K4R b HA - 0 1', 'c6h1', 'h5h1', 'e8e7');
    if (!same(legalCastles(replay(replacedOnly)).map((c) => c.side), ['queenside'])) fail('replaced h1 rook kept its right');
  },

  'promotion, en passant and captures': (fail) => {
    const promoted = play('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q');
    if (fenOf(promoted).split(' ')[0] !== 'Q3k3/8/8/8/8/8/8/4K3') fail(`promotion: ${fenOf(promoted)}`);
    if (!same(capturedPieces(promoted), { w: [], b: [] })) fail('promotion counted as capture');
    const noPiece = applyAction(newRecord('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), { type: 'move', from: 'a7', to: 'a8' });
    if (!('error' in noPiece)) fail('promotion without a piece accepted');
    const ep = play('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6');
    if (!same(capturedPieces(ep), { w: ['p'], b: [] }) || fenOf(ep).split(' ')[0] !== '4k3/8/3P4/8/8/8/8/4K3') fail(`en passant: ${fenOf(ep)}`);
    // axb8=Q+ takes a rook; Black's queen then takes the new queen.
    const takeQueen = play('1r2k3/P7/8/8/8/8/7q/4K3 w - - 0 1', 'a7b8q', 'h2b8');
    if (!same(capturedPieces(takeQueen), { w: ['r'], b: ['q'] })) fail(`promotion capture then promoted queen taken: ${JSON.stringify(capturedPieces(takeQueen))}`);
  },

  'outcomes match the standard-chess policy': (fail) => {
    const expect = (name: string, record: Chess960Record, want: unknown) => {
      if (!same(status(record), want)) fail(`${name}: ${JSON.stringify(status(record))}`);
    };
    expect('checkmate', newRecord('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'), { kind: 'checkmate', winner: 'w' });
    expect('stalemate', newRecord('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), { kind: 'draw', reason: 'stalemate' });
    expect('insufficient material', newRecord('8/8/8/4k3/8/8/8/4K3 w - - 0 1'), { kind: 'draw', reason: 'insufficient-material' });
    const shuffle = ['e1d1', 'e8d8', 'd1e1', 'd8e8'];
    expect('threefold repetition', play('4k3/8/8/8/8/8/8/4K2R w - - 0 1', ...shuffle, ...shuffle), { kind: 'draw', reason: 'threefold-repetition' });
    // The starting board returns twice, but the first time it had castling rights, so it is a
    // different position: no draw yet. The position after Kd1 (rights already gone) then
    // occurs a third time.
    const withRights = '4k3/8/8/8/8/8/8/R1K4R w HA - 0 1';
    const cycle = ['c1d1', 'e8d8', 'd1c1', 'd8e8'];
    expect('rights make a position different', play(withRights, ...cycle, ...cycle), { kind: 'playing', turn: 'w', check: false });
    expect('…until it really repeats', play(withRights, ...cycle, ...cycle, 'c1d1'), { kind: 'draw', reason: 'threefold-repetition' });
    expect('fifty-move rule', play('4k3/8/8/8/8/8/8/4K2R w - - 99 80', 'h1h2'), { kind: 'draw', reason: 'fifty-move-rule' });
    const over = applyAction(newRecord('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'), { type: 'move', from: 'h8', to: 'h7' });
    if (!('error' in over) || over.error !== 'game_over') fail(`move after mate: ${JSON.stringify(over)}`);
  },

  'a saved game replays to the same position': (fail) => {
    const record = play(startFen(0), 'e2e4', 'e7e5', 'd2d4', 'd7d5', 'g2g3', 'g7g6');
    const fromStorage = JSON.parse(JSON.stringify(record)) as Chess960Record;
    if (fenOf(fromStorage) !== fenOf(record)) fail('replay differs after a JSON round trip');
    if (!same(Object.keys(record).sort(), ['initialFen', 'moves', 'schemaVersion'])) fail(`keys ${Object.keys(record)}`);
    if (fenOf(play(startFen(ORTHODOX_INDEX), 'e2e4')).split(' ')[0] !== 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR') fail('518 + e4');
  },
};

/** Runs every check; an empty `failures` list means the proof holds in this runtime. */
export function runSelfCheck(): { checks: number; failures: string[] } {
  const failures: string[] = [];
  for (const [name, check] of Object.entries(CHECKS)) {
    try {
      check((message) => failures.push(`${name}: ${message}`));
    } catch (error) {
      failures.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { checks: Object.keys(CHECKS).length, failures };
}
