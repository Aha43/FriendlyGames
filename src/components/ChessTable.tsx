// Local play: both sides on this device, kept in this browser only, one saved game per type.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Color } from '@shared/chess/board.ts';
import type { ChessFamilyRules, ChessRecord, GameStatus } from '../games/chessFamily';
import { chessRules } from '../games/chess';
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
  /** The type's rules; standard chess unless given. */
  rules?: ChessFamilyRules;
  /** Shown in the table's accessible name, e.g. "Chess" or "Fischer Random". */
  label?: string;
  /** Shown at the top of the side panel (e.g. the local game type switch). */
  panelTop?: ReactNode;
  /** Shown at the end of the side panel (e.g. a short explanation of the type). */
  panelEnd?: ReactNode;
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

export default function ChessTable({ players, rules = chessRules, label = 'Chess', panelTop, panelEnd }: ChessTableProps) {
  const [record, setRecord] = useState<ChessRecord>(() => loadGame(rules) ?? rules.newRecord());
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingNewGame, setConfirmingNewGame] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  useEffect(() => saveGame(record, rules), [record, rules]);

  const position = useMemo(() => rules.position(record), [rules, record]);
  const status = position.status;
  const captured = useMemo(() => rules.captured(record), [rules, record]);

  function startNewGame() {
    setRecord(rules.newRecord());
    setNotice(null);
    setConfirmingNewGame(false);
    setBoardKey((k) => k + 1); // reset selection and focus
  }

  const gameInProgress = status.kind === 'playing' && record.moves.length > 0;

  return (
    <>
      <section className="table" aria-label={`${label}: ${players.w} vs ${players.b}`}>
        <PlayerPlate name={players.b} color="b" badge={badgeFor('b', status)} captured={captured.b} />
        <PlayBoard
          key={boardKey}
          position={position}
          movable="both"
          onAction={(action) => {
            const next = rules.apply(record, action);
            if (next) setRecord(next);
            else setNotice('That move isn’t allowed.');
          }}
          onNotice={setNotice}
          explainBlocked={() => `It’s ${players[position.turn]}’s turn.`}
        />
        <PlayerPlate name={players.w} color="w" badge={badgeFor('w', status)} captured={captured.w} />
      </section>

      <section className="game-panel" aria-label="This game">
        {panelTop}
        <p className={`game-status game-status-${status.kind}`} role="status">
          {statusText(status, players)}
        </p>
        <p className="game-notice" aria-live="polite">
          {notice}
        </p>

        <MoveList moves={position.moves} />

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
        {panelEnd}
      </section>
    </>
  );
}
