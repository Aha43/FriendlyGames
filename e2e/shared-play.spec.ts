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

test('two players create, join, play, refresh, recover from a failed send and resign', async ({ browser }, testInfo) => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use;
  const options: BrowserContextOptions = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL };
  const arneContext = await browser.newContext(options);
  const haraldContext = await browser.newContext(options);
  const arne = await arneContext.newPage();
  const harald = await haraldContext.newPage();
  const run = `${Date.now()}-${testInfo.project.name}`;

  // Arne arrives, introduces himself and invites Harald.
  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).toMatch(/#\/join\/[A-Za-z0-9_-]{43}$/);
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

  // Arne's move fails to send: nothing is claimed as saved, and Retry delivers it once.
  await arne.route('**/game-api/games/*/actions', (route) => route.abort('internetdisconnected'));
  await move(arne, 'g1', 'f3');
  await expect(arne.getByText('Your move hasn’t been saved: the game server couldn’t be reached.')).toBeVisible();
  await expect(square(arne, 'g1')).toHaveAccessibleName('g1, white knight');
  await expect(square(arne, 'f3')).toHaveAccessibleName('f3, empty');
  await arne.unroute('**/game-api/games/*/actions');
  await arne.getByRole('button', { name: 'Retry' }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(square(harald, 'f3')).toHaveAccessibleName('f3, white knight', SYNC);
  await expect(harald.getByRole('list', { name: 'Moves' })).toContainText('Nf3');

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
