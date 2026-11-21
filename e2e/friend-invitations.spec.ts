// Inviting a friend before choosing a game (#111): independent browsers against the real backend,
// with throwaway players only. A link connects one friend; no game is made by accepting it.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, openLobby, openTable, test, uniqueName } from './fixtures';

const ALL = '?types=chess,chess960,yatzy';
type Api = (method: 'GET' | 'POST' | 'DELETE', path: string, options?: { credential?: string; data?: unknown; expect?: number }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Friend {
  name: string;
  id: string;
  credential: string;
  page: Page;
}
type OpenContext = (who: string, identity?: { playerId: string; displayName: string; credential: string }) => Promise<BrowserContext>;

/** A player made through the API and signed in to their own browser context. */
async function player(api: Api, openContext: OpenContext, who: string, base: string, run: string, displayName = uniqueName(base)): Promise<Friend> {
  const entered = await api('POST', '/players', { data: { email: `${base.toLowerCase()}-${run}@example.test`, displayName }, expect: 201 });
  const identity = { playerId: entered.player.id, displayName, credential: entered.deviceCredential };
  const context = await openContext(who, identity);
  return { name: displayName, id: entered.player.id, credential: entered.deviceCredential, page: await context.newPage() };
}

const card = (page: Page) => page.getByRole('region', { name: 'Invite a friend' });
const linkField = (page: Page) => card(page).getByRole('textbox', { name: 'Invitation link' });
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
const pendingCount = async (api: Api, who: Friend) => (await api('GET', '/friend-invitations', { credential: who.credential, expect: 200 })).invitations.length as number;
const friendsOf = async (api: Api, who: Friend) =>
  ((await api('GET', '/opponents?friends=1', { credential: who.credential, expect: 200 })).opponents as { id: string }[]).map((o) => o.id);
/** Every answer to a matching POST is lost after the server has done the work; automatic repeats too. */
const loseAnswers = (page: Page, glob: string) =>
  page.route(glob, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fetch();
    await route.abort('connectionreset');
  });

test('a new friend: a link made by keyboard, the inviter shown before onboarding, explicit acceptance, and both in Play with without a game', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  // 40 characters with nothing to break at: the invitation page names the inviter.
  const LONG = `Wilbursjefesen${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 40);
  const arne = await player(api, openContext, 'arne', 'Arne', run, LONG);
  const HARALD = uniqueName('Harald');

  // Arne makes a link without choosing a game or typing an email, using the keyboard only.
  await openLobby(arne.page);
  await expect(card(arne.page).getByText(/One link is for one friend and works for 30 days\./)).toBeVisible();
  await expect(card(arne.page).getByRole('textbox')).toHaveCount(0);
  const create = card(arne.page).getByRole('button', { name: 'Create an invitation link' });
  await create.focus();
  await arne.page.keyboard.press('Enter');
  await expect(linkField(arne.page)).toBeVisible();
  const link = await linkField(arne.page).inputValue();
  expect(link).toMatch(/#\/friend\/[A-Za-z0-9_-]{43}$/);
  await expect(card(arne.page).getByText(/It is shown only now:/)).toBeVisible();
  await expect(card(arne.page).getByRole('list', { name: 'Waiting to be accepted (1 of 20)' }).getByRole('listitem')).toHaveCount(1);
  await fits(arne.page);
  // The field selects itself on focus, for copying by hand.
  await linkField(arne.page).focus();
  expect(await linkField(arne.page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.readOnly])).toEqual([0, link.length, true]);
  // Nothing was created but the invitation.
  expect((await api('GET', `/games${ALL}`, { credential: arne.credential, expect: 200 })).games).toEqual([]);

  // A browser that has never been here opens the link: who invites comes first.
  const harald = await (await openContext('harald')).newPage();
  await harald.setViewportSize({ width: 320, height: 800 }); // the narrowest phone, with the 40-character name
  await harald.goto(link);
  await expect(harald.getByRole('heading', { name: `${LONG} invites you to play` })).toBeVisible();
  await expect(harald.getByText(/Accepting doesn’t start a game\./)).toBeVisible();
  await expect(harald.getByRole('button', { name: /Accept/ })).toHaveCount(0);
  await fits(harald);
  // Onboarding as usual.
  await expect(harald.getByRole('heading', { name: 'First, who are you?' })).toBeVisible();
  await harald.getByLabel('Your email').fill(`harald-${run}@example.test`);
  await harald.getByRole('button', { name: 'Continue' }).click();
  await harald.getByLabel('Your name').fill(HARALD);
  await harald.getByRole('button', { name: 'Create my player' }).click();

  // Still nothing accepted: the page waits for the click, also across a reload.
  const accept = harald.getByRole('button', { name: `Accept and connect with ${LONG}` });
  await expect(accept).toBeVisible();
  await expect(harald.getByText(`You’re accepting as ${HARALD}.`)).toBeVisible();
  expect(await friendsOf(api, arne)).toEqual([]);
  await harald.reload();
  await expect(accept).toBeVisible();
  expect(await friendsOf(api, arne)).toEqual([]);
  await fits(harald);

  // Accept by keyboard.
  await accept.focus();
  await harald.keyboard.press('Enter');
  await expect(harald.getByRole('heading', { name: `You and ${LONG} are connected` })).toBeVisible();
  await expect(harald.getByRole('status')).toContainText('No game has been started');
  await fits(harald);
  // A reload right after accepting shows the same, not an error.
  await harald.reload();
  await expect(harald.getByRole('heading', { name: `You and ${LONG} are connected` })).toBeVisible();
  await expect(harald.getByRole('status')).toContainText('You’ve already accepted this invitation.');

  // To the lobby: said once, the link gone from the address, the friend in Play with, no game.
  await harald.getByRole('button', { name: 'Go to your games' }).click();
  await expect(harald.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(harald.getByText(`You and ${LONG} are connected. Find them under Play with.`)).toBeVisible();
  expect(harald.url()).not.toContain('friend');
  const haraldPicker = harald.getByRole('group', { name: 'Play with' });
  await expect(haraldPicker.getByRole('radio', { name: LONG, exact: true })).toBeVisible();
  await expect(haraldPicker.locator('.opponent-option', { hasText: LONG })).toContainText('No games together yet');
  await expect(harald.getByText('No games in progress. Start one below.')).toBeVisible();
  await fits(harald);
  for (const who of [arne.credential]) expect((await api('GET', `/games${ALL}`, { credential: who, expect: 200 })).games).toEqual([]);

  // Arne's side after a refresh: nothing waiting any more, Harald in Play with.
  await openLobby(arne.page);
  await expect(card(arne.page).getByRole('list')).toHaveCount(0);
  const arnePicker = arne.page.getByRole('group', { name: 'Play with' });
  await expect(arnePicker.locator('.opponent-option', { hasText: HARALD })).toContainText('No games together yet');
  // Yatzy can seat the friend, and Chess starts with them by name.
  await arne.page.getByRole('radio', { name: 'Yatzy' }).check();
  await expect(arne.page.getByRole('checkbox', { name: HARALD, exact: true })).toBeEnabled();
  await arne.page.getByRole('radio', { name: 'Fischer Random (Chess960)' }).check();
  await arne.page.getByRole('radio', { name: HARALD, exact: true }).check();
  await arne.page.getByRole('button', { name: 'Start game' }).click();
  await openTable(arne.page);
  await expect(arne.page.getByRole('region', { name: `Fischer Random: you vs ${HARALD}` })).toBeVisible();
  // Harald finds the game, and the picker now counts it.
  await openLobby(harald);
  await expect(harald.getByRole('list', { name: 'Games in progress' }).getByRole('listitem')).toHaveCount(1);
  await expect(harald.getByRole('group', { name: 'Play with' }).locator('.opponent-option', { hasText: LONG })).toContainText('1 game together');
});

test('an existing friend, a replaced link and a used link: the old link is dead, the new one connects one person, and your own cannot be accepted', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await player(api, openContext, 'arne', 'Arne', run);
  const harald = await player(api, openContext, 'harald', 'Harald', run);
  const other = await player(api, openContext, 'william', 'William', run);

  await openLobby(arne.page);
  await card(arne.page).getByRole('button', { name: 'Create an invitation link' }).click();
  const first = await linkField(arne.page).inputValue();
  await card(arne.page).getByRole('button', { name: 'Done' }).click();
  await expect(linkField(arne.page)).toHaveCount(0);

  // Replace it: asked first, Keep it changes nothing, then by keyboard.
  const open = card(arne.page).getByRole('button', { name: /^Replace the link of Invitation 1,/ });
  await open.click();
  const question = card(arne.page).getByRole('group', { name: /^Confirm replacing the link of Invitation 1,/ });
  await expect(question.getByText(/The old link stops working at once/)).toBeFocused();
  await question.getByRole('button', { name: 'Keep it' }).click();
  await expect(question).toHaveCount(0);
  await harald.page.goto(first);
  await expect(harald.page.getByRole('heading', { name: `${arne.name} invites you to play` })).toBeVisible(); // still alive

  await open.focus();
  await arne.page.keyboard.press('Enter');
  await question.getByRole('button', { name: 'Replace link' }).focus();
  await arne.page.keyboard.press('Enter');
  await expect(card(arne.page).getByRole('group', { name: 'The new link to send' })).toBeVisible();
  const second = await linkField(arne.page).inputValue();
  expect(second).not.toBe(first);
  await expect(card(arne.page).getByRole('list', { name: 'Waiting to be accepted (1 of 20)' }).getByRole('listitem')).toHaveCount(1);
  await fits(arne.page);

  // The old link: unavailable, with nothing to accept. Harald had it open: accepting says so too.
  await harald.page.getByRole('button', { name: `Accept and connect with ${arne.name}` }).click();
  await expect(harald.page.getByRole('heading', { name: 'This invitation isn’t available' })).toBeVisible();
  await expect(harald.page.getByRole('alert')).toContainText('It may have expired, been replaced by a newer link, or already been used by someone.');
  await harald.page.reload();
  await expect(harald.page.getByRole('heading', { name: 'This invitation isn’t available' })).toBeVisible();
  expect(await friendsOf(api, arne)).toEqual([]);
  await fits(harald.page);

  // Arne opens the new link himself: it is his own.
  const own = await (await openContext('arne-2', { playerId: arne.id, displayName: arne.name, credential: arne.credential })).newPage();
  await own.goto(second);
  await expect(own.getByRole('heading', { name: 'This is your own invitation' })).toBeVisible();
  await expect(own.getByRole('button', { name: /Accept/ })).toHaveCount(0);

  // The new link connects Harald, and then nobody else.
  await harald.page.goto(second);
  await harald.page.getByRole('button', { name: `Accept and connect with ${arne.name}` }).click();
  await expect(harald.page.getByRole('heading', { name: `You and ${arne.name} are connected` })).toBeVisible();
  await other.page.goto(second);
  await expect(other.page.getByRole('heading', { name: 'This invitation isn’t available' })).toBeVisible();
  expect(await friendsOf(api, arne)).toEqual([harald.id]);
  expect(await friendsOf(api, other)).toEqual([]);
  expect(await pendingCount(api, arne)).toBe(0);

  // Pasting a friend link into "Got an invitation?" opens the same page.
  await openLobby(other.page);
  await other.page.getByLabel('Paste an invitation link').fill(second);
  await other.page.getByRole('button', { name: 'Join' }).click();
  await expect(other.page.getByRole('heading', { name: 'This invitation isn’t available' })).toBeVisible();
});

test('lost answers: creating, replacing and accepting each recover by trying again, without a second invitation or connection', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await player(api, openContext, 'arne', 'Arne', run);
  const harald = await player(api, openContext, 'harald', 'Harald', run);
  await openLobby(arne.page);

  // Creation: saved on the server, the answer lost.
  await loseAnswers(arne.page, '**/game-api/friend-invitations?*');
  await card(arne.page).getByRole('button', { name: 'Create an invitation link' }).click();
  await expect(card(arne.page).getByRole('alert').filter({ hasText: 'Couldn’t confirm whether the invitation was created' })).toBeVisible();
  await expect(linkField(arne.page)).toHaveCount(0);
  expect(await pendingCount(api, arne)).toBe(1);
  await arne.page.unroute('**/game-api/friend-invitations?*');
  await card(arne.page).getByRole('button', { name: 'Try again' }).click();
  await expect(linkField(arne.page)).toBeVisible();
  expect(await pendingCount(api, arne)).toBe(1); // the same invitation, not a second
  const created = await linkField(arne.page).inputValue();

  // Replacement: done on the server, the answer lost. The link that was shown is dead already.
  await loseAnswers(arne.page, '**/game-api/friend-invitations/*/replacement?*');
  await card(arne.page).getByRole('button', { name: /^Replace the link of Invitation 1,/ }).click();
  const question = card(arne.page).getByRole('group', { name: /^Confirm replacing the link of Invitation 1,/ });
  await question.getByRole('button', { name: 'Replace link' }).click();
  await expect(question.getByRole('alert')).toContainText('Couldn’t confirm whether the link was replaced');
  await expect(question.getByRole('alert')).toContainText('The old link may already have stopped working.');
  await harald.page.goto(created);
  await expect(harald.page.getByRole('heading', { name: 'This invitation isn’t available' })).toBeVisible();
  await arne.page.unroute('**/game-api/friend-invitations/*/replacement?*');
  await question.getByRole('button', { name: 'Try again' }).click();
  await expect(card(arne.page).getByRole('group', { name: 'The new link to send' })).toBeVisible();
  const replaced = await linkField(arne.page).inputValue();
  expect(await pendingCount(api, arne)).toBe(1);

  // Acceptance: connected on the server, the answer lost.
  await harald.page.goto(replaced);
  const accept = harald.page.getByRole('button', { name: `Accept and connect with ${arne.name}` });
  await expect(accept).toBeVisible();
  await loseAnswers(harald.page, '**/game-api/friend-invitations/accept?*');
  await accept.click();
  await expect(harald.page.getByRole('alert')).toContainText('Couldn’t confirm that you’re connected');
  expect(await friendsOf(api, arne)).toEqual([harald.id]);
  await harald.page.unroute('**/game-api/friend-invitations/accept?*');
  await harald.page.getByRole('button', { name: 'Try again' }).click();
  await expect(harald.page.getByRole('heading', { name: `You and ${arne.name} are connected` })).toBeVisible();
  expect(await friendsOf(api, arne)).toEqual([harald.id]);
  expect(await friendsOf(api, harald)).toEqual([arne.id]);
  expect(await pendingCount(api, arne)).toBe(0);
});

test('at 20 waiting invitations: no new one is offered, the reason is given, and replacement still works; copying can be done by hand', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await player(api, openContext, 'arne', 'Arne', run);
  for (let i = 0; i < 20; i++) await api('POST', '/friend-invitations', { credential: arne.credential, data: { requestId: crypto.randomUUID() }, expect: 201 });
  // This browser refuses to copy: the fallback is to select and copy by hand.
  await arne.page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));

  await arne.page.setViewportSize({ width: 320, height: 800 });
  await openLobby(arne.page);
  await expect(card(arne.page).getByRole('list', { name: 'Waiting to be accepted (20 of 20)' }).getByRole('listitem')).toHaveCount(20);
  await expect(card(arne.page).getByText('You have 20 invitations waiting, which is the most you can have. Replace one of them below to get a new link.')).toBeVisible();
  await expect(card(arne.page).getByRole('button', { name: 'Create an invitation link' })).toBeDisabled();
  await fits(arne.page);

  await card(arne.page).getByRole('button', { name: /^Replace the link of Invitation 7,/ }).click();
  await card(arne.page).getByRole('group', { name: /^Confirm replacing the link of Invitation 7,/ }).getByRole('button', { name: 'Replace link' }).click();
  await expect(linkField(arne.page)).toBeVisible();
  const link = await linkField(arne.page).inputValue();
  expect(await pendingCount(api, arne)).toBe(20);
  await expect(card(arne.page).getByRole('listitem').nth(6)).toContainText('Its link is shown above');

  await card(arne.page).getByRole('button', { name: 'Copy link' }).click();
  await expect(card(arne.page).getByText('Couldn’t copy. Select the link and copy it by hand.')).toBeVisible();
  await linkField(arne.page).focus();
  expect(await linkField(arne.page).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))).toBe(link);

  // The replaced link works, for one friend; accepting frees a slot, and creation is offered again.
  const harald = await player(api, openContext, 'harald', 'Harald', run);
  await harald.page.goto(link);
  await harald.page.getByRole('button', { name: `Accept and connect with ${arne.name}` }).click();
  await expect(harald.page.getByRole('heading', { name: `You and ${arne.name} are connected` })).toBeVisible();
  await openLobby(arne.page);
  await expect(card(arne.page).getByRole('list', { name: 'Waiting to be accepted (19 of 20)' })).toBeVisible();
  await expect(card(arne.page).getByRole('button', { name: 'Create an invitation link' })).toBeEnabled();
});
