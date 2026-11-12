import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import ChessHistory from '../components/ChessHistory';
import InvitationShare from '../components/InvitationShare';
import NewTable from '../components/NewTable';
import YatzyHistory from '../components/YatzyHistory';
import { CHESS960_CASTLING, CHESS960_SUMMARY, GAME_TYPES, tableView, typeLabel, type GameType } from '../games/registry';
import { describeTable, MODE_LABELS, othersAt, seated } from '../games/yatzy';
import { describeGame, opponentName } from '../shared/describe';
import {
  ApiError,
  gameApi,
  isTable,
  NetworkError,
  type AnyGame,
  type HistoryEntry,
  type PreviousOpponent,
  type TableResult,
} from '../shared/gameApi';
import { forgetInvitation, rememberInvitation, tokenFromInvitation, type Identity } from '../shared/identity';
import { navigate } from '../shared/route';
import { newRequestId } from '../shared/requestId';

const REFRESH_MS = 15_000;

interface LobbyProps {
  identity: Identity;
  onIdentityRejected: () => void;
}

export default function Lobby({ identity, onIdentityRejected }: LobbyProps) {
  const [games, setGames] = useState<AnyGame[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [tables, setTables] = useState<TableResult[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An answer that arrives after the lobby has closed is ignored (its timers are already cleared).
  const open = useRef(false);

  const refresh = useCallback(async () => {
    // Games and history load independently, so one failing does not hide the other.
    const [games, history] = await Promise.allSettled([
      gameApi.listGames(identity.credential),
      gameApi.history(identity.credential),
    ]);
    if (!open.current) return;
    if (games.status === 'fulfilled') {
      // A table in a schema this client cannot read is left out, like any unknown game.
      setGames(games.value.games.filter((game) => !isTable(game) || tableView(game)));
      for (const game of games.value.games) if (game.status !== 'waiting') forgetInvitation(game.id);
    }
    if (history.status === 'fulfilled') {
      setHistory(history.value.history);
      setTables((history.value.tables ?? []).filter((table) => table.gameType === 'yatzy' && table.result?.yatzy?.standings));
    }

    const failure = [games, history].find((r) => r.status === 'rejected')?.reason;
    if (failure instanceof ApiError && failure.status === 401) onIdentityRejected();
    else setLoadError(failure ? 'Couldn’t load everything. Showing what we had; we’ll keep trying.' : null);
  }, [identity.credential, onIdentityRejected]);

  useEffect(() => {
    open.current = true;
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      open.current = false;
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
      <YatzyHistory tables={tables} />

      <NewGame identity={identity} onCreated={refresh} onIdentityRejected={onIdentityRejected} />
      <JoinByLink />

      <p className="page-footnote">
        Playing on one device? <a href="#/local">Play a local game</a> (stays in this browser).
      </p>
    </div>
  );
}

function GameLinks({ games, label }: { games: AnyGame[]; label: string }) {
  return (
    <ul className="game-links" aria-label={label}>
      {games.map((game) => {
        if (isTable(game)) {
          const yourTurn = game.turn === game.yourSeat;
          return (
            <li key={game.id}>
              <a href={`#/game/${game.id}`} className={`game-link${yourTurn ? ' game-link-your-turn' : ''}`}>
                <span className="game-link-title">with {othersAt(game)}</span>
                <span className="game-link-status">{describeTable(game)}</span>
                <span className="game-link-meta">
                  <span className="game-link-type game-link-type-yatzy">Yatzy</span> · {MODE_LABELS[game.yatzy.mode]} ·{' '}
                  {seated(game.players).length} players
                </span>
              </a>
            </li>
          );
        }
        const opponent = opponentName(game);
        const yourTurn = game.status !== 'finished' && game.turn === game.yourSeat;
        return (
          <li key={game.id}>
            <a href={`#/game/${game.id}`} className={`game-link${yourTurn ? ' game-link-your-turn' : ''}`}>
              <span className="game-link-title">{opponent ? `vs ${opponent}` : 'New game'}</span>
              <span className="game-link-status">{describeGame(game)}</span>
              <span className="game-link-meta">
                <span className={`game-link-type game-link-type-${game.type}`}>{typeLabel(game.type)}</span> · You play{' '}
                {game.yourSeat === 'white' ? 'White' : 'Black'} · {game.moveCount} moves
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Who a new game is with: someone already played (by player ID, never by name) or an email to invite. */
type Target = { kind: 'player'; playerId: string } | { kind: 'email' };

/** Previous opponents shown before "Show all": the most recent ones, keeping the list compact. */
const SHORT_LIST = 6;
const sharedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
  const [type, setType] = useState<GameType | 'yatzy'>('chess');
  // Nobody is chosen until the player picks someone (#73).
  const [choice, setChoice] = useState<Target | null>(null);
  const [opponents, setOpponents] = useState<PreviousOpponent[] | null>(null);
  const [opponentsFailed, setOpponentsFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ gameId: string; token: string | null; type: GameType } | null>(null);
  // An attempt whose outcome is unknown. Retrying the same target (same friend email or same
  // opponent) and type with its request ID finds the game if it was created; changing any is a new request.
  const [uncertain, setUncertain] = useState<{ requestId: string; target: string; type: string } | null>(null);
  const open = useRef(false);

  const loadOpponents = useCallback(async () => {
    try {
      const { opponents } = await gameApi.listOpponents(identity.credential);
      if (!open.current) return;
      setOpponents(opponents);
      setOpponentsFailed(false);
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      // Keep any list already shown; never present a failure as "nobody played yet".
      setOpponentsFailed(true);
    }
  }, [identity.credential, onIdentityRejected]);

  useEffect(() => {
    open.current = true;
    const first = setTimeout(loadOpponents, 0);
    const onVisible = () => document.visibilityState === 'visible' && loadOpponents();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      open.current = false;
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadOpponents]);

  const known = opponents !== null && opponents.length > 0;
  // Without anyone to pick (still loading, failed or nobody yet) the invitation form is the way.
  // An email typed before the list arrived keeps the invitation path chosen.
  const mode: Target['kind'] | null = !known ? 'email' : (choice?.kind ?? (email ? 'email' : null));
  const opponent =
    mode === 'player' && choice?.kind === 'player' ? opponents?.find((o) => o.id === choice.playerId) : undefined;
  const target = mode === 'player' ? (opponent ? `player:${opponent.id}` : null) : mode === 'email' ? `email:${email.trim()}` : null;
  const retrying = uncertain !== null && uncertain.target === target && uncertain.type === type;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || target === null || type === 'yatzy') return;
    const friendEmail = email.trim();
    const requestId = retrying && uncertain ? uncertain.requestId : newRequestId();
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (opponent) {
        const { game } = await gameApi.createGameWith(identity.credential, opponent.id, requestId, type);
        setUncertain(null);
        onCreated();
        navigate(`#/game/${game.id}`);
        return;
      }
      const { game, invitation } = await gameApi.createGame(identity.credential, friendEmail, requestId, type);
      if (invitation) rememberInvitation(game.id, invitation.token);
      setCreated({ gameId: game.id, token: invitation?.token ?? null, type });
      setUncertain(null);
      setEmail('');
      setChoice(null);
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        setUncertain({ requestId, target, type });
        setError(
          'Couldn’t confirm whether the game was created: the game server didn’t answer. Trying again is safe; it won’t create a second game.',
        );
      } else {
        setUncertain(null);
        setError(creationError(e, opponent ? 'player' : 'email'));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const label = busy ? 'Creating…' : retrying ? 'Try again' : mode === 'email' ? 'Create game' : 'Start game';

  const typePicker = (
    <fieldset className="type-picker">
      <legend>Game</legend>
      {(['chess', 'chess960', 'yatzy'] as const).map((option) => (
        <label key={option} className="type-option">
          <input type="radio" name="game-type" value={option} checked={type === option} onChange={() => setType(option)} />
          {option === 'chess960' ? 'Fischer Random (Chess960)' : typeLabel(option)}
        </label>
      ))}
    </fieldset>
  );
  const opponentsStatus = (
    <>
      {opponents === null && !opponentsFailed && <p className="muted">Looking for people you’ve played with…</p>}
      {opponentsFailed && (
        <p className="banner banner-warning opponents-failed">
          Couldn’t load the people you’ve played with.{known || type === 'yatzy' ? '' : ' You can still invite someone by email.'}{' '}
          <button type="button" className="text-button" onClick={loadOpponents}>
            Load the list again
          </button>
        </p>
      )}
    </>
  );

  return (
    <section className="card" aria-labelledby="new-game-title">
      <h2 id="new-game-title">Start a game</h2>
      {type === 'yatzy' ? (
        <NewTable
          identity={identity}
          typePicker={typePicker}
          opponentsStatus={opponentsStatus}
          opponents={opponents}
          onCreated={onCreated}
          onIdentityRejected={onIdentityRejected}
        />
      ) : created ? (
        <>
          {created.token ? (
            <>
              <p>Your {GAME_TYPES[created.type].label} game is ready. You play White.</p>
              <InvitationShare token={created.token} gameLabel={GAME_TYPES[created.type].label} />
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
          {typePicker}
          {type === 'chess960' && (
            <div className="type-explainer">
              <p>{CHESS960_SUMMARY} The server draws your starting arrangement when the game is created.</p>
              <p>{CHESS960_CASTLING}</p>
            </div>
          )}

          {opponentsStatus}
          {known && (
            <fieldset className="opponent-picker">
              <legend>Play with</legend>
              {(showAll ? opponents : opponents.slice(0, SHORT_LIST)).map((o) => (
                <label key={o.id} className="opponent-option">
                  <input
                    type="radio"
                    name="opponent"
                    value={o.id}
                    checked={mode === 'player' && choice?.kind === 'player' && choice.playerId === o.id}
                    onChange={() => setChoice({ kind: 'player', playerId: o.id })}
                    aria-labelledby={`opponent-${o.id}-name`}
                    aria-describedby={`opponent-${o.id}-meta`}
                  />
                  <span className="opponent-text">
                    <span id={`opponent-${o.id}-name`} className="opponent-name">
                      {o.displayName}
                    </span>
                    <span id={`opponent-${o.id}-meta`} className="opponent-meta">
                      {o.sharedGames} {o.sharedGames === 1 ? 'game' : 'games'} together · Last shared game{' '}
                      {sharedDate.format(new Date(o.lastSharedGameUpdatedAt))}
                    </span>
                  </span>
                </label>
              ))}
              {!showAll && opponents.length > SHORT_LIST && (
                <button type="button" className="text-button show-all" onClick={() => setShowAll(true)}>
                  Show all {opponents.length}
                </button>
              )}
              <label className="opponent-option opponent-option-new">
                <input
                  type="radio"
                  name="opponent"
                  value="new"
                  checked={mode === 'email'}
                  onChange={() => setChoice({ kind: 'email' })}
                />
                <span className="opponent-name">Invite someone new</span>
              </label>
            </fieldset>
          )}

          {mode === 'player' && opponent && (
            <p className="matchup">
              You play White. {opponent.displayName} plays Black and sees the game in their lobby.
            </p>
          )}
          {mode === 'email' && (
            <>
              <label>
                Friend’s email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
              </label>
              <p className="fine-print-inline">You’ll get a link to send them yourself. No email is sent.</p>
            </>
          )}
          {mode === null && (
            <p id="new-game-hint" className="fine-print-inline">
              Choose someone you’ve played with, or invite someone new.
            </p>
          )}
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || target === null}
            aria-describedby={mode === null ? 'new-game-hint' : undefined}
          >
            {label}
          </button>
        </form>
      )}
    </section>
  );
}

function creationError(e: unknown, mode: 'player' | 'email'): string {
  if (e instanceof ApiError) {
    if (e.code === 'unsupported_game_type') return 'This game type isn’t available here. Reload the page to update.';
    if (e.code === 'unsupported_game') return e.message;
    if (e.code === 'opponent_not_found') return 'You have no earlier game with that player. Invite them by email instead.';
    if (e.code === 'request_id_reused') return 'Couldn’t start that game. Please try again.';
  }
  return mode === 'email' ? 'Please enter your friend’s email address.' : 'Couldn’t start that game. Please try again.';
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
