import { useEffect, useMemo, useState } from 'react';
import type { Color } from '../chess/board';
import {
  applyMove,
  boardOf,
  gameStatus,
  kingSquare,
  lastMove,
  legalTargets,
  moveList,
  newGame,
  replay,
  type GameRecord,
  type GameStatus,
  type PromotionPiece,
} from '../chess/game';
import { loadGame, saveGame } from '../chess/storage';
import ChessBoard from './ChessBoard';
import PlayerPlate, { type PlateBadge } from './PlayerPlate';
import PromotionPicker from './PromotionPicker';

const DRAW_TEXT = {
  stalemate: 'Draw by stalemate',
  'insufficient-material': 'Draw: not enough material to checkmate',
  'threefold-repetition': 'Draw by threefold repetition',
  'fifty-move-rule': 'Draw by the fifty-move rule',
} as const;

interface ChessTableProps {
  players: Record<Color, string>;
}

function statusText(status: GameStatus, players: Record<Color, string>): string {
  switch (status.kind) {
    case 'playing':
      return `${status.check ? 'Check! ' : ''}${players[status.turn]} to move`;
    case 'checkmate':
      return `Checkmate. ${players[status.winner]} wins`;
    case 'draw':
      return DRAW_TEXT[status.reason];
  }
}

function badgeFor(color: Color, status: GameStatus): PlateBadge {
  if (status.kind === 'draw') return 'draw';
  if (status.kind === 'checkmate') return status.winner === color ? 'won' : null;
  if (status.turn !== color) return null;
  return status.check ? 'check' : 'to-move';
}

export default function ChessTable({ players }: ChessTableProps) {
  const [record, setRecord] = useState<GameRecord>(() => loadGame() ?? newGame());
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [focusSquare, setFocusSquare] = useState('e2');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingNewGame, setConfirmingNewGame] = useState(false);

  useEffect(() => saveGame(record), [record]);

  const chess = useMemo(() => replay(record), [record]);
  const status = gameStatus(chess);
  const board = boardOf(chess);
  const targets = useMemo(() => (selected ? legalTargets(chess, selected) : new Map()), [chess, selected]);
  const checkSquare = status.kind === 'checkmate' || (status.kind === 'playing' && status.check)
    ? kingSquare(chess, chess.turn())
    : null;
  const moves = moveList(chess);

  function move(from: string, to: string, promotion?: PromotionPiece) {
    const next = applyMove(record, from, to, promotion);
    setSelected(null);
    setPendingPromotion(null);
    if (next) {
      setRecord(next);
      setNotice(null);
      setFocusSquare(to);
    } else {
      setNotice('That move isn’t allowed.');
    }
  }

  function activate(square: string) {
    if (status.kind !== 'playing' || pendingPromotion) return;
    const piece = chess.get(square as 'a1');

    if (selected && targets.has(square)) {
      if (targets.get(square)?.promotion) setPendingPromotion({ from: selected, to: square });
      else move(selected, square);
    } else if (piece?.color === status.turn) {
      setSelected(square === selected ? null : square);
      setNotice(null);
    } else if (selected) {
      setSelected(null);
      setNotice('That move isn’t allowed.');
    } else if (piece) {
      setNotice(`It’s ${players[status.turn]}’s turn.`);
    }
  }

  function startNewGame() {
    setRecord(newGame());
    setSelected(null);
    setPendingPromotion(null);
    setNotice(null);
    setConfirmingNewGame(false);
    setFocusSquare('e2');
  }

  const gameInProgress = status.kind === 'playing' && record.moves.length > 0;

  return (
    <>
      <section className="table" aria-label={`Chess: ${players.w} vs ${players.b}`}>
        <PlayerPlate name={players.b} color="b" badge={badgeFor('b', status)} />
        <div className="board-frame">
          <ChessBoard
            board={board}
            selected={selected}
            targets={new Set(targets.keys())}
            lastMove={lastMove(chess)}
            checkSquare={checkSquare}
            focusSquare={focusSquare}
            disabled={status.kind !== 'playing'}
            onFocusSquare={setFocusSquare}
            onActivate={activate}
            onCancel={() => setSelected(null)}
          />
          {pendingPromotion && (
            <PromotionPicker
              color={chess.turn()}
              onChoose={(piece) => move(pendingPromotion.from, pendingPromotion.to, piece)}
              onCancel={() => {
                setPendingPromotion(null);
                setSelected(null);
              }}
            />
          )}
        </div>
        <PlayerPlate name={players.w} color="w" badge={badgeFor('w', status)} />
      </section>

      <section className="game-panel" aria-label="This game">
        <p className={`game-status game-status-${status.kind}`} role="status">
          {statusText(status, players)}
        </p>
        <p className="game-notice" aria-live="polite">
          {notice}
        </p>

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

        {confirmingNewGame ? (
          <div className="confirm" role="group" aria-label="Confirm new game">
            <span>Abandon this game and start over?</span>
            <button type="button" className="button button-primary" onClick={startNewGame}>
              Start over
            </button>
            <button type="button" className="button" onClick={() => setConfirmingNewGame(false)}>
              Keep playing
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button button-primary"
            onClick={() => (gameInProgress ? setConfirmingNewGame(true) : startNewGame())}
          >
            New game
          </button>
        )}
      </section>
    </>
  );
}
