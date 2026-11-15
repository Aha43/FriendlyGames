// Deleting a finished game (#93): independent browsers against the real backend, with throwaway
// players and games only. Any participant may delete; the game is then gone for everyone.
import type { BrowserContext, Page } from '@playwright/test';
import { ROWS } from '../supabase/functions/_shared/yatzy/rules';
import { expect, openLobby, openTable, test, uniqueName } from './fixtures';

const ALL = '?types=chess,chess960,yatzy';
type Api = (method: 'GET' | 'POST' | 'DELETE', path: string, options?: { credential?: string; data?: unknown; expect?: number }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Friend {
  name: string;
  id: string;
  email: string;
  credential: string;
  page: Page;
}

/** A player made through the API and signed in to their own browser context. */
async function friend(api: Api, context: BrowserContext, base: string, run: string, displayName = uniqueName(base)): Promise<Friend> {
  const email = `${base.toLowerCase()}-${run}@example.test`;
  const entered = await api('POST', '/players', { data: { email, displayName }, expect: 201 });
  const identity = { playerId: entered.player.id, displayName, credential: entered.deviceCredential };
  await context.addInitScript((saved) => localStorage.setItem('friendlygames.identity', JSON.stringify(saved)), identity);
  return { name: displayName, id: entered.player.id, email, credential: entered.deviceCredential, page: await context.newPage() };
}

/** A chess-family game `white` started and `black` joined; finished by Black resigning unless kept going. */
async function chessGame(api: Api, white: Friend, black: Friend, type: 'chess' | 'chess960', finish = true): Promise<string> {
  const { invitation } = await api('POST', `/games${ALL}`, { credential: white.credential, data: { friendEmail: black.email, type }, expect: 201 });
  const { game } = await api('POST', `/invitations/redeem${ALL}`, { credential: black.credential, data: { token: invitation.token }, expect: 200 });
  if (finish) {
    await api('POST', `/games/${game.id}/actions${ALL}`, {
      credential: black.credential,
      data: { requestId: crypto.randomUUID(), expectedRevision: game.revision, action: { type: 'resign' } },
      expect: 200,
    });
  }
  return game.id;
}

const fits = async (page: Page, width: number) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
const confirmation = (page: Page) => page.getByRole('group', { name: 'Confirm deleting this game' });

test('a chess game: only when finished, cancelled first, then deleted by the player who did not start it; gone for both, at 320px', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  // 40 characters, the longest name allowed, with nothing to break at: the confirmation names it.
  const LONG = `Wilbursjefesen${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 40);
  const arne = await friend(api, await openContext('arne'), 'Arne', run, LONG);
  const harald = await friend(api, await openContext('harald'), 'Harald', run);
  await harald.page.setViewportSize({ width: 320, height: 800 });

  // A game still being played offers no deletion, in the page or through the API.
  const going = await chessGame(api, arne, harald, 'chess', false);
  await openTable(harald.page, `/#/game/${going}`);
  await expect(harald.page.getByRole('button', { name: 'Resign…' })).toBeVisible();
  await expect(harald.page.getByRole('button', { name: 'Delete game…' })).toHaveCount(0);
  await api('DELETE', `/games/${going}${ALL}`, { credential: harald.credential, expect: 409 });
  const { revision } = (await api('GET', `/games/${going}${ALL}`, { credential: harald.credential, expect: 200 })).game;
  await api('POST', `/games/${going}/actions${ALL}`, {
    credential: harald.credential,
    data: { requestId: crypto.randomUUID(), expectedRevision: revision, action: { type: 'resign' } },
    expect: 200,
  });

  // Finished: both see it in their history. It is the only game they share.
  await openLobby(arne.page);
  await expect(arne.page.getByRole('list', { name: `Finished games with ${harald.name}` }).getByRole('listitem')).toHaveCount(1);
  await openTable(arne.page, `/#/game/${going}`);
  await harald.page.reload();
  await openTable(harald.page);
  await fits(harald.page, 320); // the result line names the long name too
  await harald.page.getByRole('button', { name: 'Delete game…' }).click();
  const ask = confirmation(harald.page);
  await expect(ask.getByText('Delete this game?')).toBeFocused();
  await expect(ask.getByText(new RegExp(`^Chess game with ${LONG}, finished \\d+ \\w+ \\d{4}$`))).toBeVisible();
  await expect(ask.getByText(/disappears for everyone who played it/)).toBeVisible();
  await expect(ask.getByText(`This is the last game you share with ${LONG}. You won’t find them in Play with until you share another game.`)).toBeVisible();
  await fits(harald.page, 320);
  for (const part of [ask, ask.getByRole('button', { name: 'Delete game' }), ask.getByRole('button', { name: 'Keep it' })]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }

  // Keep it: nothing happens.
  await ask.getByRole('button', { name: 'Keep it' }).click();
  await expect(ask).toHaveCount(0);
  await api('GET', `/games/${going}${ALL}`, { credential: arne.credential, expect: 200 });

  // By keyboard this time: open, confirm.
  await harald.page.getByRole('button', { name: 'Delete game…' }).focus();
  await harald.page.keyboard.press('Enter');
  await expect(ask.getByRole('button', { name: 'Delete game' })).toBeEnabled();
  await ask.getByRole('button', { name: 'Delete game' }).focus();
  await harald.page.keyboard.press('Enter');
  await expect(harald.page.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(harald.page.getByRole('status')).toHaveText(new RegExp(`^Deleted: Chess game with ${LONG}, finished .*\\.$`));
  await fits(harald.page, 320);
  await expect(harald.page.getByText('Looking for your games…')).toBeHidden();
  await expect(harald.page.getByRole('list', { name: `Finished games with ${LONG}` })).toHaveCount(0);
  await expect(harald.page.getByText('Looking for people you’ve played with…')).toBeHidden();
  await expect(harald.page.getByRole('group', { name: 'Play with' })).toHaveCount(0);

  // Arne, who started it, still has the old page open: after a refresh it is gone everywhere.
  await arne.page.reload();
  await expect(arne.page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
  await expect(arne.page.getByText('This game doesn’t exist, was deleted, or isn’t one of yours.')).toBeVisible();
  await openLobby(arne.page);
  await expect(arne.page.getByRole('list', { name: `Finished games with ${harald.name}` })).toHaveCount(0);
  await expect(arne.page.getByRole('group', { name: 'Play with' })).toHaveCount(0);
  await api('GET', `/games/${going}${ALL}`, { credential: arne.credential, expect: 404 });
  await api('DELETE', `/games/${going}${ALL}`, { credential: arne.credential, expect: 404 });
});

test('a Fischer Random game with a rematch under way: the rematch stays playable and nobody is warned about Play with', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await friend(api, await openContext('arne'), 'Arne', run);
  const harald = await friend(api, await openContext('harald'), 'Harald', run);
  const first = await chessGame(api, arne, harald, 'chess960');

  // Harald starts the rematch from the finished game.
  await openTable(harald.page, `/#/game/${first}`);
  await harald.page.getByRole('button', { name: /^Play again/ }).click();
  await expect(harald.page.getByRole('status')).toHaveText('Your move');
  const rematchId = harald.page.url().split('/game/')[1];
  expect(rematchId).not.toBe(first);

  // Arne deletes the first game. They still share the rematch, so no warning.
  await openTable(arne.page, `/#/game/${first}`);
  await arne.page.getByRole('button', { name: 'Delete game…' }).click();
  const ask = confirmation(arne.page);
  await expect(ask.getByText(new RegExp(`^Fischer Random game with ${harald.name}, finished `))).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Delete game' })).toBeEnabled();
  await expect(ask.getByText(/last game you share/)).toHaveCount(0);
  await ask.getByRole('button', { name: 'Delete game' }).click();
  await expect(arne.page.getByRole('status')).toHaveText(/^Deleted: Fischer Random game with /);

  // The rematch is in both lobbies and still plays; Harald is still in Arne's Play with.
  await expect(arne.page.getByRole('list', { name: 'Games in progress' }).locator(`a[href="#/game/${rematchId}"]`)).toBeVisible();
  await expect(arne.page.getByRole('group', { name: 'Play with' }).getByRole('radio', { name: harald.name, exact: true })).toBeVisible();
  const before = (await api('GET', `/games/${rematchId}${ALL}`, { credential: harald.credential, expect: 200 })).game;
  expect(before).toMatchObject({ type: 'chess960', status: 'active', revision: 0 });
  await harald.page.reload();
  await openTable(harald.page);
  await expect(harald.page.getByRole('status')).toHaveText('Your move');
  await harald.page.getByRole('button', { name: 'Resign…' }).click();
  await harald.page.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(harald.page.getByRole('status')).toContainText('resigned');
  await api('GET', `/games/${first}${ALL}`, { credential: harald.credential, expect: 404 });
});

test('a Yatzy table deleted by a guest: gone from everyone’s results, naming only the players it was the last shared game with', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const host = await friend(api, await openContext('arne'), 'Arne', run);
  const anna = await friend(api, await openContext('harald'), 'Harald', run);
  const ben = await friend(api, await openContext('william'), 'William', run);
  // The host has a chess game going with each guest; the guests share only the table.
  await chessGame(api, host, anna, 'chess', false);
  await chessGame(api, host, ben, 'chess', false);
  const created = await api('POST', `/games${ALL}`, {
    credential: host.credential,
    data: { type: 'yatzy', mode: 'free', friendPlayerIds: [anna.id, ben.id], requestId: crypto.randomUUID() },
    expect: 201,
  });
  const players = [host, anna, ben];
  let game = created.game;
  const tableId: string = game.id;

  // Not finished yet: no deletion offered.
  await openTable(ben.page, `/#/game/${tableId}`);
  await expect(ben.page.getByRole('button', { name: 'Delete game…' })).toHaveCount(0);
  await api('DELETE', `/games/${tableId}${ALL}`, { credential: ben.credential, expect: 409 });

  while (game.status !== 'finished') {
    const seat = Number(game.turn.slice(1)) - 1;
    const act = async (action: unknown) =>
      (
        await api('POST', `/games/${tableId}/actions${ALL}`, {
          credential: players[seat].credential,
          data: { requestId: crypto.randomUUID(), expectedRevision: game.revision, action },
          expect: 200,
        })
      ).game;
    if (game.yatzy.turn.throws === 0) game = await act({ type: 'throw', keep: [] });
    const row = ROWS.find((r) => game.yatzy.players[seat].scores[r] === undefined)!;
    game = await act({ type: 'score', row });
  }

  await openLobby(host.page);
  await expect(host.page.getByRole('list', { name: 'Finished Yatzy tables' }).getByRole('listitem')).toHaveCount(1);

  await ben.page.reload();
  await openTable(ben.page);
  await ben.page.getByRole('button', { name: 'Delete game…' }).click();
  const ask = confirmation(ben.page);
  await expect(ask.getByText(new RegExp(`^Yatzy table with ${host.name} and ${anna.name}, finished `))).toBeVisible();
  // Ben still shares a chess game with the host, so only Anna would leave his Play with.
  await expect(ask.getByText(`This is the last game you share with ${anna.name}. You won’t find them in Play with until you share another game.`)).toBeVisible();
  await ask.getByRole('button', { name: 'Delete game' }).click();
  await expect(ben.page.getByRole('status')).toHaveText(/^Deleted: Yatzy table with /);
  await expect(ben.page.getByText('Looking for people you’ve played with…')).toBeHidden();
  const picker = ben.page.getByRole('group', { name: 'Play with' });
  await expect(picker.getByRole('radio', { name: host.name, exact: true })).toBeVisible();
  await expect(picker.getByRole('radio', { name: anna.name, exact: true })).toHaveCount(0);

  await openLobby(host.page);
  await expect(host.page.getByRole('heading', { name: 'Yatzy results' })).toHaveCount(0);
  await anna.page.goto(`/#/game/${tableId}`);
  await expect(anna.page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
});

test('the warning is never skipped: the pair’s other game is deleted while the confirmation is open', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await friend(api, await openContext('arne'), 'Arne', run);
  const harald = await friend(api, await openContext('harald'), 'Harald', run);
  const one = await chessGame(api, arne, harald, 'chess');
  const two = await chessGame(api, arne, harald, 'chess');

  // Arne's confirmation for the first game shows no warning: they share a second one.
  await openTable(arne.page, `/#/game/${one}`);
  await arne.page.getByRole('button', { name: 'Delete game…' }).click();
  const ask = confirmation(arne.page);
  await expect(ask.getByRole('button', { name: 'Delete game' })).toBeEnabled();
  await expect(ask.getByText(/last game you share/)).toHaveCount(0);

  // Harald deletes the second game in his own browser.
  await openTable(harald.page, `/#/game/${two}`);
  await harald.page.getByRole('button', { name: 'Delete game…' }).click();
  await confirmation(harald.page).getByRole('button', { name: 'Delete game' }).click();
  await expect(harald.page.getByRole('status')).toHaveText(/^Deleted: /);

  // Arne confirms: nothing is deleted, and he is told who it now affects.
  await ask.getByRole('button', { name: 'Delete game' }).click();
  await expect(ask.getByRole('alert')).toContainText('Nothing was deleted: who this affects changed while you were deciding.');
  await expect(ask.getByText(`This is the last game you share with ${harald.name}. You won’t find them in Play with until you share another game.`)).toBeVisible();
  await api('GET', `/games/${one}${ALL}`, { credential: harald.credential, expect: 200 });

  // Confirming again, now warned, deletes it.
  await ask.getByRole('button', { name: 'Delete game' }).click();
  await expect(arne.page.getByRole('status')).toHaveText(/^Deleted: /);
  await api('GET', `/games/${one}${ALL}`, { credential: harald.credential, expect: 404 });
});

test('a start whose answer was lost is not made again once that game has been played and deleted', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await friend(api, await openContext('arne'), 'Arne', run);
  const harald = await friend(api, await openContext('harald'), 'Harald', run);
  await chessGame(api, arne, harald, 'chess', false); // so Arne can start with Harald by name

  await openLobby(arne.page);
  await arne.page.getByRole('group', { name: 'Play with' }).getByRole('radio', { name: harald.name, exact: true }).check();
  // The start is saved, but its answer never arrives.
  await arne.page.route('**/game-api/games?*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fetch();
    await route.abort('connectionreset');
  });
  await arne.page.getByRole('button', { name: 'Start game' }).click();
  await expect(arne.page.getByText(/Couldn’t confirm whether the game was created/)).toBeVisible();
  await arne.page.unroute('**/game-api/games?*');

  // Meanwhile Harald finds the new game, resigns it and deletes it.
  const { games } = await api('GET', `/games${ALL}`, { credential: harald.credential, expect: 200 });
  const mine = games.filter((g: { players: { white: { id: string } } }) => g.players.white.id === arne.id);
  expect(mine).toHaveLength(2);
  const lost = mine.reduce((a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt > b.createdAt ? a : b));
  await api('POST', `/games/${lost.id}/actions${ALL}`, {
    credential: harald.credential,
    data: { requestId: crypto.randomUUID(), expectedRevision: lost.revision, action: { type: 'resign' } },
    expect: 200,
  });
  await api('DELETE', `/games/${lost.id}${ALL}`, { credential: harald.credential, expect: 200 });

  // Arne's retry is told so, makes nothing, and the next start is a new game.
  await arne.page.getByRole('button', { name: 'Try again' }).click();
  await expect(arne.page.getByRole('alert').filter({ hasText: 'That game was started and has since been deleted. Start again if you want a new one.' })).toBeVisible();
  expect((await api('GET', `/games${ALL}`, { credential: arne.credential, expect: 200 })).games).toHaveLength(1);
  await arne.page.getByRole('button', { name: 'Start game' }).click();
  await openTable(arne.page);
  expect(arne.page.url().split('/game/')[1]).not.toBe(lost.id);
  expect((await api('GET', `/games${ALL}`, { credential: arne.credential, expect: 200 })).games).toHaveLength(2);
});
