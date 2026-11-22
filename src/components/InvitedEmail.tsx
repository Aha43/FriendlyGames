import { useEffect, useState } from 'react';
import { ApiError, gameApi, NetworkError } from '../shared/gameApi';
import type { Identity } from '../shared/identity';

interface InvitedEmailProps {
  identity: Identity;
  gameId: string;
  onIdentityRejected: () => void;
}

/**
 * Who the creator invited to a game nobody has joined yet (#113): the email they typed, read
 * from the server for the creator alone. It is not kept in this browser, so it also shows on
 * another device and for games made before this existed. Anything but an answer shows nothing:
 * the friend may have joined a moment ago, or this player is not the creator.
 */
export default function InvitedEmail({ identity, gameId, onIdentityRejected }: InvitedEmailProps) {
  const [shown, setShown] = useState<{ gameId: string; email: string } | 'failed' | null>(null);

  useEffect(() => {
    let open = true;
    gameApi
      .pendingInvitation(identity.credential, gameId)
      .then(({ invitation }) => open && setShown({ gameId, email: invitation.invitedEmail }))
      .catch((e) => {
        if (!open) return;
        if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
        setShown(e instanceof NetworkError || (e instanceof ApiError && e.status >= 500) ? 'failed' : null);
      });
    return () => {
      open = false;
    };
  }, [identity.credential, gameId, onIdentityRejected]);

  if (shown === 'failed') return <p className="invited-email muted">Couldn’t load who you invited to this game.</p>;
  if (!shown || shown.gameId !== gameId) return null;
  return (
    <p className="invited-email">
      You invited <strong className="invited-address">{shown.email}</strong>. <span className="muted">Only you see this.</span>
    </p>
  );
}
