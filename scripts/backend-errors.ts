// make backend-errors (#116): what the local backend's runtime logged about failures, over the
// whole run rather than its last lines.
//
// Reads the Edge runtime's log on standard input (or `--file <path>`), and prints:
// 1. every `game-api: unexpected error` line. The function writes those itself and they hold only
//    safe parts: an ID, the route pattern, the error's class, code and reduced message.
// 2. other runtime lines that look like trouble (errors, limits, restarts), reduced the same way.
// With `docker logs -t` each line keeps its time, to set beside the test client's own line.
//
// `--expect-controlled`: the backend tests make one failure on purpose
// (tests/backend/migrations/diagnostics.test.ts). Its line must be there, which proves on every run that
// this evidence path works; any other unexpected error fails the command, also when every test
// passed. `--report-only`: print, warn, never fail (the browser job, where the site repeats a
// failed read and would otherwise hide it).
//
// Plain TypeScript that Node 24 runs directly (type stripping), no dependencies. It never prints
// request or response bodies: the function does not log them, and other lines are reduced first.
import { readFileSync } from 'node:fs';

/** The backend tests' own failure. Keep in step with tests/backend/migrations/diagnostics.test.ts. */
export const CONTROLLED = 'controlled failure for diagnostics';
const UNEXPECTED = 'game-api: unexpected error';
const MAX_RUNTIME_LINES = 60;
/** Terminal colour codes, which the runtime puts around some lines. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Colour codes and container timestamps off; what could be data out. For lines the function did not write. */
export function reduce(line: string): string {
  const time = timeOf(line);
  return (
    time +
    reduceText(line.replace(COLOUR, '').slice(time ? line.replace(COLOUR, '').indexOf(' ') + 1 : 0))
  );
}

function reduceText(line: string): string {
  return line
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '…')
    .replace(/\S+@\S+/g, '…')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '…')
    .replace(/[A-Za-z0-9_-]{24,}/g, '…')
    .slice(0, 240)
    .trim();
}

/** The time `docker logs -t` puts first on each line, to the millisecond; empty without one. */
function timeOf(line: string): string {
  const time = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\d*Z /.exec(line.replace(COLOUR, ''));
  return time ? `${time[1]}Z ` : '';
}

/** A function-written line, cut back to its time and the part the function wrote (the runtime may prefix it). */
function unexpectedPart(line: string): string {
  return timeOf(line) + line.slice(line.indexOf(UNEXPECTED)).replace(COLOUR, '').slice(0, 400).trim();
}

export interface Findings {
  lines: number;
  controlled: string[];
  unexplained: string[];
  runtime: string[];
  runtimeTotal: number;
}

export function examine(log: string): Findings {
  const all = log.split(/\r?\n/);
  const unexpected = all.filter((line) => line.includes(UNEXPECTED)).map(unexpectedPart);
  const trouble = all.filter(
    (line) =>
      !line.includes(UNEXPECTED) &&
      !/serving the request/i.test(line) &&
      /error|fail|limit|terminat|boot|shut|kill|exceed|timeout|timed out|panic|crash|memory|abort/i.test(line),
  );
  return {
    lines: all.filter(Boolean).length,
    controlled: unexpected.filter((line) => line.includes(CONTROLLED)),
    unexplained: unexpected.filter((line) => !line.includes(CONTROLLED)),
    runtime: trouble.slice(0, MAX_RUNTIME_LINES).map(reduce),
    runtimeTotal: trouble.length,
  };
}

export function report(found: Findings, mode: { expectControlled: boolean; reportOnly: boolean }): { text: string; ok: boolean } {
  const out: string[] = [`Backend runtime log: ${found.lines} lines read.`];
  out.push('', `Unexpected errors in the game API, not made by a test on purpose: ${found.unexplained.length}`);
  out.push(...found.unexplained.map((line) => `  ${line}`));
  out.push('', `Made on purpose by the diagnostics test: ${found.controlled.length}`);
  out.push(...found.controlled.map((line) => `  ${line}`));
  out.push('', `Other runtime lines that mention trouble: ${found.runtimeTotal}${found.runtimeTotal > found.runtime.length ? ` (first ${found.runtime.length} shown)` : ''}`);
  out.push(...found.runtime.map((line) => `  ${line}`));

  const problems: string[] = [];
  if (found.lines === 0) problems.push('The runtime log is empty: nothing could be checked.');
  if (found.unexplained.length > 0) problems.push(`${found.unexplained.length} unexpected error(s) in the game API. Each line above has the route and the error; the same id= is in the 500 answer.`);
  if (mode.expectControlled && found.controlled.length === 0 && found.lines > 0) {
    problems.push('The diagnostics test\'s own failure is not in the log, so this check cannot vouch for the log. Did the backend tests run, and is this the right log?');
  }
  out.push('');
  if (problems.length === 0) out.push('No unexplained backend errors.');
  else out.push(...problems.map((problem) => (mode.reportOnly ? `::warning::${problem}` : `FAIL  ${problem}`)));
  return { text: out.join('\n'), ok: mode.reportOnly || problems.length === 0 };
}

function main(argv: string[]): number {
  const fileAt = argv.indexOf('--file');
  const log = readFileSync(fileAt >= 0 ? argv[fileAt + 1] : 0, 'utf8');
  const { text, ok } = report(examine(log), { expectControlled: argv.includes('--expect-controlled'), reportOnly: argv.includes('--report-only') });
  console.log(text);
  return ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('backend-errors.ts')) process.exit(main(process.argv.slice(2)));
