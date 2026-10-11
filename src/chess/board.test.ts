import { INITIAL_FEN, parseFen, pieceName } from './board';

describe('parseFen', () => {
  it('reads the initial position with white to move', () => {
    const { board, turn } = parseFen(INITIAL_FEN);
    expect(turn).toBe('w');
    expect(board).toHaveLength(8);
    expect(board[0][4]).toEqual({ color: 'b', type: 'k' }); // e8
    expect(board[7][3]).toEqual({ color: 'w', type: 'q' }); // d1
    expect(board[6].every((p) => p?.type === 'p' && p.color === 'w')).toBe(true);
    expect(board.slice(2, 6).flat().every((p) => p === null)).toBe(true);
  });

  it('reads side to move and empty-square runs', () => {
    const { board, turn } = parseFen('4k3/8/8/8/8/8/8/R3K3 b - - 0 1');
    expect(turn).toBe('b');
    expect(board[7][0]).toEqual({ color: 'w', type: 'r' });
    expect(board[7].filter(Boolean)).toHaveLength(2);
  });

  it.each(['8/8/8', 'rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', '8/8/8/8/8/8/8/7x w', '8/8/8/8/8/8/8/8 x'])(
    'rejects malformed FEN %s',
    (fen) => {
      expect(() => parseFen(fen)).toThrow(/Invalid FEN/);
    },
  );
});

describe('pieceName', () => {
  it('names a piece by colour and type', () => {
    expect(pieceName({ color: 'b', type: 'n' })).toBe('black knight');
  });
});
