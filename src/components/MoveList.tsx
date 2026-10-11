import type { Chess } from 'chess.js';

interface MoveListProps {
  chess: Chess;
  /** When given, each move is a button that shows the position after it. */
  onSelectPly?: (ply: number) => void;
  /** The ply currently shown (1 = after White's first move). */
  currentPly?: number;
}

export default function MoveList({ chess, onSelectPly, currentPly }: MoveListProps) {
  const history = chess.history({ verbose: true });
  const rows: { number: number; plies: { ply: number; san: string; color: 'w' | 'b' }[] }[] = [];
  history.forEach((move, index) => {
    const number = Number(move.before.split(' ')[5]);
    let row = rows[rows.length - 1];
    if (!row || row.number !== number) {
      row = { number, plies: [] };
      rows.push(row);
    }
    row.plies.push({ ply: index + 1, san: move.san, color: move.color });
  });

  return (
    <>
      <h2 className="panel-title">Moves</h2>
      {rows.length === 0 ? (
        <p className="moves-empty">No moves yet. White starts.</p>
      ) : (
        <ol className="moves" aria-label="Moves">
          {rows.map((row) => {
            const white = row.plies.find((p) => p.color === 'w');
            const black = row.plies.find((p) => p.color === 'b');
            const cell = (p: typeof white, side: string) => {
              if (!p) return <span>{side === 'White' ? '…' : ''}</span>;
              if (!onSelectPly) return <span>{p.san}</span>;
              return (
                <button
                  type="button"
                  className="move-button"
                  aria-label={`Move ${row.number}, ${side}: ${p.san}`}
                  aria-current={p.ply === currentPly ? 'step' : undefined}
                  onClick={() => onSelectPly(p.ply)}
                >
                  {p.san}
                </button>
              );
            };
            return (
              <li key={row.number}>
                <span className="moves-number">{row.number}.</span>
                {cell(white, 'White')}
                {cell(black, 'Black')}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
