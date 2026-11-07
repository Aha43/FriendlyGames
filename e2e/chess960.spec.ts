// Fischer Random next to chess (#55), two players in independent browsers against the real backend.
// The server draws the start; e2e/chess960Setup.ts plans ordinary moves (proven for all 960 starts)
// after which White may castle, and the castle itself is made through the real controls.
import type { Page } from '@playwright/test';
import { planCastle } from './chess960Setup';
import { expect, LOAD_BUDGET, openLobby, openTable, test } from './fixtures';

const SYNC = { timeout: LOAD_BUDGET };
const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function onboard(page: Page, name: string, email: string) {
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create my player' }).click();
}

test('Fischer Random: create, join, castle through the controls, recover a lost castle, finish, review and rematch', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await (await openContext('arne')).newPage();
  const harald = await (await openContext('harald')).newPage();

  // Arne chooses Fischer Random in the usual creation flow; a chess game with Harald exists too.
  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByRole('radio', { name: 'Fischer Random (Chess960)' }).check();
  await expect(arne.getByText(/one of 960 arrangements/)).toBeVisible();
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  await expect(arne.getByText('Your Fischer Random game is ready. You play White.')).toBeVisible();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  const identity = JSON.parse((await arne.evaluate(() => localStorage.getItem('friendlygames.identity')))!);
  await api('POST', '/games?types=chess', {
    credential: identity.credential,
    data: { friendEmail: `harald-${run}@example.test`, type: 'chess' },
    expect: 201,
  });

  // Harald joins from the link on his own device, as Black.
  await harald.goto(link);
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await openTable(harald);
  await expect(harald.getByRole('region', { name: 'Fischer Random: you vs Arne' })).toBeVisible();
  const gameId = harald.url().split('/game/')[1];
  const haraldIdentity = JSON.parse((await harald.evaluate(() => localStorage.getItem('friendlygames.identity')))!);

  // Both devices show the same saved start (never shuffled in a browser).
  const { game } = await api('GET', `/games/${gameId}?types=chess,chess960`, { credential: identity.credential, expect: 200 });
  expect(game.type).toBe('chess960');
  const { moves, castles } = planCastle(game.chess960.initialFen);

  // Mixed lobby: both games labelled.
  await openLobby(arne);
  const inProgress = arne.getByRole('list', { name: 'Games in progress' });
  await expect(inProgress.getByRole('link')).toHaveCount(2);
  await expect(inProgress).toContainText('Fischer Random · You play White');
  await expect(inProgress).toContainText('Chess · You play White');

  // Ordinary setup moves through the API until White may castle.
  let revision = game.revision;
  for (const [i, { from, to }] of moves.entries()) {
    const result = await api('POST', `/games/${gameId}/actions?types=chess960`, {
      credential: i % 2 === 0 ? identity.credential : haraldIdentity.credential,
      data: { requestId: crypto.randomUUID(), expectedRevision: revision, action: { type: 'move', from, to } },
      expect: 200,
    });
    revision = result.game.revision;
  }
  const castle = castles[0];
  const label = `Castle ${castle.side}: king to ${castle.king.to}, rook to ${castle.rook.to}`;

  await openTable(arne, `/#/game/${gameId}`);
  await expect(arne.getByRole('status')).toHaveText('Your move');
  await expect(square(arne, castle.king.from)).toHaveAccessibleName(`${castle.king.from}, white king`);

  // The castle is saved, but its answer is lost (reads too, so polling can't settle it first).
  await arne.route('**/game-api/games/*/actions?*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('connectionreset');
  });
  await arne.route('**/game-api/games/*', (route) =>
    route.request().method() === 'GET' ? route.abort('connectionreset') : route.fallback(),
  );
  await square(arne, castle.king.from).click();
  await arne.getByRole('button', { name: label }).click();
  await expect(arne.getByText(/Couldn’t confirm whether your move was saved/)).toBeVisible();
  await expect(square(arne, castle.king.from)).toHaveAccessibleName(`${castle.king.from}, white king`);
  await arne.unroute('**/game-api/games/*/actions?*');
  await arne.getByRole('button', { name: 'Retry' }).click();
  await arne.unroute('**/game-api/games/*');

  // Saved once: king and rook on their castled squares on both devices, Black's board too.
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  for (const page of [arne, harald]) {
    await expect(square(page, castle.king.to)).toHaveAccessibleName(`${castle.king.to}, white king`, SYNC);
    await expect(square(page, castle.rook.to)).toHaveAccessibleName(`${castle.rook.to}, white rook`, SYNC);
  }
  const castled = (await api('GET', `/games/${gameId}?types=chess960`, { credential: identity.credential, expect: 200 })).game;
  expect(castled.chess960.moves).toHaveLength(moves.length + 1);
  expect(castled.chess960.moves.at(-1)).toBe(castle.uci);
  await expect(harald.getByRole('list', { name: 'Moves' }).getByText(castle.side === 'kingside' ? 'O-O' : 'O-O-O', { exact: true })).toHaveCount(1);

  // A refreshed browser shows the same position.
  await harald.reload();
  await openTable(harald);
  await expect(square(harald, castle.king.to)).toHaveAccessibleName(`${castle.king.to}, white king`);

  // Harald resigns; Arne reviews the game from its own start.
  await harald.getByRole('button', { name: 'Resign…' }).click();
  await harald.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald resigned. You win', SYNC);
  await arne.getByRole('button', { name: 'Start position' }).click();
  await expect(square(arne, castle.king.from)).toHaveAccessibleName(`${castle.king.from}, white king`);
  await expect(square(arne, castle.rook.from)).toHaveAccessibleName(`${castle.rook.from}, white rook`);

  // Same-type rematch: a fresh Fischer Random game, colours swapped, empty capture trays.
  await arne.getByRole('button', { name: 'Play again, new start (you take Black)' }).click();
  await openTable(arne);
  await expect(arne.getByRole('region', { name: 'Fischer Random: you vs Harald' })).toBeVisible();
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(arne.getByText('None yet')).toHaveCount(2);

  // History keeps Fischer Random apart from chess.
  await openLobby(arne);
  await expect(arne.getByRole('heading', { name: 'Fischer Random with Harald' })).toBeVisible();
  await expect(arne.getByLabel('Fischer Random tally with Harald')).toContainText('1');
});

test('local Fischer Random keeps its own saved game next to local chess', async ({ page }) => {
  await page.goto('/#/local');
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await page.getByRole('link', { name: 'Fischer Random', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Fischer Random: White vs Black' })).toBeVisible();
  await square(page, 'a2').click();
  await square(page, 'a3').click();
  await page.reload();
  await expect(square(page, 'a3')).toHaveAccessibleName('a3, white pawn');
  await page.getByRole('link', { name: 'Chess', exact: true }).click();
  await expect(square(page, 'e4')).toHaveAccessibleName('e4, white pawn');
  await expect(square(page, 'a3')).toHaveAccessibleName('a3, empty');
});
