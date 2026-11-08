// @vitest-environment node
// make prod-name-check and the deploy guard (#76) with a stub `supabase` CLI: which answers count
// as clear, and that a collision or an unknown result stops `make deploy-backend` before it changes
// anything in production. The SQL itself (read-only enforcement, NFC, case) is proven on real
// Postgres in tests/backend/migrations/unique-names.test.ts.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, '../..');
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.test',
};

// supabase: logs every call; `db query` prints $STUB_QUERY_OUT (or fails with $STUB_QUERY_FAIL).
const SUPABASE = `#!/bin/sh
echo "supabase $*" >> "$STUB_LOG"
case "$*" in
  "db query"*) [ -n "$STUB_QUERY_FAIL" ] && { echo "$STUB_QUERY_FAIL" >&2; exit 1; }; printf '%s' "$STUB_QUERY_OUT" ;;
  "secrets list"*) echo "GAME_DB_POOLER_URL | abc" ;;
  "db dump"*) out=""; prev=""; for a in "$@"; do [ "$prev" = "-f" ] && out="$a"; prev="$a"; done
              case "$*" in *--data-only*) echo "INSERT INTO players VALUES (1);" > "$out" ;; *) echo "CREATE TABLE players ();" > "$out" ;; esac ;;
esac
exit 0
`;
const CURL = `#!/bin/sh
echo "curl $*" >> "$STUB_LOG"
printf '{"ok":true,"commit":"%s","pooled":true}' "$STUB_COMMIT"
`;

const summary = (over: Record<string, unknown> = {}) => ({
  kind: 'summary',
  name_key: null,
  player_id: null,
  display_name: null,
  games: null,
  created_at: null,
  players: 4,
  collision_groups: 0,
  read_only: 'on',
  ...over,
});
const collision = (id: string, name: string, key: string) => ({
  kind: 'collision',
  name_key: key,
  player_id: id,
  display_name: name,
  games: 2,
  created_at: '2026-10-18T10:00:00+00:00',
  players: null,
  collision_groups: null,
  read_only: null,
});
const CLEAR = JSON.stringify([summary()]);
const COLLIDING = JSON.stringify([
  summary({ collision_groups: 1 }),
  collision('11111111-1111-4111-8111-111111111111', 'Harald', 'harald'),
  collision('22222222-2222-4222-8222-222222222222', ' harald', 'harald'),
]);

let dir: string;
let repo: string;
let bin: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fg-namecheck-'));
  repo = join(dir, 'repo');
  bin = join(dir, 'bin');
  log = join(dir, 'calls.log');
  const origin = join(dir, 'origin.git');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'supabase/.temp'), { recursive: true });
  for (const f of ['deploy-backend.sh', 'backup-production.sh', 'prod-name-check.ts', 'name-check.sql']) {
    copyFileSync(join(ROOT, 'scripts', f), join(repo, 'scripts', f));
    chmodSync(join(repo, 'scripts', f), 0o755);
  }
  writeFileSync(join(repo, 'supabase/.temp/project-ref'), 'testref\n');
  writeFileSync(join(repo, '.gitignore'), 'supabase/.temp/\nbackups/\n');
  const g = (...args: string[]) => execFileSync(REAL_GIT, args, { cwd: repo, env: { ...process.env, ...GIT_ENV }, stdio: 'ignore' });
  execFileSync(REAL_GIT, ['init', '-q', '--bare', '-b', 'main', origin], { env: { ...process.env, ...GIT_ENV } });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-qm', 'fixture');
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  mkdirSync(bin);
  writeFileSync(join(bin, 'supabase'), SUPABASE);
  writeFileSync(join(bin, 'curl'), CURL);
  chmodSync(join(bin, 'supabase'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  const head = execFileSync(REAL_GIT, ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const r = spawnSync(cmd, args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, STUB_COMMIT: head, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const check = (env: Record<string, string>) => run('node', ['scripts/prod-name-check.ts'], env);
const deploy = (env: Record<string, string>) => run('scripts/deploy-backend.sh', [], { SITE_ORIGIN: 'https://site.test', ...env });
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const MUTATIONS = /supabase (db dump|db push|secrets set|functions deploy)/;

describe('make prod-name-check', () => {
  it('is clear only after a read-only check of the linked project found no collisions', () => {
    const { status, out } = check({ STUB_QUERY_OUT: CLEAR });
    expect(status, out).toBe(0);
    expect(out).toContain('linked project testref (read-only)');
    expect(out).toContain('No collisions: all 4 player names are distinct');
    expect(calls()).toEqual(['supabase db query --linked --agent no -o json -f scripts/name-check.sql']);
  });

  it('accepts the CLI’s wrapped answer too', () => {
    expect(check({ STUB_QUERY_OUT: JSON.stringify({ warning: 'x', boundary: 'b', rows: [summary()] }) }).status).toBe(0);
  });

  it('lists collisions by player ID, name, games and creation date, and exits 1', () => {
    const { status, out } = check({ STUB_QUERY_OUT: COLLIDING });
    expect(status).toBe(1);
    expect(out).toContain('1 name(s) are used by more than one of the 4 players');
    expect(out).toMatch(/11111111-1111-4111-8111-111111111111 {2}"Harald" {2}2 game\(s\) {2}created 2026-10-18/);
    expect(out).toContain('" harald"');
    expect(out).toContain('Nothing is renamed automatically');
    expect(out).not.toMatch(/@|email/i);
  });

  it.each([
    ['the query fails', { STUB_QUERY_FAIL: 'unexpected status 401: Unauthorized' }, /the query failed: unexpected status 401/],
    ['the answer is not JSON', { STUB_QUERY_OUT: 'SET' }, /not JSON/],
    ['the answer is empty', { STUB_QUERY_OUT: '[]' }, /no summary/],
    ['the check was not read-only', { STUB_QUERY_OUT: JSON.stringify([summary({ read_only: 'off' })]) }, /not run in a read-only transaction/],
    [
      'rows and summary disagree',
      { STUB_QUERY_OUT: JSON.stringify([summary({ collision_groups: 2 }), ...JSON.parse(COLLIDING).slice(1)]) },
      /did not match the summary/,
    ],
  ])('is incomplete (exit 2), never clear, when %s', (_case, env, message) => {
    const { status, out } = check(env as Record<string, string>);
    expect(status).toBe(2);
    expect(out).toMatch(message);
    expect(out).toContain('Nothing is known to be clear');
  });

  // #76 review: Number(null) and Number('') are 0, which once read as "no collisions".
  const MALFORMED: [string, unknown][] = [
    ['null', null],
    ['an empty string', ''],
    ['blank', '  '],
    ['text', 'many'],
    ['negative', -1],
    ['fractional', 1.5],
    ['a boolean', true],
    ['an array', []],
  ];

  it.each(MALFORMED)('is incomplete when the collision-group count is %s, never clear', (_case, value) => {
    const { status, out } = check({ STUB_QUERY_OUT: JSON.stringify([summary({ collision_groups: value })]) });
    expect(status).toBe(2);
    expect(out).toMatch(/collision group count was missing or not a whole number/);
    expect(out).not.toContain('No collisions');
  });

  it.each(MALFORMED)('is incomplete when the player count is %s', (_case, value) => {
    const { status, out } = check({ STUB_QUERY_OUT: JSON.stringify([summary({ players: value })]) });
    expect(status).toBe(2);
    expect(out).toMatch(/player count was missing or not a whole number/);
  });

  it('is incomplete when the counts are missing altogether', () => {
    const bare = summary();
    delete (bare as Record<string, unknown>).players;
    delete (bare as Record<string, unknown>).collision_groups;
    const { status, out } = check({ STUB_QUERY_OUT: JSON.stringify([bare]) });
    expect(status).toBe(2);
    expect(out).not.toContain('No collisions');
  });

  it('accepts counts sent as strings of digits (bigint)', () => {
    const { status, out } = check({ STUB_QUERY_OUT: JSON.stringify([summary({ players: '4', collision_groups: '0' })]) });
    expect(status, out).toBe(0);
  });

  it.each([
    ['a missing game count', { games: null }],
    ['a blank game count', { games: '' }],
    ['no creation date', { created_at: null }],
  ])('is incomplete when a collision row has %s', (_case, over) => {
    const rows = JSON.parse(COLLIDING);
    Object.assign(rows[1], over);
    const { status } = check({ STUB_QUERY_OUT: JSON.stringify(rows) });
    expect(status).toBe(2);
  });

  it('is incomplete when more players collide than exist', () => {
    const rows = JSON.parse(COLLIDING);
    rows[0].players = 1;
    expect(check({ STUB_QUERY_OUT: JSON.stringify(rows) }).status).toBe(2);
  });

  it('refuses without a linked project instead of checking some other database', () => {
    rmSync(join(repo, 'supabase/.temp/project-ref'));
    const { status, out } = check({ STUB_QUERY_OUT: CLEAR });
    expect(status).toBe(2);
    expect(out).toMatch(/not linked/);
    expect(calls()).toEqual([]);
  });
});

describe('make deploy-backend runs the name check first', () => {
  it('stops before any backup, migration, secret or function change when names collide', () => {
    const { status, out } = deploy({ STUB_QUERY_OUT: COLLIDING });
    expect(status).not.toBe(0);
    expect(out).toContain('Deploy stopped by the player-name check: nothing was changed.');
    expect(calls().some((c) => c.startsWith('supabase db query --linked'))).toBe(true);
    expect(calls().join('\n')).not.toMatch(MUTATIONS);
  });

  it('stops before any change when the answer’s counts are missing (#76 review)', () => {
    const { status, out } = deploy({ STUB_QUERY_OUT: JSON.stringify([summary({ players: null, collision_groups: null })]) });
    expect(status).not.toBe(0);
    expect(out).toContain('Deploy stopped by the player-name check: nothing was changed.');
    expect(calls().join('\n')).not.toMatch(MUTATIONS);
  });

  it('stops the same way when the check cannot complete', () => {
    const { status } = deploy({ STUB_QUERY_FAIL: 'network unreachable' });
    expect(status).not.toBe(0);
    expect(calls().join('\n')).not.toMatch(MUTATIONS);
  });

  it('checks names after the branch/link/secret checks and before the backup and migration when clear', () => {
    const { status, out } = deploy({ STUB_QUERY_OUT: CLEAR });
    expect(status, out).toBe(0);
    const order = calls().map((c) => c.split(' ').slice(0, 3).join(' '));
    expect(order).toEqual([
      'supabase secrets list',
      'supabase db query',
      'supabase db dump',
      'supabase db dump',
      'supabase db push',
      'supabase secrets set',
      'supabase functions deploy',
      expect.stringMatching(/^curl /),
    ]);
  });
});

describe('one canonical name rule', () => {
  it('is written identically in the migration (preflight and index) and in the check', () => {
    const rule = /lower\(normalize\(btrim\((?:p\.)?display_name\), NFC\) collate "und-x-icu"\)/g;
    const strip = (s: string) => s.replace(/p\.display_name/g, 'display_name');
    const migration = readFileSync(join(ROOT, 'supabase/migrations/20261108120000_unique_player_names.sql'), 'utf8');
    const checkSql = readFileSync(join(ROOT, 'scripts/name-check.sql'), 'utf8');
    const inMigration = (migration.match(rule) ?? []).map(strip);
    const inCheck = (checkSql.match(rule) ?? []).map(strip);
    expect(inMigration).toHaveLength(2); // the refusal and the index
    expect(inCheck).toHaveLength(1);
    expect(new Set([...inMigration, ...inCheck]).size).toBe(1);
    // And nothing else in either file computes a different name key.
    const code = (text: string) => text.replace(/--.*$/gm, '');
    for (const text of [migration, checkSql]) expect(code(text).match(/lower\(/g)).toHaveLength((code(text).match(rule) ?? []).length);
  });
});
