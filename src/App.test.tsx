import { render, screen, within, waitFor } from '@testing-library/react';
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
    turn: 'white',
    moveCount: 0,
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
  // Nobody played yet unless a test says otherwise (#73).
  vi.spyOn(gameApi, 'listOpponents').mockResolvedValue({ opponents: [] });
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
  const ENTERED = {
    player: { id: 'p-arne', displayName: 'Arne', email: 'arne@example.test' },
    deviceCredential: CREDENTIAL,
    created: false,
  };

  it('opens an existing player from their email alone, keeping their name', async () => {
    const user = userEvent.setup();
    const enter = vi.spyOn(gameApi, 'enterPlayer').mockResolvedValue(ENTERED);
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Welcome to the park' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Your email'), ' arne@example.test ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(enter).toHaveBeenCalledWith('arne@example.test', undefined);
    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('friendlygames.identity')!)).toEqual({
      playerId: 'p-arne',
      displayName: 'Arne',
      credential: CREDENTIAL,
    });
  });

  it('asks a new email for a name, then creates the player', async () => {
    const user = userEvent.setup();
    const enter = vi
      .spyOn(gameApi, 'enterPlayer')
      .mockRejectedValueOnce(new ApiError(404, 'player_not_found', 'new'))
      .mockResolvedValueOnce({ ...ENTERED, created: true });
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    render(<App />);
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/This email is new here, so you’ll get a new player/)).toBeVisible();
    await user.type(screen.getByLabelText('Your name'), 'Arne');
    await user.click(screen.getByRole('button', { name: 'Create my player' }));
    expect(enter).toHaveBeenLastCalledWith('arne@example.test', 'Arne');
    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
  });

  it('keeps both inputs and focuses the name when it is already taken, then retries with another (#76)', async () => {
    const user = userEvent.setup();
    const enter = vi
      .spyOn(gameApi, 'enterPlayer')
      .mockRejectedValueOnce(new ApiError(404, 'player_not_found', 'new'))
      .mockRejectedValueOnce(new ApiError(409, 'name_taken', 'taken'))
      .mockResolvedValueOnce({ ...ENTERED, created: true });
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    render(<App />);
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByLabelText('Your name'), 'Harald');
    await user.click(screen.getByRole('button', { name: 'Create my player' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already in use. Please choose another.');
    const nameField = screen.getByLabelText('Your name');
    await waitFor(() => expect(nameField).toHaveFocus());
    expect(nameField).toHaveAttribute('aria-invalid', 'true');
    expect(nameField).toHaveAccessibleDescription('That name is already in use. Please choose another.');
    expect(screen.getByLabelText('Your email')).toHaveValue('arne@example.test');

    await user.clear(nameField);
    await user.type(nameField, 'Arne');
    expect(nameField).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Create my player' }));
    expect(enter).toHaveBeenLastCalledWith('arne@example.test', 'Arne');
    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
  });

  it('goes back to email-only when the email is changed after asking for a name', async () => {
    const user = userEvent.setup();
    const enter = vi
      .spyOn(gameApi, 'enterPlayer')
      .mockRejectedValueOnce(new ApiError(404, 'player_not_found', 'new'))
      .mockResolvedValueOnce(ENTERED);
    vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
    render(<App />);
    await user.type(screen.getByLabelText('Your email'), 'arne@exampel.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByLabelText('Your name');

    await user.clear(screen.getByLabelText('Your email'));
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(enter).toHaveBeenLastCalledWith('arne@example.test', undefined);
  });

  it('says plainly that this is email-only prototype access', () => {
    render(<App />);
    // Visible before submitting, not hidden behind a disclosure.
    const notice = screen.getByText(/Prototype: enter your email to open your games\. Email ownership isn’t checked yet/);
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('anyone who knows your email can play as you');
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAccessibleDescription(/Email ownership isn’t checked yet/);
    expect(screen.queryByText(/only this browser can open them|doesn’t sign you in/)).not.toBeInTheDocument();
  });

  it('keeps the form and saves nothing when the server can’t be reached', async () => {
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'enterPlayer').mockRejectedValue(new NetworkError('down'));
    render(<App />);
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach the game server.');
    expect(localStorage.getItem('friendlygames.identity')).toBeNull();
    expect(screen.getByLabelText('Your email')).toHaveValue('arne@example.test');
  });

  it('takes an invited player who already has a player straight to the table', async () => {
    const user = userEvent.setup();
    window.location.hash = `#/join/${TOKEN}`;
    vi.spyOn(gameApi, 'enterPlayer').mockResolvedValue(ENTERED);
    const redeem = vi.spyOn(gameApi, 'redeemInvitation').mockResolvedValue({ game: game() });
    vi.spyOn(gameApi, 'getGame').mockResolvedValue({ game: game() });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'You’re invited to a game' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('region', { name: /Chess:/ })).toBeInTheDocument();
    expect(redeem).toHaveBeenCalledWith(CREDENTIAL, TOKEN);
    expect(window.location.hash).toBe(`#/game/${GAME_ID}`);
  });

  it('explains an invitation to a game this version cannot show', async () => {
    signIn();
    window.location.hash = `#/join/${TOKEN}`;
    vi.spyOn(gameApi, 'redeemInvitation').mockRejectedValue(new ApiError(422, 'unsupported_game', 'newer'));
    render(<App />);
    expect(await screen.findByText(/needs a newer version of FriendlyGames\. Reload the page/)).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/join/${TOKEN}`);
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
        game({
          id: '22222222-2222-3333-4444-555555555555',
          turn: 'black',
          moveCount: 1,
          chess: { ...game().chess!, moves: ['e2e4'], turn: 'black' },
        }),
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

    // Standard chess stays the default type (#55).
    expect(create).toHaveBeenCalledWith(CREDENTIAL, 'harald@example.test', expect.stringMatching(/^[0-9a-f-]{36}$/), 'chess');
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

  describe('choosing a game type (#55)', () => {
    const FISCHER_FEN = '1r3kr1/pppppppp/8/8/8/8/PPPPPPPP/1R3KR1 w GBgb - 0 1';
    const fischerGame = (overrides: Partial<SharedGame> = {}) =>
      game({ type: 'chess960', chess: undefined, chess960: { initialFen: FISCHER_FEN, moves: [], turn: 'white' }, ...overrides });

    it('creates a Fischer Random game when chosen, explaining it first', async () => {
      const user = userEvent.setup();
      vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
      const create = vi
        .spyOn(gameApi, 'createGame')
        .mockResolvedValue({ game: fischerGame({ status: 'waiting', revision: 0 }), invitation: { token: TOKEN }, duplicate: false });
      render(<App />);

      expect(screen.getByRole('radio', { name: 'Chess' })).toBeChecked();
      expect(screen.queryByText(/one of 960 arrangements/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: 'Fischer Random (Chess960)' }));
      expect(screen.getByText(/one of 960 arrangements/)).toBeInTheDocument();
      expect(screen.getByText(/To castle, select your king and use a castle button/)).toBeInTheDocument();

      await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
      await user.click(screen.getByRole('button', { name: 'Create game' }));
      expect(create).toHaveBeenCalledWith(CREDENTIAL, 'harald@example.test', expect.stringMatching(/^[0-9a-f-]{36}$/), 'chess960');
      expect(await screen.findByText('Your Fischer Random game is ready. You play White.')).toBeInTheDocument();
      expect(screen.getByText(/Send this Fischer Random invitation to your friend/)).toBeInTheDocument();
    });

    it('retries an unconfirmed creation with the same request ID and type', async () => {
      const user = userEvent.setup();
      vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
      const create = vi
        .spyOn(gameApi, 'createGame')
        .mockRejectedValueOnce(new NetworkError('lost'))
        .mockResolvedValueOnce({ game: fischerGame({ status: 'waiting', revision: 0 }), invitation: { token: TOKEN }, duplicate: true });
      render(<App />);
      await user.click(screen.getByRole('radio', { name: 'Fischer Random (Chess960)' }));
      await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
      await user.click(screen.getByRole('button', { name: 'Create game' }));
      await screen.findByText(/Couldn’t confirm/);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
      expect(create.mock.calls[1][3]).toBe('chess960');
    });

    it('uses a new request ID when the type is changed after an unconfirmed attempt', async () => {
      const user = userEvent.setup();
      vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
      const create = vi.spyOn(gameApi, 'createGame').mockRejectedValue(new NetworkError('lost'));
      render(<App />);
      await user.type(screen.getByLabelText('Friend’s email'), 'harald@example.test');
      await user.click(screen.getByRole('button', { name: 'Create game' }));
      await screen.findByText(/Couldn’t confirm/);
      await user.click(screen.getByRole('radio', { name: 'Fischer Random (Chess960)' }));
      expect(screen.getByRole('button', { name: 'Create game' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Create game' }));
      expect(create.mock.calls[1][2]).not.toBe(create.mock.calls[0][2]);
      expect(create.mock.calls.map((call) => call[3])).toEqual(['chess', 'chess960']);
    });

    it('labels each game in a mixed list and keeps tallies per type', async () => {
      vi.spyOn(gameApi, 'listGames').mockResolvedValue({
        games: [game(), fischerGame({ id: '22222222-2222-3333-4444-555555555555' })],
      });
      const finished = { finishedAt: '2026-11-01T12:00:00Z', termination: 'checkmate' as const, yourSeat: 'white' as const, moveCount: 20 };
      vi.mocked(gameApi.history).mockResolvedValue({
        history: [
          { gameType: 'chess', opponent: { id: 'p-harald', displayName: 'Harald' }, wins: 1, draws: 0, losses: 0, games: [{ id: 'g1', outcome: 'win', ...finished }] },
          { gameType: 'chess960', opponent: { id: 'p-harald', displayName: 'Harald' }, wins: 0, draws: 0, losses: 1, games: [{ id: 'g2', outcome: 'loss', ...finished }] },
        ],
      });
      render(<App />);
      const links = within(await screen.findByRole('list', { name: 'Games in progress' })).getAllByRole('link');
      expect(links[0]).toHaveTextContent('Chess · You play White');
      expect(links[1]).toHaveTextContent('Fischer Random · You play White');

      expect(await screen.findByRole('heading', { name: 'With Harald' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Fischer Random with Harald' })).toBeInTheDocument();
      const tally = screen.getByLabelText('Fischer Random tally with Harald');
      expect(within(tally).getByText('Harald').nextSibling).toHaveTextContent('1');
      expect(within(screen.getByLabelText('Tally with Harald')).getByText('You').nextSibling).toHaveTextContent('1');
    });
  });

  describe('starting a game with someone already played (#73)', () => {
    const HARALD = { id: '00000000-0000-4000-8000-00000000000a', displayName: 'Harald', sharedGames: 3, lastSharedGameUpdatedAt: '2026-11-09T18:00:00Z' };
    const OYSTEIN = { id: '00000000-0000-4000-8000-00000000000b', displayName: 'Øystein', sharedGames: 1, lastSharedGameUpdatedAt: '2026-10-02T10:00:00Z' };
    const UUID = expect.stringMatching(/^[0-9a-f-]{36}$/);
    const direct = (overrides: Partial<SharedGame> = {}) => ({ game: game({ revision: 0, ...overrides }), invitation: null, duplicate: false });

    beforeEach(() => {
      vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
      vi.mocked(gameApi.listOpponents).mockResolvedValue({ opponents: [HARALD, OYSTEIN] });
    });

    it('lists previous opponents with truthful context and nobody chosen', async () => {
      render(<App />);
      const picker = await screen.findByRole('group', { name: 'Play with' });
      const harald = within(picker).getByRole('radio', { name: 'Harald' });
      expect(harald).toHaveAccessibleDescription('3 games together · Last shared game 9 Nov 2026');
      expect(within(picker).getByRole('radio', { name: 'Øystein' })).toHaveAccessibleDescription(
        '1 game together · Last shared game 2 Oct 2026',
      );
      for (const radio of within(picker).getAllByRole('radio')) expect(radio).not.toBeChecked();
      expect(within(picker).getByRole('radio', { name: 'Invite someone new' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
      expect(screen.queryByLabelText('Friend’s email')).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Chess' })).toBeChecked(); // default type unchanged
    });

    it('starts a game with a chosen opponent by player ID and opens the table, without email or invitation', async () => {
      const user = userEvent.setup();
      const createWith = vi.spyOn(gameApi, 'createGameWith').mockResolvedValue(direct());
      const create = vi.spyOn(gameApi, 'createGame');
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Harald' }));
      expect(screen.getByText('You play White. Harald plays Black and sees the game in their lobby.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Friend’s email')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Start game' }));

      expect(createWith).toHaveBeenCalledWith(CREDENTIAL, HARALD.id, UUID, 'chess');
      expect(create).not.toHaveBeenCalled();
      await waitFor(() => expect(window.location.hash).toBe(`#/game/${GAME_ID}`));
      expect(screen.queryByLabelText('Invitation link')).not.toBeInTheDocument();
    });

    it('starts Fischer Random with a chosen opponent', async () => {
      const user = userEvent.setup();
      const createWith = vi.spyOn(gameApi, 'createGameWith').mockResolvedValue(direct({ type: 'chess960' }));
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Øystein' }));
      await user.click(screen.getByRole('radio', { name: 'Fischer Random (Chess960)' }));
      expect(screen.getByRole('radio', { name: 'Øystein' })).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      expect(createWith).toHaveBeenCalledWith(CREDENTIAL, OYSTEIN.id, UUID, 'chess960');
    });

    it('keeps Invite someone new as the email-and-link flow', async () => {
      const user = userEvent.setup();
      const createWith = vi.spyOn(gameApi, 'createGameWith');
      const create = vi
        .spyOn(gameApi, 'createGame')
        .mockResolvedValue({ game: game({ status: 'waiting', revision: 0 }), invitation: { token: TOKEN }, duplicate: false });
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Harald' }));
      await user.click(screen.getByRole('radio', { name: 'Invite someone new' }));
      expect(screen.queryByText(/plays Black/)).not.toBeInTheDocument();
      await user.type(screen.getByLabelText('Friend’s email'), 'new@example.test');
      await user.click(screen.getByRole('button', { name: 'Create game' }));
      expect(create).toHaveBeenCalledWith(CREDENTIAL, 'new@example.test', UUID, 'chess');
      expect(createWith).not.toHaveBeenCalled();
      expect(await screen.findByLabelText('Invitation link')).toHaveValue(`http://localhost:3000/#/join/${TOKEN}`);
    });

    it('shows only the invitation form when nobody has been played yet', async () => {
      vi.mocked(gameApi.listOpponents).mockResolvedValue({ opponents: [] });
      render(<App />);
      await waitFor(() => expect(gameApi.listOpponents).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText(/Looking for people/)).not.toBeInTheDocument());
      expect(screen.queryByRole('group', { name: 'Play with' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('Friend’s email')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create game' })).toBeEnabled();
    });

    it('says the list is loading, and a failure is not “nobody played”, keeping the invitation path', async () => {
      const user = userEvent.setup();
      let fail!: (e: unknown) => void;
      vi.mocked(gameApi.listOpponents)
        .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
        .mockResolvedValueOnce({ opponents: [HARALD] });
      render(<App />);
      expect(await screen.findByText('Looking for people you’ve played with…')).toBeInTheDocument();
      expect(screen.getByLabelText('Friend’s email')).toBeInTheDocument();

      fail(new NetworkError('offline'));
      expect(await screen.findByText(/Couldn’t load the people you’ve played with\. You can still invite someone by email\./)).toBeInTheDocument();
      expect(screen.queryByText(/Looking for people/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('Friend’s email')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Load the list again' }));
      expect(await screen.findByRole('radio', { name: 'Harald' })).not.toBeChecked();
      expect(screen.queryByText(/Couldn’t load the people/)).not.toBeInTheDocument();
    });

    it('keeps an email typed while the list was loading on the invitation path', async () => {
      const user = userEvent.setup();
      let resolve!: (v: { opponents: (typeof HARALD)[] }) => void;
      vi.mocked(gameApi.listOpponents).mockReturnValueOnce(new Promise((r) => (resolve = r)));
      render(<App />);
      await user.type(await screen.findByLabelText('Friend’s email'), 'new@example.test');
      resolve({ opponents: [HARALD] });
      expect(await screen.findByRole('radio', { name: 'Invite someone new' })).toBeChecked();
      expect(screen.getByLabelText('Friend’s email')).toHaveValue('new@example.test');
      expect(screen.getByRole('radio', { name: 'Harald' })).not.toBeChecked();
    });

    it('retries an unconfirmed start with the same request ID; a different opponent or type is a new request', async () => {
      const user = userEvent.setup();
      const createWith = vi
        .spyOn(gameApi, 'createGameWith')
        .mockRejectedValueOnce(new NetworkError('lost'))
        .mockRejectedValueOnce(new NetworkError('lost'))
        .mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Down'))
        .mockRejectedValueOnce(new NetworkError('lost'))
        .mockResolvedValueOnce({ ...direct(), duplicate: true });
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Harald' }));
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      expect(await screen.findByText(/Couldn’t confirm whether the game was created/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(createWith).toHaveBeenCalledTimes(2));
      expect(createWith.mock.calls[1]).toEqual(createWith.mock.calls[0]);

      // Another opponent: a new request.
      await user.click(screen.getByRole('radio', { name: 'Øystein' }));
      await user.click(await screen.findByRole('button', { name: 'Start game' }));
      await waitFor(() => expect(createWith).toHaveBeenCalledTimes(3));
      expect(createWith.mock.calls[2][2]).not.toBe(createWith.mock.calls[0][2]);

      // Another type: a new request again.
      await user.click(screen.getByRole('radio', { name: 'Fischer Random (Chess960)' }));
      await user.click(await screen.findByRole('button', { name: 'Start game' }));
      await waitFor(() => expect(createWith).toHaveBeenCalledTimes(4));
      expect(createWith.mock.calls[3][2]).not.toBe(createWith.mock.calls[2][2]);
      expect(createWith.mock.calls[3].slice(1, 2).concat(createWith.mock.calls[3][3])).toEqual([OYSTEIN.id, 'chess960']);

      // The same intent again finds the game the lost reply was about.
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(window.location.hash).toBe(`#/game/${GAME_ID}`));
      expect(createWith.mock.calls[4]).toEqual(createWith.mock.calls[3]);
    });

    it('sends one request however often Start game is pressed', async () => {
      const user = userEvent.setup();
      let finish!: (v: ReturnType<typeof direct>) => void;
      const createWith = vi.spyOn(gameApi, 'createGameWith').mockReturnValue(new Promise((r) => (finish = r)));
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Harald' }));
      const start = screen.getByRole('button', { name: 'Start game' });
      await user.dblClick(start);
      expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
      await user.keyboard('{Enter}');
      expect(createWith).toHaveBeenCalledTimes(1);
      finish(direct());
      await waitFor(() => expect(window.location.hash).toBe(`#/game/${GAME_ID}`));
    });

    it('works from the keyboard', async () => {
      const user = userEvent.setup();
      const createWith = vi.spyOn(gameApi, 'createGameWith').mockResolvedValue(direct());
      render(<App />);
      const harald = await screen.findByRole('radio', { name: 'Harald' });
      harald.focus();
      expect(harald).not.toBeChecked(); // focus alone chooses nobody
      await user.keyboard(' ');
      expect(harald).toBeChecked();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('radio', { name: 'Øystein' })).toBeChecked();
      await user.keyboard('{Enter}');
      expect(createWith).toHaveBeenCalledWith(CREDENTIAL, OYSTEIN.id, UUID, 'chess');
    });

    it('explains refusals plainly and does not reuse the request', async () => {
      const user = userEvent.setup();
      const createWith = vi
        .spyOn(gameApi, 'createGameWith')
        .mockRejectedValueOnce(new ApiError(404, 'opponent_not_found', 'x'))
        .mockRejectedValueOnce(new ApiError(400, 'unsupported_game_type', 'x'));
      render(<App />);
      await user.click(await screen.findByRole('radio', { name: 'Harald' }));
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      expect(await screen.findByText('You have no earlier game with that player. Invite them by email instead.')).toHaveAttribute('role', 'alert');
      await user.click(screen.getByRole('button', { name: 'Start game' }));
      expect(await screen.findByText('This game type isn’t available here. Reload the page to update.')).toHaveAttribute('role', 'alert');
      expect(createWith.mock.calls[1][2]).not.toBe(createWith.mock.calls[0][2]);
    });

    it('keeps a long list compact until asked for everyone', async () => {
      const user = userEvent.setup();
      const many = Array.from({ length: 9 }, (_, i) => ({ ...HARALD, id: `00000000-0000-4000-8000-0000000001${i}0`, displayName: `Friend ${i + 1}` }));
      vi.mocked(gameApi.listOpponents).mockResolvedValue({ opponents: many });
      render(<App />);
      const picker = await screen.findByRole('group', { name: 'Play with' });
      expect(within(picker).getAllByRole('radio')).toHaveLength(7); // six names and Invite someone new
      await user.click(screen.getByRole('button', { name: 'Show all 9' }));
      expect(within(picker).getAllByRole('radio')).toHaveLength(10);
    });
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
  it('asks for the email again when the server no longer knows this browser', async () => {
    const user = userEvent.setup();
    signIn();
    vi.spyOn(gameApi, 'history').mockRejectedValue(new ApiError(401, 'unauthenticated', 'no'));
    vi.spyOn(gameApi, 'listGames').mockRejectedValue(new ApiError(401, 'unauthenticated', 'no'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'We don’t recognise this browser any more' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enter my email' }));
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
