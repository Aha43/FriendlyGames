// Shared fixtures for the shared-play journeys.
//
// - `openContext` makes browser contexts with the project's device settings and always closes
//   them, even when an assertion fails part-way.
// - Every game-api call is recorded as "<who> <METHOD> <path> <status> <ms>", with IDs and
//   tokens masked. No headers, bodies, query strings or emails: those carry device credentials
//   and invitation tokens. The log is printed when a test fails, or always with
//   E2E_API_TIMINGS=1 (used to measure the API while investigating #21).
// - `api` makes setup calls straight to the API and fails at once, with the call that failed,
//   if the server does not answer as expected.
import { test as base, expect as baseExpect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

export const API_URL = process.env.FG_API_URL ?? 'http://localhost:56321/functions/v1/game-api';

/**
 * A player name no other test, worker or run uses (names are unique, #76): `<base>-<12 hex>`,
 * well within the 40-character limit. Assert on the returned name, never on the base.
 */
export const uniqueName = (base: string): string => `${base}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

/** "/games/<uuid>/actions" → "/games/:id/actions"; tokens and credentials become ":secret". */
export function operation(url: string): string {
  const path = new URL(url).pathname.replace(/^.*\/game-api/, '') || '/';
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/[A-Za-z0-9_-]{43}/g, ':secret');
}

function recordApiCalls(page: Page, who: string, log: string[]) {
  const started = new Map<object, number>();
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  page.on('request', (request) => {
    if (request.url().includes('/game-api/')) started.set(request, Date.now());
  });
  page.on('requestfinished', async (request) => {
    const start = started.get(request);
    if (start === undefined) return;
    // The page or context may close first (end of test): then there is nothing to record.
    const status = await request.response().then(
      (response) => response?.status() ?? 0,
      () => null,
    );
    if (status === null) return;
    log.push(`${at()} ${who} ${request.method()} ${operation(request.url())} ${status} ${Date.now() - start}ms`);
  });
  page.on('requestfailed', (request) => {
    const start = started.get(request);
    if (start === undefined) return;
    log.push(`${at()} ${who} ${request.method()} ${operation(request.url())} FAILED(${request.failure()?.errorText}) ${Date.now() - start}ms`);
  });
  page.on('pageerror', (error) => log.push(`${at()} ${who} page error: ${error.name}`));
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Fixtures {
  /** Base URL for setup calls; overridable so the leak regression test can use a dead port. */
  apiBaseUrl: string;
  apiLog: string[];
  openContext: (who: string, identity?: { playerId: string; displayName: string; credential: string }) => Promise<BrowserContext>;
  api: (method: 'GET' | 'POST', path: string, options?: { credential?: string; data?: unknown; expect?: number }) => Promise<Json>;
}

export const test = base.extend<Fixtures>({
  apiLog: async ({}, use, testInfo) => {
    const log: string[] = [];
    await use(log);
    if (process.env.E2E_API_TIMINGS) {
      for (const line of log) console.log(`[api-timing] ${testInfo.project.name} ${line}`);
    }
    if (testInfo.status !== testInfo.expectedStatus && log.length > 0) {
      console.log(`[api] ${testInfo.project.name} › ${testInfo.title}\n  ${log.join('\n  ')}`);
    }
  },

  openContext: async ({ browser, apiLog }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
    await use(async (who, identity) => {
      const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
      contexts.push(context);
      if (identity) {
        await context.addInitScript((id) => localStorage.setItem('friendlygames.identity', JSON.stringify(id)), identity);
      }
      let pages = 0;
      context.on('page', (page) => recordApiCalls(page, pages++ === 0 ? who : `${who}#${pages}`, apiLog));
      return context;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  apiBaseUrl: [API_URL, { option: true }],

  api: async ({ request, apiLog, apiBaseUrl }, use) => {
    await use(async (method, path, { credential, data, expect: expected } = {}) => {
      const started = Date.now();
      const op = `${method} ${operation(`${apiBaseUrl}${path}`)}`;
      let response;
      try {
        response = await (request as APIRequestContext).fetch(`${apiBaseUrl}${path}`, {
          method,
          headers: credential ? { 'X-Device-Credential': credential } : {},
          data,
        });
      } catch {
        // Playwright's transport errors include the request headers (the device credential) and
        // body (invitation tokens, emails). Replace them with the operation alone.
        apiLog.push(`setup ${op} TRANSPORT-ERROR ${Date.now() - started}ms`);
        throw new Error(`Setup call ${op} could not reach the API (transport error; details withheld)`);
      }
      apiLog.push(`setup ${op} ${response.status()} ${Date.now() - started}ms`);
      const ok = expected === undefined ? response.ok() : response.status() === expected;
      if (!ok) throw new Error(`Setup call ${op} answered ${response.status()}`);
      return (await response.json()) as Json;
    });
  },
});

/**
 * Time allowed for a page to load its data from the server (measured for #21, local stack,
 * full suite on desktop + phone: table load median 0.6 s, p95 1.8 s, max 2.7 s over 60 loads;
 * single API calls up to 7.9 s when the edge runtime boots a worker after idling or after
 * retiring one at its CPU limit). Worst call plus page load is about 10 s; 15 s leaves margin.
 * Only waits that need a fresh server load use it; everything else keeps the 5 s default.
 */
export const LOAD_BUDGET = 15_000;

/**
 * Assertions for the shared-play journeys. Every step there waits on the real server (a save, a
 * poll, a load), and any single server call can take up to the measured 7.9 s, so all of them get
 * LOAD_BUDGET instead of Playwright's 5 s default. Local-play journeys keep the default.
 */
export const expect = baseExpect.configure({ timeout: LOAD_BUDGET });

/**
 * Navigate (optional) and wait until the table has loaded its game from the server, i.e. its
 * status line is shown. Logs the measured time with E2E_API_TIMINGS=1.
 */
export async function openTable(page: Page, url?: string, budget = Number(process.env.E2E_LOAD_BUDGET ?? LOAD_BUDGET)) {
  const started = Date.now();
  if (url) await page.goto(url);
  await expect(page.getByRole('status')).toBeVisible({ timeout: budget });
  if (process.env.E2E_API_TIMINGS) console.log(`[load-timing] ${Date.now() - started}ms`);
}

/** Navigate to the lobby and wait until its games and history have loaded from the server. */
export async function openLobby(page: Page, budget = Number(process.env.E2E_LOAD_BUDGET ?? LOAD_BUDGET)) {
  const started = Date.now();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chess history' })).toBeVisible({ timeout: budget });
  await expect(page.getByText('Looking for your games…')).toBeHidden({ timeout: budget });
  if (process.env.E2E_API_TIMINGS) console.log(`[load-timing] lobby ${Date.now() - started}ms`);
}
