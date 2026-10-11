import { expect, test, type Page } from '@playwright/test';

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

test('play a local game, refresh, and start over', async ({ page }) => {
  await page.goto('/');
  const status = page.getByRole('status');
  await expect(status).toHaveText('Arne to move');

  // The board is fully visible and the page never scrolls sideways.
  const box = (await page.getByRole('grid', { name: 'Chess board' }).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

  await move(page, 'e2', 'e4');
  await move(page, 'e7', 'e5');
  await move(page, 'd1', 'h5');
  await move(page, 'b8', 'c6');
  await move(page, 'f1', 'c4');
  await move(page, 'g8', 'f6');

  // An illegal move is refused.
  await move(page, 'h5', 'h8');
  await expect(page.getByText('That move isn’t allowed.')).toBeVisible();

  await move(page, 'h5', 'f7');
  await expect(status).toHaveText('Checkmate. Arne wins');

  await page.reload();
  await expect(status).toHaveText('Checkmate. Arne wins');
  await expect(square(page, 'f7')).toHaveAccessibleName('f7, white queen');
  await expect(page.getByRole('list', { name: 'Moves' })).toContainText('Qxf7#');

  await page.getByRole('button', { name: 'New game' }).click();
  await expect(status).toHaveText('Arne to move');
  await expect(square(page, 'e2')).toHaveAccessibleName('e2, white pawn');
});

test('promotion dialog holds keyboard focus and hands it back to the board', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'friendlygames.localChess',
      JSON.stringify({ schemaVersion: 1, initialFen: '8/P6k/8/3p4/8/8/6K1/8 w - - 0 1', moves: [] }),
    ),
  );
  await page.reload();

  await square(page, 'a7').click();
  await square(page, 'a8').click();
  const dialog = page.getByRole('dialog', { name: 'Promote pawn to' });
  await expect(dialog.getByRole('button', { name: 'Queen' })).toBeFocused();

  // Tab cycles through the five buttons and stays inside, both ways.
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }

  // Clicking the page behind does not reach it, and Tab still stays in the dialog.
  await page.getByRole('heading', { name: 'Chess history' }).click({ force: true });
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('button', { name: 'New game' })).not.toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(square(page, 'a7')).toBeFocused();

  // Promote from the keyboard and keep playing.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(square(page, 'a8')).toHaveAccessibleName('a8, white queen');
  await expect(square(page, 'a8')).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Harald to move');
});
