import ChessTable from './components/ChessTable';
import ParkBackdrop from './components/ParkBackdrop';
import SharedHistory from './components/SharedHistory';
import { PIECE_SET_CREDIT, PIECE_SET_LICENSE_URL } from './components/pieceSet';

// Both players share this device until cross-device play arrives in Sprint 2.
const PLAYERS = { w: 'Arne', b: 'Harald' };

export default function App() {
  return (
    <div className="park">
      <ParkBackdrop />

      <header className="topbar">
        <h1>FriendlyGames</h1>
        <span className="topbar-game">Chess</span>
      </header>

      <main className="layout">
        <ChessTable players={PLAYERS} />
        <SharedHistory />
      </main>

      <footer className="credits">
        <a href={PIECE_SET_LICENSE_URL}>{PIECE_SET_CREDIT}</a> ·{' '}
        <a href={`${import.meta.env.BASE_URL}licenses/chess.js.txt`}>Rules by chess.js, BSD license</a> · Park artwork
        original to FriendlyGames
      </footer>
    </div>
  );
}
