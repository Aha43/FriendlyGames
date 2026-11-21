// @vitest-environment node
// make backend-errors (#116), checked without a backend: the function's unexpected-error lines are
// found anywhere in the runtime log, the diagnostics test's own failure is expected and every
// other one fails the check, and nothing that could be data is printed from other lines.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONTROLLED, examine, reduce, report } from '../../scripts/backend-errors';
import { unexpectedErrorLine } from '../../supabase/functions/game-api/diagnostics';

const ROOT = resolve(__dirname, '../..');
const dir = mkdtempSync(join(tmpdir(), 'backend-errors-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const serving = (n: number) => Array.from({ length: n }, () => 'serving the request with supabase/functions/game-api').join('\n');
const controlled = unexpectedErrorLine('aaaaaaaa', 'POST', '/friend-invitations', Object.assign(new Error(`${CONTROLLED} (#116)`), { name: 'PostgresError', code: 'P0001' }));
const deadlock = unexpectedErrorLine('bbbbbbbb', 'DELETE', '/games/3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d', Object.assign(new Error('deadlock detected'), { name: 'PostgresError', code: '40P01' }));

function run(log: string, ...flags: string[]) {
  const file = join(dir, `log-${Math.random().toString(16).slice(2)}.txt`);
  writeFileSync(file, log);
  const viaFile = spawnSync('node', ['scripts/backend-errors.ts', '--file', file, ...flags], { cwd: ROOT, encoding: 'utf8' });
  const viaStdin = spawnSync('node', ['scripts/backend-errors.ts', ...flags], { cwd: ROOT, encoding: 'utf8', input: log });
  expect(viaStdin.stdout).toBe(viaFile.stdout);
  expect(viaStdin.status).toBe(viaFile.status);
  return { status: viaFile.status, out: viaFile.stdout + viaFile.stderr };
}

describe('make backend-errors', () => {
  it('finds an error logged early, under thousands of later lines, and fails on it', () => {
    const log = [serving(3), `\u001b[31m[Error]\u001b[0m ${deadlock}`, serving(5000), controlled, serving(5000)].join('\n');
    const { status, out } = run(log, '--expect-controlled');
    expect(status).toBe(1);
    expect(out).toContain('Backend runtime log: 10005 lines read.');
    expect(out).toContain('not made by a test on purpose: 1');
    expect(out).toContain(`  ${deadlock}`);
    expect(out).toContain('route="DELETE /games/:id" name=PostgresError code=40P01');
    expect(out).toContain('Made on purpose by the diagnostics test: 1');
    expect(out).toMatch(/FAIL {2}1 unexpected error\(s\) in the game API/);
    expect(out).not.toContain('\u001b');
  });

  it('passes when the only unexpected error is the one made on purpose', () => {
    const { status, out } = run([serving(10), controlled, serving(10)].join('\n'), '--expect-controlled');
    expect(status).toBe(0);
    expect(out).toContain('No unexplained backend errors.');
    expect(out).toContain(`  ${controlled}`);
  });

  it('fails when the failure made on purpose is missing: the log cannot be vouched for', () => {
    const { status, out } = run(serving(50), '--expect-controlled');
    expect(status).toBe(1);
    expect(out).toMatch(/FAIL {2}The diagnostics test's own failure is not in the log/);
    const empty = run('', '--expect-controlled');
    expect(empty.status).toBe(1);
    expect(empty.out).toMatch(/FAIL {2}The runtime log is empty/);
    // "No such container" from docker is not a log either.
    expect(run('Error response from daemon: No such container: supabase_edge_runtime_friendlygames', '--expect-controlled').status).toBe(1);
  });

  it('only reports, with a warning, for the browser job', () => {
    const { status, out } = run([serving(4), deadlock].join('\n'), '--report-only');
    expect(status).toBe(0);
    expect(out).toContain(`  ${deadlock}`);
    expect(out).toMatch(/::warning::1 unexpected error\(s\) in the game API/);
    expect(run(serving(4), '--report-only')).toMatchObject({ status: 0 });
    expect(run(serving(4), '--report-only').out).toContain('No unexplained backend errors.');
  });

  it('shows other runtime trouble reduced, capped, and never the routine lines', () => {
    const secret = 'SECRETcredential0123456789abcdefghijklmnopq';
    const trouble = [
      `worker boot error: failed to reach postgresql://postgres:hunter2@db.example.test:5432/postgres for "harald@example.test" ${secret}`,
      'event loop error: wall clock duration limit reached',
      ...Array.from({ length: 100 }, (_, i) => `worker ${i} terminated`),
    ];
    const found = examine([serving(20), ...trouble, controlled].join('\n'));
    expect(found.runtimeTotal).toBe(102);
    expect(found.runtime).toHaveLength(60);
    expect(found.runtime[0]).toBe('worker boot error: failed to reach … for "…" …');
    expect(found.runtime[1]).toBe('event loop error: wall clock duration limit reached');
    const { text, ok } = report(found, { expectControlled: true, reportOnly: false });
    expect(ok).toBe(true); // runtime lines inform; only the function's own errors decide
    expect(text).toContain('Other runtime lines that mention trouble: 102 (first 60 shown)');
    for (const leaked of [secret, 'hunter2', 'harald', 'serving the request']) expect(text).not.toContain(leaked);
    expect(reduce(`x ${'a'.repeat(500)}`).length).toBeLessThanOrEqual(240);
  });

  it('is wired into CI after the backend tests, whatever their result, and only reports after the browser journeys', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/- run: make test-backend\n(?: +#.*\n)+ +- if: \$\{\{ !cancelled\(\) \}\}\n +run: make backend-errors\n/);
    expect(ci).toMatch(/- run: make e2e\n(?: +#.*\n)+ +- if: \$\{\{ !cancelled\(\) \}\}\n +run: make backend-errors BACKEND_ERRORS_FLAGS=--report-only\n/);
    expect(ci).not.toMatch(/tail -100/);
    const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    expect(makefile).toMatch(/backend-errors:\n\t@docker logs supabase_edge_runtime_friendlygames 2>&1 \| node scripts\/backend-errors\.ts \$\(BACKEND_ERRORS_FLAGS\)\n/);
    // The deliberate failure the check expects is the one the backend suite makes.
    expect(readFileSync(join(ROOT, 'tests/backend/migrations/diagnostics.test.ts'), 'utf8')).toContain(`const CONTROLLED = '${CONTROLLED}';`);
  });
});
