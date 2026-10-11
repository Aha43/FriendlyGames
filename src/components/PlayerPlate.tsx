import type { Color } from '../chess/board';

interface PlayerPlateProps {
  name: string;
  color: Color;
  toMove: boolean;
}

export default function PlayerPlate({ name, color, toMove }: PlayerPlateProps) {
  return (
    <div className={`player-plate${toMove ? ' player-plate-active' : ''}`}>
      <span className={`player-token player-token-${color}`} aria-hidden="true" />
      <span className="player-name">{name}</span>
      <span className="player-color">{color === 'w' ? 'White' : 'Black'}</span>
      {toMove && <span className="player-turn">To move</span>}
    </div>
  );
}
