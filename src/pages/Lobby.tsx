import { useCallback, useEffect, useState, type FormEvent } from 'react';
import InvitationShare from '../components/InvitationShare';
import { describeGame, opponentName } from '../shared/describe';
import { ApiError, gameApi, NetworkError, type SharedGame } from '../shared/gameApi';
import { forgetInvitation, rememberInvitation, tokenFromInvitation, type Identity } from '../shared/identity';
import { navigate } from '../shared/route';

const REFRESH_MS = 15_000;

interface LobbyProps {
  identity: Identity;
  onIdentityRejected: () => void;
}

export default function Lobby({ identity, onIdentityRejected }: LobbyProps) {
  const [games, setGames] = useState<SharedGame[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { games } = await gameApi.listGames(identity.credential);
      setGames(games);
      setLoadError(null);
      for (const game of games) if (game.status !== 'waiting') forgetInvitation(game.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onIdentityRejected();
      else setLoadError('Couldn’t load your games. Showing what we had; we’ll keep trying.');
    }
  }, [identity.credential, onIdentityRejected]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  const ongoing = games?.filter((g) => g.status !== 'finished') ?? [];
  const finished = games?.filter((g) => g.status === 'finished') ?? [];

  return (
    <div className="page">
      <section className="card" aria-labelledby="games-title">
        <h2 id="games-title">Your games</h2>
        {loadError && <p className="banner banner-warning">{loadError}</p>}
        {games === null && !loadError && <p className="muted">Looking for your games…</p>}
        {games !== null && ongoing.length === 0 && <p className="muted">No games in progress. Start one below.</p>}
        {ongoing.length > 0 && <GameLinks games={ongoing} label="Games in progress" />}
        {finished.length > 0 && (
          <>
            <h3 className="panel-title">Finished</h3>
            <GameLinks games={finished} label="Finished games" />
          </>
        )}
      </section>

      <NewGame identity={identity} onCreated={refresh} onIdentityRejected={onIdentityRejected} />
      <JoinByLink />

      <p className="page-footnote">
        Playing on one device? <a href="#/local">Play a local game</a> (stays in this browser).
      </p>
    </div>
  );
}

function GameLinks({ games, label }: { games: SharedGame[]; label: string }) {
  return (
    <ul className="game-links" aria-label={label}>
      {games.map((game) => {
        const opponent = opponentName(game);
        const yourTurn = game.status === 'active' && game.chess.turn === game.yourSeat;
        return (
          <li key={game.id}>
            <a href={`#/game/${game.id}`} className={`game-link${yourTurn ? ' game-link-your-turn' : ''}`}>
              <span className="game-link-title">{opponent ? `vs ${opponent}` : 'New game'}</span>
              <span className="game-link-status">{describeGame(game)}</span>
              <span className="game-link-meta">
                You play {game.yourSeat === 'white' ? 'White' : 'Black'} · {game.chess.moves.length} moves
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function NewGame({
  identity,
  onCreated,
  onIdentityRejected,
}: {
  identity: Identity;
  onCreated: () => void;
  onIdentityRejected: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ gameId: string; token: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { game, invitation } = await gameApi.createGame(identity.credential, email.trim());
      rememberInvitation(game.id, invitation.token);
      setCreated({ gameId: game.id, token: invitation.token });
      setEmail('');
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      setError(
        e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)
          ? 'Couldn’t reach the game server. Nothing was created; try again.'
          : 'Please enter your friend’s email address.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="new-game-title">
      <h2 id="new-game-title">Start a chess game</h2>
      {created ? (
        <>
          <p>Your game is ready. You play White.</p>
          <InvitationShare token={created.token} />
          <div className="button-row">
            <a className="button button-primary" href={`#/game/${created.gameId}`}>
              Go to the table
            </a>
            <button type="button" className="button" onClick={() => setCreated(null)}>
              Start another
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="form">
          <label>
            Friend’s email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
          </label>
          <p className="fine-print-inline">You’ll get a link to send them yourself. No email is sent.</p>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create game'}
          </button>
        </form>
      )}
    </section>
  );
}

function JoinByLink() {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const token = tokenFromInvitation(text);
    if (!token) return setError('That doesn’t look like an invitation link.');
    setText('');
    navigate(`#/join/${token}`);
  }

  return (
    <section className="card" aria-labelledby="join-title">
      <h2 id="join-title">Got an invitation?</h2>
      <form onSubmit={submit} className="form form-inline">
        <label>
          Paste an invitation link
          <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" className="button">
          Join
        </button>
      </form>
      <p className="form-error" role="alert">
        {error}
      </p>
    </section>
  );
}
