import { useState, type FormEvent } from 'react';
import { gameApi, NetworkError, ApiError } from '../shared/gameApi';
import { saveIdentity, type Identity } from '../shared/identity';

interface OnboardingProps {
  invited: boolean;
  onDone: (identity: Identity) => void;
}

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
        e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)
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
      <p>{invited ? 'First, tell us who you are. Then you’ll go straight to the table.' : 'Tell us who you are to play chess with a friend.'}</p>

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
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Setting the table…' : 'Continue'}
        </button>
      </form>

      <details className="fine-print">
        <summary>How this device remembers you</summary>
        <p>
          There’s no password. This browser keeps a private key that identifies you to the game server. Your email
          isn’t checked or shown to other players; it only helps friends invite you.
        </p>
        <p>
          <strong>If this browser’s data is cleared, or you use another device, you start as a new player</strong> and
          can’t get back to games played here. Typing the same email again doesn’t restore them.
        </p>
      </details>
    </section>
  );
}
