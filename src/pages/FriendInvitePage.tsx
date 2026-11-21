import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, gameApi, NetworkError, type FriendInvitationPreview } from '../shared/gameApi';
import { setFlash } from '../shared/flash';
import type { Identity } from '../shared/identity';
import { navigate } from '../shared/route';
import Onboarding from './Onboarding';

interface FriendInvitePageProps {
  /** Null until the holder of the link has entered their email. */
  identity: Identity | null;
  token: string;
  onIdentity: (identity: Identity) => void;
  onIdentityRejected: () => void;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; invitation: FriendInvitationPreview }
  | { state: 'unavailable' }
  | { state: 'unreachable' };

const isMomentary = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);

/**
 * A friend invitation link (#111). The holder first sees who invites them, enters their email if
 * this browser has no player yet, and then accepts explicitly. Accepting connects the two; no
 * game is made. Reloading at any point shows where things stand.
 */
export default function FriendInvitePage({ identity, token, onIdentity, onIdentityRejected }: FriendInvitePageProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The friend's name once accepted here, for the confirmation.
  const [accepted, setAccepted] = useState<string | null>(null);
  const sending = useRef(false);
  const open = useRef(false);
  const credential = identity?.credential;

  const load = useCallback(async () => {
    setLoaded({ state: 'loading' });
    try {
      const { invitation } = await gameApi.previewFriendInvitation(token, credential);
      if (open.current) setLoaded({ state: 'ready', invitation });
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      setLoaded({ state: isMomentary(e) ? 'unreachable' : 'unavailable' });
    }
  }, [token, credential, onIdentityRejected]);

  useEffect(() => {
    open.current = true;
    const first = setTimeout(load, 0);
    return () => {
      open.current = false;
      clearTimeout(first);
    };
  }, [load]);

  async function accept() {
    if (sending.current || !identity) return;
    sending.current = true;
    setAccepting(true);
    setError(null);
    try {
      // Safe to repeat: the same player accepting again gets the same connection.
      const { friend } = await gameApi.acceptFriendInvitation(identity.credential, token);
      if (open.current) setAccepted(friend.displayName);
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (isMomentary(e)) {
        setError('Couldn’t confirm that you’re connected: the game server didn’t answer. Trying again is safe.');
      } else if (e instanceof ApiError && e.code === 'own_friend_invitation') {
        setLoaded((now) => (now.state === 'ready' ? { state: 'ready', invitation: { ...now.invitation, state: 'own' } } : now));
      } else {
        // Someone else accepted it first, it was replaced, or it expired while this page was open.
        setLoaded({ state: 'unavailable' });
      }
    } finally {
      sending.current = false;
      if (open.current) setAccepting(false);
    }
  }

  /** To the lobby without leaving the link in the address bar, with a note there. */
  function toGames(friend: string) {
    setFlash(`You and ${friend} are connected. Find them under Play with.`);
    navigate('#/', { replace: true });
  }

  const yourGames = (
    <a className="button" href="#/">
      {identity ? 'Your games' : 'Open FriendlyGames'}
    </a>
  );

  let card;
  if (loaded.state === 'loading') {
    card = (
      <>
        <h2 id="friend-title">Opening the invitation…</h2>
        <p className="muted">Looking up who invited you.</p>
      </>
    );
  } else if (loaded.state === 'unreachable') {
    card = (
      <>
        <h2 id="friend-title">Couldn’t open the invitation</h2>
        <p role="alert">Couldn’t reach the game server. The invitation itself may be fine.</p>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={load}>
            Try again
          </button>
          {yourGames}
        </div>
      </>
    );
  } else if (loaded.state === 'unavailable') {
    card = (
      <>
        <h2 id="friend-title">This invitation isn’t available</h2>
        <p role="alert">
          It may have expired, been replaced by a newer link, or already been used by someone. A link works for one friend,
          once. Ask your friend for a new one.
        </p>
        <div className="button-row">{yourGames}</div>
      </>
    );
  } else {
    const { inviter, state } = loaded.invitation;
    const name = inviter.displayName;
    if (accepted !== null || state === 'accepted') {
      const friend = accepted ?? name;
      card = (
        <>
          <h2 id="friend-title">You and {friend} are connected</h2>
          <p role="status">
            {accepted === null && 'You’ve already accepted this invitation. '}
            You’ll find {friend} under <strong>Play with</strong> when you start a game, and {friend} finds you there too. No
            game has been started: choose Chess, Fischer Random or Yatzy whenever you like.
          </p>
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={() => toGames(friend)}>
              Go to your games
            </button>
          </div>
        </>
      );
    } else if (state === 'own') {
      card = (
        <>
          <h2 id="friend-title">This is your own invitation</h2>
          <p>Send this link to a friend. It connects you with the first person who accepts it, so you can’t accept it yourself.</p>
          <div className="button-row">{yourGames}</div>
        </>
      );
    } else {
      card = (
        <>
          <h2 id="friend-title">{name} invites you to play</h2>
          <p>
            Accept to connect with {name} on FriendlyGames. You’ll then find each other under <strong>Play with</strong> and can
            start Chess, Fischer Random or Yatzy. Accepting doesn’t start a game.
          </p>
          {identity ? (
            <>
              <p className="fine-print-inline">You’re accepting as {identity.displayName}.</p>
              <p className="form-error" role="alert">
                {error}
              </p>
              <div className="button-row">
                <button type="button" className="button button-primary" onClick={accept} disabled={accepting}>
                  {accepting ? 'Connecting…' : error ? 'Try again' : `Accept and connect with ${name}`}
                </button>
                <a className="button" href="#/">
                  Not now
                </a>
              </div>
            </>
          ) : (
            <p className="fine-print-inline">Enter your email below first; then you can accept.</p>
          )}
        </>
      );
    }
  }

  const needsPlayer = !identity && loaded.state === 'ready' && loaded.invitation.state === 'open';
  return (
    <div className="page">
      <section className="card friend-invite" aria-labelledby="friend-title">
        {card}
      </section>
      {needsPlayer && <Onboarding invited="friend" onDone={onIdentity} />}
    </div>
  );
}
