// make backend-errors (#116): what the local backend's runtime logged about failures, over the
// whole run rather than its last lines.
//
// Reads the Edge runtime's log from `--file <path>` (as scripts/backend-errors.sh gives it) or
// standard input, and prints:
// 1. every `game-api: unexpected error` line. The function writes those itself and they hold only
//    safe parts: an ID, the route pattern, the error's class, code and reduced message.
// 2. other runtime lines that look like trouble (errors, limits, restarts), reduced by the same
//    rules and grouped: each distinct message once, with its count and times, wherever in the run
//    it was. A routine warning repeated many times cannot push a different error out of view.
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
import { redact } from '../supabase/functions/game-api/diagnostics.ts';

/** The backend tests' own failure. Keep in step with tests/backend/migrations/diagnostics.test.ts. */
export const CONTROLLED = 'controlled failure for diagnostics';
const UNEXPECTED = 'game-api: unexpected error';
/** Distinct runtime messages shown. Far above anything seen; if it is ever reached the report says so. */
const MAX_DISTINCT = 200;
/** Times listed per message; beyond that the count, first and last still tell the story. */
const MAX_TIMES = 40;
/** Terminal colour codes, which the runtime puts around some lines. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\d*Z /;

/** A line without colour codes, split into the time `docker logs -t` puts first (to the millisecond) and the rest. */
function split(line: string): { time: string; text: string } {
  const plain = line.replace(COLOUR, '');
  const time = TIME.exec(plain);
  return time ? { time: `${time[1]}Z`, text: plain.slice(time[0].length) } : { time: '', text: plain };
}

/**
 * A line the function did not write, with what could be data taken out by the same rules the
 * function uses for its own messages: quoted values (double or single), emails, links, hosts and
 * addresses, IDs, tokens, long numbers. The time stays.
 */
export function reduce(line: string): string {
  const { time, text } = split(line);
  return `${time ? `${time} ` : ''}${redact(text).slice(0, 240).trim()}`;
}

/**
 * A function-written line, cut back to its time and the part the function wrote (the runtime may
 * prefix it). The function reduces its own lines; one that is not in its `id=… route=…` form is
 * not trusted and is reduced here.
 */
function unexpectedPart(line: string): string {
  const { time, text } = split(line);
  const own = text.slice(text.indexOf(UNEXPECTED)).slice(0, 400).trim();
  return `${time ? `${time} ` : ''}${/^game-api: unexpected error id=[0-9a-f]{8} route="[A-Z]+ [a-z/:-]*" /.test(own) ? own : redact(own)}`;
}

/** One distinct runtime message: every occurrence counted, with its times, wherever in the run it was. */
export interface RuntimeMessage {
  text: string;
  count: number;
  times: string[];
}

export interface Findings {
  lines: number;
  controlled: string[];
  unexplained: string[];
  runtime: RuntimeMessage[];
  runtimeTotal: number;
  runtimeDistinct: number;
}

const TROUBLE =
  /error|fail|limit|terminat|boot|shut|kill|exceed|timeout|timed out|panic|crash|memory|abort|reset|refus|closed|denied|unhandled|exception|invalid|warn|fatal/i;

export function examine(log: string): Findings {
  const all = log.split(/\r?\n/);
  const unexpected = all.filter((line) => line.includes(UNEXPECTED)).map(unexpectedPart);
  const trouble = all.filter((line) => !line.includes(UNEXPECTED) && !/serving the request/i.test(line) && TROUBLE.test(line));
  // Grouped by message, not cut off by position: a routine warning repeated a thousand times is
  // one entry, and a single different error after it is another.
  const groups = new Map<string, RuntimeMessage>();
  for (const line of trouble) {
    const { time, text } = split(line);
    const shown = redact(text).slice(0, 240).trim();
    const key = shown.replace(/\d+/g, '#');
    const group = groups.get(key) ?? { text: shown, count: 0, times: [] };
    group.count += 1;
    if (time) group.times.push(time);
    groups.set(key, group);
  }
  return {
    lines: all.filter(Boolean).length,
    controlled: unexpected.filter((line) => line.includes(CONTROLLED)),
    unexplained: unexpected.filter((line) => !line.includes(CONTROLLED)),
    runtime: [...groups.values()].slice(0, MAX_DISTINCT),
    runtimeTotal: trouble.length,
    runtimeDistinct: groups.size,
  };
}

/** `×10 at 19:30:07.148, 19:30:07.264, …`: the clock times of a message, the date said once per line. */
function when(message: RuntimeMessage): string {
  if (message.times.length === 0) return message.count > 1 ? `  ×${message.count}` : '';
  const clock = (time: string) => time.slice(11, -1);
  const listed = message.times.slice(0, MAX_TIMES).map(clock).join(', ');
  const more = message.times.length > MAX_TIMES ? `, … last ${clock(message.times[message.times.length - 1])}` : '';
  return `  ×${message.count} on ${message.times[0].slice(0, 10)} at ${listed}${more}`;
}

export function report(found: Findings, mode: { expectControlled: boolean; reportOnly: boolean }): { text: string; ok: boolean } {
  const out: string[] = [`Backend runtime log: ${found.lines} lines read.`];
  out.push('', `Unexpected errors in the game API, not made by a test on purpose: ${found.unexplained.length}`);
  out.push(...found.unexplained.map((line) => `  ${line}`));
  out.push('', `Made on purpose by the diagnostics test: ${found.controlled.length}`);
  out.push(...found.controlled.map((line) => `  ${line}`));
  out.push('', `Other runtime lines that mention trouble: ${found.runtimeTotal}, in ${found.runtimeDistinct} distinct message(s), each shown once with its times`);
  for (const message of found.runtime) out.push(`  ${message.text}`, ...(when(message) ? [`  ${when(message)}`] : []));
  if (found.runtimeDistinct > found.runtime.length) {
    out.push(`  … and ${found.runtimeDistinct - found.runtime.length} more distinct message(s) NOT shown: read the runtime log itself.`);
  }

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

/** Standard input, read as a stream. (Not `readFileSync(0)`: a synchronous read of a pipe that is still being written is fragile.) */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv: string[]): Promise<number> {
  const fileAt = argv.indexOf('--file');
  const log = fileAt >= 0 ? readFileSync(argv[fileAt + 1], 'utf8') : await readStdin();
  const { text, ok } = report(examine(log), { expectControlled: argv.includes('--expect-controlled'), reportOnly: argv.includes('--report-only') });
  console.log(text);
  return ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('backend-errors.ts')) process.exitCode = await main(process.argv.slice(2));
