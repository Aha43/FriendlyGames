// The player's identity on this device. The credential is the only key to their games:
// there is no password and no recovery (docs/backend.md, "Losing the credential").

export interface Identity {
  playerId: string;
  displayName: string;
  credential: string;
}

const IDENTITY_KEY = 'friendlygames.identity';
const INVITES_KEY = 'friendlygames.invitations';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadIdentity(): Identity | null {
  const identity = read<Identity>(IDENTITY_KEY);
  return identity && typeof identity.credential === 'string' && typeof identity.playerId === 'string'
    ? identity
    : null;
}

/** Returns false when the browser will not store it (e.g. storage disabled). */
export function saveIdentity(identity: Identity): boolean {
  return write(IDENTITY_KEY, identity);
}

export function forgetIdentity(): void {
  write(IDENTITY_KEY, null);
  write(INVITES_KEY, null);
}

// Invitation tokens are returned once, to the creator. Keep them on the creator's device
// until the friend has joined, so the link can be shared again.
export function rememberInvitation(gameId: string, token: string): void {
  write(INVITES_KEY, { ...(read<Record<string, string>>(INVITES_KEY) ?? {}), [gameId]: token });
}

export function invitationFor(gameId: string): string | null {
  return read<Record<string, string>>(INVITES_KEY)?.[gameId] ?? null;
}

export function forgetInvitation(gameId: string): void {
  const invites = read<Record<string, string>>(INVITES_KEY);
  if (!invites?.[gameId]) return;
  delete invites[gameId];
  write(INVITES_KEY, invites);
}

export function invitationLink(token: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/join/${token}`;
}

/** Accepts a full invitation link or a bare token. */
export function tokenFromInvitation(text: string): string | null {
  const match = text.trim().match(/(?:#\/join\/)?([A-Za-z0-9_-]{43})\s*$/);
  return match ? match[1] : null;
}
