// Starting games with someone already played (#73): pick them by name, no email or invitation.
// Two players in independent browsers against the real backend; the first game uses the usual
// email invitation, every later one only the picker.
import type { Page } from '@playwright/test';
import { expect, LOAD_BUDGET, openLobby, openTable, test, uniqueName } from './fixtures';

const SYNC = { timeout: LOAD_BUDGET };
const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

async function onboard(page: Page, name: string, email: string) {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create my player' }).click();
}

test('play again by name: both game types, no email, a lost reply retried into one game', async ({ openContext, api }, testInfo) => {
  const ARNE = uniqueName('Arne'), HARALD = uniqueName('Harald');
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await (await openContext('arne')).newPage();
  const harald = await (await openContext('harald')).newPage();

  // First game the usual way: Arne invites Harald by email and Harald joins. Nobody to pick yet.
  await arne.goto('/');
  await onboard(arne, ARNE, `arne-${run}@example.test`);
  await expect(arne.getByText('Looking for people you’ve played with…')).toBeHidden();
  await expect(arne.getByRole('group', { name: 'Play with' })).toHaveCount(0);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  await harald.goto(link);
  await onboard(harald, HARALD, `harald-${run}@example.test`);
  await openTable(harald);
  const identity = JSON.parse((await arne.evaluate(() => localStorage.getItem('friendlygames.identity')))!);

  // That game is still going. Back in the lobby Arne finds Harald by name, nobody chosen.
  await openLobby(arne);
  const picker = arne.getByRole('group', { name: 'Play with' });
  const haraldOption = picker.getByRole('radio', { name: HARALD, exact: true });
  await expect(haraldOption).not.toBeChecked();
  await expect(haraldOption).toHaveAccessibleDescription(/^1 game together · Last shared game /);
  await expect(arne.getByRole('button', { name: 'Start game' })).toBeDisabled();
  await expect(arne.getByLabel('Friend’s email')).toHaveCount(0);

  // Chess (the default) with Harald: one action opens the table, Arne White, Harald Black.
  await haraldOption.check();
  await expect(arne.getByText(`You play White. ${HARALD} plays Black`)).toBeVisible();
  await arne.getByRole('button', { name: 'Start game' }).click();
  await openTable(arne);
  await expect(arne.getByRole('region', { name: `Chess: you vs ${HARALD}` })).toBeVisible();
  await expect(arne.getByRole('status')).toHaveText('Your move');
  await expect(arne.getByLabel('Invitation link')).toHaveCount(0);
  const chessId = arne.url().split('/game/')[1];
  await move(arne, 'e2', 'e4');
  await expect(arne.getByRole('status')).toHaveText(`${HARALD}’s move`);

  // Harald sees it in his lobby without redeeming anything, and plays it.
  await openLobby(harald);
  const haraldGames = harald.getByRole('list', { name: 'Games in progress' });
  await expect(haraldGames.getByRole('link')).toHaveCount(2);
  await haraldGames.locator(`a[href="#/game/${chessId}"]`).click();
  await openTable(harald);
  await expect(harald.getByRole('region', { name: `Chess: you vs ${ARNE}` })).toBeVisible();
  await expect(harald.getByRole('status')).toHaveText('Your move', SYNC);
  await move(harald, 'e7', 'e5');
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);
  await expect(square(arne, 'e5')).toHaveAccessibleName('e5, black pawn');

  // Fischer Random with Harald after a refresh. The game is created but the reply is lost;
  // trying again with the same choice opens that one game.
  await openLobby(arne);
  await arne.reload();
  await expect(arne.getByText('Looking for your games…')).toBeHidden();
  await arne.getByRole('radio', { name: 'Fischer Random (Chess960)' }).check();
  await expect(picker.getByRole('radio', { name: HARALD, exact: true })).toHaveAccessibleDescription(/^2 games together/);
  await picker.getByRole('radio', { name: HARALD, exact: true }).check();
  await arne.route('**/game-api/games?*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch(); // committed on the server
    await route.abort('connectionreset'); // the answer never arrives, nor do automatic repeats
  });
  await arne.getByRole('button', { name: 'Start game' }).click();
  await expect(arne.getByText(/Couldn’t confirm whether the game was created/)).toBeVisible();
  await arne.unroute('**/game-api/games?*');
  await arne.getByRole('button', { name: 'Try again' }).click();
  await openTable(arne);
  await expect(arne.getByRole('region', { name: `Fischer Random: you vs ${HARALD}` })).toBeVisible();
  await expect(arne.getByRole('status')).toHaveText('Your move');

  // Exactly one Fischer Random game was made; three games in progress between them.
  const { games } = await api('GET', '/games?types=chess,chess960', { credential: identity.credential, expect: 200 });
  expect(games.filter((g: { type: string }) => g.type === 'chess960')).toHaveLength(1);
  expect(games.filter((g: { status: string }) => g.status !== 'finished')).toHaveLength(3);

  // Harald sees it labelled and gets Black.
  await openLobby(harald);
  await expect(haraldGames.getByRole('link')).toHaveCount(3, SYNC);
  await expect(haraldGames).toContainText('Fischer Random · You play Black');
});

test('Invite someone new stays available next to known names', async ({ openContext, api }, testInfo) => {
  const ARNE = uniqueName('Arne'), HARALD = uniqueName('Harald');
  const run = `${Date.now()}-${testInfo.project.name}`;
  const page = await (await openContext('arne')).newPage();
  await page.goto('/');
  await onboard(page, ARNE, `arne-${run}@example.test`);
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  const identity = JSON.parse((await page.evaluate(() => localStorage.getItem('friendlygames.identity')))!);

  // A seated game with Harald, set up through the API.
  const { invitation } = await api('POST', '/games?types=chess', {
    credential: identity.credential,
    data: { friendEmail: `harald-${run}@example.test`, type: 'chess' },
    expect: 201,
  });
  const harald = await api('POST', '/players', { data: { email: `harald-${run}@example.test`, displayName: HARALD }, expect: 201 });
  await api('POST', '/invitations/redeem?types=chess', { credential: harald.deviceCredential, data: { token: invitation.token }, expect: 200 });

  await openLobby(page);
  await expect(page.getByRole('radio', { name: HARALD, exact: true })).not.toBeChecked();
  await page.getByRole('radio', { name: 'Invite someone new' }).check();
  await page.getByLabel('Friend’s email').fill(`someone-${run}@example.test`);
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('Your Chess game is ready. You play White.')).toBeVisible();
  await expect(page.getByLabel('Invitation link', { exact: true })).toHaveValue(/#\/join\/[A-Za-z0-9_-]{43}$/);
});
