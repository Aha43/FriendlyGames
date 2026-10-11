// Invented results for the visual prototype. Never mix these with real games.

export type SampleResult = 'white' | 'black' | 'draw';

export interface SampleGame {
  id: string;
  date: string; // ISO date
  white: string;
  black: string;
  result: SampleResult;
  ending: string;
  moves: number;
}

export const SAMPLE_GAMES: SampleGame[] = [
  { id: 's6', date: '2026-10-08', white: 'Harald', black: 'Arne', result: 'black', ending: 'Checkmate', moves: 41 },
  { id: 's5', date: '2026-10-03', white: 'Arne', black: 'Harald', result: 'white', ending: 'Resignation', moves: 47 },
  { id: 's4', date: '2026-09-27', white: 'Harald', black: 'Arne', result: 'white', ending: 'Resignation', moves: 29 },
  { id: 's3', date: '2026-09-20', white: 'Arne', black: 'Harald', result: 'white', ending: 'Checkmate', moves: 34 },
  { id: 's2', date: '2026-09-14', white: 'Harald', black: 'Arne', result: 'white', ending: 'Checkmate', moves: 23 },
  { id: 's1', date: '2026-09-06', white: 'Arne', black: 'Harald', result: 'draw', ending: 'Threefold repetition', moves: 52 },
];

export function winner(game: SampleGame): string | null {
  if (game.result === 'draw') return null;
  return game.result === 'white' ? game.white : game.black;
}

/** Wins per player and draws, for the two players at the table. */
export function tally(games: SampleGame[], players: [string, string]) {
  const wins = { [players[0]]: 0, [players[1]]: 0 } as Record<string, number>;
  let draws = 0;
  for (const game of games) {
    const w = winner(game);
    if (w === null) draws++;
    else if (w in wins) wins[w]++;
  }
  return { wins, draws };
}
