import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { completeGame, type Scripted } from '@shared/yatzy/fixtures.ts';
import type { Row } from '@shared/yatzy/rules.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, gameApi, NetworkError, type TableGame } from '../shared/gameApi';
import type { Identity } from '../shared/identity';
import { table, TABLE_ID } from '../test/yatzyTable';
import YatzyPage from './YatzyPage';

const identity: Identity = { playerId: 'p-arne', displayName: 'Arne', credential: 'C'.repeat(43) };
const UUID = expect.stringMatching(/^[0-9a-f-]{36}$/);

function show(initial: TableGame) {
  const onIdentityRejected = vi.fn();
  render(<YatzyPage identity={identity} gameId={TABLE_ID} initial={initial} onIdentityRejected={onIdentityRejected} />);
  return { onIdentityRejected };
}
const die = (n: number) => screen.getByRole('button', { name: new RegExp(`^Die ${n}:`) });
const status = () => screen.getByRole('status');
const cell = (row: string, column: number) => within(screen.getByRole('row', { name: new RegExp(`^${row}\\b`) })).getAllByRole('cell')[column];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(gameApi, 'getGame').mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a turn at the table', () => {
  it('starts with blank dice and one explicit throw; nothing can be kept or scored yet', async () => {
    const user = userEvent.setup();
    const thrown = table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]);
    const submit = vi.spyOn(gameApi, 'submitTableAction').mockResolvedValue({ game: thrown, duplicate: false });
    show(table('free', 2));

    expect(screen.getByRole('region', { name: 'Yatzy: you with Harald' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('Your turn: throw the dice');
    expect(screen.getByText('Yatzy · Free')).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(die(n)).toHaveAccessibleName(`Die ${n}: not thrown yet`);
      expect(die(n)).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: /^Score/ })).not.toBeInTheDocument();
    expect(screen.getByText(/You have 0 banked throws/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Throw the dice' }));
    expect(submit).toHaveBeenCalledWith(identity.credential, TABLE_ID, UUID, 0, { type: 'throw', keep: [] });
    expect(await screen.findByText(/^Throw 1 of 3/)).toBeInTheDocument();
    expect([1, 2, 3, 4, 5].map((n) => die(n).getAttribute('aria-label'))).toEqual(['Die 1: 5', 'Die 2: 5', 'Die 3: 3', 'Die 4: 1', 'Die 5: 5']);
    expect(status()).toHaveTextContent('Your turn: keep dice and throw again, or score');
  });

  it('keeps the dice you hold, by mouse or keyboard, and sends only their positions', async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(gameApi, 'submitTableAction')
      .mockResolvedValue({ game: table('free', 2, [{ throw: [5, 5, 3, 1, 5] }, { throw: [5, 5, 6, 2, 5], keep: [0, 1, 4] }]), duplicate: false });
    show(table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]));

    expect(screen.getByRole('button', { name: 'Throw all five again' })).toBeEnabled();
    await user.click(die(1));
    expect(die(1)).toHaveAttribute('aria-pressed', 'true');
    expect(within(die(1)).getByText('Kept')).toBeInTheDocument();
    // Keyboard: focus a die, Space or Enter toggles it; a second press lets it go again.
    die(2).focus();
    await user.keyboard(' ');
    die(5).focus();
    await user.keyboard('{Enter}');
    die(3).focus();
    await user.keyboard(' ');
    await user.keyboard(' ');
    expect([1, 2, 3, 4, 5].map((n) => die(n).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'false', 'true']);

    await user.click(screen.getByRole('button', { name: 'Keep 3, throw 2 again' }));
    expect(submit).toHaveBeenCalledWith(identity.credential, TABLE_ID, UUID, 1, { type: 'throw', keep: [0, 1, 4] });
    expect(JSON.stringify(submit.mock.calls[0][4])).not.toMatch(/dice|points|tokens/);
    // The kept dice stay held for the next throw, as the server recorded them.
    expect(await screen.findByText(/^Throw 2 of 3/)).toBeInTheDocument();
    expect([1, 2, 3, 4, 5].map((n) => die(n).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'false', 'true']);
    expect(die(3)).toHaveAccessibleName('Die 3: 6');
  });

  it('cannot throw with all five kept', async () => {
    const user = userEvent.setup();
    show(table('free', 2, [{ throw: [5, 5, 5, 5, 5] }]));
    for (const n of [1, 2, 3, 4, 5]) await user.click(die(n));
    const again = screen.getByRole('button', { name: 'Keep 5, throw 0 again' });
    expect(again).toBeDisabled();
    expect(again).toHaveAccessibleDescription('Keep at most four dice to throw again.');
  });

  it('Free: every empty row shows what it would score; scoring is a separate explicit step that says what it banks', async () => {
    const user = userEvent.setup();
    const scored = table('free', 2, [{ throw: [5, 5, 3, 1, 5] }, { score: 'threeOfAKind' }]);
    const submit = vi.spyOn(gameApi, 'submitTableAction').mockResolvedValue({ game: scored, duplicate: false });
    show(table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]));

    const previews = Object.fromEntries(
      screen.getAllByRole('button', { name: /would score/ }).map((b) => b.getAttribute('aria-label')!.split(': would score ')),
    );
    expect(previews).toEqual({
      Ones: '1', Twos: '0', Threes: '3', Fours: '0', Fives: '15', Sixes: '0',
      'One pair': '10', 'Two pairs': '0', 'Three of a kind': '15', 'Four of a kind': '0',
      'Small straight': '0', 'Large straight': '0', 'Full house': '0', Chance: '19', Yatzy: '0',
    });
    expect(screen.queryByRole('button', { name: /^Score/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Pick an empty row/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Chance: would score 19' }));
    expect(screen.getByRole('button', { name: 'Score 19 in Chance' })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled(); // picking a row scores nothing
    await user.click(screen.getByRole('button', { name: 'Three of a kind: would score 15' }));
    expect(screen.getByRole('button', { name: 'Three of a kind: would score 15' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Banks 2 throws for later.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Score 15 in Three of a kind' }));
    expect(submit).toHaveBeenCalledWith(identity.credential, TABLE_ID, UUID, 1, { type: 'score', row: 'threeOfAKind' });
    expect(await screen.findByText('Harald’s turn')).toBeInTheDocument();
    expect(cell('Three of a kind', 0)).toHaveTextContent('15');
    expect(cell('Total', 0)).toHaveTextContent('15');
    expect(cell('Banked throws', 0)).toHaveTextContent('2');
    expect(screen.queryByRole('button', { name: /would score/ })).not.toBeInTheDocument();
  });

  it('says what a score banks after one, two and three throws', () => {
    const again: Scripted = { throw: [5, 5, 3, 1, 5], keep: [0, 1] };
    const { unmount } = render(<YatzyPage identity={identity} gameId={TABLE_ID} initial={table('forced', 2, [{ throw: [5, 5, 3, 1, 5] }, again])} onIdentityRejected={vi.fn()} />);
    expect(screen.getByText(/Banks 1 throw for later\./)).toBeInTheDocument();
    unmount();
    show(table('forced', 2, [{ throw: [5, 5, 3, 1, 5] }, again, again]));
    expect(screen.getByText(/Banks no throws\./)).toBeInTheDocument();
  });

  it('Forced: only the next row on the card can be scored, with nothing to pick', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(gameApi, 'submitTableAction').mockResolvedValue({ game: table('forced', 2, [{ throw: [1, 1, 6, 6, 6] }, { score: 'ones' }]), duplicate: false });
    show(table('forced', 2, [{ throw: [1, 1, 6, 6, 6] }]));
    expect(screen.getByText('Yatzy · Forced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /would score/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ones would score 2')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Sixes would score/)).not.toBeInTheDocument();
    expect(screen.getByText(/Forced order: this is your next row\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Score 2 in Ones' }));
    expect(submit).toHaveBeenCalledWith(identity.credential, TABLE_ID, UUID, 1, { type: 'score', row: 'ones' });
  });

  it('a fourth throw says it uses a banked throw, and is refused in words when none are banked', async () => {
    const user = userEvent.setup();
    const again: Scripted = { throw: [5, 5, 3, 1, 5], keep: [0, 1] };
    const three: Scripted[] = [{ throw: [5, 5, 3, 1, 5] }, again, again];
    // No tokens: three throws made, nothing banked.
    const { unmount } = render(<YatzyPage identity={identity} gameId={TABLE_ID} initial={table('free', 2, three)} onIdentityRejected={vi.fn()} />);
    const blocked = screen.getByRole('button', { name: 'Keep 2, throw 3 again' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription('No throws left this turn and none banked: score a row.');
    unmount();

    // Two banked from a first-throw score in round one; round two, three throws made.
    const banked: Scripted[] = [{ throw: [1, 1, 1, 1, 1] }, { score: 'yatzy' }, { throw: [2, 2, 2, 2, 2] }, { score: 'yatzy' }, ...three];
    const fourth = table('free', 2, [...banked, again]);
    const submit = vi.spyOn(gameApi, 'submitTableAction').mockResolvedValue({ game: fourth, duplicate: false });
    show(table('free', 2, banked));
    expect(screen.getByText(/You have 2 banked throws/)).toBeInTheDocument();
    const paid = screen.getByRole('button', { name: 'Keep 2, throw 3 again' });
    expect(paid).toHaveAccessibleDescription('Another throw uses 1 of your 2 banked throws.');
    await user.click(paid);
    expect(submit).toHaveBeenCalledWith(identity.credential, TABLE_ID, UUID, 7, { type: 'throw', keep: [0, 1] });
    expect(await screen.findByText(/^Throw 4 \(1 banked throw used\)/)).toBeInTheDocument();
    expect(screen.getByText(/You have 1 banked throw\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fives: would score 15' }));
    expect(screen.getByText('Banks no throws.')).toBeInTheDocument();
  });
});

describe('other players', () => {
  it('see whose turn it is, the latest committed dice and what was kept, and cannot act', () => {
    const game = table('free', 3, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }, { throw: [4, 4, 2, 2, 6] }, { throw: [4, 4, 1, 1, 3], keep: [0, 1] }]);
    show(game);
    expect(status()).toHaveTextContent('Harald’s turn');
    expect(screen.getByRole('group', { name: 'Harald’s dice' })).toBeInTheDocument();
    expect(screen.getByText(/^Throw 2 of 3/)).toBeInTheDocument();
    expect([1, 2, 3, 4, 5].map((n) => die(n).getAttribute('aria-label'))).toEqual(['Die 1: 4', 'Die 2: 4', 'Die 3: 1', 'Die 4: 1', 'Die 5: 3']);
    expect([1, 2, 3, 4, 5].map((n) => die(n).getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'false', 'false']);
    for (const n of [1, 2, 3, 4, 5]) expect(die(n)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Throw|Score|would score/ })).not.toBeInTheDocument();
    // The scorecard: three players in turn order, your column first, the player to act marked.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Row', 'You', 'Harald (to play)', 'William']);
    expect(cell('Chance', 0)).toHaveTextContent('16');
    expect(cell('Banked throws', 0)).toHaveTextContent('2');
  });

  it('get the next throw and score on the usual refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const before = table('free', 2, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }, { throw: [4, 4, 2, 2, 6] }]);
    const after = table('free', 2, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }, { throw: [4, 4, 2, 2, 6] }, { score: 'twoPairs' }]);
    vi.mocked(gameApi.getGame).mockResolvedValue({ game: after });
    show(before);
    expect(status()).toHaveTextContent('Harald’s turn');
    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect(status()).toHaveTextContent('Your turn: throw the dice');
    expect(cell('Two pairs', 1)).toHaveTextContent('12');
  });

  it('never go back to an older table', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const newer = table('free', 2, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }]);
    vi.mocked(gameApi.getGame).mockResolvedValue({ game: table('free', 2, [{ throw: [1, 2, 3, 4, 6] }]) });
    show(newer);
    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect(status()).toHaveTextContent('Harald’s turn');
  });
});

describe('when the server does not answer', () => {
  it('a throw of unknown outcome is retried with the same request and kept dice; the saved dice are shown once', async () => {
    const user = userEvent.setup();
    const saved = table('free', 2, [{ throw: [5, 5, 3, 1, 5] }, { throw: [5, 5, 2, 2, 5], keep: [0, 1, 4] }]);
    const submit = vi
      .spyOn(gameApi, 'submitTableAction')
      .mockRejectedValueOnce(new NetworkError('lost'))
      .mockResolvedValueOnce({ game: saved, duplicate: true });
    show(table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]));
    for (const n of [1, 2, 5]) await user.click(die(n));
    await user.click(screen.getByRole('button', { name: 'Keep 3, throw 2 again' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t confirm whether your throw was saved');
    expect(alert).toHaveTextContent('it won’t roll or cost a banked throw twice');
    // Nothing else can be sent while that throw is unsettled.
    expect(screen.getByRole('button', { name: 'Keep 3, throw 2 again' })).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: /would score/ })) expect(b).toBeDisabled();
    expect(die(1)).toBeDisabled();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(await screen.findByText(/^Throw 2 of 3/)).toBeInTheDocument();
    expect(die(3)).toHaveAccessibleName('Die 3: 2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a score of unknown outcome keeps its row and request on retry', async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(gameApi, 'submitTableAction')
      .mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down'))
      .mockResolvedValueOnce({ game: table('free', 2, [{ throw: [5, 5, 3, 1, 5] }, { score: 'fives' }]), duplicate: true });
    show(table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]));
    await user.click(screen.getByRole('button', { name: 'Fives: would score 15' }));
    await user.click(screen.getByRole('button', { name: 'Score 15 in Fives' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t confirm whether your score was saved');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(submit.mock.calls[0][4]).toEqual({ type: 'score', row: 'fives' });
    expect(await screen.findByText('Harald’s turn')).toBeInTheDocument();
    expect(cell('Fives', 0)).toHaveTextContent('15');
  });

  it('settles an unconfirmed action from a refresh that already holds it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.spyOn(gameApi, 'submitTableAction').mockRejectedValue(new NetworkError('lost'));
    vi.mocked(gameApi.getGame).mockResolvedValue({ game: table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]) });
    show(table('free', 2));
    await user.click(screen.getByRole('button', { name: 'Throw the dice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t confirm');
    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(die(1)).toHaveAccessibleName('Die 1: 5');
    expect(screen.getByRole('button', { name: 'Throw all five again' })).toBeEnabled();
  });

  it('sends one request however often a button is pressed', async () => {
    const user = userEvent.setup();
    const reply = deferred<{ game: TableGame; duplicate: boolean }>();
    const submit = vi.spyOn(gameApi, 'submitTableAction').mockReturnValue(reply.promise);
    show(table('free', 2));
    const button = screen.getByRole('button', { name: 'Throw the dice' });
    await user.dblClick(button);
    expect(status()).toHaveTextContent('Throwing…');
    expect(submit).toHaveBeenCalledTimes(1);
    reply.resolve({ game: table('free', 2, [{ throw: [1, 2, 3, 4, 5] }]), duplicate: false });
    expect(await screen.findByText(/^Throw 1 of 3/)).toBeInTheDocument();
  });

  it('shows the latest table when it changed first, and the server’s words for a refusal', async () => {
    const user = userEvent.setup();
    const latest = table('free', 2, [{ throw: [5, 5, 3, 1, 5] }, { throw: [5, 5, 4, 4, 5], keep: [0, 1, 4] }]);
    vi.spyOn(gameApi, 'submitTableAction')
      .mockRejectedValueOnce(new ApiError(409, 'stale_revision', 'Changed', latest))
      .mockRejectedValueOnce(new ApiError(422, 'no_tokens', 'You have no banked throws left.'));
    show(table('free', 2, [{ throw: [5, 5, 3, 1, 5] }]));
    await user.click(screen.getByRole('button', { name: 'Throw all five again' }));
    expect(await screen.findByText('The table changed before that was saved. Here’s the latest.')).toBeInTheDocument();
    expect(screen.getByText(/^Throw 2 of 3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /throw \d again/ }));
    expect(await screen.findByText('You have no banked throws left.')).toBeInTheDocument();
  });

  it('says so when the server cannot be reached, keeping the last saved table', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(gameApi.getGame).mockRejectedValue(new NetworkError('offline'));
    show(table('free', 2, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }]));
    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect(screen.getByRole('alert')).toHaveTextContent('Can’t reach the game server. Showing the last saved table.');
    expect(cell('Chance', 0)).toHaveTextContent('16');
  });

  it('hands a forgotten browser back to the app', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'submitTableAction').mockRejectedValue(new ApiError(401, 'unauthorized', 'No'));
    const { onIdentityRejected } = show(table('free', 2));
    await user.click(screen.getByRole('button', { name: 'Throw the dice' }));
    expect(onIdentityRejected).toHaveBeenCalled();
  });
});

describe('a finished table', () => {
  // The last turn decides: a Yatzy (50) or a miss, scored after one, two or three throws.
  const yatzyOn = (throws: number): Scripted[] => [
    ...Array.from({ length: throws - 1 }, (_, i): Scripted => (i === 0 ? { throw: [6, 6, 6, 6, 1] } : { throw: [6, 6, 6, 6, 1], keep: [0, 1, 2, 3] })),
    throws === 1 ? { throw: [6, 6, 6, 6, 6] } : { throw: [6, 6, 6, 6, 6], keep: [0, 1, 2, 3] },
    { score: 'yatzy' },
  ];
  const miss: Scripted[] = [{ throw: [1, 2, 3, 4, 6] }, { score: 'yatzy' }];
  const ending = (bySeat: Record<number, Scripted[]>) => (seat: number, row: Row) => (row === 'yatzy' ? bySeat[seat] : undefined);
  const standings = () => within(screen.getByRole('list', { name: 'Final standings' })).getAllByRole('listitem').map((li) => li.textContent);

  it('shows the completed scorecard and the places, with no dice or actions', () => {
    show(table('free', 3, completeGame('free', 3, ending({ 0: miss, 1: yatzyOn(3), 2: miss }))));
    expect(status()).toHaveTextContent('Finished. Harald wins');
    expect(standings()).toEqual([
      '1stHarald330 points · 28 banked throws',
      '2ndYou280 points · 30 banked throws',
      '2ndWilliam280 points · 30 banked throws',
    ]);
    expect(screen.queryByText(/tied on/)).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Final scorecard' })).toBeInTheDocument();
    expect(cell('Sum', 0)).toHaveTextContent('63');
    expect(cell('Bonus', 0)).toHaveTextContent('50');
    expect(cell('Yatzy', 1)).toHaveTextContent('50');
    expect(cell('Yatzy', 0)).toHaveTextContent('0');
    expect(cell('Total', 1)).toHaveTextContent('330');
    expect(screen.getByText('Finished 12 November 2026')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /dice/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Throw|Score|Die/ })).not.toBeInTheDocument();
  });

  it('says when banked throws broke a tie on points', () => {
    show(table('forced', 3, completeGame('forced', 3, ending({ 0: yatzyOn(1), 1: yatzyOn(2), 2: miss }))));
    expect(status()).toHaveTextContent('Finished. You win on banked throws');
    expect(standings().map((s) => s!.slice(0, 3))).toEqual(['1st', '2nd', '3rd']);
    expect(screen.getByText('You and Harald tied on 330 points. The most banked throws left decides: You had 30.')).toBeInTheDocument();
  });

  it('names joint winners when points and banked throws both tie', () => {
    show(table('free', 4, completeGame('free', 4, ending({ 0: yatzyOn(2), 1: miss, 2: yatzyOn(2), 3: yatzyOn(3) }))));
    expect(status()).toHaveTextContent('Finished. You and William share the win');
    expect(standings().map((s) => s!.slice(0, 3))).toEqual(['1st', '1st', '3rd', '4th']);
    // Three are level on points, but only two of them on banked throws: only those two won.
    expect(
      screen.getByText('You, William and Øystein tied on 330 points. You and William had the most banked throws left (29 each), so they share the win.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/tied on both/)).not.toBeInTheDocument();
  });

  it('says everyone level on points and banked throws shares the win', () => {
    show(table('free', 3, completeGame('free', 3, ending({ 0: yatzyOn(2), 1: miss, 2: yatzyOn(2) }))));
    expect(status()).toHaveTextContent('Finished. You and William share the win');
    expect(standings().map((s) => s!.slice(0, 3))).toEqual(['1st', '1st', '3rd']);
    expect(screen.getByText('You and William tied on both points (330) and banked throws (29), so they share the win.')).toBeInTheDocument();
  });

  it('does not poll a finished table', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(table('free', 2, completeGame('free', 2)));
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(gameApi.getGame).not.toHaveBeenCalled();
  });
});

describe('four players', () => {
  it('fit one scorecard, seen from a guest’s seat', () => {
    show(table('free', 4, [{ throw: [1, 2, 3, 4, 6] }, { score: 'chance' }], { yourSeat: 'p3' }));
    expect(screen.getByRole('region', { name: 'Yatzy: you with Arne, Harald and Øystein' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Row', 'Arne', 'Harald (to play)', 'You', 'Øystein']);
    expect(status()).toHaveTextContent('Harald’s turn');
    expect(cell('Chance', 0)).toHaveTextContent('16');
  });
});
