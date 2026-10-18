import { useState, type FormEvent } from 'react';
import { gameApi, NetworkError, ApiError } from '../shared/gameApi';
import { saveIdentity, type Identity } from '../shared/identity';

interface OnboardingProps {
  invited: boolean;
  onDone: (identity: Identity) => void;
}

const EMAIL_TAKEN =
  'A player already uses this email. Open FriendlyGames in the browser where you first created your player: your games are there. Entering your email here can’t sign you in.';

export default function Onboarding({ invited, onDone }: OnboardingProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { player, deviceCredential } = await gameApi.createPlayer(name.trim(), email.trim());
      const identity = { playerId: player.id, displayName: player.displayName, credential: deviceCredential };
      if (!saveIdentity(identity)) {
        setError('This browser won’t let FriendlyGames remember you (private browsing or blocked storage?). Try a normal window.');
        return;
      }
      onDone(identity);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'email_taken'
          ? EMAIL_TAKEN
          : e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)
            ? 'Couldn’t reach the game server. Check your connection and try again.'
            : e instanceof ApiError && e.status === 400
              ? 'Please enter your name and a valid email address.'
              : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card onboarding" aria-labelledby="onboarding-title">
      <h2 id="onboarding-title">{invited ? 'You’re invited to a game' : 'Welcome to the park'}</h2>
      <p>{invited ? 'First, create your player. Then you’ll go straight to the table.' : 'Create your player to play chess with a friend.'}</p>

      <form onSubmit={submit} className="form">
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="given-name" />
        </label>
        <label>
          Your email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        <div className="notice-box" id="browser-access">
          <p>
            <strong>This creates your player in this browser.</strong> Your games are saved on our server, but for now
            only this browser can open them. There’s no password and your email doesn’t sign you in; one email
            belongs to one player.
          </p>
          <p>If this browser’s data is cleared, this player can’t be reached again.</p>
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="submit" className="button button-primary" disabled={busy} aria-describedby="browser-access">
          {busy ? 'Creating your player…' : 'Create my player'}
        </button>
      </form>
    </section>
  );
}
