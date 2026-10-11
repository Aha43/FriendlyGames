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
