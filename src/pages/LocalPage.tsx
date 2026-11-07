import ChessTable from '../components/ChessTable';
import SharedHistory from '../components/SharedHistory';
import AboutChess960 from '../components/AboutChess960';
import { GAME_TYPES } from '../games/registry';

// Both sides on one device, kept in this browser only. Separate from shared games by design.
// Each type has its own saved game (#55); switching between them keeps both.
const PLAYERS = { w: 'White', b: 'Black' };

export default function LocalPage({ type = 'chess' }: { type?: 'chess' | 'chess960' }) {
  const entry = GAME_TYPES[type];
  const typeSwitch = (
    <nav className="type-switch" aria-label="Local game type">
      <a href="#/local" aria-current={type === 'chess' ? 'page' : undefined}>
        {GAME_TYPES.chess.label}
      </a>
      <a href="#/local/chess960" aria-current={type === 'chess960' ? 'page' : undefined}>
        {GAME_TYPES.chess960.label}
      </a>
    </nav>
  );
  return (
    <>
      <ChessTable
        players={PLAYERS}
        rules={entry.rules}
        label={entry.label}
        panelTop={typeSwitch}
        panelEnd={type === 'chess960' ? <AboutChess960 /> : null}
      />
      <SharedHistory />
    </>
  );
}
