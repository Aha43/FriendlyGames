import type { Color } from '@shared/chess/board.ts';

export type PlateBadge = 'to-move' | 'check' | 'won' | 'draw' | null;

const BADGE_TEXT: Record<Exclude<PlateBadge, null>, string> = {
  'to-move': 'To move',
  check: 'Check!',
  won: 'Winner',
  draw: 'Draw',
};

interface PlayerPlateProps {
  name: string;
  color: Color;
  badge: PlateBadge;
}

export default function PlayerPlate({ name, color, badge }: PlayerPlateProps) {
  const active = badge === 'to-move' || badge === 'check';
  return (
    <div className={`player-plate${active ? ' player-plate-active' : ''}`}>
      <span className={`player-token player-token-${color}`} aria-hidden="true" />
      <span className="player-name">{name}</span>
      <span className="player-color">{color === 'w' ? 'White' : 'Black'}</span>
      {badge && <span className={`player-badge player-badge-${badge}`}>{BADGE_TEXT[badge]}</span>}
    </div>
  );
}
