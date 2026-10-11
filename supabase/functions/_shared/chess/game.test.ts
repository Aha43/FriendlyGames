import { applyMove, gameStatus, legalTargets, moveList, newGame, outcomeOf, replay, type GameRecord } from './game.ts';

/** Play moves given as "e2e4" strings, failing the test if any is rejected. */
function play(record: GameRecord, ...moves: string[]): GameRecord {
  return moves.reduce((game, m) => {
    const next = applyMove(game, m.slice(0, 2), m.slice(2, 4), m[4] as 'q' | undefined);
    if (!next) throw new Error(`move ${m} was rejected`);
    return next;
  }, record);
}

const at = (record: GameRecord, square: string) => replay(record).get(square as 'e1');

describe('local chess rules', () => {
  it('records legal moves in order and alternates turns', () => {
    const game = play(newGame(), 'e2e4', 'e7e5', 'g1f3');
    expect(game.moves).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(gameStatus(replay(game))).toEqual({ kind: 'playing', turn: 'b', check: false });
  });

  it('rejects illegal moves without changing the game', () => {
    const game = newGame();
    expect(applyMove(game, 'e2', 'e5')).toBeNull(); // pawn too far
    expect(applyMove(game, 'e7', 'e5')).toBeNull(); // not black's turn
    expect(applyMove(game, 'e1', 'e2')).toBeNull(); // own piece in the way
    expect(game.moves).toEqual([]);
  });

  it('rejects moves that leave the king in check', () => {
    // White king e1 pinned bishop d2 by black queen on a5 → bishop may not leave the diagonal.
    const game = newGame('4k3/8/8/q7/8/8/3B4/4K3 w - - 0 1');
    expect(applyMove(game, 'd2', 'e3')).toBeNull();
    expect(applyMove(game, 'd2', 'c3')).not.toBeNull();
  });

  it('castles kingside and queenside', () => {
    const start = newGame('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
    const game = play(start, 'e1g1', 'e8c8');
    expect(at(game, 'g1')).toMatchObject({ type: 'k', color: 'w' });
    expect(at(game, 'f1')).toMatchObject({ type: 'r', color: 'w' });
    expect(at(game, 'c8')).toMatchObject({ type: 'k', color: 'b' });
    expect(at(game, 'd8')).toMatchObject({ type: 'r', color: 'b' });
    expect(moveList(replay(game))).toEqual([{ number: 1, white: 'O-O', black: 'O-O-O' }]);
  });

  it('does not castle through check', () => {
    const game = newGame('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');
    // Black rook on f3 attacks f1, so O-O is illegal but O-O-O is fine.
    expect(legalTargets(replay(game), 'e1').has('g1')).toBe(false);
    expect(legalTargets(replay(game), 'e1').has('c1')).toBe(true);
  });

  it('captures en passant only immediately after the double step', () => {
    const game = play(newGame(), 'e2e4', 'a7a6', 'e4e5', 'd7d5');
    expect(legalTargets(replay(game), 'e5').has('d6')).toBe(true);
    const captured = play(game, 'e5d6');
    expect(at(captured, 'd5')).toBeUndefined();
    expect(at(captured, 'd6')).toMatchObject({ type: 'p', color: 'w' });

    const late = play(game, 'h2h3', 'h7h6');
    expect(applyMove(late, 'e5', 'd6')).toBeNull();
  });

  it('promotes to the chosen piece, including underpromotion', () => {
    const start = newGame('8/P6k/8/8/8/8/6K1/8 w - - 0 1');
    expect(legalTargets(replay(start), 'a7').get('a8')).toEqual({ promotion: true });
    expect(at(play(start, 'a7a8q'), 'a8')).toMatchObject({ type: 'q', color: 'w' });
    expect(at(play(start, 'a7a8n'), 'a8')).toMatchObject({ type: 'n', color: 'w' });
    expect(play(start, 'a7a8n').moves).toEqual(['a7a8n']);
  });

  it('requires a promotion piece exactly when a pawn promotes', () => {
    const start = newGame('8/P6k/8/8/8/8/6K1/8 w - - 0 1');
    expect(applyMove(start, 'a7', 'a8')).toBeNull();
    expect(applyMove(newGame(), 'e2', 'e4', 'q')).toBeNull();
  });

  it('detects check', () => {
    const game = play(newGame(), 'e2e4', 'f7f6', 'd1h5');
    expect(gameStatus(replay(game))).toEqual({ kind: 'playing', turn: 'b', check: true });
  });

  it('detects checkmate and stops further moves', () => {
    const game = play(newGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(gameStatus(replay(game))).toEqual({ kind: 'checkmate', winner: 'b' });
    expect(applyMove(game, 'a2', 'a3')).toBeNull();
  });

  it('detects stalemate', () => {
    const game = play(newGame('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1'), 'f1f7');
    expect(gameStatus(replay(game))).toEqual({ kind: 'draw', reason: 'stalemate' });
  });

  it('detects insufficient material', () => {
    const game = play(newGame('7k/8/8/8/3r4/4K3/8/8 w - - 0 1'), 'e3d4');
    expect(gameStatus(replay(game))).toEqual({ kind: 'draw', reason: 'insufficient-material' });
  });

  it('detects threefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const game = play(newGame(), ...shuffle, ...shuffle);
    expect(gameStatus(replay(game))).toEqual({ kind: 'draw', reason: 'threefold-repetition' });
  });

  it('detects the fifty-move rule', () => {
    const game = play(newGame('4k3/8/8/8/8/8/8/R3K3 w - - 99 80'), 'a1a2');
    expect(gameStatus(replay(game))).toEqual({ kind: 'draw', reason: 'fifty-move-rule' });
  });

  it('rebuilds a game from its record, and refuses a corrupted one', () => {
    const game = play(newGame(), 'e2e4', 'e7e5');
    expect(replay({ ...game }).fen()).toBe(replay(game).fen());
    expect(() => replay({ ...game, moves: ['e2e4', 'e2e4'] })).toThrow();
  });
});

describe('outcomeOf', () => {
  it('maps finished positions to a recorded result', () => {
    const mate = play(newGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
    expect(outcomeOf(gameStatus(replay(mate)))).toEqual({ result: 'black', termination: 'checkmate' });
    const stalemate = play(newGame('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1'), 'f1f7');
    expect(outcomeOf(gameStatus(replay(stalemate)))).toEqual({ result: 'draw', termination: 'stalemate' });
    expect(outcomeOf(gameStatus(replay(newGame())))).toBeNull();
  });
});
