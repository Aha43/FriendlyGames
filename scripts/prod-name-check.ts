// make prod-name-check (#76): are any production player names the same under the uniqueness
// rule (trim, NFC, ignore case)? Read-only; run deliberately by the owner, and by
// scripts/deploy-backend.sh before it changes anything.
//
// It runs scripts/name-check.sql on the LINKED project through `supabase db query --linked`
// (the Management API, using the owner's `supabase login`; no database password or other secret
// is read, passed or printed). It never falls back to a local database.
//
// Exit 0 only when the query ran read-only and found no collisions. Collisions exit 1; a missing
// link, a failed or incomplete query, or an answer that does not prove a read-only check exit 2.
// It never renames, merges or deletes anything: collisions need the owner's decision.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const SQL_FILE = 'scripts/name-check.sql';

interface Row {
  kind: string;
  name_key: string | null;
  player_id: string | null;
  display_name: string | null;
  games: number | string | null;
  created_at: string | null;
  players: number | string | null;
  collision_groups: number | string | null;
  read_only: string | null;
}

export class CheckError extends Error {}

/** The rows of `supabase db query -o json`: an array, or `{ rows }` when the CLI wraps it. */
export function parseRows(output: string): Row[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new CheckError('the answer was not JSON');
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) throw new CheckError('the answer had no rows');
  return rows as Row[];
}

/**
 * A count from the query: a non-negative integer, as a JSON number or a string of digits (bigint).
 * Anything else (missing, null, blank, text, negative, fractional, boolean) means the answer is
 * not a complete check. Never coerce: Number(null) and Number('') are 0, which would read as
 * "no collisions" (#76 review).
 */
export function count(value: unknown, what: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new CheckError(`the ${what} count was missing or not a whole number`);
  return n;
}

export interface Report {
  players: number;
  groups: { key: string; players: { id: string; name: string; games: number; created: string }[] }[];
}

/** Checks the rows prove a complete, read-only check, and groups the collisions. */
export function report(rows: Row[]): Report {
  const summaries = rows.filter((r) => r?.kind === 'summary');
  if (summaries.length !== 1) throw new CheckError('the answer had no summary, so the check may not have run');
  const [summary] = summaries;
  if (summary.read_only !== 'on') throw new CheckError('the query did not run in a read-only transaction');
  const players = count(summary.players, 'player');
  const expectedGroups = count(summary.collision_groups, 'collision group');

  const groups = new Map<string, Report['groups'][number]>();
  for (const row of rows) {
    if (row?.kind !== 'collision') continue;
    if (!row.name_key || !row.player_id || row.display_name === null) throw new CheckError('a collision row was incomplete');
    const group = groups.get(row.name_key) ?? { key: row.name_key, players: [] };
    if (typeof row.created_at !== 'string' || !row.created_at) throw new CheckError('a collision row had no creation date');
    group.players.push({ id: row.player_id, name: row.display_name, games: count(row.games, 'game'), created: row.created_at });
    groups.set(row.name_key, group);
  }
  const listed = [...groups.values()].reduce((n, g) => n + g.players.length, 0);
  if (groups.size !== expectedGroups || listed > players || [...groups.values()].some((g) => g.players.length < 2)) {
    throw new CheckError('the collision rows did not match the summary');
  }
  return { players, groups: [...groups.values()] };
}

export function main(): number {
  const say = (line = '') => process.stdout.write(`${line}\n`);
  const fail = (message: string) => {
    process.stderr.write(`\nName check incomplete: ${message}. Nothing is known to be clear; nothing was changed.\n`);
    return 2;
  };

  if (!existsSync('supabase/.temp/project-ref')) return fail("not linked: run 'supabase link --project-ref <ref>' first");
  const ref = readFileSync('supabase/.temp/project-ref', 'utf8').trim();
  say(`Checking player names on the linked project ${ref} (read-only).`);

  const run = spawnSync('supabase', ['db', 'query', '--linked', '--agent', 'no', '-o', 'json', '-f', SQL_FILE], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) return fail(`the Supabase CLI could not be run (${run.error.message})`);
  if (run.status !== 0) return fail(`the query failed: ${(run.stderr || run.stdout).trim().split('\n').slice(-3).join(' ')}`);

  let result: Report;
  try {
    result = report(parseRows(run.stdout));
  } catch (e) {
    if (e instanceof CheckError) return fail(e.message);
    throw e;
  }

  if (result.groups.length === 0) {
    say(`No collisions: all ${result.players} player records have distinct names (trimmed, NFC, ignoring case).`);
    return 0;
  }
  // Records, not people: test accounts and abandoned sign-ups are player records too.
  say(`\n${result.groups.length} name(s) are shared by more than one player record (${result.players} records in all,`);
  say('including any test accounts and unused sign-ups):');
  for (const group of result.groups) {
    say(`\n  "${group.key}"`);
    for (const p of group.players) say(`    ${p.id}  ${JSON.stringify(p.name)}  ${p.games} game(s)  created ${p.created}`);
  }
  say('\nThe unique-name migration will refuse to apply until these are reconciled. Nothing was changed;');
  say('decide what to do with each (docs/backend.md, "Unique player names"). Nothing is renamed automatically.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
