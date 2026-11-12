import { useCallback, useState } from 'react';
import ParkBackdrop from './components/ParkBackdrop';
import { PIECE_SET_CREDIT, PIECE_SET_LICENSE_URL } from './components/pieceSet';
import JoinPage from './pages/JoinPage';
import LocalPage from './pages/LocalPage';
import Lobby from './pages/Lobby';
import Onboarding from './pages/Onboarding';
import SharedGamePage from './pages/SharedGamePage';
import YatzyPage from './pages/YatzyPage';
import type { TableGame } from './shared/gameApi';
import { forgetIdentity, loadIdentity, type Identity } from './shared/identity';
import { useRoute } from './shared/route';

/**
 * One shared game. Its type is only known once loaded: the chess page loads it, and hands a
 * table (Yatzy) over to the table page (#86).
 */
function GamePage(props: { identity: Identity; gameId: string; onIdentityRejected: () => void }) {
  const [table, setTable] = useState<TableGame | null>(null);
  return table ? <YatzyPage {...props} initial={table} /> : <SharedGamePage {...props} onTable={setTable} />;
}

/** The corresponding source of every published build (GPL-3.0-or-later, see LICENSE). */
const SOURCE_URL = 'https://github.com/Aha43/FriendlyGames';

export default function App() {
  const route = useRoute();
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity);
  const [rejected, setRejected] = useState(false);
  const onIdentityRejected = useCallback(() => setRejected(true), []);

  let content;
  if (route.page === 'local') {
    content = <LocalPage key={route.type} type={route.type} />;
  } else if (rejected) {
    content = (
      <div className="page">
        <section className="card" aria-labelledby="lost-title">
          <h2 id="lost-title">We don’t recognise this browser any more</h2>
          <p>
            The game server no longer knows the player saved in this browser. Enter your email again to open your
            games.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              forgetIdentity();
              setIdentity(null);
              setRejected(false);
            }}
          >
            Enter my email
          </button>
        </section>
      </div>
    );
  } else if (!identity) {
    content = <Onboarding invited={route.page === 'join'} onDone={setIdentity} />;
  } else if (route.page === 'join') {
    content = <JoinPage key={route.token} identity={identity} token={route.token} onIdentityRejected={onIdentityRejected} />;
  } else if (route.page === 'game') {
    content = <GamePage key={route.gameId} identity={identity} gameId={route.gameId} onIdentityRejected={onIdentityRejected} />;
  } else {
    content = <Lobby identity={identity} onIdentityRejected={onIdentityRejected} />;
  }

  return (
    <div className="park">
      <ParkBackdrop />

      <header className="topbar">
        <h1>
          <a href="#/">FriendlyGames</a>
        </h1>
        <span className="topbar-game">Chess &amp; Yatzy</span>
        <nav className="topbar-nav" aria-label="Main">
          {route.page === 'local' ? <a href="#/">Your games</a> : <a href="#/local">Local game</a>}
          {identity && route.page !== 'local' && <span className="topbar-player">{identity.displayName}</span>}
        </nav>
      </header>

      <main className={route.page === 'local' || route.page === 'game' ? 'layout' : 'layout layout-single'}>
        {content}
      </main>

      <footer className="credits">
        <a href={PIECE_SET_LICENSE_URL}>{PIECE_SET_CREDIT}</a> ·{' '}
        <a href={`${import.meta.env.BASE_URL}licenses/chess.js.txt`}>Rules by chess.js, BSD license</a> ·{' '}
        <a href={`${import.meta.env.BASE_URL}licenses/chessops.txt`}>Fischer Random rules by chessops, GPL</a> (with{' '}
        <a href={`${import.meta.env.BASE_URL}licenses/badrap-result.txt`}>@badrap/result, MIT</a>) · Park artwork original
        to FriendlyGames · <a href={SOURCE_URL}>Source code, GPL-3.0-or-later</a>
        {__BUILD_COMMIT__ && <span className="build"> · Build {__BUILD_COMMIT__.slice(0, 7)}</span>}
      </footer>
    </div>
  );
}
