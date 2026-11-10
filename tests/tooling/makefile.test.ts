// @vitest-environment node
// The Makefile (#32), run for real with stub npm/supabase/curl/docker/node that record every
// call. Each test uses a throwaway copy of the repository's Makefile and scripts, so nothing
// here can reach production, the real backups/ folder or a local backend.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

const STUB = `#!/bin/sh
name=$(basename "$0")
echo "$name $*" >> "$STUB_LOG"
[ -n "$STUB_FAIL" ] && [ "$name $*" = "$STUB_FAIL" ] && exit 1
case "$name" in
  supabase)
    case "$*" in
      --version) echo 2.105.0 ;;
      "db dump"*)
        out=""; prev=""; for a in "$@"; do [ "$prev" = "-f" ] && out="$a"; prev="$a"; done
        case "$STUB_DUMP" in
          fail) exit 1 ;;
          empty) : > "$out" ;;
          *) case "$*" in *--data-only*) echo "INSERT INTO players VALUES (1);" > "$out" ;; *) echo "CREATE TABLE players ();" > "$out" ;; esac ;;
        esac ;;
    esac ;;
  curl)
    case "$*" in
      *-w*) printf "\${STUB_SITE:-200}" ;;
      *) if [ -n "$STUB_HEALTH" ]; then printf '%s\n' "$STUB_HEALTH"; else echo '{"ok":true,"commit":"abc1234","pooled":true}'; fi ;;
    esac ;;
  docker) [ "$STUB_DOCKER" = down ] && exit 1 ;;
  node) [ "$1" = -v ] && echo v24.11.0 ;;
  npm) [ "$1" = -v ] && echo 11.0.0 ;;
esac
exit 0
`;

let repo: string;
let bin: string;
let log: string;

function run(target: string[], env: Record<string, string> = {}) {
  const result = spawnSync('make', ['--no-print-directory', ...target], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, calls: calls() };
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'fg-make-'));
  bin = join(repo, '.stub-bin');
  log = join(repo, '.stub-log');
  mkdirSync(join(repo, 'scripts'));
  mkdirSync(join(repo, 'supabase/.temp'), { recursive: true });
  copyFileSync(join(ROOT, 'Makefile'), join(repo, 'Makefile'));
  copyFileSync(join(ROOT, 'package.json'), join(repo, 'package.json'));
  for (const script of readdirSync(join(ROOT, 'scripts'))) {
    copyFileSync(join(ROOT, 'scripts', script), join(repo, 'scripts', script));
    chmodSync(join(repo, 'scripts', script), 0o755);
  }
  writeFileSync(join(repo, 'supabase/.temp/project-ref'), 'testref\n');
  writeFileSync(join(repo, '.gitignore'), '.stub-bin/\n.stub-log\nbackups/\nsupabase/.temp/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'feature');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'fixture');
  mkdirSync(bin);
  for (const name of ['npm', 'supabase', 'curl', 'docker']) {
    writeFileSync(join(bin, name), STUB);
    chmodSync(join(bin, name), 0o755);
  }
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Install a stub `node` too (only where the real one isn't needed). */
function stubNode() {
  writeFileSync(join(bin, 'node'), STUB);
  chmodSync(join(bin, 'node'), 0o755);
}

const PRODUCTION = /supabase (db dump|db push|db reset|db query|secrets|functions deploy|link)|curl .*supabase\.co|workers\.dev/;

describe('make', () => {
  it('shows help by default and runs nothing', () => {
    const { status, out, calls } = run([]);
    expect(status).toBe(0);
    expect(out).toContain('Production (you run these deliberately):');
    expect(out).toMatch(/deploy-backend +Back up, migrate and deploy/);
    expect(calls).toEqual([]);
  });

  it('labels the version as the local checkout, not what is deployed', () => {
    const { status, out, calls } = run(['version']);
    expect(status).toBe(0);
    expect(out).toContain('Local checkout (not proof of what is deployed');
    expect(out).toMatch(/version +0\.\d+\.\d+/);
    expect(out).toMatch(/branch +feature/);
    expect(calls).toEqual([]);
  });

  it('verify runs check, backend and browser checks in order, locally only', () => {
    const { status, calls } = run(['verify']);
    expect(status).toBe(0);
    expect(calls).toEqual(['npm run check', 'npm run test:backend', 'npm run e2e']);
    expect(calls.join('\n')).not.toMatch(PRODUCTION);
  });

  it.each([
    ['npm run check', ['npm run check']],
    ['npm run test:backend', ['npm run check', 'npm run test:backend']],
    ['npm run e2e', ['npm run check', 'npm run test:backend', 'npm run e2e']],
  ])('verify stops at the first failure (%s) and fails', (failing, expected) => {
    const { status, calls } = run(['verify'], { STUB_FAIL: failing });
    expect(status).not.toBe(0);
    expect(calls).toEqual(expected);
  });

  it.each([
    ['check', 'npm run check'],
    ['test-backend', 'npm run test:backend'],
    ['e2e', 'npm run e2e'],
    ['build', 'npm run build'],
    ['up', 'supabase start'],
    ['down', 'supabase stop'],
  ])('%s delegates to %s and passes its failure on', (target, command) => {
    expect(run([target]).calls).toEqual([command]);
    rmSync(log);
    expect(run([target], { STUB_FAIL: command }).status).not.toBe(0);
  });

  it('down keeps local data (no --no-backup) and nothing resets the database', () => {
    for (const target of ['up', 'down', 'check', 'test-backend', 'e2e', 'verify', 'setup', 'version']) run([target]);
    expect(calls().join('\n')).not.toMatch(/--no-backup|db reset/);
  });
});

describe('make doctor', () => {
  it('passes when everything is in place', () => {
    stubNode();
    const { status, out } = run(['doctor']);
    expect(out).toContain('ok    Node v24.11.0');
    expect(out).toContain('ok    Docker is running');
    expect(status).toBe(0);
  });

  it('fails with an actionable message when Docker is not running', () => {
    stubNode();
    const { status, out } = run(['doctor'], { STUB_DOCKER: 'down' });
    expect(status).not.toBe(0);
    expect(out).toContain("FAIL  Docker isn't running");
  });
});

describe('make backup', () => {
  const backups = () => (existsSync(join(repo, 'backups')) ? readdirSync(join(repo, 'backups')) : []);

  it('saves a schema and a data dump with the same timestamp', () => {
    const { status, out } = run(['backup']);
    expect(status).toBe(0);
    const files = backups().sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^\d{8}T\d{6}Z-data\.sql$/);
    expect(files[1]).toBe(files[0].replace('-data', '-schema'));
    expect(out).toMatch(/Backed up to backups\/\d{8}T\d{6}Z-schema\.sql \(\d+ bytes\)/);
  });

  it.each([
    ['a dump that fails (e.g. Docker not running)', 'fail'],
    ['empty dumps', 'empty'],
  ])('leaves nothing that looks like a backup after %s', (_name, mode) => {
    const { status, out } = run(['backup'], { STUB_DUMP: mode });
    expect(status).not.toBe(0);
    expect(backups()).toEqual([]); // not even the temporary folder
    if (mode === 'empty') expect(out).toContain('Nothing was saved.');
  });

  it('refuses without a linked project', () => {
    rmSync(join(repo, 'supabase/.temp/project-ref'));
    const { status, out, calls } = run(['backup']);
    expect(status).not.toBe(0);
    expect(out).toContain('Not linked');
    expect(calls).toEqual([]);
  });
});

describe('production commands', () => {
  it('prod-name-check queries only the linked project, and an empty answer is never "clear"', () => {
    const { status, out, calls } = run(['prod-name-check']);
    expect(status).not.toBe(0);
    expect(out).toContain('Checking player names on the linked project testref (read-only).');
    expect(out).toMatch(/Name check incomplete: the answer was not JSON/);
    expect(calls).toEqual(['supabase db query --linked --agent no -o json -f scripts/name-check.sql']);
    expect(calls.join('\n')).not.toMatch(/--local|--db-url|db push|db reset/);
  });

  it('prod-status reads the live health only, and shows the local commit separately', () => {
    const { status, out, calls } = run(['prod-status']);
    expect(status).toBe(0);
    expect(out).toContain('https://testref.supabase.co/functions/v1/game-api');
    expect(out).toContain('commit abc1234, database ok, pooler yes');
    expect(out).toMatch(/Local +[0-9a-f]{7} on feature \(your checkout, for comparison\)/);
    expect(calls.every((c) => c.startsWith('curl '))).toBe(true);
    expect(calls.join('\n')).not.toMatch(/-X|--data|POST/);
  });

  it('prod-status fails clearly when the backend does not answer', () => {
    const { status, out } = run(['prod-status'], {
      STUB_FAIL: 'curl -fsS --max-time 20 https://testref.supabase.co/functions/v1/game-api/health',
    });
    expect(status).not.toBe(0);
    expect(out).toContain('health check failed');
  });

  it('prod-status shows everything but fails when the site does not answer normally', () => {
    const { status, out } = run(['prod-status'], { STUB_SITE: '503' });
    expect(status).not.toBe(0);
    expect(out).toContain('did not answer normally (HTTP 503)');
    expect(out).toContain('commit abc1234, database ok, pooler yes');
    expect(out).toMatch(/Local +[0-9a-f]{7}/);
  });

  it('prod-status fails when the backend reports its database is not ok', () => {
    const { status, out } = run(['prod-status'], { STUB_HEALTH: '{"ok":false,"commit":"abc1234","pooled":true}' });
    expect(status).not.toBe(0);
    expect(out).toContain('database NOT ok');
  });

  it('deploy-backend goes through the guarded script, which refuses outside main', () => {
    const { status, out, calls } = run(['deploy-backend']);
    expect(out).toContain('SITE_ORIGIN=https://friendlygames.arne-halvorsen.workers.dev scripts/deploy-backend.sh');
    expect(status).not.toBe(0);
    expect(out).toContain('Deploy from main.');
    expect(calls).toEqual([]);
  });

  it('prod-e2e runs the journeys against the live site and API', () => {
    const { status, out, calls } = run(['prod-e2e']);
    expect(status).toBe(0);
    expect(out).toContain('throwaway @example.test players');
    expect(calls).toEqual(['npm run e2e']);
    expect(out).toContain(
      'PLAYWRIGHT_BASE_URL=https://friendlygames.arne-halvorsen.workers.dev FG_API_URL=https://testref.supabase.co/functions/v1/game-api npm run e2e',
    );
  });
});
