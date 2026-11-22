// Player details and the invited email (#113): the player's own details with their email, a
// connected player's details without one, and who the creator invited to a game still waiting.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, gameApi, NetworkError, type SharedGame } from './shared/gameApi';

const CREDENTIAL = 'C'.repeat(43);
const ME = { playerId: 'p-arne', displayName: 'Arne', credential: CREDENTIAL };
const MY_EMAIL = 'arne@example.test';
const INVITED = 'kari.nordmann@example.test';
const GAME_ID = '11111111-2222-3333-4444-555555555555';
const HARALD = { id: '00000000-0000-4000-8000-00000000000a', displayName: 'Harald', sharedGames: 3, lastSharedGameUpdatedAt: '2026-11-09T18:00:00Z', connectedAt: null };
const INGRID = { id: '00000000-0000-4000-8000-00000000000b', displayName: 'Ingrid', sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: '2026-11-20T10:00:00Z' };
const WILLIAM = { id: '00000000-0000-4000-8000-00000000000c', displayName: 'William', sharedGames: 1, lastSharedGameUpdatedAt: '2026-10-02T10:00:00Z', connectedAt: '2026-10-01T10:00:00Z' };

function waitingGame(overrides: Partial<SharedGame> = {}): SharedGame {
  return {
    id: GAME_ID,
    type: 'chess',
    schemaVersion: 1,
    status: 'waiting',
    result: null,
    termination: null,
    revision: 0,
    createdAt: '2026-10-11T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    players: { white: { id: 'p-arne', displayName: 'Arne' }, black: null },
    yourSeat: 'white',
    turn: 'white',
    moveCount: 0,
    chess: { initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], turn: 'white' },
    rematchGameId: null,
    ...overrides,
  };
}

const consoleCalls: unknown[][] = [];
beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  consoleCalls.length = 0;
  localStorage.setItem('friendlygames.identity', JSON.stringify(ME));
  vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
  vi.spyOn(gameApi, 'history').mockResolvedValue({ history: [] });
  vi.spyOn(gameApi, 'listOpponents').mockResolvedValue({ opponents: [HARALD, INGRID, WILLIAM] });
  vi.spyOn(gameApi, 'listFriendInvitations').mockResolvedValue({ invitations: [], limit: 20, validDays: 30 });
  vi.spyOn(gameApi, 'me').mockResolvedValue({ player: { id: 'p-arne', displayName: 'Arne', email: MY_EMAIL } });
  vi.spyOn(gameApi, 'pendingInvitation').mockResolvedValue({ invitation: { gameId: GAME_ID, invitedEmail: INVITED, createdAt: '2026-10-11T10:00:00Z' } });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void consoleCalls.push(args));
  }
});
afterEach(() => {
  // Emails and the credential never reach logs, the address or this browser's storage.
  for (const secret of [CREDENTIAL, MY_EMAIL, INVITED]) expect(JSON.stringify(consoleCalls)).not.toContain(secret);
  for (const secret of [MY_EMAIL, INVITED]) {
    expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
  }
  vi.restoreAllMocks();
});

async function lobby() {
  render(<App />);
  await screen.findByRole('heading', { name: 'Your games' });
  await screen.findByRole('group', { name: 'Play with' });
  return userEvent.setup();
}
const mine = () => screen.getByRole('button', { name: 'Your details, Arne' });

describe('your own details', () => {
  it('opens from your name, shows your email read for you alone, and says who sees it', async () => {
    const user = await lobby();
    expect(gameApi.me).not.toHaveBeenCalled(); // read only when asked for
    expect(document.body).not.toHaveTextContent(MY_EMAIL);
    let answer!: (value: Awaited<ReturnType<typeof gameApi.me>>) => void;
    vi.mocked(gameApi.me).mockReturnValue(new Promise((resolve) => (answer = resolve)));

    await user.click(mine());
    const dialog = screen.getByRole('dialog', { name: 'Arne' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Loading…')).toBeInTheDocument();
    await act(async () => answer({ player: { id: 'p-arne', displayName: 'Arne', email: MY_EMAIL } }));
    expect(within(dialog).getByText('Your email').nextElementSibling).toHaveTextContent(MY_EMAIL);
    expect(dialog).toHaveTextContent('Only you see your email. Other players see your name. You use this email to open your games on another device.');
    expect(gameApi.me).toHaveBeenCalledTimes(1);
    expect(gameApi.me).toHaveBeenCalledWith(CREDENTIAL);
    // Nothing speculative: no games count, no connection line about yourself.
    expect(dialog).not.toHaveTextContent(/Games together|Connected/);
  });

  it('is a modal dialog: focus on Close, the page behind inert, Tab stays, Escape closes and returns focus', async () => {
    const user = await lobby();
    mine().focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Arne' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    expect(document.querySelector('main')).toHaveAttribute('inert');
    expect(document.querySelector('header')).toHaveAttribute('inert');
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('main')).not.toHaveAttribute('inert');
    expect(document.querySelector('header')).not.toHaveAttribute('inert');
    expect(mine()).toHaveFocus();

    // The button and a click outside the card close it too; a click inside does not.
    await user.click(mine());
    await user.click(screen.getByText('Your email'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(mine());
    await user.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when the email cannot be read, and reads again the next time it is opened', async () => {
    const user = await lobby();
    vi.mocked(gameApi.me).mockRejectedValueOnce(new NetworkError('offline'));
    await user.click(mine());
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Couldn’t load your email just now.');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(mine());
    expect(await within(screen.getByRole('dialog')).findByText(MY_EMAIL)).toBeInTheDocument();
    expect(gameApi.me).toHaveBeenCalledTimes(2);
  });

  it('a browser the server no longer recognises is told so instead', async () => {
    const user = await lobby();
    vi.mocked(gameApi.me).mockRejectedValue(new ApiError(401, 'unauthorized', 'x'));
    await user.click(mine());
    expect(await screen.findByRole('heading', { name: 'We don’t recognise this browser any more' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('main')).not.toHaveAttribute('inert');
  });

  it('is not offered where there is no player: playing on one device', async () => {
    window.location.hash = '#/local';
    render(<App />);
    await screen.findByRole('link', { name: 'Your games' });
    expect(screen.queryByRole('button', { name: /Your details/ })).not.toBeInTheDocument();
  });
});

describe('details about someone you can play with', () => {
  it('shows the name and what you share, from your own list: never an email, and no request', async () => {
    const user = await lobby();
    const picker = screen.getByRole('group', { name: 'Play with' });

    await user.click(within(picker).getByRole('button', { name: 'Details about Harald' }));
    let dialog = screen.getByRole('dialog', { name: 'Harald' });
    expect(within(dialog).getByText('Games together').nextElementSibling).toHaveTextContent('3, the latest active 9 Nov 2026');
    expect(dialog).not.toHaveTextContent('Connected');
    expect(dialog).toHaveTextContent('You can start a game with Harald under Play with. You’re in each other’s list because you share a game.');
    await user.keyboard('{Escape}');
    expect(within(picker).getByRole('button', { name: 'Details about Harald' })).toHaveFocus();

    await user.click(within(picker).getByRole('button', { name: 'Details about Ingrid' }));
    dialog = screen.getByRole('dialog', { name: 'Ingrid' });
    expect(within(dialog).getByText('Connected').nextElementSibling).toHaveTextContent('By invitation, since 20 Nov 2026');
    expect(within(dialog).getByText('Games together').nextElementSibling).toHaveTextContent('None yet');
    expect(dialog).not.toHaveTextContent(/1970|Invalid|share a game/);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(within(picker).getByRole('button', { name: 'Details about William' }));
    dialog = screen.getByRole('dialog', { name: 'William' });
    expect(dialog).toHaveTextContent('By invitation, since 1 Oct 2026');
    expect(dialog).toHaveTextContent('1, the latest active 2 Oct 2026');

    // No email, no field for one, and nothing was asked of the server about them.
    expect(dialog).not.toHaveTextContent(/email|@/i);
    expect(gameApi.me).not.toHaveBeenCalled();
    expect(gameApi.pendingInvitation).not.toHaveBeenCalled();
  });

  it('opening details does not choose the player, and choosing still works beside it', async () => {
    const user = await lobby();
    const picker = screen.getByRole('group', { name: 'Play with' });
    await user.click(within(picker).getByRole('button', { name: 'Details about Ingrid' }));
    await user.keyboard('{Escape}');
    expect(within(picker).getByRole('radio', { name: 'Ingrid' })).not.toBeChecked();
    await user.click(within(picker).getByRole('radio', { name: 'Ingrid' }));
    expect(within(picker).getByRole('radio', { name: 'Ingrid' })).toBeChecked();
    expect(within(picker).getByRole('radio', { name: 'Ingrid' })).toHaveAccessibleDescription('No games together yet');
  });

  it('is offered for every seat choice in Yatzy too, without seating anyone', async () => {
    const user = await lobby();
    await user.click(screen.getByRole('radio', { name: 'Yatzy' }));
    const picker = screen.getByRole('group', { name: /^Players/ });
    await user.click(within(picker).getByRole('button', { name: 'Details about William' }));
    expect(screen.getByRole('dialog', { name: 'William' })).toHaveTextContent('1, the latest active 2 Oct 2026');
    await user.keyboard('{Escape}');
    expect(within(picker).getByRole('checkbox', { name: 'William' })).not.toBeChecked();
    expect(within(picker).getByRole('button', { name: 'Details about William' })).toHaveFocus();
  });
});

describe('who you invited to a game that is still waiting', () => {
  it('shows the email on your waiting game in the list, and nowhere on games someone joined', async () => {
    const joined = waitingGame({
      id: '22222222-2222-3333-4444-555555555555',
      status: 'active',
      players: { white: { id: 'p-arne', displayName: 'Arne' }, black: { id: HARALD.id, displayName: 'Harald' } },
    });
    vi.mocked(gameApi.listGames).mockResolvedValue({ games: [waitingGame(), joined] });
    await lobby();
    const games = screen.getByRole('list', { name: 'Games in progress' });
    const note = await within(games).findByText(INVITED);
    expect(note.closest('p')).toHaveTextContent(`You invited ${INVITED}. Only you see this.`);
    expect(note.closest('a')).toBeNull(); // beside the link to the game, not inside it
    expect(gameApi.pendingInvitation).toHaveBeenCalledTimes(1);
    expect(gameApi.pendingInvitation).toHaveBeenCalledWith(CREDENTIAL, GAME_ID);
  });

  it('shows it on the game’s own page, for a game made on another device or long ago', async () => {
    vi.spyOn(gameApi, 'getGame').mockResolvedValue({ game: waitingGame() });
    window.location.hash = `#/game/${GAME_ID}`;
    render(<App />);
    expect((await screen.findByText(INVITED)).closest('p')).toHaveTextContent(`You invited ${INVITED}. Only you see this.`);
    expect(gameApi.pendingInvitation).toHaveBeenCalledWith(CREDENTIAL, GAME_ID);
  });

  it.each([
    ['the friend joined a moment ago', new ApiError(409, 'invitation_used', 'x')],
    ['this player is not the creator', new ApiError(403, 'not_creator', 'x')],
    ['the game is gone', new ApiError(404, 'game_not_found', 'x')],
  ])('shows nothing when %s', async (_why, refusal) => {
    vi.mocked(gameApi.listGames).mockResolvedValue({ games: [waitingGame()] });
    vi.mocked(gameApi.pendingInvitation).mockRejectedValue(refusal);
    await lobby();
    await waitFor(() => expect(gameApi.pendingInvitation).toHaveBeenCalled());
    await act(async () => {});
    expect(document.body).not.toHaveTextContent(/You invited|Couldn’t load who/);
  });

  it('says so when the answer does not arrive', async () => {
    vi.mocked(gameApi.listGames).mockResolvedValue({ games: [waitingGame()] });
    vi.mocked(gameApi.pendingInvitation).mockRejectedValue(new NetworkError('offline'));
    await lobby();
    expect(await screen.findByText('Couldn’t load who you invited to this game.')).toBeInTheDocument();
  });

  it('never asks about a waiting game this player did not create', async () => {
    const theirs = waitingGame({ players: { white: { id: HARALD.id, displayName: 'Harald' }, black: null }, yourSeat: null as never });
    vi.mocked(gameApi.listGames).mockResolvedValue({ games: [theirs] });
    await lobby();
    await act(async () => {});
    expect(gameApi.pendingInvitation).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('You invited');
  });

  it('a browser the server no longer recognises is told so', async () => {
    vi.mocked(gameApi.listGames).mockResolvedValue({ games: [waitingGame()] });
    vi.mocked(gameApi.pendingInvitation).mockRejectedValue(new ApiError(401, 'unauthorized', 'x'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'We don’t recognise this browser any more' })).toBeInTheDocument();
  });
});
