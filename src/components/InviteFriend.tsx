import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, gameApi, NetworkError, type PendingFriendInvitation } from '../shared/gameApi';
import { friendInvitationLink, type Identity } from '../shared/identity';
import { newRequestId } from '../shared/requestId';
import { LinkShare } from './InvitationShare';

interface InviteFriendProps {
  identity: Identity;
  onIdentityRejected: () => void;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const isMomentary = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);
const UNCONFIRMED = 'the game server didn’t answer. Trying again is safe';

/** A link that was just made or replaced. It is shown now and cannot be shown again: only its hash is kept. */
interface Fresh {
  invitationId: string;
  token: string;
  replaced: boolean;
}

/**
 * Invite a friend before choosing a game (#111). One link connects one friend and works for 30
 * days. The player's pending invitations are listed with their dates; any of them can be
 * replaced, which gives a new link in the same place and stops the old one.
 */
export default function InviteFriend({ identity, onIdentityRejected }: InviteFriendProps) {
  const [pending, setPending] = useState<PendingFriendInvitation[] | null>(null);
  const [limit, setLimit] = useState(20);
  const [validDays, setValidDays] = useState(30);
  const [listFailed, setListFailed] = useState(false);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A creation whose outcome is unknown: trying again with its request ID never makes a second invitation.
  const [uncertain, setUncertain] = useState<string | null>(null);
  // The invitation whose replacement is being confirmed, and what went wrong with it, if anything.
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const sending = useRef(false);
  const open = useRef(false);
  const question = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    try {
      const listed = await gameApi.listFriendInvitations(identity.credential);
      if (!open.current) return;
      setPending(listed.invitations);
      setLimit(listed.limit);
      setValidDays(listed.validDays);
      setListFailed(false);
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      setListFailed(true); // keep any list already shown
    }
  }, [identity.credential, onIdentityRejected]);

  useEffect(() => {
    open.current = true;
    const first = setTimeout(load, 0);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      open.current = false;
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (replacing) question.current?.focus();
  }, [replacing]);

  const atLimit = pending !== null && pending.length >= limit;

  async function create() {
    if (sending.current) return;
    const requestId = uncertain ?? newRequestId();
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { invitation } = await gameApi.createFriendInvitation(identity.credential, requestId);
      if (!open.current) return;
      setUncertain(null);
      setFresh({ invitationId: invitation.id, token: invitation.token, replaced: false });
      load();
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (isMomentary(e)) {
        setUncertain(requestId);
        setError(`Couldn’t confirm whether the invitation was created: ${UNCONFIRMED}; it won’t create a second invitation.`);
        return;
      }
      setUncertain(null);
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'friend_invitation_limit'
          ? `You have ${limit} invitations waiting, which is the most you can have. Replace one of them below to get a new link.`
          : code === 'friend_invitation_accepted'
            ? 'That invitation was created and has already been accepted. Your friend is under Play with.'
            : code === 'friend_invitation_expired'
              ? 'That invitation has expired. Create a new one.'
              : 'Couldn’t create an invitation. Please try again.',
      );
      load();
    } finally {
      sending.current = false;
      if (open.current) setBusy(false);
    }
  }

  async function replace(id: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setReplaceError(null);
    try {
      // Safe to repeat: replacing again gives another new link for the same invitation.
      const { invitation } = await gameApi.replaceFriendInvitation(identity.credential, id);
      if (!open.current) return;
      setReplacing(null);
      setFresh({ invitationId: invitation.id, token: invitation.token, replaced: true });
      load();
    } catch (e) {
      if (!open.current) return;
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (isMomentary(e)) {
        setReplaceError(`Couldn’t confirm whether the link was replaced: ${UNCONFIRMED}. The old link may already have stopped working.`);
        return;
      }
      // Accepted or expired while the question was open: nothing to replace any more.
      setReplacing(null);
      setError(
        e instanceof ApiError && e.code === 'friend_invitation_accepted'
          ? 'That invitation has just been accepted, so there is nothing to replace. Your friend is under Play with.'
          : 'That invitation is no longer waiting (it may have expired). Create a new one if you need a link.',
      );
      load();
    } finally {
      sending.current = false;
      if (open.current) setBusy(false);
    }
  }

  return (
    <section className="card invite-friend" aria-labelledby="invite-friend-title">
      <h2 id="invite-friend-title">Invite a friend</h2>
      <p>
        Get a link to send to a friend, without choosing a game first. When they accept, you find each other under{' '}
        <strong>Play with</strong> and can start Chess, Fischer Random or Yatzy. One link is for one friend and works for{' '}
        {validDays} days.
      </p>

      {fresh && (
        <div className="fresh-link" role="group" aria-label={fresh.replaced ? 'The new link to send' : 'The link to send'}>
          <LinkShare link={friendInvitationLink(fresh.token)} shareTitle="Play with me on FriendlyGames">
            {fresh.replaced ? 'Here is the new link; the old one no longer works. ' : 'Your invitation is ready. '}
            Send it to one friend yourself, by message or email. It connects you with whoever accepts it first, so share it only
            with them. <strong>It is shown only now:</strong> if you lose it, replace the invitation below to get a new link.
          </LinkShare>
          <button type="button" className="button" onClick={() => setFresh(null)}>
            Done
          </button>
        </div>
      )}

      <p className="form-error" role="alert">
        {error}
      </p>
      {atLimit && !error && (
        <p className="notice-box">
          You have {limit} invitations waiting, which is the most you can have. Replace one of them below to get a new link.
        </p>
      )}
      <button type="button" className="button button-primary" onClick={create} disabled={busy || (atLimit && !uncertain)}>
        {busy && !replacing ? 'Creating…' : uncertain ? 'Try again' : fresh ? 'Create another invitation' : 'Create an invitation link'}
      </button>

      {listFailed && (
        <p className="banner banner-warning">
          Couldn’t load your waiting invitations.{' '}
          <button type="button" className="text-button" onClick={load}>
            Load them again
          </button>
        </p>
      )}
      {pending !== null && pending.length > 0 && (
        <>
          <h3 id="pending-friends-title">
            Waiting to be accepted ({pending.length} of {limit})
          </h3>
          <p className="fine-print-inline">
            A link can’t be shown again once you’ve left it. If you’ve lost one, replace it: you get a new link, valid for{' '}
            {validDays} days, and the old link stops working.
          </p>
          <ul className="pending-invitations" aria-labelledby="pending-friends-title">
            {pending.map((invitation, index) => {
              const label = `Invitation ${index + 1}, created ${day.format(new Date(invitation.createdAt))}`;
              return (
                <li key={invitation.id}>
                  <span className="pending-dates">
                    <span className="pending-created">
                      {index + 1}. Created {day.format(new Date(invitation.createdAt))}
                    </span>
                    <span className="pending-expires">Expires {day.format(new Date(invitation.expiresAt))}</span>
                    {fresh?.invitationId === invitation.id && <span className="pending-shown">Its link is shown above</span>}
                  </span>
                  {replacing === invitation.id ? (
                    <div className="replace-link" role="group" aria-label={`Confirm replacing the link of ${label}`}>
                      <p ref={question} tabIndex={-1} className="replace-question">
                        Replace this link? The old link stops working at once, also if you’ve already sent it. The new link is
                        valid for {validDays} days.
                      </p>
                      {replaceError && (
                        <p className="form-error" role="alert">
                          {replaceError}
                        </p>
                      )}
                      <div className="button-row">
                        <button type="button" className="button button-primary" onClick={() => replace(invitation.id)} disabled={busy}>
                          {busy ? 'Replacing…' : replaceError ? 'Try again' : 'Replace link'}
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => {
                            setReplacing(null);
                            setReplaceError(null);
                          }}
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`Replace the link of ${label}`}
                      disabled={busy}
                      onClick={() => {
                        setReplacing(invitation.id);
                        setReplaceError(null);
                        setError(null);
                      }}
                    >
                      Replace link…
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
