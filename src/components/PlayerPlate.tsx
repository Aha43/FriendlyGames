import { PIECE_NAMES, type Color, type PieceType } from '@shared/chess/board.ts';
import { pieceImage } from './pieceSet';

export type PlateBadge = 'to-move' | 'check' | 'won' | 'draw' | null;

const BADGE_TEXT: Record<Exclude<PlateBadge, null>, string> = {
  'to-move': 'To move',
  check: 'Check!',
  won: 'Winner',
  draw: 'Draw',
};

const COLOR_NAME: Record<Color, string> = { w: 'White', b: 'Black' };

interface PlayerPlateProps {
  name: string;
  color: Color;
  badge: PlateBadge;
  /** The pieces this player has captured (of the other colour), most valuable first (#44). */
  captured?: PieceType[];
}

/** "2 black pawns, 1 black knight" for screen readers; the row itself shows the pieces. */
function describeCaptured(pieces: PieceType[], victimColor: Color): string {
  const counts = new Map<PieceType, number>();
  for (const type of pieces) counts.set(type, (counts.get(type) ?? 0) + 1);
  const colour = COLOR_NAME[victimColor].toLowerCase();
  return [...counts]
    .map(([type, n]) => `${n} ${colour} ${PIECE_NAMES[type]}${n === 1 ? '' : 's'}`)
    .join(', ');
}

export default function PlayerPlate({ name, color, badge, captured }: PlayerPlateProps) {
  const active = badge === 'to-move' || badge === 'check';
  const victimColor: Color = color === 'w' ? 'b' : 'w';
  return (
    <div className={`player-plate${active ? ' player-plate-active' : ''}`}>
      <div className="player-plate-main">
        <span className={`player-token player-token-${color}`} aria-hidden="true" />
        <span className="player-name">{name}</span>
        <span className="player-color">{COLOR_NAME[color]}</span>
        {badge && <span className={`player-badge player-badge-${badge}`}>{BADGE_TEXT[badge]}</span>}
      </div>
      {captured && (
        <p className="player-captures">
          <span className="player-captures-label">Captured by {COLOR_NAME[color]}:</span>{' '}
          {captured.length === 0 ? (
            <span className="player-captures-none">None yet</span>
          ) : (
            <>
              <span className="player-captures-pieces" aria-hidden="true">
                {captured.map((type, i) => (
                  <img key={i} src={pieceImage({ color: victimColor, type })} alt="" />
                ))}
              </span>
              <span className="visually-hidden">{describeCaptured(captured, victimColor)}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
