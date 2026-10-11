import { applyMove, newGame } from './game';
import { loadGame, saveGame } from './storage';

describe('local game storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the full move history', () => {
    const game = applyMove(applyMove(newGame(), 'e2', 'e4')!, 'c7', 'c5')!;
    saveGame(game);
    expect(loadGame()).toEqual(game);
  });

  it('returns null when nothing is saved or the record is unusable', () => {
    expect(loadGame()).toBeNull();
    localStorage.setItem('friendlygames.localChess', '{not json');
    expect(loadGame()).toBeNull();
    localStorage.setItem('friendlygames.localChess', JSON.stringify({ ...newGame(), moves: ['e2e5'] }));
    expect(loadGame()).toBeNull();
    localStorage.setItem('friendlygames.localChess', JSON.stringify({ ...newGame(), schemaVersion: 2 }));
    expect(loadGame()).toBeNull();
  });
});
