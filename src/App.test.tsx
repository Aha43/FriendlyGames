import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, gameApi, type SharedGame } from './shared/gameApi';

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
  beforeEach(signIn);

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
    expect(within(screen.getByRole('list', { name: 'Finished games' })).getByRole('link')).toHaveTextContent(
      'Checkmate. You win',
    );
  });

  it('creates a game and offers the invitation link to copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    const create = vi.spyOn(gameApi, 'createGame').mockResolvedValue({
      game: game({ status: 'waiting', revision: 0 }),
      invitation: { token: TOKEN },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);

    await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
    await user.click(screen.getByRole('button', { name: 'Create game' }));

    expect(create).toHaveBeenCalledWith(CREDENTIAL, 'harald@example.test');
    const link = `http://localhost:3000/#/join/${TOKEN}`;
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(link);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the table' })).toHaveAttribute('href', `#/game/${GAME_ID}`);
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
