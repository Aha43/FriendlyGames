// Plain-language descriptions of a shared game from the viewer's side.
import type { Seat, SharedGame } from './gameApi';

const DRAWS: Record<string, string> = {
  stalemate: 'Draw by stalemate',
  'insufficient-material': 'Draw: not enough material to checkmate',
  'threefold-repetition': 'Draw by threefold repetition',
  'fifty-move-rule': 'Draw by the fifty-move rule',
};

export const other = (seat: Seat): Seat => (seat === 'white' ? 'black' : 'white');

export function opponentName(game: SharedGame): string | null {
  return game.players[other(game.yourSeat)]?.displayName ?? null;
}

/** E.g. "Your move", "Harald's move", "Checkmate. You win". */
export function describeGame(game: SharedGame): string {
  const opponent = opponentName(game) ?? 'your friend';
  if (game.status === 'waiting') {
    // The creator may open before the friend joins (#33); then the empty seat is to move.
    return game.turn === game.yourSeat
      ? `Your move. ${opponentName(game) ?? 'Your friend'} can join at any time`
      : `Your move is saved. Waiting for ${opponent} to join`;
  }
  if (game.status === 'active') return game.turn === game.yourSeat ? 'Your move' : `${opponent}’s move`;

  const youWon = game.result === game.yourSeat;
  switch (game.termination) {
    case 'checkmate':
      return youWon ? 'Checkmate. You win' : `Checkmate. ${opponent} wins`;
    case 'resignation':
      return youWon ? `${opponent} resigned. You win` : `You resigned. ${opponent} wins`;
    default:
      return DRAWS[game.termination ?? ''] ?? 'Draw';
  }
}
