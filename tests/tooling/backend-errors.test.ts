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

  it('shows other runtime trouble reduced, and never the routine lines', () => {
    const secret = 'SECRETcredential0123456789abcdefghijklmnopq';
    const trouble = [
      `worker boot error: failed to reach postgresql://postgres:hunter2@db.example.test:5432/postgres for "harald@example.test" ${secret}`,
      'event loop error: wall clock duration limit reached',
    ];
    const found = examine([serving(20), ...trouble, controlled].join('\n'));
    expect(found.runtime.map((m) => m.text)).toEqual(['worker boot error: failed to reach … for "…" …', 'event loop error: wall clock duration limit reached']);
    const { text, ok } = report(found, { expectControlled: true, reportOnly: false });
    expect(ok).toBe(true); // runtime lines inform; only the function's own errors decide
    expect(text).toContain('Other runtime lines that mention trouble: 2, in 2 distinct message(s)');
    for (const leaked of [secret, 'hunter2', 'harald', 'serving the request']) expect(text).not.toContain(leaked);
    expect(reduce(`x ${'a '.repeat(500)}`).length).toBeLessThanOrEqual(240);
  });

  it('takes single-quoted values and bare database addresses out of runtime lines (review of fa7a97a)', () => {
    expect(reduce("password authentication failed for 'sample-pass' at db.example.test:6543")).toBe("password authentication failed for '…' at …");
    const cases: [string, string[]][] = [
      ["FATAL: password authentication failed for user 'postgres' (pass 'hunter2')", ['postgres', 'hunter2']],
      ['connection error: connect ECONNREFUSED 10.0.0.12:5432', ['10.0.0.12', '5432']],
      ['connection error: connect ECONNREFUSED [fd00::12]:5432', ['fd00', '5432']],
      ['failed to connect to supabase_db_friendlygames:5432 after timeout', ['supabase_db_friendlygames', '5432']],
      ['error reaching localhost:54322 and db:6543', ['54322', '6543', 'localhost']],
      ['error: host aws-0-eu-north-1.pooler.supabase.com refused', ['pooler', 'supabase.com', 'eu-north']],
      ["invalid input 'O''Brien' for harald@example.test", ['Brien', 'harald', 'example.test']],
      ['2026-11-21T19:30:07.148123456Z error: token SECRETcredential0123456789abcdefghijklmnopq rejected', ['SECRETcredential']],
    ];
    for (const [line, secrets] of cases) {
      const shown = reduce(line);
      for (const secret of secrets) expect(shown, line).not.toContain(secret);
      // The same line through the whole report.
      const { text } = report(examine(line), { expectControlled: false, reportOnly: true });
      for (const secret of secrets) expect(text, line).not.toContain(secret);
    }
    // The time is kept; fixed wording is kept.
    expect(reduce('2026-11-21T19:30:07.148123456Z CPU time soft limit reached: isolate: 3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d')).toBe(
      '2026-11-21T19:30:07.148Z CPU time soft limit reached: isolate: …',
    );
    // A line that claims to be the function's own but is not in its form is reduced too.
    const forged = examine("game-api: unexpected error: failed for 'sample-pass' at db.example.test:6543").unexplained[0];
    expect(forged).toBe("game-api: unexpected error: failed for '…' at …");
  });

  it('keeps a single different error that arrives after many repeated warnings (review of fa7a97a)', () => {
    const stamp = (i: number) => `2026-11-21T19:30:${String(Math.floor(i / 10) % 60).padStart(2, '0')}.${String(i % 10)}00Z`;
    const repeated = Array.from({ length: 300 }, (_, i) => [
      `${stamp(i)} CPU time soft limit reached: isolate: 3f2b8c1e-5d47-4a6b-9c0d-${String(i).padStart(12, '0')}`,
      `${stamp(i)} early termination has been triggered: isolate: 3f2b8c1e-5d47-4a6b-9c0d-${String(i).padStart(12, '0')}`,
      `${stamp(i)} worker ${i} terminated`,
    ]).flat();
    const late = '2026-11-21T19:45:01.250Z connection error: Connection reset by peer (os error 104)';
    const found = examine([...repeated, serving(2000), late, serving(2000), controlled].join('\n'));
    expect(found.runtimeTotal).toBe(901);
    expect(found.runtimeDistinct).toBe(4);
    expect(found.runtime.map((m) => [m.text, m.count])).toEqual([
      ['CPU time soft limit reached: isolate: …', 300],
      ['early termination has been triggered: isolate: …', 300],
      ['worker 0 terminated', 300],
      ['connection error: Connection reset by peer (os error 104)', 1],
    ]);
    const { text } = report(found, { expectControlled: true, reportOnly: false });
    expect(text).toContain('Other runtime lines that mention trouble: 901, in 4 distinct message(s), each shown once with its times');
    expect(text).toContain('  connection error: Connection reset by peer (os error 104)\n    ×1 on 2026-11-21 at 19:45:01.250');
    // Repeats are summarised with their times: the first forty, then the last.
    expect(text).toMatch(/ {2}CPU time soft limit reached: isolate: …\n {4}×300 on 2026-11-21 at 19:30:00\.000, 19:30:00\.100, .*, … last 19:30:29\.900\n/);
    expect(text.split('\n').length).toBeLessThan(30);
    expect(text).not.toContain('NOT shown');
  });

  it('says so if there are more distinct messages than it shows, rather than dropping them silently', () => {
    const many = Array.from({ length: 250 }, (_, i) => `error kind ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10) % 10]}${'uvwxyzABCD'[Math.floor(i / 100)]} happened`);
    const found = examine(many.join('\n'));
    expect(found.runtimeDistinct).toBe(250);
    expect(found.runtime).toHaveLength(200);
    expect(report(found, { expectControlled: false, reportOnly: true }).text).toContain('… and 50 more distinct message(s) NOT shown: read the runtime log itself.');
  });

  it('keeps each line’s time when the log has them, so a failure can be set beside a runtime event', () => {
    const log = [
      '2026-11-21T19:20:30.123456789Z CPU time soft limit reached: isolate: 3f2b8c1e-5d47-4a6b-9c0d-1e2f3a4b5c6d',
      `2026-11-21T19:20:30.200000000Z [Error] ${deadlock}`,
      '2026-11-21T19:20:31.000000000Z serving the request with supabase/functions/game-api',
      `2026-11-21T19:20:40.5Z ${controlled}`,
    ].join('\n');
    const found = examine(log);
    expect(found.runtime).toEqual([{ text: 'CPU time soft limit reached: isolate: …', count: 1, times: ['2026-11-21T19:20:30.123Z'] }]);
    expect(found.unexplained).toEqual([`2026-11-21T19:20:30.200Z ${deadlock}`]);
    expect(found.controlled).toEqual([`2026-11-21T19:20:40.5Z ${controlled}`]);
  });

  it('is wired into CI after the backend tests, whatever their result, and only reports after the browser journeys', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/- run: make test-backend\n(?: +#.*\n)+ +- if: \$\{\{ !cancelled\(\) \}\}\n +run: make backend-errors\n/);
    expect(ci).toMatch(/- run: make e2e\n(?: +#.*\n)+ +- if: \$\{\{ !cancelled\(\) \}\}\n +run: make backend-errors BACKEND_ERRORS_FLAGS=--report-only\n/);
    expect(ci).not.toMatch(/tail -100/);
    const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    expect(makefile).toMatch(/backend-errors:\n\t@docker logs -t supabase_edge_runtime_friendlygames 2>&1 \| node scripts\/backend-errors\.ts \$\(BACKEND_ERRORS_FLAGS\)\n/);
    // The deliberate failure the check expects is the one the backend suite makes.
    expect(readFileSync(join(ROOT, 'tests/backend/migrations/diagnostics.test.ts'), 'utf8')).toContain(`const CONTROLLED = '${CONTROLLED}';`);
  });
});
