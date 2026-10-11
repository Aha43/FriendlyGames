import { tally, winner, type SampleGame } from './sampleHistory';

const game = (result: SampleGame['result'], white = 'Arne', black = 'Harald'): SampleGame => ({
  id: result,
  date: '2026-10-01',
  white,
  black,
  result,
  ending: 'Checkmate',
  moves: 30,
});

describe('sample history', () => {
  it('names the winner by colour', () => {
    expect(winner(game('white'))).toBe('Arne');
    expect(winner(game('black'))).toBe('Harald');
    expect(winner(game('draw'))).toBeNull();
  });

  it('tallies wins per player and draws regardless of colour', () => {
    const games = [game('white'), game('white', 'Harald', 'Arne'), game('black', 'Harald', 'Arne'), game('draw')];
    expect(tally(games, ['Arne', 'Harald'])).toEqual({ wins: { Arne: 2, Harald: 1 }, draws: 1 });
  });
});
