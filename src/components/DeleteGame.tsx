// Deleting a finished game (#93). Any participant may; it is gone for everyone. Offered only when
// the server says so (`canDelete`), always behind an explicit confirmation that names the game,
// says who else is affected, and names anyone who would leave "Play with".
import { useEffect, useRef, useState } from 'react';
import { listNames } from '../games/yatzy';
import { ApiError, gameApi, NetworkError, type PlayerSummary } from '../shared/gameApi';
import { setFlash } from '../shared/flash';
import type { Identity } from '../shared/identity';
import { navigate } from '../shared/route';

interface DeleteGameProps {
  identity: Identity;
  gameId: string;
  /** Which game this is, for the confirmation: e.g. "Chess game with Harald, finished 12 Nov 2026". */
  description: string;
  onIdentityRejected: () => void;
}

type Check = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; removes: PlayerSummary[] };

export default function DeleteGame({ identity, gameId, description, onIdentityRejected }: DeleteGameProps) {
  const [confirming, setConfirming] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  // The request was sent but its outcome is unknown: a repeat that finds nothing means it worked.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useRef(true);
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // Move focus to the question, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (confirming) heading.current?.focus();
  }, [confirming]);

  function gone(message: string) {
    setFlash(message);
    navigate('#/');
  }

  async function loadCheck() {
    setCheck({ state: 'loading' });
    try {
      const { deletion } = await gameApi.deletionPreview(identity.credential, gameId);
      if (open.current) setCheck({ state: 'ready', removes: deletion.removesFromPlayWith });
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (e instanceof ApiError && e.status === 404) return gone('That game was already deleted.');
      setCheck({ state: 'failed' });
    }
  }

  function ask() {
    setConfirming(true);
    setError(null);
    setUnconfirmed(false);
    loadCheck();
  }

  async function confirm() {
    if (sending.current || check.state !== 'ready') return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await gameApi.deleteGame(identity.credential, gameId, check.removes.map((p) => p.id));
      // The player may have gone elsewhere while this was on its way: leave them there.
      if (open.current) gone(`Deleted: ${description}.`);
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (e instanceof ApiError && e.status === 404) {
        // Nothing there any more: this request's earlier attempt, or someone else, deleted it.
        return gone(unconfirmed ? `Deleted: ${description}.` : 'That game was already deleted.');
      }
      if (e instanceof ApiError && e.code === 'deletion_changed' && e.deletion) {
        // Nothing was deleted: who it affects changed since the confirmation was shown.
        setUnconfirmed(false);
        setCheck({ state: 'ready', removes: e.deletion.removesFromPlayWith });
        setError('Nothing was deleted: who this affects changed while you were deciding. Check below, then confirm again.');
        return;
      }
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        setUnconfirmed(true);
        setError('Couldn’t confirm whether the game was deleted: the game server didn’t answer. Trying again is safe; it can’t delete anything else.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Couldn’t delete the game.');
      }
    } finally {
      sending.current = false;
      if (open.current) setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="button button-quiet delete-game-open" onClick={ask}>
        Delete game…
      </button>
    );
  }

  const removes = check.state === 'ready' ? check.removes : [];
  return (
    <div className="delete-game" role="group" aria-label="Confirm deleting this game">
      <p className="delete-game-title" ref={heading} tabIndex={-1}>
        Delete this game?
      </p>
      <p className="delete-game-which">{description}</p>
      <p>It disappears for everyone who played it, including from history and results. This can’t be undone.</p>
      {check.state === 'loading' && <p className="muted">Checking who this affects…</p>}
      {check.state === 'failed' && (
        <p className="banner banner-warning">
          Couldn’t check who this affects.{' '}
          <button type="button" className="text-button" onClick={loadCheck}>
            Check again
          </button>
        </p>
      )}
      {removes.length > 0 && (
        <p className="banner banner-warning delete-game-last">
          This is the last game you share with {listNames(removes.map((p) => p.displayName))}. You won’t find them in
          Play with until you share another game.
        </p>
      )}
      <p className="form-error" role="alert">
        {error}
      </p>
      <div className="button-row">
        <button type="button" className="button button-danger" disabled={busy || check.state !== 'ready'} onClick={confirm}>
          {busy ? 'Deleting…' : unconfirmed ? 'Try again' : 'Delete game'}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => setConfirming(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}
