// What the API says about a failure it did not expect (#116): one log line that names the
// request and the error well enough to diagnose it, and nothing a log must not hold. Request
// bodies and headers carry device credentials, invitation tokens and emails, so they are never
// read here; error text is reduced to its safe parts.

/** Path words the API itself defines. Anything else in a path is an ID or a token: shown as `:id`. */
const ROUTE_WORDS = new Set([
  'health', 'players', 'me', 'games', 'history', 'opponents', 'invitations', 'redeem', 'actions', 'invitation',
  'rematch', 'deletion', 'friend-invitations', 'preview', 'accept', 'replacement',
]); // prettier-ignore

const METHODS = new Set(['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD']);

/** `DELETE /games/:id`: the method and path with every ID replaced, and no query string. */
export function routePattern(method: string, path: string): string {
  const segments = path
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .slice(0, 6)
    .map((segment) => (ROUTE_WORDS.has(segment) ? segment : ':id'));
  return `${METHODS.has(method) ? method : 'OTHER'} /${segments.join('/')}`;
}

/** A short random ID that ties a `500` response to its log line. */
export function newErrorId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const short = (value: unknown, pattern: RegExp): string => (typeof value === 'string' && pattern.test(value) ? value : '-');

/**
 * Text with everything that could be data taken out: quoted values (double or single), emails,
 * links, hosts and addresses with or without a port, IDs, tokens and long numbers. What stays is
 * the fixed wording, e.g. `deadlock detected` or `duplicate key value violates unique constraint "…"`.
 * Also used for the runtime's own log lines before CI prints them (scripts/backend-errors.ts).
 */
export function redact(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '…')
    .replace(/\S+@\S+/g, '…')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '…')
    .replace(/[A-Za-z0-9_-]{24,}/g, '…')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '…')
    .replace(/\[[0-9a-f:]*:[0-9a-f:]+\](?::\d+)?/gi, '…')
    .replace(/\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?::\d+)?\b/gi, '…')
    .replace(/\b(?:localhost|[a-z][\w-]*):\d{2,5}\b/gi, '…')
    .replace(/…:\d+/g, '…') // a port left behind by a host that was already taken out
    .replace(/\d{5,}/g, '…');
}

/** An error message, reduced (see `redact`) and kept short. */
export function safeMessage(message: unknown): string {
  if (typeof message !== 'string') return '-';
  return redact(message).slice(0, 160).trim();
}

/**
 * The one log line for an unexpected error. From the error it takes its class name, its code (a
 * Postgres SQLSTATE such as `40P01`, or a driver code such as `CONNECTION_CLOSED`), the Postgres
 * severity, routine, table and constraint names, and the reduced message. Never `detail`, `hint`,
 * `where`, the query or its parameters: those quote row values.
 */
export function unexpectedErrorLine(id: string, method: string, path: string, error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const name = short(error instanceof Error ? error.name : undefined, /^[A-Za-z]{1,40}$/);
  return [
    'game-api: unexpected error',
    `id=${id}`,
    `route="${routePattern(method, path)}"`,
    `name=${name}`,
    `code=${short(e.code, /^[A-Za-z0-9_]{1,40}$/)}`,
    `severity=${short(e.severity, /^[A-Z]{1,12}$/)}`,
    `routine=${short(e.routine, /^[A-Za-z0-9_]{1,60}$/)}`,
    `table=${short(e.table_name, /^[a-z0-9_]{1,60}$/)}`,
    `constraint=${short(e.constraint_name, /^[a-z0-9_]{1,80}$/)}`,
    `message="${safeMessage(error instanceof Error ? error.message : undefined).replaceAll('"', "'")}"`,
  ].join(' ');
}
