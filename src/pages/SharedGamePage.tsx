// A game shared with a friend. The server is authoritative: the board shows the last
// confirmed position, plus a move that is visibly "saving" until the server accepts it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from '@shared/chess/board.ts';
import { applyMove, gameStatus, replay, type GameRecord, type PromotionPiece } from '@shared/chess/game.ts';
import InvitationShare from '../components/InvitationShare';
import MoveList from '../components/MoveList';
import PlayBoard from '../components/PlayBoard';
import PlayerPlate, { type PlateBadge } from '../components/PlayerPlate';
import { badgeFor } from '../shared/badges';
import { describeGame, opponentName, other } from '../shared/describe';
import { ApiError, gameApi, NetworkError, type GameAction, type Seat, type SharedGame } from '../shared/gameApi';
import { forgetInvitation, invitationFor, rememberInvitation, type Identity } from '../shared/identity';
import { newRequestId } from '../shared/requestId';
import { navigate } from '../shared/route';

const POLL_MS = 4_000;

const finishedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const colorOf = (seat: Seat): Color => (seat === 'white' ? 'w' : 'b');

interface Pending {
  requestId: string;
  expectedRevision: number;
  action: GameAction;
  /** Set when sending failed; the action is not saved and can be retried as-is. */
  failure: string | null;
}

interface SharedGamePageProps {
  identity: Identity;
  gameId: string;
  onIdentityRejected: () => void;
}

export default function SharedGamePage({ identity, gameId, onIdentityRejected }: SharedGamePageProps) {
  const [game, setGame] = useState<SharedGame | null>(null);
  const [missing, setMissing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingResign, setConfirmingResign] = useState(false);
  // Reviewing a finished game: the number of moves (plies) shown, or null for the final position.
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [rematchBusy, setRematchBusy] = useState(false);
  const sending = useRef(false);

  /** Accept a confirmed game from the server, never going back to an older revision. */
  const accept = useCallback((next: SharedGame) => {
    setGame((current) => (current && current.id === next.id && current.revision > next.revision ? current : next));
    if (next.status !== 'waiting') forgetInvitation(next.id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { game } = await gameApi.getGame(identity.credential, gameId);
      accept(game);
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) setOffline(true);
      else if (e instanceof ApiError && e.status === 401) onIdentityRejected();
      else if (e instanceof ApiError && e.status === 404) setMissing(true);
    }
  }, [identity.credential, gameId, accept, onIdentityRejected]);

  // A finished game only changes when someone starts a rematch.
  const settled = game?.status === 'finished' && game.rematchGameId !== null;

  // Load, then poll while the page is visible and the game can still change.
  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !settled && !sending.current) refresh();
    }, POLL_MS);
    const onReturn = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [refresh, settled]);

  async function send(next: Pending) {
    sending.current = true;
    setPending({ ...next, failure: null });
    setNotice(null);
    try {
      const result = await gameApi.submitAction(
        identity.credential,
        gameId,
        next.requestId,
        next.expectedRevision,
        next.action,
      );
      accept(result.game);
      setPending(null);
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        // Unknown whether it arrived. Keep it, unsaved, for a retry with the same request ID.
        setPending({
          ...next,
          failure: `Couldn’t confirm whether your ${next.action.type === 'move' ? 'move' : 'resignation'} was saved: the game server didn’t answer. Retrying is safe; it won’t be applied twice.`,
        });
      } else if (e instanceof ApiError && e.status === 401) {
        onIdentityRejected();
      } else {
        setPending(null);
        if (e instanceof ApiError && e.code === 'stale_revision' && e.game) {
          accept(e.game);
          setNotice('The game changed before your move was saved. Here’s the latest position.');
        } else {
          setNotice(e instanceof ApiError ? e.message : 'That didn’t work.');
          refresh();
        }
      }
    } finally {
      sending.current = false;
    }
  }

  function act(action: GameAction) {
    if (!game || pending) return;
    send({ requestId: newRequestId(), expectedRevision: game.revision, action, failure: null });
  }

  const confirmed: GameRecord | null = useMemo(
    () => (game ? { schemaVersion: 1, initialFen: game.chess.initialFen, moves: game.chess.moves } : null),
    [game],
  );
  const pendingMove = pending && !pending.failure && pending.action.type === 'move' ? pending.action : null;
  const shown = useMemo(() => {
    if (confirmed && viewPly !== null) return { ...confirmed, moves: confirmed.moves.slice(0, viewPly) };
    if (!confirmed || !pendingMove) return confirmed;
    return applyMove(confirmed, pendingMove.from, pendingMove.to, pendingMove.promotion) ?? confirmed;
  }, [confirmed, pendingMove, viewPly]);

  if (missing) {
    return (
      <div className="page">
        <section className="card">
          <h2>Game not found</h2>
          <p>This game doesn’t exist, or it isn’t one of yours.</p>
          <a className="button" href="#/">
            Your games
          </a>
        </section>
      </div>
    );
  }

  if (!game || !shown || !confirmed) {
    return (
      <div className="page">
        <section className="card">
          <p className="muted">{offline ? 'Can’t reach the game server. Retrying…' : 'Setting the table…'}</p>
        </section>
      </div>
    );
  }

  const me = game.yourSeat;
  const them = other(me);
  const opponent = opponentName(game);
  const myTurn = game.status === 'active' && game.chess.turn === me && !pending;
  const status = gameStatus(replay(shown));
  // Plates show the game's real state, even while an earlier position is being reviewed.
  const plateStatus = viewPly === null ? status : gameStatus(replay(confirmed));
  const token = game.status === 'waiting' ? invitationFor(game.id) : null;

  function badge(seat: Seat): PlateBadge {
    if (game!.status === 'waiting') return null;
    if (game!.termination === 'resignation') return game!.result === seat ? 'won' : null;
    return badgeFor(colorOf(seat), plateStatus);
  }

  function explainBlocked(color: Color): string {
    if (color !== colorOf(me)) return `You play ${me === 'white' ? 'White' : 'Black'}.`;
    if (game!.status === 'waiting') return `Waiting for ${opponent ?? 'your friend'} to join.`;
    if (pending) return pending.failure ? 'Retry or cancel your unsaved move first.' : 'Saving your move…';
    return `It’s ${opponent ?? 'your friend'}’s move.`;
  }

  let statusLine = describeGame(game);
  if (game.status === 'active' && status.kind === 'playing' && status.check && game.chess.turn === me) {
    statusLine = 'Check! Your move';
  }
  if (pendingMove) statusLine = 'Saving your move…';

  return (
    <>
      <section className="table" aria-label={`Chess: you vs ${opponent ?? 'your friend'}`}>
        <PlayerPlate name={opponent ?? 'Waiting for friend'} color={colorOf(them)} badge={badge(them)} />
        <PlayBoard
          record={shown}
          movable={myTurn ? colorOf(me) : null}
          orientation={colorOf(me)}
          pendingMove={pendingMove}
          onMove={(from: string, to: string, promotion?: PromotionPiece) =>
            act({ type: 'move', from, to, ...(promotion ? { promotion } : {}) })
          }
          onNotice={setNotice}
          explainBlocked={explainBlocked}
        />
        <PlayerPlate name={`${identity.displayName} (you)`} color={colorOf(me)} badge={badge(me)} />
      </section>

      <section className="game-panel" aria-label="This game">
        {offline && (
          <p className="banner banner-warning" role="alert">
            Can’t reach the game server. Showing the last saved position.
          </p>
        )}
        <p className={`game-status game-status-${game.status === 'finished' ? 'checkmate' : 'playing'}`} role="status">
          {statusLine}
        </p>
        <p className="game-notice" aria-live="polite">
          {notice}
        </p>

        {pending?.failure && (
          <div className="banner banner-error" role="alert">
            <p>{pending.failure}</p>
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={() => send(pending)}>
                Retry
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPending(null);
                  refresh();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {game.status === 'waiting' &&
          (token ? (
            <InvitationShare token={token} />
          ) : game.players.white?.id === identity.playerId ? (
            <RenewInvitation identity={identity} gameId={game.id} onIdentityRejected={onIdentityRejected} />
          ) : null)}

        {game.status === 'finished' ? (
          <>
            <p className="finished-date">Finished {finishedDate.format(new Date(game.updatedAt))}</p>
            <Review
              ply={viewPly ?? confirmed.moves.length}
              total={confirmed.moves.length}
              onShow={(ply) => setViewPly(ply === confirmed.moves.length ? null : ply)}
            />
            <MoveList
              chess={replay(confirmed)}
              currentPly={viewPly ?? confirmed.moves.length}
              onSelectPly={(ply) => setViewPly(ply === confirmed.moves.length ? null : ply)}
            />
            {game.rematchGameId ? (
              <a className="button button-primary" href={`#/game/${game.rematchGameId}`}>
                Go to the rematch
              </a>
            ) : (
              <button
                type="button"
                className="button button-primary"
                disabled={rematchBusy}
                onClick={async () => {
                  setRematchBusy(true);
                  setNotice(null);
                  try {
                    const { game: next } = await gameApi.rematch(identity.credential, game.id);
                    navigate(`#/game/${next.id}`);
                  } catch (e) {
                    if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
                    // Safe to press again: there is at most one rematch per game.
                    setNotice('Couldn’t start a new game: the game server didn’t answer. Try again.');
                  } finally {
                    setRematchBusy(false);
                  }
                }}
              >
                {rematchBusy ? 'Setting up…' : `Play again (you take ${me === 'white' ? 'Black' : 'White'})`}
              </button>
            )}
          </>
        ) : (
          <MoveList chess={replay(confirmed)} />
        )}

        {game.status === 'active' &&
          (confirmingResign ? (
            <div className="confirm" role="group" aria-label="Confirm resignation">
              <span>Resign this game? {opponent ?? 'Your friend'} wins.</span>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setConfirmingResign(false);
                  act({ type: 'resign' });
                }}
              >
                Resign
              </button>
              <button type="button" className="button" onClick={() => setConfirmingResign(false)}>
                Keep playing
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!!pending}
              onClick={() => setConfirmingResign(true)}
            >
              Resign…
            </button>
          ))}

        <p className="page-footnote">
          <a href="#/">← Your games</a>
        </p>
      </section>
    </>
  );
}

/** For a waiting game whose link this device doesn't have (e.g. the creation response was lost). */
function RenewInvitation({
  identity,
  gameId,
  onIdentityRejected,
}: {
  identity: Identity;
  gameId: string;
  onIdentityRejected: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      const { invitation } = await gameApi.renewInvitation(identity.credential, gameId);
      rememberInvitation(gameId, invitation.token);
      setToken(invitation.token);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      setError(
        e instanceof ApiError && e.code === 'invitation_used'
          ? 'Your friend has just joined.'
          : 'Couldn’t reach the game server. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (token) return <InvitationShare token={token} />;

  return (
    <div className="invite">
      <p>This device doesn’t have the invitation link for this game. Make a new one to send; any earlier link stops working.</p>
      <button type="button" className="button button-primary" disabled={busy} onClick={renew}>
        {busy ? 'Making a link…' : 'Make a new invitation link'}
      </button>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Step through a finished game's positions. */
function Review({ ply, total, onShow }: { ply: number; total: number; onShow: (ply: number) => void }) {
  const position = ply === 0 ? 'Start position' : ply === total ? `Final position, after move ${Math.ceil(ply / 2)}` : `After move ${Math.ceil(ply / 2)} (${ply % 2 === 1 ? 'White' : 'Black'})`;
  return (
    <div className="review" role="group" aria-label="Review the game">
      <div className="button-row">
        <button type="button" className="button" aria-label="Start position" disabled={ply === 0} onClick={() => onShow(0)}>
          ⏮
        </button>
        <button type="button" className="button" aria-label="Previous move" disabled={ply === 0} onClick={() => onShow(ply - 1)}>
          ◀
        </button>
        <button type="button" className="button" aria-label="Next move" disabled={ply === total} onClick={() => onShow(ply + 1)}>
          ▶
        </button>
        <button type="button" className="button" aria-label="Final position" disabled={ply === total} onClick={() => onShow(total)}>
          ⏭
        </button>
      </div>
      <p className="review-position" aria-live="polite">
        {position}
      </p>
    </div>
  );
}
