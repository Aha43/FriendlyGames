// Player details and the invited email (#113): independent browsers against the real backend,
// with throwaway players only. A player's email is shown to that player alone; the email typed
// into a game invitation is shown to the game's creator alone, while nobody has joined.
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect, openLobby, openTable, test, uniqueName } from './fixtures';

const ALL = '?types=chess,chess960,yatzy';
type Api = (method: 'GET' | 'POST' | 'DELETE', path: string, options?: { credential?: string; data?: unknown; expect?: number }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Identity = { playerId: string; displayName: string; credential: string };
type OpenContext = (who: string, identity?: Identity) => Promise<BrowserContext>;
interface Player {
  name: string;
  email: string;
  identity: Identity;
  page: Page;
}

/** A player made through the API and signed in to their own browser context. */
async function player(api: Api, openContext: OpenContext, who: string, base: string, run: string, displayName = uniqueName(base)): Promise<Player> {
  const email = `${base.toLowerCase()}-${run}@example.test`;
  const entered = await api('POST', '/players', { data: { email, displayName }, expect: 201 });
  const identity = { playerId: entered.player.id, displayName, credential: entered.deviceCredential };
  return { name: displayName, email, identity, page: await (await openContext(who, identity)).newPage() };
}

const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
/** The dialog's card lies wholly inside the window, and nothing in it is cut off sideways. */
async function cardFits(page: Page) {
  const card = page.locator('.details-card');
  const box = (await card.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}

test('details: your own with your email by keyboard, a friend’s and a co-player’s by tap, and never someone else’s email', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const touch = testInfo.project.name === 'phone';
  const press = (target: Locator) => (touch ? target.tap() : target.click());
  // 40 characters with nothing to break at, on the narrowest phone.
  const LONG = `Wilbursjefesen${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 40);
  const arne = await player(api, openContext, 'arne', 'Arne', run, LONG);
  const friend = await player(api, openContext, 'friend', 'Friend', run);
  const played = await player(api, openContext, 'played', 'Played', run);
  await arne.page.setViewportSize({ width: 320, height: 700 });

  // Friend is connected by invitation and has no game with Arne; Played shares one game and no invitation.
  const link = await api('POST', '/friend-invitations', { credential: arne.identity.credential, data: { requestId: crypto.randomUUID() }, expect: 201 });
  await api('POST', '/friend-invitations/accept', { credential: friend.identity.credential, data: { token: link.invitation.token }, expect: 200 });
  const game = await api('POST', `/games${ALL}`, { credential: arne.identity.credential, data: { friendEmail: played.email }, expect: 201 });
  await api('POST', `/invitations/redeem${ALL}`, { credential: played.identity.credential, data: { token: game.invitation.token }, expect: 200 });

  // Arne's own details, with the keyboard only.
  await openLobby(arne.page);
  await expect(arne.page.getByText(arne.email)).toHaveCount(0);
  const mine = arne.page.getByRole('button', { name: `Your details, ${LONG}` });
  await mine.focus();
  await arne.page.keyboard.press('Enter');
  const dialog = arne.page.getByRole('dialog', { name: LONG });
  await expect(dialog.getByText(arne.email)).toBeVisible();
  await expect(dialog.getByText('Only you see your email.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await cardFits(arne.page);
  await fits(arne.page);
  // Tab has nowhere else to go; the page behind cannot be reached.
  await arne.page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await arne.page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await arne.page.keyboard.press('Escape');
  await expect(arne.page.getByRole('dialog')).toHaveCount(0);
  await expect(mine).toBeFocused();
  await expect(arne.page.getByText(arne.email)).toHaveCount(0);

  // A friend by invitation, and someone played with: name and what the two share. No email.
  const picker = arne.page.getByRole('group', { name: 'Play with' });
  await press(picker.getByRole('button', { name: `Details about ${friend.name}` }));
  const theirs = arne.page.getByRole('dialog', { name: friend.name });
  await expect(theirs.getByText(/^By invitation, since \d{1,2} \w{3} \d{4}$/)).toBeVisible();
  await expect(theirs.getByText('None yet')).toBeVisible();
  await expect(theirs).not.toContainText('@');
  await cardFits(arne.page);
  await press(theirs.getByRole('button', { name: 'Close' }));
  await expect(arne.page.getByRole('dialog')).toHaveCount(0);
  await expect(picker.getByRole('radio', { name: friend.name, exact: true })).not.toBeChecked(); // looking is not choosing

  const details = picker.getByRole('button', { name: `Details about ${played.name}` });
  await details.focus();
  await arne.page.keyboard.press('Enter');
  const coPlayer = arne.page.getByRole('dialog', { name: played.name });
  await expect(coPlayer.getByText(/^1, the latest active \d{1,2} \w{3} \d{4}$/)).toBeVisible();
  await expect(coPlayer.getByText('Connected')).toHaveCount(0);
  await expect(coPlayer).not.toContainText('@');
  // A tap beside the card closes it and focus returns to where it came from.
  await arne.page.mouse.click(5, 5);
  await expect(arne.page.getByRole('dialog')).toHaveCount(0);
  await expect(details).toBeFocused();

  // The other side: Arne's 40-character name at 320px, their own email only, and none of Arne's.
  await friend.page.setViewportSize({ width: 320, height: 700 });
  await openLobby(friend.page);
  await press(friend.page.getByRole('group', { name: 'Play with' }).getByRole('button', { name: `Details about ${LONG}` }));
  const aboutArne = friend.page.getByRole('dialog', { name: LONG });
  await expect(aboutArne.getByText(/^By invitation, since/)).toBeVisible();
  await expect(aboutArne).not.toContainText('@');
  await cardFits(friend.page);
  await fits(friend.page);
  await friend.page.keyboard.press('Escape');
  await press(friend.page.getByRole('button', { name: `Your details, ${friend.name}` }));
  await expect(friend.page.getByRole('dialog', { name: friend.name }).getByText(friend.email)).toBeVisible();
  await expect(friend.page.getByText(arne.email)).toHaveCount(0);

  // In Yatzy the seat list offers the same, and opening details seats nobody.
  await press(arne.page.getByRole('radio', { name: 'Yatzy' }));
  const seats = arne.page.getByRole('group', { name: /^Players/ });
  await press(seats.getByRole('button', { name: `Details about ${friend.name}` }));
  await expect(arne.page.getByRole('dialog', { name: friend.name }).getByText('None yet')).toBeVisible();
  await arne.page.keyboard.press('Escape');
  await expect(seats.getByRole('checkbox', { name: friend.name, exact: true })).not.toBeChecked();
  await fits(arne.page);
});

test('who you invited: shown to the creator on the waiting game, on any of their devices, and to nobody else', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await player(api, openContext, 'arne', 'Arne', run);
  const harald = await player(api, openContext, 'harald', 'Harald', run);
  const outsider = await player(api, openContext, 'outsider', 'Outsider', run);
  // A long address with nothing to break at, on the narrowest phone.
  const invited = `harald.with.a.very.long.address.and.no.breaks-${run}@example.test`.toLowerCase();
  await arne.page.setViewportSize({ width: 320, height: 700 });

  // Arne invites by email, in the site (knowing nobody yet, the email field is all there is).
  await openLobby(arne.page);
  await arne.page.getByLabel('Friend’s email').fill(invited);
  await arne.page.getByRole('button', { name: 'Create game' }).click();
  await expect(arne.page.getByText('Your Chess game is ready. You play White.')).toBeVisible();
  const link = await arne.page.getByLabel('Invitation link', { exact: true }).inputValue();
  const games = (await api('GET', `/games${ALL}`, { credential: arne.identity.credential, expect: 200 })).games as { id: string }[];
  expect(games).toHaveLength(1);
  const gameId = games[0].id;

  // Another device of Arne's knows nothing typed here, and shows who was invited: in the list…
  const tablet = await (await openContext('arne-tablet', arne.identity)).newPage();
  await tablet.setViewportSize({ width: 320, height: 700 });
  await openLobby(tablet);
  const waiting = tablet.getByRole('list', { name: 'Games in progress' }).getByRole('listitem');
  await expect(waiting).toHaveCount(1);
  await expect(waiting.locator('.invited-email')).toHaveText(`You invited ${invited}. Only you see this.`);
  await fits(tablet);
  expect(await waiting.locator('.invited-email').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // …and on the game's own page, without the address or storage ever holding it.
  await openTable(tablet, `/#/game/${gameId}`);
  await expect(tablet.locator('.invited-email')).toHaveText(`You invited ${invited}. Only you see this.`);
  await fits(tablet);
  expect(tablet.url()).not.toContain('@');
  expect(await tablet.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(invited);

  // Nobody else gets it from the server: not an outsider, not someone who is not signed in.
  await api('GET', `/games/${gameId}/invitation${ALL}`, { credential: outsider.identity.credential, expect: 404 });
  await api('GET', `/games/${gameId}/invitation${ALL}`, { expect: 401 });
  // The link's holder sees who invites and the game, never the address it was sent to.
  await harald.page.setViewportSize({ width: 320, height: 700 });
  await harald.page.goto(link);
  await openTable(harald.page);
  await expect(harald.page.getByText(/You invited|Only you see this/)).toHaveCount(0);
  await expect(harald.page.locator('body')).not.toContainText(invited);
  await api('GET', `/games/${gameId}/invitation${ALL}`, { credential: harald.identity.credential, expect: 403 });
  await openLobby(harald.page);
  await expect(harald.page.getByRole('list', { name: 'Games in progress' }).getByRole('listitem')).toHaveCount(1);
  await expect(harald.page.locator('body')).not.toContainText(invited);

  // Once someone has joined there is no invitation left to show, on either of Arne's devices.
  await api('GET', `/games/${gameId}/invitation${ALL}`, { credential: arne.identity.credential, expect: 409 });
  for (const page of [arne.page, tablet]) {
    await openLobby(page);
    await expect(page.getByRole('list', { name: 'Games in progress' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText(/You invited/)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(invited);
  }
});
