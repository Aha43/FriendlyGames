import { useCallback, useEffect, useState, type FormEvent } from 'react';
import ChessHistory from '../components/ChessHistory';
import InvitationShare from '../components/InvitationShare';
import { describeGame, opponentName } from '../shared/describe';
import { ApiError, gameApi, NetworkError, type HistoryEntry, type SharedGame } from '../shared/gameApi';
import { forgetInvitation, rememberInvitation, tokenFromInvitation, type Identity } from '../shared/identity';
import { navigate } from '../shared/route';
import { newRequestId } from '../shared/requestId';

const REFRESH_MS = 15_000;

interface LobbyProps {
  identity: Identity;
  onIdentityRejected: () => void;
}

export default function Lobby({ identity, onIdentityRejected }: LobbyProps) {
  const [games, setGames] = useState<SharedGame[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Games and history load independently, so one failing does not hide the other.
    const [games, history] = await Promise.allSettled([
      gameApi.listGames(identity.credential),
      gameApi.history(identity.credential),
    ]);
    if (games.status === 'fulfilled') {
      setGames(games.value.games);
      for (const game of games.value.games) if (game.status !== 'waiting') forgetInvitation(game.id);
    }
    if (history.status === 'fulfilled') setHistory(history.value.history);

    const failure = [games, history].find((r) => r.status === 'rejected')?.reason;
    if (failure instanceof ApiError && failure.status === 401) onIdentityRejected();
    else setLoadError(failure ? 'Couldn’t load everything. Showing what we had; we’ll keep trying.' : null);
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

  return (
    <div className="page">
      <section className="card" aria-labelledby="games-title">
        <h2 id="games-title">Your games</h2>
        {loadError && <p className="banner banner-warning">{loadError}</p>}
        {games === null && !loadError && <p className="muted">Looking for your games…</p>}
        {games !== null && ongoing.length === 0 && <p className="muted">No games in progress. Start one below.</p>}
        {ongoing.length > 0 && <GameLinks games={ongoing} label="Games in progress" />}
      </section>

      {history && <ChessHistory history={history} />}

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
        const yourTurn = game.status !== 'finished' && game.chess.turn === game.yourSeat;
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
  const [created, setCreated] = useState<{ gameId: string; token: string | null } | null>(null);
  // An attempt whose outcome is unknown. Retrying with its request ID finds the game if it was created.
  const [uncertain, setUncertain] = useState<{ requestId: string; email: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const friendEmail = email.trim();
    const requestId = uncertain?.email === friendEmail ? uncertain.requestId : newRequestId();
    setBusy(true);
    setError(null);
    try {
      const { game, invitation } = await gameApi.createGame(identity.credential, friendEmail, requestId);
      if (invitation) rememberInvitation(game.id, invitation.token);
      setCreated({ gameId: game.id, token: invitation?.token ?? null });
      setUncertain(null);
      setEmail('');
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        setUncertain({ requestId, email: friendEmail });
        setError(
          'Couldn’t confirm whether the game was created: the game server didn’t answer. Trying again is safe; it won’t create a second game.',
        );
      } else {
        setUncertain(null);
        setError('Please enter your friend’s email address.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="new-game-title">
      <h2 id="new-game-title">Start a chess game</h2>
      {created ? (
        <>
          {created.token ? (
            <>
              <p>Your game is ready. You play White.</p>
              <InvitationShare token={created.token} />
            </>
          ) : (
            <p>Your friend has already joined this game.</p>
          )}
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
            {busy ? 'Creating…' : uncertain?.email === email.trim() ? 'Try again' : 'Create game'}
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
