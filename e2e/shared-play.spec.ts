// Two players in independent browser contexts, against the real local backend (`supabase start`).
import type { Page } from '@playwright/test';
import { expect, LOAD_BUDGET, openLobby, openTable, test } from './fixtures';

const square = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function move(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
}

async function onboard(page: Page, name: string, email: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Create my player' }).click();
}

// Seeing the other player's change takes one 4 s poll plus one server call, so the same
// budget as a fresh load covers it (see LOAD_BUDGET in fixtures.ts).
const SYNC = { timeout: LOAD_BUDGET };

/**
 * Until the route is removed, let matching requests reach the server and commit, then lose
 * their responses. All of them, so the app's automatic repeats are lost too.
 */
async function loseResponses(page: Page, url: string, method = 'POST') {
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.continue();
    await route.fetch(); // the server receives and commits it
    await route.abort('connectionreset'); // the client never sees the answer
  });
}

/** Answer the next matching request with 503 without it reaching the server, as a restarting worker does. */
async function rejectNextOnce(page: Page, url: string, method = 'POST') {
  let rejected = false;
  await page.route(url, async (route) => {
    if (rejected || route.request().method() !== method) return route.continue();
    rejected = true;
    await route.fulfill({ status: 503, body: '' });
  });
}

test('two players create, join, play, refresh, recover from a failed send and resign', async ({ openContext }, testInfo) => {
  // A long journey: about 30 server round trips, measured at 21 s median and 25.7 s max, too
  // close to Playwright's 30 s default. test.slow() allows 90 s.
  test.slow();
  const arneContext = await openContext('arne');
  const haraldContext = await openContext('harald');
  // Harald's browser behaves like a phone on the dev server's LAN address (plain HTTP, not a
  // secure context), where crypto.randomUUID does not exist.
  await haraldContext.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined });
  });
  const arne = await arneContext.newPage();
  const harald = await haraldContext.newPage();
  const run = `${Date.now()}-${testInfo.project.name}`;

  // Arne arrives, introduces himself and invites Harald.
  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);

  // The game is created, but the answer (with the only copy of the link) is lost.
  await loseResponses(arne, '**/game-api/games');
  await arne.getByRole('button', { name: 'Create game' }).click();
  await expect(arne.getByText(/Couldn’t confirm whether the game was created/)).toBeVisible();
  await arne.unroute('**/game-api/games');
  // Retrying finds the same game and issues a working link; no second game appears.
  await arne.getByRole('button', { name: 'Try again' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).toMatch(/#\/join\/[A-Za-z0-9_-]{43}$/);
  await expect(arne.getByRole('list', { name: 'Games in progress' }).getByRole('link')).toHaveCount(1);
  await arne.getByRole('link', { name: 'Go to the table' }).click();
  await expect(arne.getByRole('status')).toHaveText('Waiting for your friend to join');

  // Harald opens the link on his own device, introduces himself and lands at the table as Black.
  await harald.goto(link);
  await expect(harald.getByRole('heading', { name: 'You’re invited to a game' })).toBeVisible();
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await openTable(harald); // after onboarding: redeem the invitation, then load the game
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
  await Promise.all([openTable(arne), openTable(harald)]);
  await expect(arne.getByRole('list', { name: 'Moves' })).toContainText('e4');
  await expect(arne.getByRole('list', { name: 'Moves' })).toContainText('e5');
  await expect(arne.getByRole('status')).toHaveText('Your move');
  await expect(square(harald, 'e5')).toHaveAccessibleName('e5, black pawn');

  // Arne's move is saved, but the answer is lost: the page doesn't claim either outcome,
  // and Retry (same request ID) confirms it without playing it twice.
  // Reads are cut too, so polling cannot settle the move before the player uses Retry.
  await loseResponses(arne, '**/game-api/games/*/actions');
  await arne.route('**/game-api/games/*', (route) =>
    route.request().method() === 'GET' ? route.abort('connectionreset') : route.fallback(),
  );
  await move(arne, 'g1', 'f3');
  await expect(arne.getByText(/Couldn’t confirm whether your move was saved/)).toBeVisible();
  await expect(square(arne, 'g1')).toHaveAccessibleName('g1, white knight'); // last confirmed position
  await arne.unroute('**/game-api/games/*/actions');
  await arne.getByRole('button', { name: 'Retry' }).click();
  await arne.unroute('**/game-api/games/*');
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(square(arne, 'f3')).toHaveAccessibleName('f3, white knight');
  await expect(square(harald, 'f3')).toHaveAccessibleName('f3, white knight', SYNC);
  await expect(harald.getByRole('list', { name: 'Moves' }).getByText('Nf3')).toHaveCount(1);

  // Both lobbies list the game.
  await openLobby(arne);
  await expect(arne.getByRole('list', { name: 'Games in progress' })).toContainText('vs Harald');
  await expect(arne.getByRole('list', { name: 'Games in progress' })).toContainText('Harald’s move');
  await arne.goBack();

  // Harald resigns after confirming; Arne sees the result.
  await harald.getByRole('button', { name: 'Resign…' }).click();
  await harald.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(harald.getByRole('status')).toHaveText('You resigned. Arne wins');
  await expect(arne.getByRole('status')).toHaveText('Harald resigned. You win', SYNC);
});

test('a move from an outdated tab is refused and the tab catches up', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const createPlayer = (displayName: string) =>
    api('POST', '/players', { data: { displayName, email: `${displayName}-${run}@example.test` }, expect: 201 });
  const arne = await createPlayer('Arne');
  const harald = await createPlayer('Harald');
  const created = await api('POST', '/games', {
    credential: arne.deviceCredential,
    data: { friendEmail: `harald-${run}@example.test` },
    expect: 201,
  });
  await api('POST', '/invitations/redeem', {
    credential: harald.deviceCredential,
    data: { token: created.invitation.token },
    expect: 200,
  });

  // Arne has the game open in two tabs of the same browser.
  const context = await openContext('arne', {
    playerId: arne.player.id,
    displayName: 'Arne',
    credential: arne.deviceCredential,
  });
  const [first, second] = [await context.newPage(), await context.newPage()];
  for (const page of [first, second]) {
    await openTable(page, `/#/game/${created.game.id}`);
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
});

test('the creator can make a new invitation link from a device without one', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const arne = await api('POST', '/players', {
    data: { displayName: 'Arne', email: `arne-${run}@example.test` },
    expect: 201,
  });
  // A game exists, but its link never reached this browser.
  const created = await api('POST', '/games', {
    credential: arne.deviceCredential,
    data: { friendEmail: `harald-${run}@example.test` },
    expect: 201,
  });

  const arneContext = await openContext('arne', {
    playerId: arne.player.id,
    displayName: 'Arne',
    credential: arne.deviceCredential,
  });
  const page = await arneContext.newPage();
  await openTable(page, `/#/game/${created.game.id}`);
  await page.getByRole('button', { name: 'Make a new invitation link' }).click();
  const link = await page.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).not.toContain(created.invitation.token);

  const haraldContext = await openContext('harald');
  const harald = await haraldContext.newPage();
  await harald.goto(link);
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await openTable(harald); // after onboarding: redeem the invitation, then load the game
  await expect(harald.getByRole('status')).toHaveText('Arne’s move');
  await expect(page.getByRole('status')).toHaveText('Your move', SYNC);
});

test('finished games become shared history: checkmate, resignation, review and play again', async ({ openContext }, testInfo) => {
  // A long journey: measured at 25 s median and 27.5 s max against the 30 s default. 90 s.
  test.slow();
  const arneContext = await openContext('arne');
  const haraldContext = await openContext('harald');
  const arne = await arneContext.newPage();
  const harald = await haraldContext.newPage();
  const run = `${Date.now()}-${testInfo.project.name}`;

  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  await arne.getByRole('link', { name: 'Go to the table' }).click();
  await harald.goto(link);
  await onboard(harald, 'Harald', `harald-${run}@example.test`);
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);

  // Game 1: Harald mates Arne.
  await move(arne, 'f2', 'f3');
  await expect(harald.getByRole('status')).toHaveText('Your move', SYNC);
  await move(harald, 'e7', 'e5');
  await expect(arne.getByRole('status')).toHaveText('Your move', SYNC);
  await move(arne, 'g2', 'g4');
  await expect(harald.getByRole('status')).toHaveText('Your move', SYNC);
  await move(harald, 'd8', 'h4');
  await expect(harald.getByRole('status')).toHaveText('Checkmate. You win');
  await expect(arne.getByRole('status')).toHaveText('Checkmate. Harald wins', SYNC);
  const firstGame = arne.url();

  // Arne asks to play again; Harald is offered the same new game, now as White.
  await arne.getByRole('button', { name: 'Play again (you take Black)' }).click();
  await expect(arne).toHaveURL(/#\/game\//);
  await openTable(arne); // starting the rematch and loading it are two server calls
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
  await expect(harald.getByRole('link', { name: 'Go to the rematch' })).toBeVisible(SYNC);
  await harald.getByRole('link', { name: 'Go to the rematch' }).click();
  expect(harald.url()).toBe(arne.url());
  await expect(harald.getByRole('status')).toHaveText('Your move');

  // Game 2: Harald opens and then resigns.
  await move(harald, 'e2', 'e4');
  await openTable(harald); // after onboarding: redeem the invitation, then load the game
  await expect(harald.getByRole('status')).toHaveText('Arne’s move');
  await harald.getByRole('button', { name: 'Resign…' }).click();
  await harald.getByRole('button', { name: 'Resign', exact: true }).click();
  await expect(arne.getByRole('status')).toHaveText('Harald resigned. You win', SYNC);

  // After a refresh, both histories show both games and an exact tally.
  for (const [page, opponent] of [[arne, 'Harald'], [harald, 'Arne']] as const) {
    await openLobby(page);
    const tally = page.getByLabel(`Tally with ${opponent}`);
    await expect(tally).toContainText('You1');
    await expect(tally).toContainText('Draws0');
    await expect(tally).toContainText(`${opponent}1`);
    const games = page.getByRole('list', { name: `Finished games with ${opponent}` }).getByRole('link');
    await expect(games).toHaveCount(2);
  }
  const arneGames = arne.getByRole('list', { name: 'Finished games with Harald' }).getByRole('link');
  await expect(arneGames.nth(0)).toContainText('You won by resignation · 1 moves');
  await expect(arneGames.nth(1)).toContainText('Harald won by checkmate · 4 moves');

  // Reopen the first game: read-only, unchanged, and every position can be inspected.
  await arneGames.nth(1).click();
  expect(arne.url()).toBe(firstGame);
  await expect(arne.getByRole('status')).toHaveText('Checkmate. Harald wins');
  await expect(arne.getByRole('list', { name: 'Moves' })).toHaveText(/1\.f3e52\.g4Qh4#/);
  await expect(arne.getByRole('link', { name: 'Go to the rematch' })).toBeVisible();
  await arne.getByRole('button', { name: 'Previous move' }).click();
  await expect(square(arne, 'h4')).toHaveAccessibleName('h4, empty');
  await arne.getByRole('button', { name: 'Move 1, White: f3' }).click();
  await expect(square(arne, 'f3')).toHaveAccessibleName('f3, white pawn');
  await expect(square(arne, 'e5')).toHaveAccessibleName('e5, empty');
  await square(arne, 'e2').click();
  await expect(square(arne, 'e2')).toHaveAccessibleName('e2, white pawn'); // nothing selectable

});

test('momentary server failures: safe requests are repeated, sign-up is left to the player', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const context = await openContext('arne');
  const arne = await context.newPage();

  // Sign-up answers 503 once. It cannot be deduplicated, so the app does not repeat it: the
  // player is told and decides to press Create my player again.
  let signUps = 0;
  arne.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/game-api/players')) signUps++;
  });
  await rejectNextOnce(arne, '**/game-api/players');
  await arne.goto('/');
  await onboard(arne, 'Arne', `arne-${run}@example.test`);
  await expect(arne.getByText('Couldn’t reach the game server. Check your connection and try again.')).toBeVisible();
  expect(signUps).toBe(1);
  await arne.getByRole('button', { name: 'Create my player' }).click();
  await expect(arne.getByRole('heading', { name: 'Your games' })).toBeVisible();
  expect(signUps).toBe(2);

  // Creating a game: the same once.
  await rejectNextOnce(arne, '**/game-api/games');
  await arne.getByLabel('Friend’s email').fill(`harald-${run}@example.test`);
  await arne.getByRole('button', { name: 'Create game' }).click();
  const link = await arne.getByLabel('Invitation link', { exact: true }).inputValue();
  expect(link).toMatch(/#\/join\/[A-Za-z0-9_-]{43}$/);
  await expect(arne.getByText(/Couldn’t confirm/)).toHaveCount(0);

  // Play again on a finished game: the same once, and the player still lands in the rematch.
  const identity = JSON.parse((await arne.evaluate(() => localStorage.getItem('friendlygames.identity')))!);
  const harald = await api('POST', '/players', { data: { displayName: 'Harald', email: `harald-${run}@example.test` }, expect: 201 });
  const game = (await api('POST', '/invitations/redeem', {
    credential: harald.deviceCredential,
    data: { token: link.split('/join/')[1] },
    expect: 200,
  })).game;
  let revision = game.revision;
  for (const [credential, from, to] of [
    [identity.credential, 'f2', 'f3'],
    [harald.deviceCredential, 'e7', 'e5'],
    [identity.credential, 'g2', 'g4'],
    [harald.deviceCredential, 'd8', 'h4'],
  ]) {
    const result = await api('POST', `/games/${game.id}/actions`, {
      credential,
      data: { requestId: crypto.randomUUID(), expectedRevision: revision, action: { type: 'move', from, to } },
      expect: 200,
    });
    revision = result.game.revision;
  }
  await openTable(arne, `/#/game/${game.id}`);
  await expect(arne.getByRole('status')).toHaveText('Checkmate. Harald wins');
  await rejectNextOnce(arne, '**/game-api/games/*/rematch');
  await arne.getByRole('button', { name: 'Play again (you take Black)' }).click();
  await openTable(arne);
  await expect(arne.getByRole('status')).toHaveText('Harald’s move');
});

test('one player per email: a second browser is told, gets nothing, and the first keeps playing', async ({ openContext }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const email = `once-${run}@example.test`;
  const first = await (await openContext('first')).newPage();
  const second = await (await openContext('second')).newPage();

  await first.goto('/');
  await onboard(first, 'Arne', email);
  await expect(first.getByRole('heading', { name: 'Your games' })).toBeVisible();

  // The same person (or anyone) types the same email, differently cased, in another browser.
  let signUps = 0;
  second.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/game-api/players')) signUps++;
  });
  await second.goto('/');
  await onboard(second, 'Arne again', `  ${email.toUpperCase()} `);
  await expect(second.getByText(/A player already uses this email\. Open FriendlyGames in the browser where you first created your player/)).toBeVisible();
  expect(signUps).toBe(1); // sign-up is never repeated automatically
  await expect(second.getByRole('heading', { name: 'Your games' })).toHaveCount(0);
  expect(await second.evaluate(() => localStorage.getItem('friendlygames.identity'))).toBeNull();

  // The first browser is unaffected.
  await first.reload();
  await expect(first.getByRole('heading', { name: 'Your games' })).toBeVisible();
  await expect(first.getByText('Arne', { exact: true })).toBeVisible();
});

test('an invited player whose email is taken is told so, and nothing claims they joined', async ({ openContext, api }, testInfo) => {
  const run = `${Date.now()}-${testInfo.project.name}`;
  const host = await api('POST', '/players', { data: { displayName: 'Host', email: `host-${run}@example.test` }, expect: 201 });
  await api('POST', '/players', { data: { displayName: 'Guest', email: `guest-${run}@example.test` }, expect: 201 });
  const created = await api('POST', '/games', {
    credential: host.deviceCredential,
    data: { friendEmail: `guest-${run}@example.test` },
    expect: 201,
  });

  const page = await (await openContext('guest-elsewhere')).newPage();
  await page.goto(`/#/join/${created.invitation.token}`);
  await expect(page.getByRole('heading', { name: 'You’re invited to a game' })).toBeVisible();
  await onboard(page, 'Guest', `guest-${run}@example.test`);
  await expect(page.getByText(/A player already uses this email/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re invited to a game' })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Chess board' })).toHaveCount(0);

  const game = await api('GET', `/games/${created.game.id}`, { credential: host.deviceCredential });
  expect(game.game.status).toBe('waiting'); // the seat is still free
});
