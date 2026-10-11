import { pieceName } from './board.ts';

describe('pieceName', () => {
  it('names a piece by colour and type', () => {
    expect(pieceName({ color: 'b', type: 'n' })).toBe('black knight');
    expect(pieceName({ color: 'w', type: 'k' })).toBe('white king');
  });
});
