// Yatzy at a shared table (#86): names, labels and plain-language descriptions for the views.
// The rules themselves are the shared module the server uses (`@shared/yatzy/rules.ts`); the
// server stays authoritative for dice, scores and tokens. This client only previews.
import { FREE_THROWS, ROWS, scoreRow, tokensBanked, UPPER_BONUS, UPPER_BONUS_THRESHOLD, type Die, type Row } from '@shared/yatzy/rules.ts';
import type { PlayerSummary, TableGame, TableSeat, YatzyCard, YatzyStanding, YatzyView } from '../shared/gameApi';

export { FREE_THROWS, ROWS, UPPER_BONUS, UPPER_BONUS_THRESHOLD };
export type { Row };

export const ROW_LABELS: Record<Row, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  onePair: 'One pair',
  twoPairs: 'Two pairs',
  threeOfAKind: 'Three of a kind',
  fourOfAKind: 'Four of a kind',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  fullHouse: 'Full house',
  chance: 'Chance',
  yatzy: 'Yatzy',
};

export const MODE_LABELS = { forced: 'Forced', free: 'Free' } as const;

export const MODE_SUMMARY = {
  forced: 'Forced: fill the card from the top, one row after another.',
  free: 'Free: score any empty row you like.',
} as const;

/** How banked throws work, where the picker and the table explain them. */
export const TOKENS_SUMMARY =
  'Up to three throws a turn. Score on your first throw to bank two extra throws, on your second to bank one. A banked throw buys a fourth, fifth… throw on a later turn. Unused ones break a tie.';

export const SEATS: readonly TableSeat[] = ['p1', 'p2', 'p3', 'p4'];

/** The table's seats in turn order, with their players. */
export function seated(players: Partial<Record<TableSeat, PlayerSummary>>): { seat: TableSeat; player: PlayerSummary }[] {
  return SEATS.flatMap((seat) => (players[seat] ? [{ seat, player: players[seat] }] : []));
}

/** "You" for the viewer, otherwise the player's name. */
export function nameAt(game: Pick<TableGame, 'players' | 'yourSeat'>, seat: TableSeat): string {
  return seat === game.yourSeat ? 'You' : (game.players[seat]?.displayName ?? 'A player');
}

/** "Harald, William and Øystein". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Everyone else at the table, e.g. for "Yatzy with …". */
export function othersAt(game: Pick<TableGame, 'players' | 'yourSeat'>): string {
  return listNames(seated(game.players).filter(({ seat }) => seat !== game.yourSeat).map(({ player }) => player.displayName));
}

export const cardOf = (view: YatzyView, seat: TableSeat): YatzyCard => view.players.find((p) => p.seat === seat)!;

/** The rows `seat` may score now: the next empty row (Forced) or every empty row (Free). */
export function openRows(view: YatzyView, seat: TableSeat): Row[] {
  const empty = ROWS.filter((row) => cardOf(view, seat).scores[row] === undefined);
  return view.mode === 'forced' ? empty.slice(0, 1) : empty;
}

/** What scoring `row` with the committed dice would record, as the server will calculate it. */
export function preview(view: YatzyView, row: Row): { points: number; banked: number } | null {
  if (!view.turn.dice || view.turn.throws === 0) return null;
  return { points: scoreRow(row, view.turn.dice as Die[]), banked: tokensBanked(view.turn.throws) };
}

/** What the next throw costs: nothing for the first three, one banked throw after that. */
export function nextThrow(view: YatzyView, seat: TableSeat): { cost: 0 | 1; allowed: boolean } {
  if (view.turn.throws < FREE_THROWS) return { cost: 0, allowed: true };
  return { cost: 1, allowed: cardOf(view, seat).tokens >= 1 };
}

/**
 * How the finished table was decided: clear on points, on banked throws when the leaders tie on
 * points, or shared when they tie on both.
 */
export function decidedBy(standings: YatzyStanding[]): 'points' | 'tokens' | 'shared' {
  const winners = standings.filter((s) => s.place === 1);
  if (winners.length > 1) return 'shared';
  const top = winners[0];
  return standings.some((s) => s.place > 1 && s.total === top.total) ? 'tokens' : 'points';
}

/** E.g. "You win", "Harald wins on banked throws", "You and Harald share the win". */
export function resultLine(game: Pick<TableGame, 'players' | 'yourSeat' | 'yatzy'>): string {
  const { standings, winners } = game.yatzy;
  if (!standings || !winners) return '';
  const names = winners.map((seat) => nameAt(game, seat));
  // "You" first reads better: "You and Harald".
  names.sort((a, b) => Number(b === 'You') - Number(a === 'You'));
  const how = decidedBy(standings);
  if (how === 'shared') return `${listNames(names)} share the win`;
  const verb = names[0] === 'You' ? 'win' : 'wins';
  return how === 'tokens' ? `${names[0]} ${verb} on banked throws` : `${names[0]} ${verb}`;
}

/** The lobby and status line: whose turn it is, or how it ended. */
export function describeTable(game: TableGame): string {
  if (game.status === 'finished') return `Finished. ${resultLine(game)}`;
  if (game.turn === null) return 'In progress';
  return game.turn === game.yourSeat ? 'Your turn' : `${nameAt(game, game.turn)}’s turn`;
}

/** 1st, 2nd, 3rd, 4th. */
export const ordinal = (place: number): string => `${place}${['th', 'st', 'nd', 'rd'][place] ?? 'th'}`;
