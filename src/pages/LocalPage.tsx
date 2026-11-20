import ChessTable from '../components/ChessTable';
import SharedHistory from '../components/SharedHistory';
import AboutChess960 from '../components/AboutChess960';
import { GAME_TYPES } from '../games/registry';

// Both sides on one device, kept in this browser only. Separate from shared games by design.
// Each type has its own saved game (#55); switching between them keeps both.
const PLAYERS = { w: 'White', b: 'Black' };

export default function LocalPage({ type = 'chess' }: { type?: 'chess' | 'chess960' }) {
  const entry = GAME_TYPES[type];
  // What this page is, for players who know only games shared with a friend (#82).
  const panelTop = (
    <>
      <div className="one-device">
        <h2>Playing on one device</h2>
        <p>You take turns on this device. The game is saved only in this browser: it isn’t one of your games with friends, and nobody can open it from another device.</p>
      </div>
      <nav className="type-switch" aria-label="Game type">
      <a href="#/local" aria-current={type === 'chess' ? 'page' : undefined}>
        {GAME_TYPES.chess.label}
      </a>
      <a href="#/local/chess960" aria-current={type === 'chess960' ? 'page' : undefined}>
        {GAME_TYPES.chess960.label}
      </a>
      </nav>
    </>
  );
  return (
    <>
      <ChessTable
        players={PLAYERS}
        rules={entry.rules}
        label={entry.label}
        panelTop={panelTop}
        panelEnd={type === 'chess960' ? <AboutChess960 /> : null}
      />
      <SharedHistory />
    </>
  );
}
