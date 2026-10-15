/**
 * The database URL the function connects with.
 *
 * Supabase provides SUPABASE_DB_URL. In the local stack its host is the Docker container name
 * `supabase_db_<project>`, which Deno's resolver rejects because of the underscores; the same
 * container is reachable as `db.supabase.internal`. Hosted URLs are used unchanged. This lives in
 * code, not in config.toml secrets, because the CLI uploads those to production (#11).
 */
export function databaseUrl(provided: string): string {
  const url = new URL(provided);
  if (url.hostname.startsWith('supabase_db_')) url.hostname = 'db.supabase.internal';
  return url.toString();
}
