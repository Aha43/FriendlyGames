// A one-off message for the next page, e.g. "Game deleted" shown in the lobby after leaving a
// game's page. Kept in memory only: it is gone once shown or when the app reloads.
let pending: string | null = null;

export function setFlash(message: string): void {
  pending = message;
}

/** The pending message, if any; taking it clears it. */
export function takeFlash(): string | null {
  const message = pending;
  pending = null;
  return message;
}
