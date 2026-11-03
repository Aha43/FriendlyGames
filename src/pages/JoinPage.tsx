import { useEffect, useRef, useState } from 'react';
import { ApiError, gameApi, NetworkError } from '../shared/gameApi';
import { UNSUPPORTED_GAME_TEXT } from '../games/registry';
import type { Identity } from '../shared/identity';
import { navigate } from '../shared/route';

const MESSAGES: Record<string, string> = {
  invitation_used: 'This invitation has already been used by someone else.',
  invitation_not_found: 'This invitation link isn’t valid. Check that it was copied completely.',
  already_participant: 'This is your own invitation. Send the link to your friend.',
  unsupported_game: UNSUPPORTED_GAME_TEXT,
};

interface JoinPageProps {
  identity: Identity;
  token: string;
  onIdentityRejected: () => void;
}

export default function JoinPage({ identity, token, onIdentityRejected }: JoinPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (started.current === attempt) return; // StrictMode runs effects twice; redeem once per attempt
    started.current = attempt;
    gameApi
      .redeemInvitation(identity.credential, token)
      // Replace the join URL so the token does not stay in browser history.
      .then(({ game }) => navigate(`#/game/${game.id}`, { replace: true }))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
        setError(
          e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)
            ? 'Couldn’t reach the game server.'
            : (MESSAGES[(e as ApiError).code] ?? 'Something went wrong joining this game.'),
        );
      });
  }, [identity.credential, token, attempt, onIdentityRejected]);

  return (
    <div className="page">
      <section className="card" aria-labelledby="join-status">
        <h2 id="join-status">{error ? 'Couldn’t join' : 'Joining the game…'}</h2>
        {error && (
          <>
            <p role="alert">{error}</p>
            <div className="button-row">
              {error.startsWith('Couldn’t reach') && (
                <button type="button" className="button button-primary" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>
                  Try again
                </button>
              )}
              <a className="button" href="#/">
                Your games
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
