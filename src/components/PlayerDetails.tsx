import { useEffect, useRef, useState } from 'react';
import { ApiError, gameApi, type PreviousOpponent } from '../shared/gameApi';
import type { Identity } from '../shared/identity';

/** Whose details: the signed-in player's own, or someone they can play with (from their own Play with list). */
export type DetailsSubject = { kind: 'self' } | { kind: 'other'; player: PreviousOpponent };

interface PlayerDetailsProps {
  identity: Identity;
  subject: DetailsSubject;
  onClose: () => void;
  onIdentityRejected: () => void;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
let serial = 0;

/**
 * A small view of one player (#113). For someone else it shows their name and what the two
 * share: connected by invitation since when, how many games, the last one. That is exactly what
 * the player's own Play with list already holds, so nobody outside that list can be looked up,
 * and another player's email is never fetched or shown. For the player themselves it shows the
 * email they entered with, read from the server for them alone.
 *
 * A modal dialog: everything behind it is inert, focus starts on Close and returns to whatever
 * opened it, Escape closes.
 */
export default function PlayerDetails({ identity, subject, onClose, onIdentityRejected }: PlayerDetailsProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [titleId] = useState(() => `player-details-${++serial}`);
  // The player's own email: null while loading, false when it could not be read.
  const [email, setEmail] = useState<string | null | false>(null);
  const self = subject.kind === 'self';

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const madeInert: Element[] = [];
    for (let node: HTMLElement | null = dialog.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          madeInert.push(sibling);
        }
      }
    }
    function keepFocusInside(event: FocusEvent) {
      if (!dialog.current?.contains(event.target as Node)) close.current?.focus();
    }
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      for (const element of madeInert) element.removeAttribute('inert');
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // The callers pass fresh functions on every render; the email is read once per opening.
  const handlers = useRef({ onClose, onIdentityRejected });
  useEffect(() => {
    handlers.current = { onClose, onIdentityRejected };
  });

  useEffect(() => {
    if (!self) return;
    let open = true;
    gameApi
      .me(identity.credential)
      .then(({ player }) => open && setEmail(player.email || false))
      .catch((e) => {
        if (!open) return;
        if (e instanceof ApiError && e.status === 401) {
          handlers.current.onClose();
          handlers.current.onIdentityRejected();
        } else setEmail(false);
      });
    return () => {
      open = false;
    };
  }, [self, identity.credential]);

  const name = self ? identity.displayName : subject.player.displayName;

  return (
    <div
      ref={dialog}
      className="details-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        } else if (event.key === 'Tab') {
          // One control: keep focus on it.
          event.preventDefault();
          close.current?.focus();
        }
      }}
    >
      <div className="details-card">
        <p className="details-kicker">{self ? 'You' : 'Player'}</p>
        <h2 id={titleId}>{name}</h2>
        {self ? (
          <dl className="details-list">
            <div>
              <dt>Your email</dt>
              <dd>{email === null ? <span className="muted">Loading…</span> : email === false ? <span role="alert">Couldn’t load your email just now.</span> : email}</dd>
            </div>
          </dl>
        ) : (
          <dl className="details-list">
            {subject.player.connectedAt && (
              <div>
                <dt>Connected</dt>
                <dd>By invitation, since {day.format(new Date(subject.player.connectedAt))}</dd>
              </div>
            )}
            <div>
              <dt>Games together</dt>
              <dd>
                {subject.player.sharedGames === 0 || !subject.player.lastSharedGameUpdatedAt
                  ? 'None yet'
                  : `${subject.player.sharedGames}, the latest active ${day.format(new Date(subject.player.lastSharedGameUpdatedAt))}`}
              </dd>
            </div>
          </dl>
        )}
        <p className="details-note">
          {self
            ? 'Only you see your email. Other players see your name. You use this email to open your games on another device.'
            : `You can start a game with ${name} under Play with.${subject.player.connectedAt ? '' : ' You’re in each other’s list because you share a game.'}`}
        </p>
        <div className="button-row">
          <button ref={close} type="button" className="button button-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
