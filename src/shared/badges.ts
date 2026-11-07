import type { Color } from '@shared/chess/board.ts';
import type { GameStatus } from '../games/chessFamily';
import type { PlateBadge } from '../components/PlayerPlate';

/** The badge on a player's plate for a position. */
export function badgeFor(color: Color, status: GameStatus): PlateBadge {
  if (status.kind === 'draw') return 'draw';
  if (status.kind === 'checkmate') return status.winner === color ? 'won' : null;
  if (status.turn !== color) return null;
  return status.check ? 'check' : 'to-move';
}
