// Local play: both sides on this device, kept in this browser only.
import { useEffect, useMemo, useState } from 'react';
import type { Color } from '@shared/chess/board.ts';
import { applyMove, capturedPieces, gameStatus, newGame, replay, type GameRecord, type GameStatus } from '@shared/chess/game.ts';
import { loadGame, saveGame } from '../chess/storage';
import MoveList from './MoveList';
import PlayBoard from './PlayBoard';
import PlayerPlate from './PlayerPlate';
import { badgeFor } from '../shared/badges';

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

export default function ChessTable({ players }: ChessTableProps) {
  const [record, setRecord] = useState<GameRecord>(() => loadGame() ?? newGame());
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingNewGame, setConfirmingNewGame] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  useEffect(() => saveGame(record), [record]);

  const chess = useMemo(() => replay(record), [record]);
  const status = gameStatus(chess);
  const captured = useMemo(() => capturedPieces(record), [record]);

  function startNewGame() {
    setRecord(newGame());
    setNotice(null);
    setConfirmingNewGame(false);
    setBoardKey((k) => k + 1); // reset selection and focus
  }

  const gameInProgress = status.kind === 'playing' && record.moves.length > 0;

  return (
    <>
      <section className="table" aria-label={`Chess: ${players.w} vs ${players.b}`}>
        <PlayerPlate name={players.b} color="b" badge={badgeFor('b', status)} captured={captured.b} />
        <PlayBoard
          key={boardKey}
          record={record}
          movable="both"
          onMove={(from, to, promotion) => {
            const next = applyMove(record, from, to, promotion);
            if (next) setRecord(next);
            else setNotice('That move isn’t allowed.');
          }}
          onNotice={setNotice}
          explainBlocked={() => `It’s ${players[chess.turn()]}’s turn.`}
        />
        <PlayerPlate name={players.w} color="w" badge={badgeFor('w', status)} captured={captured.w} />
      </section>

      <section className="game-panel" aria-label="This game">
        <p className={`game-status game-status-${status.kind}`} role="status">
          {statusText(status, players)}
        </p>
        <p className="game-notice" aria-live="polite">
          {notice}
        </p>

        <MoveList chess={chess} />

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
