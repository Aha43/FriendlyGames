import { useCallback, useState } from 'react';
import ParkBackdrop from './components/ParkBackdrop';
import { PIECE_SET_CREDIT, PIECE_SET_LICENSE_URL } from './components/pieceSet';
import JoinPage from './pages/JoinPage';
import LocalPage from './pages/LocalPage';
import Lobby from './pages/Lobby';
import Onboarding from './pages/Onboarding';
import SharedGamePage from './pages/SharedGamePage';
import { forgetIdentity, loadIdentity, type Identity } from './shared/identity';
import { useRoute } from './shared/route';

export default function App() {
  const route = useRoute();
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity);
  const [rejected, setRejected] = useState(false);
  const onIdentityRejected = useCallback(() => setRejected(true), []);

  let content;
  if (route.page === 'local') {
    content = <LocalPage />;
  } else if (rejected) {
    content = (
      <div className="page">
        <section className="card" aria-labelledby="lost-title">
          <h2 id="lost-title">We don’t recognise this device any more</h2>
          <p>
            The game server no longer knows the identity saved in this browser, so its games can’t be reached from
            here. You can start again as a new player.
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
            Start as a new player
          </button>
        </section>
      </div>
    );
  } else if (!identity) {
    content = <Onboarding invited={route.page === 'join'} onDone={setIdentity} />;
  } else if (route.page === 'join') {
    content = <JoinPage key={route.token} identity={identity} token={route.token} onIdentityRejected={onIdentityRejected} />;
  } else if (route.page === 'game') {
    content = (
      <SharedGamePage key={route.gameId} identity={identity} gameId={route.gameId} onIdentityRejected={onIdentityRejected} />
    );
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
        <span className="topbar-game">Chess</span>
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
        <a href={`${import.meta.env.BASE_URL}licenses/chess.js.txt`}>Rules by chess.js, BSD license</a> · Park artwork
        original to FriendlyGames
      </footer>
    </div>
  );
}
