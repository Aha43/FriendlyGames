/**
 * Where the function connects to Postgres.
 *
 * - Production: GAME_DB_POOLER_URL, a function secret the owner sets (it contains the database
 *   password), pointing at Supabase's connection pooler in transaction mode (port 6543). Edge
 *   Functions start many short-lived instances; connecting each one directly exhausted the
 *   database's connection slots under load ("remaining connection slots are reserved…", #11).
 * - Locally and in CI: Supabase's SUPABASE_DB_URL. Its local host is the Docker container name
 *   `supabase_db_<project>`, which Deno's resolver rejects because of the underscores; the same
 *   container is reachable as `db.supabase.internal`.
 *
 * Never put these in config.toml [edge_runtime.secrets]: the CLI uploads those to production.
 */
export function databaseConnection(env: { get(name: string): string | undefined }): { url: string; pooled: boolean } {
  const pooler = env.get('GAME_DB_POOLER_URL');
  if (pooler) return { url: transactionPooler(pooler), pooled: true };
  const provided = env.get('SUPABASE_DB_URL');
  if (!provided) throw new Error('SUPABASE_DB_URL is not set');
  return { url: databaseUrl(provided), pooled: false };
}

/**
 * Accept only Supabase's transaction pooler (host *.pooler.supabase.com, port 6543). The session
 * pooler and direct connections use port 5432 and would keep the connection exhaustion this
 * secret exists to prevent. Errors never include the URL: it contains the database password.
 */
export function transactionPooler(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GAME_DB_POOLER_URL is not a valid URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.pooler.supabase.com') || url.port !== '6543') {
    throw new Error(
      "GAME_DB_POOLER_URL must be Supabase's transaction pooler (postgresql://…@<region>.pooler.supabase.com:6543/postgres).",
    );
  }
  return value;
}

export function databaseUrl(provided: string): string {
  const url = new URL(provided);
  if (url.hostname.startsWith('supabase_db_')) url.hostname = 'db.supabase.internal';
  return url.toString();
}
