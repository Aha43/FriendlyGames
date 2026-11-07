// The interactive board: selection by tap or keyboard, legal-move hints, promotion choice,
// Fischer Random castle controls and focus handling. Used by local and shared play, for every
// chess-family type; the caller supplies the position and decides what an action does.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '@shared/chess/board.ts';
import { castleLabel, type BoardAction, type CastleOption, type Position, type PromotionPiece } from '../games/chessFamily';
import ChessBoard from './ChessBoard';
import PromotionPicker from './PromotionPicker';

interface PlayBoardProps {
  position: Position;
  /** Which side the person at this device may move now: both (local play), one, or none. */
  movable: Color | 'both' | null;
  orientation?: Color;
  /** An action waiting for the server; shown on the board and highlighted as unsaved. */
  pendingMove?: { from: string; to: string } | null;
  /** Called with a legal move, or a castle offered by the position. */
  onAction: (action: BoardAction) => void;
  /** Feedback for taps that do not make a move; null clears it. */
  onNotice: (message: string | null) => void;
  /** Why a piece of this colour cannot be moved right now. */
  explainBlocked: (color: Color) => string;
}


export default function PlayBoard({
  position,
  movable,
  orientation = 'w',
  pendingMove = null,
  onAction,
  onNotice,
  explainBlocked,
}: PlayBoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [focusSquare, setFocusSquare] = useState(orientation === 'w' ? 'e2' : 'e7');
  // Square to move keyboard focus back to once a dialog or control has done its job.
  const restoreFocusTo = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const boardFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingPromotion || !restoreFocusTo.current) return;
    boardFrameRef.current?.querySelector<HTMLElement>(`[data-square="${restoreFocusTo.current}"]`)?.focus();
    restoreFocusTo.current = null;
  }, [pendingPromotion, focusRequest]);

  const { status, turn } = position;
  const canMove = (color: Color) =>
    status.kind === 'playing' && color === status.turn && (movable === 'both' || movable === color);
  const activeSelection = selected && canMove(turn) ? selected : null;
  const targets = useMemo(
    () => (activeSelection ? position.legalTargets(activeSelection) : new Map<string, { promotion: boolean }>()),
    [position, activeSelection],
  );
  const checkSquare =
    status.kind === 'checkmate' || (status.kind === 'playing' && status.check) ? position.kingSquare(turn) : null;

  // Fischer Random: castles are offered while the king that can make them is selected, ordered as
  // their rooks sit on screen (queenside on the left for White, on the right for Black).
  const kingSelected = activeSelection !== null && activeSelection === position.kingSquare(turn);
  const castles = kingSelected
    ? [...position.castles].sort((a, b) => (a.side === b.side ? 0 : (a.side === 'queenside') === (orientation === 'w') ? -1 : 1))
    : [];

  function finish(focusTo: string) {
    setSelected(null);
    setPendingPromotion(null);
    setFocusSquare(focusTo);
    onNotice(null);
  }

  function move(from: string, to: string, promotion?: PromotionPiece) {
    finish(to);
    onAction({ type: 'move', from, to, ...(promotion ? { promotion } : {}) });
  }

  function castle(option: CastleOption) {
    finish(option.king.to);
    // Back to the board, on the king's new square, so the next keypress continues from there.
    restoreFocusTo.current = option.king.to;
    setFocusRequest((n) => n + 1);
    onAction({ type: 'castle', side: option.side });
  }

  function activate(square: string) {
    if (status.kind !== 'playing' || pendingPromotion) return;
    const piece = position.pieceAt(square);

    if (activeSelection && targets.has(square)) {
      if (targets.get(square)?.promotion) setPendingPromotion({ from: activeSelection, to: square });
      else move(activeSelection, square);
    } else if (square !== activeSelection && castles.some((c) => c.rook.from === square || c.king.to === square)) {
      // A king move never castles by accident: castling is its own control.
      onNotice('To castle, use a castle button below the board.');
    } else if (piece && canMove(piece.color)) {
      const selecting = square === activeSelection ? null : square;
      setSelected(selecting);
      const canCastle = selecting !== null && selecting === position.kingSquare(turn) && position.castles.length > 0;
      onNotice(canCastle ? 'Your king can castle: use a castle button below the board.' : null);
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
        board={position.board}
        orientation={orientation}
        selected={activeSelection}
        targets={new Set(targets.keys())}
        lastMove={pendingMove ? null : position.lastMove}
        pendingMove={pendingMove}
        checkSquare={checkSquare}
        focusSquare={focusSquare}
        disabled={status.kind !== 'playing' || movable === null}
        onFocusSquare={setFocusSquare}
        onActivate={activate}
        onCancel={() => setSelected(null)}
      />
      {castles.length > 0 && (
        <div className="castle-controls" role="group" aria-label="Castle">
          {castles.map((option) => (
            <button
              key={option.side}
              type="button"
              className="button castle-button"
              aria-label={castleLabel(option)}
              data-castle={option.side}
              onClick={() => castle(option)}
            >
              <span className="castle-name">Castle {option.side}</span>
              <span className="castle-squares" aria-hidden="true">
                king {option.king.to} · rook {option.rook.to}
              </span>
            </button>
          ))}
        </div>
      )}
      {pendingPromotion && (
        <PromotionPicker
          color={turn}
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
