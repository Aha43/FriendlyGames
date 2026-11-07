import { useState } from 'react';
import { invitationLink } from '../shared/identity';

interface InvitationShareProps {
  token: string;
  friend?: string;
  /** The game type, e.g. "Fischer Random"; named in the text so mixed invitations can't be confused. */
  gameLabel?: string;
}

/** The invitation link, to send by hand. Anyone holding it can take the empty seat once. */
export default function InvitationShare({ token, friend, gameLabel = 'Chess' }: InvitationShareProps) {
  const link = invitationLink(token);
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
      <p>
        Send this {gameLabel} invitation to {friend ?? 'your friend'} yourself, by message or email. Whoever opens it first takes the
        empty seat, so share it only with them.
      </p>
      <label className="invite-link">
        <span className="visually-hidden">Invitation link</span>
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="button-row">
        <button type="button" className="button button-primary" onClick={copy}>
          {copied === 'yes' ? 'Copied!' : 'Copy link'}
        </button>
        {canShare && (
          <button
            type="button"
            className="button"
            onClick={() => navigator.share({ title: `${gameLabel} in the park`, url: link }).catch(() => {})}
          >
            Share…
          </button>
        )}
      </div>
      {copied === 'failed' && <p className="form-error">Couldn’t copy. Select the link and copy it by hand.</p>}
    </div>
  );
}
