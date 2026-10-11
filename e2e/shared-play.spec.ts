// Two players in independent browser contexts, against the real local backend (`supabase start`).
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

async function onboard(page: Page, name: string, email: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
}

// Polling runs every 4 s; allow a couple of rounds.
const SYNC = { timeout: 12_000 };

/** Let the next matching request reach the server and commit, then lose its response. */
async function loseNextResponse(page: Page, url: string, method = 'POST') {
  let lost = false;
  await page.route(url, async (route) => {
    if (lost || route.request().method() !== method) return route.continue();
    lost = true;
    await route.fetch(); // the server receives and commits it
    await route.abort('connectionreset'); // the client never sees the answer
  });
}

test('two players create, join, play, refresh, recover from a failed send and resign', async ({ browser }, testInfo) => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const options: BrowserContextOptions = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL };
  const arneContext = await browser.newContext(options);
  const haraldContext = await browser.newContext(options);
  // Harald's browser behaves like a phone on the dev server's LAN address (plain HTTP, not a
  // secure context), where crypto.randomUUID does not exist.
  await haraldContext.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined });
  });
  const arne = await arneContext.newPage();
  const harald = await haraldContext.newPage();
  const run = `${Date.now()}-${testInfo.project.name}`;

  // Arne arrives, introduces himself and invites Harald.
  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);

  // The game is created, but the answer (with the only copy of the link) is lost.
  await loseNextResponse(arne, '**/game-api/games');
  await arne.getByRole('button', { name: 'Create game' }).click();
  await expect(arne.getByText(/Couldn’t confirm whether the game was created/)).toBeVisible();
  await arne.unroute('**/game-api/games');
  // Retrying finds the same game and issues a working link; no second game appears.
  await arne.getByRole('button', { name: 'Try again' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).toMatch(/#\/join\/[A-Za-z0-9_-]{43}$/);
  await expect(arne.getByRole('list', { name: 'Games in progress' }).getByRole('link')).toHaveCount(1);
  await arne.getByRole('link', { name: 'Go to the table' }).click();
  await expect(arne.getByRole('status')).toHaveText('Waiting for your friend to join');

  // Harald opens the link on his own device, introduces himself and lands at the table as Black.
  await harald.goto(link);
  await expect(harald.getByRole('heading', { name: 'You’re invited to a game' })).toBeVisible();
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await expect(harald.getByRole('status')).toHaveText('Arne’s move');
  expect(harald.url()).not.toContain('/join/'); // the token is not left in the address bar
  await expect(harald.getByRole('gridcell').first()).toHaveAccessibleName('h1, white rook');

  // Arne sees Harald arrive, and they exchange moves.
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);
  await move(arne, 'e2', 'e4');
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(square(harald, 'e4')).toHaveAccessibleName('e4, white pawn', SYNC);
  await expect(harald.getByRole('status')).toHaveText('Your move');
  await move(harald, 'e7', 'e5');
  await expect(square(arne, 'e5')).toHaveAccessibleName('e5, black pawn', SYNC);

  // Both close and come back: the game resumes from the server.
  await Promise.all([arne.reload(), harald.reload()]);
  await expect(arne.getByRole('list', { name: 'Moves' })).toContainText('e4');
  await expect(arne.getByRole('list', { name: 'Moves' })).toContainText('e5');
  await expect(arne.getByRole('status')).toHaveText('Your move');
  await expect(square(harald, 'e5')).toHaveAccessibleName('e5, black pawn');

  // Arne's move is saved, but the answer is lost: the page doesn't claim either outcome,
  // and Retry (same request ID) confirms it without playing it twice.
  await loseNextResponse(arne, '**/game-api/games/*/actions');
  await move(arne, 'g1', 'f3');
  await expect(arne.getByText(/Couldn’t confirm whether your move was saved/)).toBeVisible();
  await expect(square(arne, 'g1')).toHaveAccessibleName('g1, white knight'); // last confirmed position
  await arne.unroute('**/game-api/games/*/actions');
  await arne.getByRole('button', { name: 'Retry' }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(square(arne, 'f3')).toHaveAccessibleName('f3, white knight');
  await expect(square(harald, 'f3')).toHaveAccessibleName('f3, white knight', SYNC);
  await expect(harald.getByRole('list', { name: 'Moves' }).getByText('Nf3')).toHaveCount(1);

  // Both lobbies list the game.
  await arne.goto('/');
  await expect(arne.getByRole('list', { name: 'Games in progress' })).toContainText('vs Harald');
  await expect(arne.getByRole('list', { name: 'Games in progress' })).toContainText('Harald’s move');
  await arne.goBack();

  // Harald resigns after confirming; Arne sees the result.
  await harald.getByRole('button', { name: 'Resign…' }).click();
  await harald.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(harald.getByRole('status')).toHaveText('You resigned. Arne wins');
  await expect(arne.getByRole('status')).toHaveText('Harald resigned. You win', SYNC);

  await arneContext.close();
  await haraldContext.close();
});

test('a move from an outdated tab is refused and the tab catches up', async ({ browser, request }, testInfo) => {
  const api = process.env.FG_API_URL ?? 'http://localhost:56321/functions/v1/game-api';
  const run = `${Date.now()}-${testInfo.project.name}`;
  const createPlayer = async (displayName: string) =>
    (await request.post(`${api}/players`, { data: { displayName, email: `${displayName}-${run}@example.test` } })).json();
  const arne = await createPlayer('Arne');
  const harald = await createPlayer('Harald');
  const created = await (
    await request.post(`${api}/games`, {
      headers: { 'X-Device-Credential': arne.deviceCredential },
      data: { friendEmail: `harald-${run}@example.test` },
    })
  ).json();
  await request.post(`${api}/invitations/redeem`, {
    headers: { 'X-Device-Credential': harald.deviceCredential },
    data: { token: created.invitation.token },
  });

  // Arne has the game open in two tabs of the same browser.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
  await context.addInitScript((identity) => {
    localStorage.setItem('friendlygames.identity', JSON.stringify(identity));
  }, { playerId: arne.player.id, displayName: 'Arne', credential: arne.deviceCredential });
  const [first, second] = [await context.newPage(), await context.newPage()];
  for (const page of [first, second]) {
    await page.goto(`/#/game/${created.game.id}`);
    await expect(page.getByRole('status')).toHaveText('Your move');
  }

  // The second tab stops hearing from the server, so it still thinks it is Arne's move.
  await second.route('**/game-api/games/*', (route) =>
    route.request().method() === 'GET' ? route.abort() : route.continue(),
  );
  await move(first, 'e2', 'e4');
  await expect(first.getByRole('status')).toHaveText('Harald’s move');

  await move(second, 'd2', 'd4');
  await expect(second.getByText('The game changed before your move was saved. Here’s the latest position.')).toBeVisible();
  await expect(square(second, 'e4')).toHaveAccessibleName('e4, white pawn');
  await expect(square(second, 'd4')).toHaveAccessibleName('d4, empty');
  await expect(second.getByRole('status')).toHaveText('Harald’s move');

  await context.close();
});

test('the creator can make a new invitation link from a device without one', async ({ browser, request }, testInfo) => {
  const api = process.env.FG_API_URL ?? 'http://localhost:56321/functions/v1/game-api';
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await (
    await request.post(`${api}/players`, { data: { displayName: 'Arne', email: `arne-${run}@example.test` } })
  ).json();
  // A game exists, but its link never reached this browser.
  const created = await (
    await request.post(`${api}/games`, {
      headers: { 'X-Device-Credential': arne.deviceCredential },
      data: { friendEmail: `harald-${run}@example.test` },
    })
  ).json();

  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const options: BrowserContextOptions = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL };
  const arneContext = await browser.newContext(options);
  await arneContext.addInitScript((identity) => {
    localStorage.setItem('friendlygames.identity', JSON.stringify(identity));
  }, { playerId: arne.player.id, displayName: 'Arne', credential: arne.deviceCredential });
  const page = await arneContext.newPage();
  await page.goto(`/#/game/${created.game.id}`);
  await page.getByRole('button', { name: 'Make a new invitation link' }).click();
  const link = await page.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).not.toContain(created.invitation.token);

  const haraldContext = await browser.newContext(options);
  const harald = await haraldContext.newPage();
  await harald.goto(link);
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await expect(harald.getByRole('status')).toHaveText('Arne’s move');
  await expect(page.getByRole('status')).toHaveText('Your move', SYNC);

  await arneContext.close();
  await haraldContext.close();
});

test('finished games become shared history: checkmate, resignation, review and play again', async ({ browser }, testInfo) => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const options: BrowserContextOptions = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL };
  const arneContext = await browser.newContext(options);
  const haraldContext = await browser.newContext(options);
  const arne = await arneContext.newPage();
  const harald = await haraldContext.newPage();
  const run = `${Date.now()}-${testInfo.project.name}`;

  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  await arne.getByRole('link', { name: 'Go to the table' }).click();
  await harald.goto(link);
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);

  // Game 1: Harald mates Arne.
  await move(arne, 'f2', 'f3');
  await expect(harald.getByRole('status')).toHaveText('Your move', SYNC);
  await move(harald, 'e7', 'e5');
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);
  await move(arne, 'g2', 'g4');
  await expect(harald.getByRole('status')).toHaveText('Your move', SYNC);
  await move(harald, 'd8', 'h4');
  await expect(harald.getByRole('status')).toHaveText('Checkmate. You win');
  await expect(arne.getByRole('status')).toHaveText('Checkmate. Harald wins', SYNC);
  const firstGame = arne.url();

  // Arne asks to play again; Harald is offered the same new game, now as White.
  await arne.getByRole('button', { name: 'Play again (you take Black)' }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(harald.getByRole('link', { name: 'Go to the rematch' })).toBeVisible(SYNC);
  await harald.getByRole('link', { name: 'Go to the rematch' }).click();
  expect(harald.url()).toBe(arne.url());
  await expect(harald.getByRole('status')).toHaveText('Your move');

  // Game 2: Harald opens and then resigns.
  await move(harald, 'e2', 'e4');
  await expect(harald.getByRole('status')).toHaveText('Arne’s move');
  await harald.getByRole('button', { name: 'Resign…' }).click();
  await harald.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald resigned. You win', SYNC);

  // After a refresh, both histories show both games and an exact tally.
  for (const [page, opponent] of [[arne, 'Harald'], [harald, 'Arne']] as const) {
    await page.goto('/');
    await page.reload();
    const tally = page.getByLabel(`Tally with ${opponent}`);
    await expect(tally).toContainText('You1');
    await expect(tally).toContainText('Draws0');
    await expect(tally).toContainText(`${opponent}1`);
    const games = page.getByRole('list', { name: `Finished games with ${opponent}` }).getByRole('link');
    await expect(games).toHaveCount(2);
  }
  const arneGames = arne.getByRole('list', { name: 'Finished games with Harald' }).getByRole('link');
  await expect(arneGames.nth(0)).toContainText('You won by resignation · 1 moves');
  await expect(arneGames.nth(1)).toContainText('Harald won by checkmate · 4 moves');

  // Reopen the first game: read-only, unchanged, and every position can be inspected.
  await arneGames.nth(1).click();
  expect(arne.url()).toBe(firstGame);
  await expect(arne.getByRole('status')).toHaveText('Checkmate. Harald wins');
  await expect(arne.getByRole('list', { name: 'Moves' })).toHaveText(/1\.f3e52\.g4Qh4#/);
  await expect(arne.getByRole('link', { name: 'Go to the rematch' })).toBeVisible();
  await arne.getByRole('button', { name: 'Previous move' }).click();
  await expect(square(arne, 'h4')).toHaveAccessibleName('h4, empty');
  await arne.getByRole('button', { name: 'Move 1, White: f3' }).click();
  await expect(square(arne, 'f3')).toHaveAccessibleName('f3, white pawn');
  await expect(square(arne, 'e5')).toHaveAccessibleName('e5, empty');
  await square(arne, 'e2').click();
  await expect(square(arne, 'e2')).toHaveAccessibleName('e2, white pawn'); // nothing selectable

  await arneContext.close();
  await haraldContext.close();
});
