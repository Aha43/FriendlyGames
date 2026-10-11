import { FILES, pieceName, type Board, type Color } from '../chess/board';
import { pieceImage } from './pieceSet';

interface ChessBoardProps {
  board: Board;
  /** The side shown at the bottom of the board. */
  orientation?: Color;
}

export default function ChessBoard({ board, orientation = 'w' }: ChessBoardProps) {
  const rows = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="board" role="grid" aria-label="Chess board">
      {rows.map((r, rowIndex) => (
        <div className="board-row" role="row" key={r}>
          {cols.map((c, colIndex) => {
            const square = `${FILES[c]}${8 - r}`;
            const piece = board[r][c];
            const dark = (r + c) % 2 === 1;
            return (
              <div
                key={square}
                role="gridcell"
                aria-label={piece ? `${square}, ${pieceName(piece)}` : `${square}, empty`}
                className={`square ${dark ? 'square-dark' : 'square-light'}`}
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
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
