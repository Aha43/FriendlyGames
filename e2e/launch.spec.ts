// Where the app starts (#112): the root opens Your games; a link, a reload and a return from the
// background keep their place; only an iPhone Home Screen icon that was made on a game is sent to
// Your games. Real backend, throwaway players.
import type { BrowserContext } from '@playwright/test';
import { expect, openLobby, openTable, test, uniqueName } from './fixtures';

const ALL = '?types=chess,chess960,yatzy';

/** As iOS reports a web app opened from a Home Screen icon. */
const asHomeScreenApp = (context: BrowserContext) =>
  context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }));

test('root opens Your games; a game link, a reload and a return from the background stay on the game', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const enter = async (base: string) => {
    const name = uniqueName(base);
    const entered = await api('POST', '/players', { data: { email: `${base.toLowerCase()}-${run}@example.test`, displayName: name }, expect: 201 });
    return { name, identity: { playerId: entered.player.id as string, displayName: name, credential: entered.deviceCredential as string } };
  };
  const [arne, harald] = [await enter('Arne'), await enter('Harald')];
  // A finished game between them, as in the report: the kind of old game a launch kept landing on.
  const created = await api('POST', `/games${ALL}`, { credential: arne.identity.credential, data: { friendEmail: `harald-${run}@example.test` }, expect: 201 });
  const joined = await api('POST', `/invitations/redeem${ALL}`, { credential: harald.identity.credential, data: { token: created.invitation.token }, expect: 200 });
  await api('POST', `/games/${joined.game.id}/actions${ALL}`, {
    credential: harald.identity.credential,
    data: { requestId: crypto.randomUUID(), expectedRevision: joined.game.revision, action: { type: 'resign' } },
    expect: 200,
  });
  const gameUrl = `/#/game/${joined.game.id}`;

  // In a browser: the root is Your games, and it has no memory of the last page.
  const browser = await openContext('arne', arne.identity);
  const page = await browser.newPage();
  await openLobby(page);
  await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await openTable(page, gameUrl);
  await expect(page.getByRole('status')).toContainText('resigned');
  const again = await browser.newPage(); // a new tab at the root, after having been on the game
  await openLobby(again);
  await expect(again.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await again.close();

  // An explicit link in a new tab reaches the game; so does a reload of it.
  const linked = await browser.newPage();
  await openTable(linked, gameUrl);
  await expect(linked.getByRole('status')).toContainText('resigned');
  await linked.reload();
  await openTable(linked);
  expect(linked.url()).toContain(gameUrl);
  // Going to the background and coming back changes nothing.
  for (const state of ['hidden', 'visible']) {
    await linked.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
      if (value === 'visible') window.dispatchEvent(new Event('focus'));
    }, state);
  }
  await expect(linked.getByRole('status')).toContainText('resigned');
  expect(linked.url()).toContain(gameUrl);

  // The site says where an installed icon starts.
  const manifestLink = await linked.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await linked.request.get(manifestLink!)).json();
  expect(manifest).toMatchObject({ name: 'FriendlyGames', start_url: '/', scope: '/' });
});

test('an iPhone Home Screen icon made while a game was open starts on Your games; inside it, opening and reloading a game still works', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const name = uniqueName('Arne');
  const entered = await api('POST', '/players', { data: { email: `arne-${run}@example.test`, displayName: name }, expect: 201 });
  const identity = { playerId: entered.player.id as string, displayName: name, credential: entered.deviceCredential as string };
  const created = await api('POST', `/games${ALL}`, { credential: identity.credential, data: { friendEmail: `nobody-${run}@example.test` }, expect: 201 });
  const gameUrl = `/#/game/${created.game.id}`;

  const app = await openContext('arne', identity);
  await asHomeScreenApp(app);

  // A cold start at the game's address: the icon, not a link.
  const launch = await app.newPage();
  await launch.goto(gameUrl);
  await expect(launch.getByRole('heading', { name: 'Your games' })).toBeVisible();
  expect(new URL(launch.url()).hash).toBe('#/');
  // The game is untouched and one tap away.
  const listed = launch.getByRole('list', { name: 'Games in progress' }).locator(`a[href="#/game/${created.game.id}"]`);
  await expect(listed).toBeVisible();
  await listed.click();
  await openTable(launch);
  expect(launch.url()).toContain(gameUrl);
  // Reloading the game inside the app keeps the game: that is not a launch.
  await launch.reload();
  await openTable(launch);
  expect(launch.url()).toContain(gameUrl);
  await launch.reload();
  await openTable(launch);
  expect(launch.url()).toContain(gameUrl);

  // The next cold start (the app was closed) is a launch again, also for an invitation address.
  for (const path of [gameUrl, `/#/join/${'J'.repeat(43)}`, `/#/friend/${'F'.repeat(43)}`]) {
    const cold = await app.newPage();
    await cold.goto(path);
    await expect(cold.getByRole('heading', { name: 'Your games' })).toBeVisible();
    expect(new URL(cold.url()).hash).toBe('#/');
    await cold.close();
  }
  // An icon made on one-device play keeps opening that.
  const local = await app.newPage();
  await local.goto('/#/local');
  await expect(local.getByRole('heading', { name: 'Playing on one device' })).toBeVisible();
});

test('a friend or game invitation link opened in a browser still reaches its page, also for a new visitor', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const name = uniqueName('Arne');
  const entered = await api('POST', '/players', { data: { email: `arne-${run}@example.test`, displayName: name }, expect: 201 });
  const friend = await api('POST', '/friend-invitations', { credential: entered.deviceCredential, data: { requestId: crypto.randomUUID() }, expect: 201 });
  const game = await api('POST', `/games${ALL}`, { credential: entered.deviceCredential, data: { friendEmail: `harald-${run}@example.test` }, expect: 201 });

  const visitor = await (await openContext('harald')).newPage();
  await visitor.goto(`/#/friend/${friend.invitation.token}`);
  await expect(visitor.getByRole('heading', { name: `${name} invites you to play` })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { name: `${name} invites you to play` })).toBeVisible();
  const other = await (await openContext('harald-2')).newPage();
  await other.goto(`/#/join/${game.invitation.token}`);
  await expect(other.getByRole('heading', { name: 'You’re invited to a game' })).toBeVisible();
  expect(new URL(other.url()).hash).toBe(`#/join/${game.invitation.token}`);
});
