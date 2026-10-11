import { INITIAL_FEN, parseFen } from './chess/board';
import ChessBoard from './components/ChessBoard';
import ParkBackdrop from './components/ParkBackdrop';
import PlayerPlate from './components/PlayerPlate';
import SharedHistory from './components/SharedHistory';
import { PIECE_SET_CREDIT, PIECE_SET_LICENSE_URL } from './components/pieceSet';

// The table shows a fixed opening position until local play arrives (#3).
const WHITE = 'Arne';
const BLACK = 'Harald';

export default function App() {
  const { board, turn } = parseFen(INITIAL_FEN);
  const toMoveName = turn === 'w' ? WHITE : BLACK;

  return (
    <div className="park">
      <ParkBackdrop />

      <header className="topbar">
        <h1>FriendlyGames</h1>
        <span className="topbar-game">Chess</span>
      </header>

      <main className="layout">
        <section className="table" aria-label={`Chess: ${WHITE} vs ${BLACK}`}>
          <PlayerPlate name={BLACK} color="b" toMove={turn === 'b'} />
          <div className="board-frame">
            <ChessBoard board={board} />
          </div>
          <PlayerPlate name={WHITE} color="w" toMove={turn === 'w'} />
          <p className="turn-status" role="status">
            {toMoveName} to move
          </p>
        </section>

        <SharedHistory />
      </main>

      <footer className="credits">
        <a href={PIECE_SET_LICENSE_URL}>{PIECE_SET_CREDIT}</a> · Park artwork original to FriendlyGames
      </footer>
    </div>
  );
}
