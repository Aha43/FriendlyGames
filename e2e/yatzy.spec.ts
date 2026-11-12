// Yatzy with friends (#86): independent browsers against the real backend. The server rolls the
// dice, so the journeys read whatever was thrown from the page and check it against the API and
// the shared rules; nothing here depends on particular dice.
import type { BrowserContext, Page } from '@playwright/test';
import { ROWS, scoreRow, type Die, type Row } from '../supabase/functions/_shared/yatzy/rules';
import { expect, LOAD_BUDGET, openLobby, openTable, test, uniqueName } from './fixtures';

const SYNC = { timeout: LOAD_BUDGET };
const ALL = '?types=chess,chess960,yatzy';
type Api = (method: 'GET' | 'POST', path: string, options?: { credential?: string; data?: unknown; expect?: number }) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Friend {
  name: string;
  id: string;
  credential: string;
  page: Page;
}

/** A player made through the API and signed in to their own browser context. */
async function friend(api: Api, context: BrowserContext, base: string, run: string): Promise<Friend> {
  const name = uniqueName(base);
  const entered = await api('POST', '/players', { data: { email: `${base.toLowerCase()}-${run}@example.test`, displayName: name }, expect: 201 });
  const identity = { playerId: entered.player.id, displayName: name, credential: entered.deviceCredential };
  await context.addInitScript((saved) => localStorage.setItem('friendlygames.identity', JSON.stringify(saved)), identity);
  return { name, id: entered.player.id, credential: entered.deviceCredential, page: await context.newPage() };
}

/** The host and each guest have sat at a chess game: the guests are the host's previous opponents. */
async function introduce(api: Api, host: Friend, guests: Friend[], run: string) {
  for (const [i, guest] of guests.entries()) {
    const { invitation } = await api('POST', `/games${ALL}`, {
      credential: host.credential,
      data: { friendEmail: `intro${i}-${run}@example.test`, type: 'chess' },
      expect: 201,
    });
    await api('POST', `/invitations/redeem${ALL}`, { credential: guest.credential, data: { token: invitation.token }, expect: 200 });
  }
}

const dice = async (page: Page): Promise<Die[]> =>
  Promise.all([1, 2, 3, 4, 5].map(async (n) => Number((await page.getByRole('button', { name: new RegExp(`^Die ${n}:`) }).getAttribute('aria-label'))!.split(': ')[1]) as Die));
const die = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Die ${n}:`) });
const table = async (api: Api, who: Friend, gameId: string) => (await api('GET', `/games/${gameId}${ALL}`, { credential: who.credential, expect: 200 })).game;

/** Plays every remaining turn through the API: one throw, then the first open row. */
async function finishThroughApi(api: Api, players: Friend[], gameId: string) {
  let game = await table(api, players[0], gameId);
  while (game.status !== 'finished') {
    const seat = Number(game.turn.slice(1)) - 1;
    const act = async (action: unknown) =>
      (
        await api('POST', `/games/${gameId}/actions${ALL}`, {
          credential: players[seat].credential,
          data: { requestId: crypto.randomUUID(), expectedRevision: game.revision, action },
          expect: 200,
        })
      ).game;
    if (game.yatzy.turn.throws === 0) game = await act({ type: 'throw', keep: [] });
    const row = ROWS.find((r) => game.yatzy.players[seat].scores[r] === undefined)!;
    game = await act({ type: 'score', row });
  }
  return game;
}

const LABELS: Record<Row, string> = {
  ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes', onePair: 'One pair',
  twoPairs: 'Two pairs', threeOfAKind: 'Three of a kind', fourOfAKind: 'Four of a kind', smallStraight: 'Small straight',
  largeStraight: 'Large straight', fullHouse: 'Full house', chance: 'Chance', yatzy: 'Yatzy',
};

test('three friends play Free Yatzy: seated from the picker, a lost throw retried, resumed, finished; the guests can then play chess', async ({
  openContext,
  api,
}, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const host = await friend(api, await openContext('arne'), 'Arne', run);
  const anna = await friend(api, await openContext('harald'), 'Harald', run);
  const ben = await friend(api, await openContext('william'), 'William', run);
  await introduce(api, host, [anna, ben], run);

  // The host seats both from the usual "Start a game", choosing the order: Ben before Anna.
  await openLobby(host.page);
  await host.page.getByRole('radio', { name: 'Yatzy' }).check();
  await host.page.getByRole('radio', { name: 'Free' }).check();
  await expect(host.page.getByRole('button', { name: 'Start Yatzy' })).toBeDisabled();
  await host.page.getByRole('checkbox', { name: ben.name, exact: true }).check();
  await host.page.getByRole('checkbox', { name: anna.name, exact: true }).check();
  await expect(host.page.getByRole('list', { name: 'Turn order' }).getByRole('listitem')).toHaveText(['You (host)', ben.name, anna.name]);
  await expect(host.page.getByLabel('Friend’s email')).toHaveCount(0);
  await host.page.getByRole('button', { name: 'Start Yatzy' }).click();
  await openTable(host.page);
  await expect(host.page.getByRole('region', { name: `Yatzy: you with ${ben.name} and ${anna.name}` })).toBeVisible();
  await expect(host.page.getByText('Yatzy · Free')).toBeVisible();
  const gameId = host.page.url().split('/game/')[1];
  const players = [host, ben, anna];

  // The host throws, keeps two dice (one by pointer, one by keyboard), throws again and scores.
  await expect(host.page.getByRole('status')).toHaveText('Your turn: throw the dice');
  await host.page.getByRole('button', { name: 'Throw the dice' }).click();
  await expect(host.page.getByText(/^Throw 1 of 3/)).toBeVisible();
  const first = await dice(host.page);
  expect((await table(api, anna, gameId)).yatzy.turn).toMatchObject({ throws: 1, dice: first, kept: [] });
  await die(host.page, 1).click();
  await die(host.page, 4).focus();
  await host.page.keyboard.press('Space');
  await expect(die(host.page, 4)).toHaveAttribute('aria-pressed', 'true');
  await host.page.getByRole('button', { name: 'Keep 2, throw 3 again' }).click();
  await expect(host.page.getByText(/^Throw 2 of 3/)).toBeVisible();
  const second = await dice(host.page);
  expect([second[0], second[3]]).toEqual([first[0], first[3]]);
  expect((await table(api, anna, gameId)).yatzy.turn).toMatchObject({ throws: 2, dice: second, kept: [0, 3] });
  // Every empty row offers what it would give; picking one scores nothing until Score is pressed.
  await expect(host.page.getByRole('button', { name: /would score/ })).toHaveCount(15);
  const chance = scoreRow('chance', second);
  await host.page.getByRole('button', { name: `Chance: would score ${chance}` }).click();
  await expect(host.page.getByText('Banks 1 throw for later.')).toBeVisible();
  expect((await table(api, anna, gameId)).revision).toBe(2);
  await host.page.getByRole('button', { name: `Score ${chance} in Chance` }).click();
  await expect(host.page.getByRole('status')).toHaveText(`${ben.name}’s turn`);
  await expect(host.page.getByRole('row', { name: /^Banked throws/ }).getByRole('cell').first()).toHaveText('1');

  // Ben finds the table in his lobby. His first throw is saved, but its answer is lost (reads
  // too, so a refresh cannot settle it first).
  await openLobby(ben.page);
  await ben.page.getByRole('list', { name: 'Games in progress' }).locator(`a[href="#/game/${gameId}"]`).click();
  await openTable(ben.page);
  await expect(ben.page.getByRole('status')).toHaveText('Your turn: throw the dice');
  await ben.page.route('**/game-api/games/*/actions?*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('connectionreset');
  });
  await ben.page.route('**/game-api/games/*', (route) => (route.request().method() === 'GET' ? route.abort('connectionreset') : route.fallback()));
  await ben.page.getByRole('button', { name: 'Throw the dice' }).click();
  await expect(ben.page.getByText(/Couldn’t confirm whether your throw was saved/)).toBeVisible();
  const committed = (await table(api, host, gameId)).yatzy.turn;
  expect(committed.throws).toBe(1);
  await ben.page.unroute('**/game-api/games/*/actions?*');
  await ben.page.getByRole('button', { name: 'Retry' }).click();
  await ben.page.unroute('**/game-api/games/*');
  // The retry shows the dice that were saved: no second roll.
  await expect(ben.page.getByText(/^Throw 1 of 3/)).toBeVisible();
  expect(await dice(ben.page)).toEqual(committed.dice);
  expect((await table(api, host, gameId)).yatzy.turn).toEqual(committed);

  // Anna, waiting on another device, sees Ben's committed throw on her usual refresh.
  await openTable(anna.page, `/#/game/${gameId}`);
  await expect(anna.page.getByRole('status')).toHaveText(`${ben.name}’s turn`);
  await expect(anna.page.getByRole('group', { name: `${ben.name}’s dice` })).toBeVisible();
  expect(await dice(anna.page)).toEqual(committed.dice);
  await expect(anna.page.getByRole('button', { name: /Throw|Score|would score/ })).toHaveCount(0);

  // Ben reloads mid-turn and carries on from the same dice, keeping some for a second throw.
  await ben.page.reload();
  await openTable(ben.page);
  await expect(ben.page.getByText(/^Throw 1 of 3/)).toBeVisible();
  expect(await dice(ben.page)).toEqual(committed.dice);
  await die(ben.page, 2).click();
  await ben.page.getByRole('button', { name: 'Keep 1, throw 4 again' }).click();
  await expect(ben.page.getByText(/^Throw 2 of 3/)).toBeVisible();
  await expect(die(ben.page, 2)).toHaveAttribute('aria-pressed', 'true');
  // Anna sees which die he kept.
  await expect(anna.page.getByText(/^Throw 2 of 3/)).toBeVisible(SYNC);
  await expect(die(anna.page, 2)).toHaveAttribute('aria-pressed', 'true');
  const benDice = await dice(ben.page);
  const pair = scoreRow('onePair', benDice);
  await ben.page.getByRole('button', { name: `One pair: would score ${pair}` }).click();
  await ben.page.getByRole('button', { name: `Score ${pair} in One pair` }).click();

  // Anna plays her turn; the host sees both scores arrive.
  await expect(anna.page.getByRole('status')).toHaveText('Your turn: throw the dice', SYNC);
  await anna.page.getByRole('button', { name: 'Throw the dice' }).click();
  await expect(anna.page.getByText(/^Throw 1 of 3/)).toBeVisible();
  const sixes = scoreRow('sixes', await dice(anna.page));
  await anna.page.getByRole('button', { name: `Sixes: would score ${sixes}` }).click();
  await expect(anna.page.getByText('Banks 2 throws for later.')).toBeVisible();
  await anna.page.getByRole('button', { name: `Score ${sixes} in Sixes` }).click();
  await expect(host.page.getByRole('status')).toHaveText('Your turn: throw the dice', SYNC);
  await expect(host.page.getByRole('columnheader')).toHaveText(['Row', /^You/, ben.name, anna.name]);
  await expect(host.page.getByRole('row', { name: /^One pair/ }).getByRole('cell').nth(1)).toHaveText(String(pair));
  await expect(host.page.getByRole('row', { name: /^Sixes/ }).getByRole('cell').nth(2)).toHaveText(String(sixes));
  await expect(host.page.getByRole('row', { name: /^Banked throws/ }).getByRole('cell')).toHaveText(['1', '1', '2']);

  // The remaining turns are played through the API; every device then shows the finished card.
  const final = await finishThroughApi(api, players, gameId);
  const places = final.yatzy.standings as { seat: string; total: number; place: number }[];
  for (const viewer of players) {
    await expect(viewer.page.getByRole('status')).toHaveText(/^Finished\. /, SYNC);
    await expect(viewer.page.getByRole('table', { name: 'Final scorecard' })).toBeVisible();
    const listed = viewer.page.getByRole('list', { name: 'Final standings' }).getByRole('listitem');
    await expect(listed).toHaveCount(3);
    for (const [i, s] of places.entries()) {
      const who = players[Number(s.seat.slice(1)) - 1];
      await expect(listed.nth(i)).toContainText(who === viewer ? 'You' : who.name);
      await expect(listed.nth(i)).toContainText(`${s.total} point`);
    }
    await expect(viewer.page.getByRole('row', { name: /^Total/ }).getByRole('cell')).toHaveText(
      final.yatzy.players.map((p: { total: number }) => String(p.total)),
    );
    await expect(viewer.page.getByRole('button', { name: /Throw|Score|Die/ })).toHaveCount(0);
  }

  // In the lobby the table is a Yatzy result of its own; the chess tallies hold no Yatzy.
  await openLobby(host.page);
  const results = host.page.getByRole('list', { name: 'Finished Yatzy tables' }).getByRole('link');
  await expect(results).toHaveCount(1);
  await expect(results).toContainText(`With ${ben.name} and ${anna.name}`);
  await expect(host.page.getByRole('heading', { name: /^Yatzy with/ })).toHaveCount(0);
  await expect(host.page.getByRole('list', { name: 'Games in progress' }).getByRole('link')).toHaveCount(2); // the two chess games
  await results.click();
  await openTable(host.page);
  await expect(host.page.getByRole('table', { name: 'Final scorecard' })).toBeVisible();

  // Ben and Anna never played chess with each other. Having sat at this table, Ben can pick
  // Anna by name and start a chess game with her directly.
  await openLobby(ben.page);
  const picker = ben.page.getByRole('group', { name: 'Play with' });
  await picker.getByRole('radio', { name: anna.name, exact: true }).check();
  await ben.page.getByRole('button', { name: 'Start game' }).click();
  await openTable(ben.page);
  await expect(ben.page.getByRole('region', { name: `Chess: you vs ${anna.name}` })).toBeVisible();
  await expect(ben.page.getByRole('status')).toHaveText('Your move');
  await openLobby(anna.page);
  await expect(anna.page.getByRole('list', { name: 'Games in progress' })).toContainText(`vs ${ben.name}`);
});

test('Forced Yatzy for two at 320px: the next row only, by keyboard, a banked throw spent, finished and reopened', async ({ openContext, api }, testInfo) => {
  test.slow();
  const run = `${Date.now()}-${testInfo.project.name}`;
  const host = await friend(api, await openContext('arne'), 'Arne', run);
  const guest = await friend(api, await openContext('harald'), 'Harald', run);
  await introduce(api, host, [guest], run);
  const page = host.page;
  await page.setViewportSize({ width: 320, height: 720 });
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  // Forced is the default order; everything here is done from the keyboard.
  await openLobby(page);
  await page.getByRole('radio', { name: 'Yatzy' }).check();
  await expect(page.getByRole('radio', { name: 'Forced' })).toBeChecked();
  await page.getByRole('checkbox', { name: guest.name, exact: true }).focus();
  await page.keyboard.press('Space');
  await fits();
  await page.keyboard.press('Enter');
  await openTable(page);
  await expect(page.getByText('Yatzy · Forced')).toBeVisible();
  const gameId = page.url().split('/game/')[1];

  // Round one: one throw, and only Ones can be scored.
  await page.getByRole('button', { name: 'Throw the dice' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Throw 1 of 3/)).toBeVisible();
  const ones = scoreRow('ones', await dice(page));
  await expect(page.getByRole('button', { name: /would score/ })).toHaveCount(0);
  await expect(page.getByLabel(`Ones would score ${ones}`)).toBeVisible();
  await expect(page.getByText(/Forced order: this is your next row\./)).toBeVisible();
  await fits();
  await page.getByRole('button', { name: `Score ${ones} in Ones` }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText(`${guest.name}’s turn`);

  // The guest plays through the API; the API refuses a row out of order.
  let game = await table(api, guest, gameId);
  const guestAct = async (action: unknown, expectStatus = 200) =>
    api('POST', `/games/${gameId}/actions${ALL}`, {
      credential: guest.credential,
      data: { requestId: crypto.randomUUID(), expectedRevision: game.revision, action },
      expect: expectStatus,
    });
  game = (await guestAct({ type: 'throw', keep: [] })).game;
  await guestAct({ type: 'score', row: 'chance' }, 422);
  game = (await guestAct({ type: 'score', row: 'ones' })).game;

  // Round two: three throws, then a fourth that spends one of the two banked throws.
  await expect(page.getByRole('status')).toHaveText('Your turn: throw the dice', SYNC);
  await expect(page.getByText(/You have 2 banked throws\./)).toBeVisible();
  await page.getByRole('button', { name: 'Throw the dice' }).click();
  for (const n of [2, 3]) {
    await page.getByRole('button', { name: 'Throw all five again' }).click();
    await expect(page.getByText(new RegExp(`^Throw ${n} of 3`))).toBeVisible();
  }
  const paid = page.getByRole('button', { name: 'Throw all five again' });
  await expect(paid).toHaveAccessibleDescription('Another throw uses 1 of your 2 banked throws.');
  await die(page, 3).focus();
  await page.keyboard.press('Enter');
  const kept = (await dice(page))[2];
  await page.getByRole('button', { name: 'Keep 1, throw 4 again' }).click();
  await expect(page.getByText(/^Throw 4 \(1 banked throw used\)/)).toBeVisible();
  await expect(page.getByText(/You have 1 banked throw\./)).toBeVisible();
  expect((await dice(page))[2]).toBe(kept);
  const twos = scoreRow('twos', await dice(page));
  await expect(page.getByText(/Banks no throws\./)).toBeVisible();
  await fits();
  await page.getByRole('button', { name: `Score ${twos} in Twos` }).click();
  await expect(page.getByRole('status')).toHaveText(`${guest.name}’s turn`);
  await expect(page.getByRole('row', { name: /^Banked throws/ }).getByRole('cell')).toHaveText(['1', '2']);
  await expect(page.getByRole('row', { name: /^Sum/ }).getByRole('cell').first()).toHaveText(String(ones + twos));

  // Finished through the API; the page shows the result, and a reload opens the same finished card.
  const final = await finishThroughApi(api, [host, guest], gameId);
  await expect(page.getByRole('status')).toHaveText(/^Finished\. /, SYNC);
  await page.reload();
  await openTable(page);
  await expect(page.getByRole('status')).toHaveText(/^Finished\. /);
  await expect(page.getByRole('table', { name: 'Final scorecard' })).toBeVisible();
  for (const row of ROWS) {
    await expect(page.getByRole('row', { name: new RegExp(`^${LABELS[row]}\\b`) }).getByRole('cell')).toHaveText(
      final.yatzy.players.map((p: { scores: Record<string, number> }) => String(p.scores[row])),
    );
  }
  await expect(page.getByRole('list', { name: 'Final standings' }).getByRole('listitem')).toHaveCount(2);
  await fits();
});

test('a full table of four fits a 320px phone, from the picker to the scorecard', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const host = await friend(api, await openContext('arne'), 'Arne', run);
  const guests: Friend[] = [];
  for (const base of ['Harald', 'William', 'Oystein', 'Kari']) guests.push(await friend(api, await openContext(base.toLowerCase()), base, run));
  await introduce(api, host, guests, run);
  const page = host.page;
  await page.setViewportSize({ width: 320, height: 720 });
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await openLobby(page);
  await page.getByRole('radio', { name: 'Yatzy' }).check();
  for (const guest of guests.slice(0, 3)) await page.getByRole('checkbox', { name: guest.name, exact: true }).check();
  // Four is the most: the fifth friend cannot be added.
  await expect(page.getByText('That’s a full table of four.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: guests[3].name, exact: true })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Turn order' }).getByRole('listitem')).toHaveText(['You (host)', ...guests.slice(0, 3).map((g) => g.name)]);
  await fits();
  await page.getByRole('button', { name: 'Start Yatzy' }).click();
  await openTable(page);
  await expect(page.getByRole('columnheader')).toHaveCount(5);
  await page.getByRole('button', { name: 'Throw the dice' }).click();
  await expect(page.getByText(/^Throw 1 of 3/)).toBeVisible();
  await fits();
  // The dice and the whole card stay inside the screen.
  for (const element of [page.getByRole('group', { name: 'Your dice' }), page.getByRole('table')]) {
    const box = (await element.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  // Every guest sees the table and where they sit.
  const gameId = page.url().split('/game/')[1];
  for (const [i, guest] of guests.slice(0, 3).entries()) {
    expect((await table(api, guest, gameId)).yourSeat).toBe(`p${i + 2}`);
  }
  await openLobby(guests[2].page);
  await expect(guests[2].page.getByRole('list', { name: 'Games in progress' })).toContainText('Yatzy · Forced · 4 players');
});
