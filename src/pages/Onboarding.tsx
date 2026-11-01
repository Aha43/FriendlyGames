import { useRef, useState, type FormEvent } from 'react';
import { gameApi, NetworkError, ApiError } from '../shared/gameApi';
import { saveIdentity, type Identity } from '../shared/identity';

interface OnboardingProps {
  invited: boolean;
  onDone: (identity: Identity) => void;
}

/**
 * Email entry (prototype, #29). Email first: an email that belongs to a player opens that player
 * here; a new email asks for a name and creates the player. Email ownership isn't checked.
 */
export default function Onboarding({ invited, onDone }: OnboardingProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { player, deviceCredential } = await gameApi.enterPlayer(email.trim(), needsName ? name.trim() : undefined);
      const identity = { playerId: player.id, displayName: player.displayName, credential: deviceCredential };
      if (!saveIdentity(identity)) {
        setError('This browser won’t let FriendlyGames remember you (private browsing or blocked storage?). Try a normal window.');
        return;
      }
      onDone(identity);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'player_not_found') {
        setNeedsName(true);
        requestAnimationFrame(() => nameInput.current?.focus());
        return;
      }
      setError(
        e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)
          ? 'Couldn’t reach the game server. Check your connection and try again.'
          : e instanceof ApiError && e.status === 400
            ? needsName
              ? 'Please enter your name (up to 40 characters).'
              : 'Please enter a valid email address.'
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function changeEmail(value: string) {
    setEmail(value);
    if (needsName) setNeedsName(false); // a different email may belong to a player
  }

  const label = busy ? (needsName ? 'Creating your player…' : 'Opening…') : needsName ? 'Create my player' : 'Continue';

  return (
    <section className="card onboarding" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">{invited ? 'You’re invited to a game' : 'Welcome to the park'}</h2>
      <p>
        {invited
          ? 'Enter your email. Then you’ll go straight to the table.'
          : 'Enter your email to open your games, or to start playing chess with a friend.'}
      </p>

      <form onSubmit={submit} className="form">
        <label>
          Your email
          <input
            type="email"
            value={email}
            onChange={(e) => changeEmail(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        {needsName && (
          <>
            <p className="notice-box" id="new-player">
              Nice to meet you! This email is new here, so you’ll get a new player. What should your friends call you?
            </p>
            <label>
              Your name
              <input
                ref={nameInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={40}
                autoComplete="given-name"
              />
            </label>
          </>
        )}
        <p className="fine-print-inline" id="prototype-access">
          Prototype: enter your email to open your games. Email ownership isn’t checked yet, so anyone who knows your
          email can play as you.
        </p>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="submit" className="button button-primary" disabled={busy} aria-describedby="prototype-access">
          {label}
        </button>
      </form>
    </section>
  );
}
