// Chess960 engine proof (#52) in the browser: builds proofs/chess960 with Vite, runs it in
// Chromium (Playwright) and reports the fixture results and the rules' bundle size.
// Usage: node scripts/chess960-browser-proof.mjs   (exits non-zero if any fixture fails)
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const root = resolve(import.meta.dirname, '../proofs/chess960');
const out = mkdtempSync(join(tmpdir(), 'chess960-proof-'));
const quiet = { logLevel: 'error', configFile: false };
try {
  await build({ ...quiet, root, base: './', build: { outDir: join(out, 'page'), emptyOutDir: true } });
  await build({
    ...quiet,
    root,
    build: { outDir: join(out, 'size'), emptyOutDir: true, lib: { entry: join(root, 'size.ts'), formats: ['es'], fileName: 'rules' } },
  });
  const rules = readFileSync(join(out, 'size', readdirSync(join(out, 'size')).find((f) => f.endsWith('.js'))));

  const server = await preview({ ...quiet, root, build: { outDir: join(out, 'page') }, preview: { port: 0, host: '127.0.0.1' } });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const result = await page.waitForFunction(() => window.chess960Proof, null, { timeout: 30_000 }).then((h) => h.jsonValue());
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));

  console.log(JSON.stringify({ browser: userAgent.match(/(HeadlessChrome|Chrome)\/[\d.]+/)?.[0], ...result, rulesBundle: { bytes: rules.length, gzip: gzipSync(rules).length } }, null, 2));
  process.exitCode = result.failures.length === 0 ? 0 : 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
