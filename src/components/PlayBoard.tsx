// The interactive board: selection by tap or keyboard, legal-move hints, promotion choice
// and focus handling. Used by both local and shared play; the caller decides what a move does.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '@shared/chess/board.ts';
import {
  boardOf,
  gameStatus,
  kingSquare,
  lastMove,
  legalTargets,
  replay,
  type GameRecord,
  type PromotionPiece,
} from '@shared/chess/game.ts';
import ChessBoard from './ChessBoard';
import PromotionPicker from './PromotionPicker';

interface PlayBoardProps {
  record: GameRecord;
  /** Which side the person at this device may move now: both (local play), one, or none. */
  movable: Color | 'both' | null;
  orientation?: Color;
  /** A move waiting for the server; shown on the board and highlighted as unsaved. */
  pendingMove?: { from: string; to: string } | null;
  /** Called with a legal move. */
  onMove: (from: string, to: string, promotion?: PromotionPiece) => void;
  /** Feedback for taps that do not make a move; null clears it. */
  onNotice: (message: string | null) => void;
  /** Why a piece of this colour cannot be moved right now. */
  explainBlocked: (color: Color) => string;
}

export default function PlayBoard({
  record,
  movable,
  orientation = 'w',
  pendingMove = null,
  onMove,
  onNotice,
  explainBlocked,
}: PlayBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [focusSquare, setFocusSquare] = useState(orientation === 'w' ? 'e2' : 'e7');
  // Square to move keyboard focus back to once the promotion dialog has closed.
  const restoreFocusTo = useRef<string | null>(null);
  const boardFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingPromotion || !restoreFocusTo.current) return;
    boardFrameRef.current?.querySelector<HTMLElement>(`[data-square="${restoreFocusTo.current}"]`)?.focus();
    restoreFocusTo.current = null;
  }, [pendingPromotion]);

  const chess = useMemo(() => replay(record), [record]);
  const status = gameStatus(chess);
  const canMove = (color: Color) =>
    status.kind === 'playing' && color === status.turn && (movable === 'both' || movable === color);
  const activeSelection = selected && canMove(chess.turn()) ? selected : null;
  const targets = useMemo(
    () => (activeSelection ? legalTargets(chess, activeSelection) : new Map<string, { promotion: boolean }>()),
    [chess, activeSelection],
  );
  const checkSquare =
    status.kind === 'checkmate' || (status.kind === 'playing' && status.check) ? kingSquare(chess, chess.turn()) : null;

  function move(from: string, to: string, promotion?: PromotionPiece) {
    setSelected(null);
    setPendingPromotion(null);
    setFocusSquare(to);
    onNotice(null);
    onMove(from, to, promotion);
  }

  function activate(square: string) {
    if (status.kind !== 'playing' || pendingPromotion) return;
    const piece = chess.get(square as 'a1');

    if (activeSelection && targets.has(square)) {
      if (targets.get(square)?.promotion) setPendingPromotion({ from: activeSelection, to: square });
      else move(activeSelection, square);
    } else if (piece && canMove(piece.color)) {
      setSelected(square === activeSelection ? null : square);
      onNotice(null);
    } else if (activeSelection) {
      setSelected(null);
      onNotice('That move isn’t allowed.');
    } else if (piece) {
      onNotice(explainBlocked(piece.color));
    }
  }

  return (
    <div className="board-frame" ref={boardFrameRef}>
      <ChessBoard
        board={boardOf(chess)}
        orientation={orientation}
        selected={activeSelection}
        targets={new Set(targets.keys())}
        lastMove={pendingMove ? null : lastMove(chess)}
        pendingMove={pendingMove}
        checkSquare={checkSquare}
        focusSquare={focusSquare}
        disabled={status.kind !== 'playing' || movable === null}
        onFocusSquare={setFocusSquare}
        onActivate={activate}
        onCancel={() => setSelected(null)}
      />
      {pendingPromotion && (
        <PromotionPicker
          color={chess.turn()}
          onChoose={(piece) => {
            restoreFocusTo.current = pendingPromotion.to;
            move(pendingPromotion.from, pendingPromotion.to, piece);
          }}
          onCancel={() => {
            setPendingPromotion(null);
            setSelected(null);
            setFocusSquare(pendingPromotion.from);
            restoreFocusTo.current = pendingPromotion.from;
          }}
        />
      )}
    </div>
  );
}
