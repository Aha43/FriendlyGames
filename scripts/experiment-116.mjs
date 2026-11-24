// Experiment for #116, not for main: load the local game API until its Edge runtime retires
// workers many times, and count the answers the runtime itself gives instead of the function.
// Disposable local stack only. Prints statuses, the error name in a failure's trace, never
// bodies, credentials or emails.
const API = process.env.FG_API_URL ?? 'http://127.0.0.1:56321/functions/v1/game-api';
const TOTAL = Number(process.env.EXP_REQUESTS ?? 30000);
const CONCURRENCY = Number(process.env.EXP_CONCURRENCY ?? 16);

const entered = await (await fetch(`${API}/players`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: `exp-${Date.now()}@example.test`, displayName: `Exp${Date.now()}` }),
})).json();
const credential = entered.deviceCredential;
if (!credential) throw new Error('could not create the disposable player');

const kinds = {
  // No body: the newer CLI replays these once when the worker has retired.
  get: () => fetch(`${API}/me`, { headers: { 'X-Device-Credential': credential } }),
  // With a body, and harmless: an unknown token is answered 404.
  post: () => fetch(`${API}/friend-invitations/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Credential': credential },
    body: JSON.stringify({ token: 'x'.repeat(43) }),
  }),
};
const expected = { get: 200, post: 404 };
const tally = {};
const failures = [];
const note = (key) => (tally[key] = (tally[key] ?? 0) + 1);

let next = 0;
async function worker() {
  while (next < TOTAL) {
    const kind = next++ % 2 === 0 ? 'get' : 'post';
    try {
      const response = await kinds[kind]();
      const text = await response.text();
      if (response.status === expected[kind]) { note(`${kind} ok`); continue; }
      let shape = text === '' ? 'empty body' : 'other body';
      try {
        const body = JSON.parse(text);
        if (body?.error?.errorId) shape = 'function error with errorId';
        else if (typeof body?.trace === 'string') shape = `runtime: ${(/\b([A-Z][A-Za-z]+): /.exec(body.trace) ?? [])[1] ?? 'unnamed'}`;
        else if (typeof body?.code === 'string') shape = `runtime code ${body.code}`.slice(0, 60);
      } catch { /* not JSON */ }
      const key = `${kind} ${response.status} ${shape}`;
      note(key);
      if (failures.length < 40) failures.push(`${new Date().toISOString()} ${key}`);
    } catch (error) {
      note(`${kind} fetch failed: ${error?.cause?.code ?? error?.name}`);
    }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`requests ${TOTAL}, concurrency ${CONCURRENCY}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const key of Object.keys(tally).sort()) console.log(`  ${String(tally[key]).padStart(6)}  ${key}`);
console.log(failures.length ? `first failures:\n  ${failures.join('\n  ')}` : 'no failed request');
