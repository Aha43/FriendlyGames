// The Fischer Random presentation adapter (#55): the board, targets, castles, captures and move list
// it gives the components, from the saved record and the shared server rules.
import { describe, expect, it } from 'vitest';
import { backRank, ORTHODOX_INDEX, START_COUNT, startFen } from '@shared/chess960/start.ts';
import { chessRules } from './chess';
import { chess960Rules as rules } from './chess960';
import type { ChessRecord } from './chessFamily';
import { chessFamilyView } from './registry';
import type { SharedGame } from '../shared/gameApi';

const record = (initialFen: string, moves: string[] = []): ChessRecord => ({ schemaVersion: 1, initialFen, moves });
const play = (r: ChessRecord, ...actions: Parameters<typeof rules.apply>[1][]) =>
  actions.reduce<ChessRecord>((acc, action) => {
    const next = rules.apply(acc, action);
    if (!next) throw new Error(`refused: ${JSON.stringify(action)}`);
    return next;
  }, r);

// Kf1 between Rb1 and Rg1, queen and knights out of the way: both castles legal for White.
const READY = '1r3kr1/pppppppp/8/8/8/8/PPPPPPPP/1R3KR1 w GBgb - 0 1';

describe('Fischer Random positions', () => {
  it('draw the saved start, never a shuffled or orthodox board', () => {
    for (const index of [0, 1, 517, ORTHODOX_INDEX, 959]) {
      const { board } = rules.position(record(startFen(index)));
      const white = board[7].map((p) => p!.type.toUpperCase()).join('');
      const black = board[0].map((p) => p!.type).join('');
      expect(white).toBe(backRank(index));
      expect(black).toBe(backRank(index).toLowerCase());
    }
  });

  it('offer castles with their final squares, and leave castling out of ordinary king targets', () => {
    const position = rules.position(record(READY));
    expect(position.castles).toEqual([
      { side: 'kingside', king: { from: 'f1', to: 'g1' }, rook: { from: 'g1', to: 'f1' } },
      { side: 'queenside', king: { from: 'f1', to: 'c1' }, rook: { from: 'b1', to: 'd1' } },
    ]);
    // Ke1 is a step; g1 (own rook) and d1/c1 as castles are not ordinary targets.
    expect([...position.legalTargets('f1').keys()].sort()).toEqual(['e1']);
  });

  it('save a castle as the king onto its rook, and recognise it as that saved move', () => {
    const before = record(READY);
    expect(rules.savedMove(before, { type: 'castle', side: 'kingside' })).toBe('f1g1');
    expect(rules.savedMove(before, { type: 'castle', side: 'queenside' })).toBe('f1b1');
    const after = play(before, { type: 'castle', side: 'queenside' });
    expect(after.moves).toEqual(['f1b1']);
    const position = rules.position(after);
    expect(position.pieceAt('c1')).toEqual({ color: 'w', type: 'k' });
    expect(position.pieceAt('d1')).toEqual({ color: 'w', type: 'r' });
    expect(position.pieceAt('b1')).toBeNull();
    expect(position.lastMove).toEqual({ from: 'f1', to: 'c1' });
    expect(position.moves).toEqual([{ ply: 1, number: 1, color: 'w', san: 'O-O-O' }]);
  });

  it('refuse a king move that would castle, so only the explicit action castles', () => {
    expect(rules.apply(record(READY), { type: 'move', from: 'f1', to: 'g1' })).toBeNull();
    expect(rules.apply(record(READY), { type: 'move', from: 'f1', to: 'b1' })).toBeNull();
    expect(rules.apply(record(READY), { type: 'move', from: 'f1', to: 'e1' })?.moves).toEqual(['f1e1']);
  });

  it('never count a castle as a capture', () => {
    const after = play(record(READY), { type: 'castle', side: 'kingside' }, { type: 'castle', side: 'kingside' });
    expect(rules.captured(after)).toEqual({ w: [], b: [] });
  });

  it('give each start a fresh local game from the 960, never anything else', () => {
    const fens = new Set(Array.from({ length: 50 }, () => rules.newRecord().initialFen));
    const all = new Set(Array.from({ length: START_COUNT }, (_, i) => startFen(i)));
    for (const fen of fens) expect(all.has(fen)).toBe(true);
  });
});

describe('choosing rules by saved type (#55)', () => {
  const base = { schemaVersion: 1, turn: 'white', moveCount: 0 } as unknown as SharedGame;
  const saved = { initialFen: READY, moves: [], turn: 'white' as const };

  it('replays a Fischer Random game with Fischer Random rules, and chess with chess', () => {
    expect(chessFamilyView({ ...base, type: 'chess960', chess960: saved })?.rules).toBe(rules);
    expect(chessFamilyView({ ...base, type: 'chess', chess: { ...saved, initialFen: startFen(ORTHODOX_INDEX) } })?.rules).toBe(
      chessRules,
    );
  });

  it('never falls back to another type’s record or an unknown schema', () => {
    expect(chessFamilyView({ ...base, type: 'chess960', chess: saved })).toBeNull();
    expect(chessFamilyView({ ...base, type: 'chess960', schemaVersion: 2, chess960: saved })).toBeNull();
    expect(chessFamilyView({ ...base, type: 'checkers', chess960: saved })).toBeNull();
  });
});
