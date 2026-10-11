import { useRef, type KeyboardEvent } from 'react';
import { FILES, pieceName, type Board } from '../chess/board';
import { pieceImage } from './pieceSet';

interface ChessBoardProps {
  board: Board;
  selected: string | null;
  /** Squares the selected piece can move to. */
  targets: ReadonlySet<string>;
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  /** The square that holds keyboard focus (roving tabindex). */
  focusSquare: string;
  disabled?: boolean;
  onFocusSquare: (square: string) => void;
  onActivate: (square: string) => void;
  onCancel: () => void;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

function squareAt(file: number, rank: number) {
  return `${FILES[file]}${rank}`;
}

export default function ChessBoard({
  board,
  selected,
  targets,
  lastMove,
  checkSquare,
  focusSquare,
  disabled = false,
  onFocusSquare,
  onActivate,
  onCancel,
}: ChessBoardProps) {
  const squareRefs = useRef(new Map<string, HTMLDivElement>());

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, square: string) {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const file = Math.min(7, Math.max(0, FILES.indexOf(square[0] as (typeof FILES)[number]) + arrow[0]));
      const rank = Math.min(8, Math.max(1, Number(square[1]) + arrow[1]));
      const next = squareAt(file, rank);
      onFocusSquare(next);
      squareRefs.current.get(next)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(square);
    } else if (event.key === 'Escape') {
      onCancel();
    }
  }

  return (
    <div className={`board${disabled ? ' board-disabled' : ''}`} role="grid" aria-label="Chess board">
      {board.map((rankSquares, r) => (
        <div className="board-row" role="row" key={r}>
          {rankSquares.map((piece, c) => {
            const square = squareAt(c, 8 - r);
            const isTarget = targets.has(square);
            const label = [
              square,
              piece ? pieceName(piece) : 'empty',
              square === selected && 'selected',
              isTarget && (piece ? 'capture' : 'legal move'),
              square === checkSquare && 'in check',
            ]
              .filter(Boolean)
              .join(', ');
            const classes = [
              'square',
              (r + c) % 2 === 1 ? 'square-dark' : 'square-light',
              square === selected && 'square-selected',
              (square === lastMove?.from || square === lastMove?.to) && 'square-last',
              square === checkSquare && 'square-check',
              isTarget && (piece ? 'square-capture' : 'square-target'),
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={square}
                ref={(el) => {
                  if (el) squareRefs.current.set(square, el);
                  else squareRefs.current.delete(square);
                }}
                role="gridcell"
                aria-label={label}
                aria-selected={square === selected}
                tabIndex={square === focusSquare ? 0 : -1}
                className={classes}
                data-square={square}
                onClick={() => {
                  onFocusSquare(square);
                  onActivate(square);
                }}
                onKeyDown={(event) => handleKeyDown(event, square)}
              >
                {c === 0 && (
                  <span className="coord coord-rank" aria-hidden="true">
                    {8 - r}
                  </span>
                )}
                {r === 7 && (
                  <span className="coord coord-file" aria-hidden="true">
                    {FILES[c]}
                  </span>
                )}
                {piece && <img className="piece" src={pieceImage(piece)} alt="" draggable={false} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
