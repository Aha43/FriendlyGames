import { useState, type ReactNode } from 'react';
import { invitationLink } from '../shared/identity';

interface InvitationShareProps {
  token: string;
  friend?: string;
  /** The game type, e.g. "Fischer Random"; named in the text so mixed invitations can't be confused. */
  gameLabel?: string;
}

/** The invitation link, to send by hand. Anyone holding it can take the empty seat once. */
export default function InvitationShare({ token, friend, gameLabel = 'Chess' }: InvitationShareProps) {
  return (
    <LinkShare link={invitationLink(token)} shareTitle={`${gameLabel} in the park`}>
      Send this {gameLabel} invitation to {friend ?? 'your friend'} yourself, by message or email. Whoever opens it first takes the
      empty seat, so share it only with them.
    </LinkShare>
  );
}

/** A link to send by hand: shown in a field to select, with Copy, and Share where the device offers it. */
export function LinkShare({ link, shareTitle, children }: { link: string; shareTitle: string; children: ReactNode }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const canShare = typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="invite">
      <p>{children}</p>
      <label className="invite-link">
        <span className="visually-hidden">Invitation link</span>
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="button-row">
        <button type="button" className="button button-primary" onClick={copy}>
          {copied === 'yes' ? 'Copied!' : 'Copy link'}
        </button>
        {canShare && (
          <button type="button" className="button" onClick={() => navigator.share({ title: shareTitle, url: link }).catch(() => {})}>
            Share…
          </button>
        )}
      </div>
      {copied === 'failed' && (
        <p className="form-error" role="alert">
          Couldn’t copy. Select the link and copy it by hand.
        </p>
      )}
    </div>
  );
}
