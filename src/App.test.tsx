import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, gameApi, NetworkError, type SharedGame } from './shared/gameApi';

const CREDENTIAL = 'C'.repeat(43);
const TOKEN = 'T'.repeat(43);
const GAME_ID = '11111111-2222-3333-4444-555555555555';

function game(overrides: Partial<SharedGame> = {}): SharedGame {
  return {
    id: GAME_ID,
    type: 'chess',
    schemaVersion: 1,
    status: 'active',
    result: null,
    termination: null,
    revision: 1,
    createdAt: '2026-10-11T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    players: { white: { id: 'p-arne', displayName: 'Arne' }, black: { id: 'p-harald', displayName: 'Harald' } },
    yourSeat: 'white',
    chess: { initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [], turn: 'white' },
    rematchGameId: null,
    ...overrides,
  };
}

function signIn() {
  localStorage.setItem(
    'friendlygames.identity',
    JSON.stringify({ playerId: 'p-arne', displayName: 'Arne', credential: CREDENTIAL }),
  );
}

const consoleCalls: unknown[][] = [];

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  consoleCalls.length = 0;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void consoleCalls.push(args));
  }
});

afterEach(() => {
  // Device credentials and invitation tokens must never reach logs.
  const logged = JSON.stringify(consoleCalls);
  expect(logged).not.toContain(CREDENTIAL);
  expect(logged).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

describe('onboarding', () => {
  it('creates a player, remembers the device and opens the lobby', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(gameApi, 'createPlayer').mockResolvedValue({
      player: { id: 'p-arne', displayName: 'Arne', email: 'arne@example.test' },
      deviceCredential: CREDENTIAL,
    });
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Welcome to the park' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your name'), 'Arne');
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(create).toHaveBeenCalledWith('Arne', 'arne@example.test');
    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('friendlygames.identity')!)).toEqual({
      playerId: 'p-arne',
      displayName: 'Arne',
      credential: CREDENTIAL,
    });
  });

  it('explains that the identity lives on this device only', () => {
    render(<App />);
    expect(screen.getByText(/If this browser’s data is cleared, or you use another device, you start as a new player/)).toBeInTheDocument();
    expect(screen.getByText(/Typing the same email again doesn’t restore them/)).toBeInTheDocument();
  });

  it('asks an invited player to introduce themselves first', () => {
    window.location.hash = `#/join/${TOKEN}`;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'You’re invited to a game' })).toBeInTheDocument();
  });
});

describe('lobby', () => {
  beforeEach(() => {
    signIn();
    vi.spyOn(gameApi, 'history').mockResolvedValue({ history: [] });
  });

  it('shows the real chess history with an exact tally per friend', async () => {
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    vi.mocked(gameApi.history).mockResolvedValue({
      history: [
        {
          gameType: 'chess',
          opponent: { id: 'p-harald', displayName: 'Harald' },
          wins: 2,
          draws: 1,
          losses: 1,
          games: [
            { id: GAME_ID, finishedAt: '2026-10-11T12:00:00Z', outcome: 'win', termination: 'resignation', yourSeat: 'black', moveCount: 1 },
            { id: '22222222-2222-3333-4444-555555555555', finishedAt: '2026-10-10T12:00:00Z', outcome: 'loss', termination: 'checkmate', yourSeat: 'white', moveCount: 4 },
          ],
        },
      ],
    });
    render(<App />);
    const tally = await screen.findByLabelText('Tally with Harald');
    expect(within(tally).getByText('You').nextSibling).toHaveTextContent('2');
    expect(within(tally).getByText('Draws').nextSibling).toHaveTextContent('1');
    expect(within(tally).getByText('Harald').nextSibling).toHaveTextContent('1');
    const games = within(screen.getByRole('list', { name: 'Finished games with Harald' })).getAllByRole('link');
    expect(games[0]).toHaveTextContent('11 Oct 2026');
    expect(games[0]).toHaveTextContent('You won by resignation · 1 moves');
    expect(games[0]).toHaveAttribute('href', `#/game/${GAME_ID}`);
    expect(games[1]).toHaveTextContent('Harald won by checkmate · 4 moves');
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
  });

  it('still lists games when the history cannot be loaded', async () => {
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [game()] });
    vi.mocked(gameApi.history).mockRejectedValue(new NetworkError('offline'));
    render(<App />);
    expect(await screen.findByRole('list', { name: 'Games in progress' })).toHaveTextContent('vs Harald');
    expect(screen.getByText(/Couldn’t load everything/)).toBeInTheDocument();
  });

  it('lists games with whose move it is', async () => {
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({
      games: [
        game(),
        game({ id: '22222222-2222-3333-4444-555555555555', chess: { ...game().chess, moves: ['e2e4'], turn: 'black' } }),
        game({
          id: '33333333-2222-3333-4444-555555555555',
          status: 'finished',
          result: 'white',
          termination: 'checkmate',
        }),
      ],
    });
    render(<App />);
    const inProgress = await screen.findByRole('list', { name: 'Games in progress' });
    const links = within(inProgress).getAllByRole('link');
    expect(links[0]).toHaveTextContent('vs Harald');
    expect(links[0]).toHaveTextContent('Your move');
    expect(links[0]).toHaveAttribute('href', `#/game/${GAME_ID}`);
    expect(links[1]).toHaveTextContent('Harald’s move');
    expect(links).toHaveLength(2); // finished games appear in the history instead
  });

  it('creates a game and offers the invitation link to copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    const create = vi.spyOn(gameApi, 'createGame').mockResolvedValue({
      game: game({ status: 'waiting', revision: 0 }),
      invitation: { token: TOKEN },
      duplicate: false,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);

    await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
    await user.click(screen.getByRole('button', { name: 'Create game' }));

    expect(create).toHaveBeenCalledWith(CREDENTIAL, 'harald@example.test', expect.stringMatching(/^[0-9a-f-]{36}$/));
    const link = `http://localhost:3000/#/join/${TOKEN}`;
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(link);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the table' })).toHaveAttribute('href', `#/game/${GAME_ID}`);
  });

  it('says creation is unconfirmed when the answer is lost, and retries the same request', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    const create = vi
      .spyOn(gameApi, 'createGame')
      .mockRejectedValueOnce(new NetworkError('lost'))
      .mockResolvedValueOnce({ game: game({ status: 'waiting', revision: 0 }), invitation: { token: TOKEN }, duplicate: true });
    render(<App />);

    await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
    await user.click(screen.getByRole('button', { name: 'Create game' }));
    expect(await screen.findByText(/Couldn’t confirm whether the game was created/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was created/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]); // same request ID: the server finds the game
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(`http://localhost:3000/#/join/${TOKEN}`);
  });

  it('uses a new request ID when the friend’s email is changed after an unconfirmed attempt', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    const create = vi.spyOn(gameApi, 'createGame').mockRejectedValue(new NetworkError('lost'));
    render(<App />);
    await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
    await user.click(screen.getByRole('button', { name: 'Create game' }));
    await screen.findByText(/Couldn’t confirm/);
    await user.clear(screen.getByLabelText('Friend’s email'));
    await user.type(screen.getByLabelText('Friend’s email'), 'other@example.test');
    await user.click(screen.getByRole('button', { name: 'Create game' }));
    expect(create.mock.calls[1][2]).not.toBe(create.mock.calls[0][2]);
  });

  it('joins from a pasted invitation link', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    const redeem = vi.spyOn(gameApi, 'redeemInvitation').mockResolvedValue({ game: game({ yourSeat: 'black' }) });
    vi.spyOn(gameApi, 'getGame').mockResolvedValue({ game: game({ yourSeat: 'black' }) });
    render(<App />);

    await user.type(screen.getByLabelText('Paste an invitation link'), `https://friends.example/#/join/${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('grid', { name: 'Chess board' })).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledWith(CREDENTIAL, TOKEN);
    expect(window.location.hash).toBe(`#/game/${GAME_ID}`);
  });
});

describe('joining', () => {
  beforeEach(signIn);

  it('redeems the invitation once and replaces the link in history', async () => {
    window.location.hash = `#/join/${TOKEN}`;
    const redeem = vi.spyOn(gameApi, 'redeemInvitation').mockResolvedValue({ game: game({ yourSeat: 'black' }) });
    vi.spyOn(gameApi, 'getGame').mockResolvedValue({ game: game({ yourSeat: 'black' }) });
    render(<App />);
    expect(await screen.findByRole('grid', { name: 'Chess board' })).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe(`#/game/${GAME_ID}`);
  });

  it('explains an invitation that was already used', async () => {
    window.location.hash = `#/join/${TOKEN}`;
    vi.spyOn(gameApi, 'redeemInvitation').mockRejectedValue(new ApiError(409, 'invitation_used', 'used'));
    render(<App />);
    expect(await screen.findByText('This invitation has already been used by someone else.')).toBeInTheDocument();
  });
});

describe('identity', () => {
  it('offers a fresh start when the server no longer knows this device', async () => {
    const user = userEvent.setup();
    signIn();
    vi.spyOn(gameApi, 'history').mockRejectedValue(new ApiError(401, 'unauthenticated', 'no'));
    vi.spyOn(gameApi, 'listGames').mockRejectedValue(new ApiError(401, 'unauthenticated', 'no'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'We don’t recognise this device any more' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start as a new player' }));
    expect(screen.getByRole('heading', { name: 'Welcome to the park' })).toBeInTheDocument();
    expect(localStorage.getItem('friendlygames.identity')).toBeNull();
  });

  it('keeps local play available without an identity', () => {
    window.location.hash = '#/local';
    render(<App />);
    expect(screen.getByRole('region', { name: 'Chess: White vs Black' })).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });
});
