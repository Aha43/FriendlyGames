import { moveList } from '@shared/chess/game.ts';
import type { Chess } from 'chess.js';

export default function MoveList({ chess }: { chess: Chess }) {
  const moves = moveList(chess);
  return (
    <>
      <h2 className="panel-title">Moves</h2>
      {moves.length === 0 ? (
        <p className="moves-empty">No moves yet. White starts.</p>
      ) : (
        <ol className="moves" aria-label="Moves">
          {moves.map((row) => (
            <li key={row.number}>
              <span className="moves-number">{row.number}.</span>
              <span>{row.white ?? '…'}</span>
              <span>{row.black ?? ''}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
