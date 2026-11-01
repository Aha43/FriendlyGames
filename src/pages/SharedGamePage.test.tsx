import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, gameApi, NetworkError, type SharedGame } from '../shared/gameApi';
import type { Identity } from '../shared/identity';
import SharedGamePage from './SharedGamePage';

const identity: Identity = { playerId: 'p-arne', displayName: 'Arne', credential: 'C'.repeat(43) };
const GAME_ID = '11111111-2222-3333-4444-555555555555';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function game(overrides: Partial<SharedGame> = {}, moves: string[] = []): SharedGame {
  return {
    id: GAME_ID,
    type: 'chess',
    schemaVersion: 1,
    status: 'active',
    result: null,
    termination: null,
    revision: 1 + moves.length,
    createdAt: '2026-10-11T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    players: { white: { id: 'p-arne', displayName: 'Arne' }, black: { id: 'p-harald', displayName: 'Harald' } },
    yourSeat: 'white',
    chess: { initialFen: START, moves, turn: moves.length % 2 === 0 ? 'white' : 'black' },
    rematchGameId: null,
    ...overrides,
  };
}

const square = (name: string) =>
  within(screen.getByRole('grid', { name: 'Chess board' })).getByRole('gridcell', { name: new RegExp(`^${name},`) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderPage(initial: SharedGame) {
  vi.spyOn(gameApi, 'getGame').mockResolvedValue({ game: initial });
  const onIdentityRejected = vi.fn();
  render(<SharedGamePage identity={identity} gameId={GAME_ID} onIdentityRejected={onIdentityRejected} />);
  await screen.findByRole('grid', { name: 'Chess board' });
  return { onIdentityRejected };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shared game', () => {
  it('sends a move with a request ID and the revision it was based on, showing it as unsaved until confirmed', async () => {
    const user = userEvent.setup();
    await renderPage(game());
    expect(screen.getByRole('status')).toHaveTextContent('Your move');

    const reply = deferred<{ game: SharedGame; duplicate: boolean }>();
    const submit = vi.spyOn(gameApi, 'submitAction').mockReturnValue(reply.promise);
    await user.click(square('e2'));
    await user.click(square('e4'));

    expect(submit).toHaveBeenCalledWith(identity.credential, GAME_ID, expect.stringMatching(/^[0-9a-f-]{36}$/), 1, {
      type: 'move',
      from: 'e2',
      to: 'e4',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saving your move…');
    expect(square('e4')).toHaveAccessibleName('e4, white pawn, not saved yet');

    await act(async () => reply.resolve({ game: game({}, ['e2e4']), duplicate: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Harald’s move');
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
  });

  it('keeps the last confirmed position after a network failure and retries the same request', async () => {
    const user = userEvent.setup();
    await renderPage(game());
    const submit = vi
      .spyOn(gameApi, 'submitAction')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValueOnce({ game: game({}, ['e2e4']), duplicate: false });

    await user.click(square('e2'));
    await user.click(square('e4'));

    expect(await screen.findByText(/Couldn’t confirm whether your move was saved/)).toBeInTheDocument();
    expect(square('e2')).toHaveAccessibleName('e2, white pawn');
    expect(square('e4')).toHaveAccessibleName('e4, empty');
    expect(screen.getByRole('status')).not.toHaveTextContent('Saving');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]); // same request ID and revision
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument();
  });

  it('drops an unsaved move on Cancel and reloads the game', async () => {
    const user = userEvent.setup();
    await renderPage(game());
    vi.spyOn(gameApi, 'submitAction').mockRejectedValueOnce(new NetworkError('offline'));
    await user.click(square('e2'));
    await user.click(square('e4'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument();
    expect(gameApi.getGame).toHaveBeenCalledTimes(2);
  });

  it('settles an unconfirmed move as saved when polling shows it on the server', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const user = userEvent.setup();
    await renderPage(game());
    vi.spyOn(gameApi, 'submitAction').mockRejectedValue(new NetworkError('lost'));
    await user.click(square('e2'));
    await user.click(square('e4'));
    expect(await screen.findByText(/Couldn’t confirm whether your move was saved/)).toBeInTheDocument();

    vi.mocked(gameApi.getGame).mockResolvedValue({ game: game({}, ['e2e4']) }); // it did arrive
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The game changed/)).not.toBeInTheDocument();
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    expect(screen.getByRole('status')).toHaveTextContent('Harald’s move');
  });

  it('settles an unconfirmed move as not saved when the server shows something else first', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const user = userEvent.setup();
    await renderPage(game());
    vi.spyOn(gameApi, 'submitAction').mockRejectedValue(new NetworkError('lost'));
    await user.click(square('e2'));
    await user.click(square('e4'));
    await screen.findByText(/Couldn’t confirm/);

    vi.mocked(gameApi.getGame).mockResolvedValue({ game: game({}, ['d2d4']) }); // another tab moved first
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument();
    expect(screen.getByText('The game changed before your move was saved. Here’s the latest position.')).toBeInTheDocument();
    expect(square('e4')).toHaveAccessibleName('e4, empty');
  });

  it('shows the newer game when the move was based on a stale revision', async () => {
    const user = userEvent.setup();
    await renderPage(game());
    const newer = game({}, ['d2d4']); // e.g. played from another tab
    vi.spyOn(gameApi, 'submitAction').mockRejectedValue(
      new ApiError(409, 'stale_revision', 'The game has changed.', newer),
    );
    await user.click(square('e2'));
    await user.click(square('e4'));

    expect(await screen.findByText('The game changed before your move was saved. Here’s the latest position.')).toBeInTheDocument();
    expect(square('d4')).toHaveAccessibleName('d4, white pawn');
    expect(square('e4')).toHaveAccessibleName('e4, empty');
    expect(screen.getByRole('status')).toHaveTextContent('Harald’s move');
  });

  it('polls for the opponent’s move while visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    await renderPage(game({}, ['e2e4']));
    expect(screen.getByRole('status')).toHaveTextContent('Harald’s move');

    vi.mocked(gameApi.getGame).mockResolvedValue({ game: game({}, ['e2e4', 'e7e5']) });
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(await screen.findByText('Your move')).toBeInTheDocument();
    expect(square('e5')).toHaveAccessibleName('e5, black pawn');
  });

  it('says when the server cannot be reached and keeps the last saved position', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    await renderPage(game({}, ['e2e4']));
    vi.mocked(gameApi.getGame).mockRejectedValue(new NetworkError('offline'));
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(await screen.findByText('Can’t reach the game server. Showing the last saved position.')).toBeInTheDocument();
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
  });

  it('explains why a piece cannot be moved when it is not your turn', async () => {
    const user = userEvent.setup();
    await renderPage(game({}, ['e2e4']));
    await user.click(square('d2'));
    expect(screen.getByText('It’s Harald’s move.')).toBeInTheDocument();
    await user.click(square('e7'));
    expect(screen.getByText('You play White.')).toBeInTheDocument();
  });

  it('shows the board from Black’s side to the Black player', async () => {
    await renderPage(game({ yourSeat: 'black' }, ['e2e4']));
    const cells = within(screen.getByRole('grid', { name: 'Chess board' })).getAllByRole('gridcell');
    expect(cells[0]).toHaveAccessibleName('h1, white rook');
    expect(cells[63]).toHaveAccessibleName('a8, black rook');
    expect(screen.getByRole('status')).toHaveTextContent('Your move');
  });

  it('asks before resigning and sends the resignation', async () => {
    const user = userEvent.setup();
    await renderPage(game());
    const submit = vi.spyOn(gameApi, 'submitAction').mockResolvedValue({
      game: game({ status: 'finished', result: 'black', termination: 'resignation', revision: 2 }),
      duplicate: false,
    });

    await user.click(screen.getByRole('button', { name: 'Resign…' }));
    expect(screen.getByText('Resign this game? Harald wins.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(submit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Resign…' }));
    await user.click(screen.getByRole('button', { name: 'Resign' }));
    expect(submit).toHaveBeenCalledWith(identity.credential, GAME_ID, expect.any(String), 1, { type: 'resign' });
    expect(await screen.findByText('You resigned. Harald wins')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resign…' })).not.toBeInTheDocument();
  });

  it('shows the invitation link to the creator while waiting', async () => {
    localStorage.setItem('friendlygames.invitations', JSON.stringify({ [GAME_ID]: 'T'.repeat(43) }));
    await renderPage(game({ status: 'waiting', revision: 0, players: { white: { id: 'p-arne', displayName: 'Arne' }, black: null } }));
    expect(screen.getByRole('status')).toHaveTextContent('Your move. Your friend can join at any time');
    expect(screen.getByLabelText('Invitation link')).toHaveValue(`http://localhost:3000/#/join/${'T'.repeat(43)}`);
  });

  describe('opening while waiting for the friend (#33)', () => {
    const waitingSeats = { white: { id: 'p-arne', displayName: 'Arne' }, black: null };
    const waiting = (moves: string[] = []) =>
      game({ status: 'waiting', revision: moves.length, players: waitingSeats }, moves);
    const plate = (name: string) => screen.getByText(name).parentElement!;

    it('lets the creator make the opening, then says it is saved and keeps the invitation', async () => {
      const user = userEvent.setup();
      localStorage.setItem('friendlygames.invitations', JSON.stringify({ [GAME_ID]: 'T'.repeat(43) }));
      await renderPage(waiting());
      expect(plate('Arne (you)')).toHaveTextContent('To move');
      expect(plate('Waiting for friend')).not.toHaveTextContent('To move');
      expect(screen.queryByRole('button', { name: 'Resign…' })).not.toBeInTheDocument();

      const reply = deferred<{ game: SharedGame; duplicate: boolean }>();
      const submit = vi.spyOn(gameApi, 'submitAction').mockReturnValue(reply.promise);
      await user.click(square('e2'));
      await user.click(square('e4'));
      expect(submit).toHaveBeenCalledWith(identity.credential, GAME_ID, expect.any(String), 0, { type: 'move', from: 'e2', to: 'e4' });
      // Unconfirmed: never called saved.
      expect(screen.getByRole('status')).toHaveTextContent('Saving your move…');
      expect(square('e4')).toHaveAccessibleName('e4, white pawn, not saved yet');

      await act(async () => reply.resolve({ game: waiting(['e2e4']), duplicate: false }));
      expect(screen.getByRole('status')).toHaveTextContent('Your move is saved. Waiting for your friend to join');
      expect(square('e4')).toHaveAccessibleName('e4, white pawn');
      expect(plate('Arne (you)')).not.toHaveTextContent('To move');
      expect(plate('Waiting for friend')).not.toHaveTextContent('To move');
      expect(screen.getByLabelText('Invitation link')).toBeInTheDocument();

      // No second move: the board explains why.
      await user.click(square('d2'));
      expect(screen.getByText('Your move is saved. Waiting for your friend to join.')).toBeInTheDocument();
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('explains an old game server’s refusal and shows the confirmed board again', async () => {
      const user = userEvent.setup();
      await renderPage(waiting());
      vi.spyOn(gameApi, 'submitAction').mockRejectedValue(new ApiError(409, 'not_started', 'Waiting for your friend to join.'));
      await user.click(square('e2'));
      await user.click(square('e4'));
      expect(await screen.findByText(/Your move wasn’t saved: the game server can’t take an opening move/)).toBeInTheDocument();
      expect(square('e2')).toHaveAccessibleName('e2, white pawn');
      expect(square('e4')).toHaveAccessibleName('e4, empty');
      expect(screen.getByRole('status')).toHaveTextContent('Your move. Your friend can join at any time');
    });
  });

  it('lets the creator make a new link when this device has none', async () => {
    const user = userEvent.setup();
    const waiting = game({ status: 'waiting', revision: 0, players: { white: { id: 'p-arne', displayName: 'Arne' }, black: null } });
    await renderPage(waiting);
    const renew = vi.spyOn(gameApi, 'renewInvitation').mockResolvedValue({ game: waiting, invitation: { token: 'N'.repeat(43) } });

    expect(screen.getByText(/This device doesn’t have the invitation link/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make a new invitation link' }));
    expect(renew).toHaveBeenCalledWith(identity.credential, GAME_ID);
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(`http://localhost:3000/#/join/${'N'.repeat(43)}`);
  });

  describe('a finished game', () => {
    const FOOLS_MATE = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    const finished = (overrides: Partial<SharedGame> = {}) =>
      game({ status: 'finished', result: 'black', termination: 'checkmate', updatedAt: '2026-10-08T18:30:00Z', ...overrides }, FOOLS_MATE);

    it('opens read-only with the result and date', async () => {
      const user = userEvent.setup();
      await renderPage(finished());
      expect(screen.getByRole('status')).toHaveTextContent('Checkmate. Harald wins');
      expect(screen.getByText('Finished 8 October 2026')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Resign…' })).not.toBeInTheDocument();
      await user.click(square('a2'));
      expect(square('a2')).toHaveAccessibleName('a2, white pawn');
      expect(screen.getByRole('grid', { name: 'Chess board' })).toHaveClass('board-disabled');
    });

    it('steps through every position with the review buttons and the move list', async () => {
      const user = userEvent.setup();
      await renderPage(finished());
      expect(screen.getByText('Final position, after move 2')).toBeInTheDocument();
      expect(square('h4')).toHaveAccessibleName('h4, black queen');

      await user.click(screen.getByRole('button', { name: 'Previous move' }));
      expect(square('h4')).toHaveAccessibleName('h4, empty');
      // The plates keep showing the result, not whose move it was in the reviewed position.
      expect(screen.getByText('Winner')).toBeInTheDocument();
      expect(screen.queryByText('To move')).not.toBeInTheDocument();
      expect(square('d8')).toHaveAccessibleName('d8, black queen');
      expect(screen.getByText('After move 2 (White)')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Start position' }));
      expect(screen.getByText('Start position', { selector: 'p' })).toBeInTheDocument();
      expect(square('f2')).toHaveAccessibleName('f2, white pawn');
      expect(screen.getByRole('button', { name: 'Previous move' })).toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Move 1, Black: e5' }));
      expect(square('e5')).toHaveAccessibleName('e5, black pawn');
      expect(square('g4')).toHaveAccessibleName('g4, empty');
      expect(screen.getByRole('button', { name: 'Move 1, Black: e5' })).toHaveAttribute('aria-current', 'step');

      await user.click(screen.getByRole('button', { name: 'Final position' }));
      expect(square('h4')).toHaveAccessibleName('h4, black queen');
      expect(screen.getByRole('button', { name: 'Next move' })).toBeDisabled();
    });

    it('starts a rematch with the same friend and opens it', async () => {
      const user = userEvent.setup();
      await renderPage(finished());
      const rematch = vi.spyOn(gameApi, 'rematch').mockResolvedValue({
        game: game({ id: '99999999-2222-3333-4444-555555555555', yourSeat: 'black', revision: 0 }),
        duplicate: false,
      });
      await user.click(screen.getByRole('button', { name: 'Play again (you take Black)' }));
      expect(rematch).toHaveBeenCalledWith(identity.credential, GAME_ID);
      expect(window.location.hash).toBe('#/game/99999999-2222-3333-4444-555555555555');
    });

    it('links to the rematch once one exists', async () => {
      await renderPage(finished({ rematchGameId: '99999999-2222-3333-4444-555555555555' }));
      expect(screen.getByRole('link', { name: 'Go to the rematch' })).toHaveAttribute(
        'href',
        '#/game/99999999-2222-3333-4444-555555555555',
      );
      expect(screen.queryByRole('button', { name: /Play again/ })).not.toBeInTheDocument();
    });
  });

  it('reports a rejected identity', async () => {
    vi.spyOn(gameApi, 'getGame').mockRejectedValue(new ApiError(401, 'unauthenticated', 'no'));
    const onIdentityRejected = vi.fn();
    render(<SharedGamePage identity={identity} gameId={GAME_ID} onIdentityRejected={onIdentityRejected} />);
    await vi.waitFor(() => expect(onIdentityRejected).toHaveBeenCalled());
  });
});
