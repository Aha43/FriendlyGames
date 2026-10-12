import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FILES, pieceName, type Board, type Color } from '@shared/chess/board.ts';
import { pieceImage } from './pieceSet';

interface ChessBoardProps {
  board: Board;
  /** The side shown at the bottom. */
  orientation?: Color;
  selected: string | null;
  /** Squares the selected piece can move to. */
  targets: ReadonlySet<string>;
  lastMove: { from: string; to: string } | null;
  /** A move shown on the board but not yet confirmed as saved. */
  pendingMove?: { from: string; to: string } | null;
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
  orientation = 'w',
  selected,
  targets,
  lastMove,
  pendingMove = null,
  checkSquare,
  focusSquare,
  disabled = false,
  onFocusSquare,
  onActivate,
  onCancel,
}: ChessBoardProps) {
  const squareRefs = useRef(new Map<string, HTMLDivElement>());
  const wrapRef = useRef<HTMLDivElement>(null);
  // A finger covers the square it touches, so its name is shown just above it.
  const [touched, setTouched] = useState<{ square: string; left: number; top: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  function showTouchedSquare(event: PointerEvent<HTMLDivElement>, square: string) {
    if (event.pointerType !== 'touch' || !wrapRef.current) return;
    clearTimeout(hideTimer.current);
    const wrap = wrapRef.current.getBoundingClientRect();
    const cell = event.currentTarget.getBoundingClientRect();
    setTouched({ square, left: cell.left - wrap.left + cell.width / 2, top: cell.top - wrap.top });
  }

  function hideTouchedSquare() {
    // Linger briefly so a quick tap still shows the name.
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTouched(null), 700);
  }
  // Board rows run rank 8 → 1; with Black at the bottom both rows and files are reversed.
  const order = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, square: string) {
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      // Arrows follow the screen: with Black at the bottom, "up" is towards rank 1.
      const flip = orientation === 'w' ? 1 : -1;
      const file = Math.min(7, Math.max(0, FILES.indexOf(square[0] as (typeof FILES)[number]) + arrow[0] * flip));
      const rank = Math.min(8, Math.max(1, Number(square[1]) + arrow[1] * flip));
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
    <div className="board-wrap" ref={wrapRef}>
      <div className={`board${disabled ? ' board-disabled' : ''}`} role="grid" aria-label="Chess board">
        {order.map((r, rowIndex) => (
          <div className="board-row" role="row" key={r}>
            {order.map((c, colIndex) => {
              const piece = board[r][c];
              const square = squareAt(c, 8 - r);
              const isTarget = targets.has(square);
              const isPending = square === pendingMove?.from || square === pendingMove?.to;
              const label = [
                square,
                piece ? pieceName(piece) : 'empty',
                square === selected && 'selected',
                isTarget && (piece ? 'capture' : 'legal move'),
                square === checkSquare && 'in check',
                square === pendingMove?.to && 'not saved yet',
              ]
                .filter(Boolean)
                .join(', ');
              const classes = [
                'square',
                (r + c) % 2 === 1 ? 'square-dark' : 'square-light',
                square === selected && 'square-selected',
                (square === lastMove?.from || square === lastMove?.to) && 'square-last',
                isPending && 'square-pending',
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
                  title={square}
                  onPointerDown={(event) => showTouchedSquare(event, square)}
                  onPointerUp={hideTouchedSquare}
                  onPointerCancel={hideTouchedSquare}
                  onClick={() => {
                    onFocusSquare(square);
                    onActivate(square);
                  }}
                  onKeyDown={(event) => handleKeyDown(event, square)}
                >
                  {colIndex === 0 && (
                    <span className="coord coord-rank" aria-hidden="true">
                      {8 - r}
                    </span>
                  )}
                  {rowIndex === 7 && (
                    <span className="coord coord-file" aria-hidden="true">
                      {FILES[c]}
                    </span>
                  )}
                  {piece && <img className="piece" src={pieceImage(piece)} alt="" draggable={false} />}
                  {isTarget && (
                    // The destination's real name, whichever way the board faces. Accessible
                    // names already say "legal move", so this is visual only.
                    <span className={`target-label${piece ? ' target-label-capture' : ''}`} aria-hidden="true">
                      {square}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {touched && (
        <span className="square-name" style={{ left: touched.left, top: touched.top }} aria-hidden="true">
          {touched.square}
        </span>
      )}
    </div>
  );
}
