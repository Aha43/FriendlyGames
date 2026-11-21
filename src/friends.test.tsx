// Inviting a friend before choosing a game (#111): the lobby's invitation card with its pending
// list and replacement, the friend link's own page, and friends without a shared game in the picker.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { ApiError, gameApi, NetworkError, type PendingFriendInvitation } from './shared/gameApi';

const CREDENTIAL = 'C'.repeat(43);
const TOKEN = 'F'.repeat(43);
const NEW_TOKEN = 'N'.repeat(43);
const ME = { playerId: 'p-arne', displayName: 'Arne', credential: CREDENTIAL };
const linkOf = (token: string) => `${window.location.origin}${window.location.pathname}#/friend/${token}`;
const waiting = (n: number, created = '2026-11-21T10:00:00Z', expires = '2026-12-21T10:00:00Z'): PendingFriendInvitation => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: created,
  expiresAt: expires,
});

const consoleCalls: unknown[][] = [];
beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
  consoleCalls.length = 0;
  vi.spyOn(gameApi, 'listGames').mockResolvedValue({ games: [] });
  vi.spyOn(gameApi, 'history').mockResolvedValue({ history: [] });
  vi.spyOn(gameApi, 'listOpponents').mockResolvedValue({ opponents: [] });
  vi.spyOn(gameApi, 'listFriendInvitations').mockResolvedValue({ invitations: [], limit: 20, validDays: 30 });
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void consoleCalls.push(args));
  }
});
afterEach(() => {
  // Credentials and invitation links must never reach logs, nor stay in this browser's storage.
  for (const secret of [CREDENTIAL, TOKEN, NEW_TOKEN]) expect(JSON.stringify(consoleCalls)).not.toContain(secret);
  for (const secret of [TOKEN, NEW_TOKEN]) expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const signIn = () => localStorage.setItem('friendlygames.identity', JSON.stringify(ME));
const card = () => screen.getByRole('region', { name: 'Invite a friend' });
async function lobby() {
  signIn();
  render(<App />);
  await screen.findByRole('heading', { name: 'Your games' });
  await waitFor(() => expect(gameApi.listFriendInvitations).toHaveBeenCalled());
  return userEvent.setup();
}

describe('Invite a friend, on Your games', () => {
  it('explains what a link does before any is made: one friend, 30 days, no game chosen', async () => {
    await lobby();
    expect(within(card()).getByText(/Get a link to send to a friend, without choosing a game first\./)).toHaveTextContent(
      'Get a link to send to a friend, without choosing a game first. When they accept, you find each other under Play with and can start Chess, Fischer Random or Yatzy. One link is for one friend and works for 30 days.',
    );
    expect(within(card()).getByRole('button', { name: 'Create an invitation link' })).toBeEnabled();
    expect(within(card()).queryByRole('textbox')).not.toBeInTheDocument(); // no email to type
    expect(within(card()).queryByRole('list')).not.toBeInTheDocument();
    expect(gameApi.listFriendInvitations).toHaveBeenCalledWith(CREDENTIAL);
  });

  it('creates one link on one request, shows it once to copy, and lists the invitation as waiting', async () => {
    const user = await lobby();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let answer!: (value: Awaited<ReturnType<typeof gameApi.createFriendInvitation>>) => void;
    const create = vi.spyOn(gameApi, 'createFriendInvitation').mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue({ invitations: [waiting(1)], limit: 20, validDays: 30 });

    await user.dblClick(within(card()).getByRole('button', { name: 'Create an invitation link' }));
    expect(within(card()).getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(CREDENTIAL, expect.stringMatching(/^[0-9a-f-]{36}$/));
    await act(async () => answer({ invitation: { ...waiting(1), token: TOKEN }, duplicate: false }));

    const shown = within(card()).getByRole('group', { name: 'The link to send' });
    expect(within(shown).getByLabelText('Invitation link')).toHaveValue(linkOf(TOKEN));
    expect(shown).toHaveTextContent('It connects you with whoever accepts it first, so share it only with them. It is shown only now: if you lose it, replace the invitation below to get a new link.');
    await user.click(within(shown).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(linkOf(TOKEN));
    expect(within(shown).getByRole('button', { name: 'Copied!' })).toBeInTheDocument();

    const list = await within(card()).findByRole('list', { name: 'Waiting to be accepted (1 of 20)' });
    expect(within(list).getByRole('listitem')).toHaveTextContent('1. Created 21 Nov 2026Expires 21 Dec 2026Its link is shown above');
    // Done puts the link away for good; the invitation stays listed, without it.
    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(within(card()).queryByLabelText('Invitation link')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(within(list).getByRole('listitem')).toHaveTextContent('1. Created 21 Nov 2026Expires 21 Dec 2026');
  });

  it('lets the link be selected and copied by hand when the browser refuses to copy', async () => {
    const user = await lobby();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    vi.spyOn(gameApi, 'createFriendInvitation').mockResolvedValue({ invitation: { ...waiting(1), token: TOKEN }, duplicate: false });
    await user.click(within(card()).getByRole('button', { name: 'Create an invitation link' }));
    await user.click(await within(card()).findByRole('button', { name: 'Copy link' }));
    expect(await within(card()).findByText('Couldn’t copy. Select the link and copy it by hand.')).toHaveAttribute('role', 'alert');
    const field = within(card()).getByLabelText('Invitation link') as HTMLInputElement;
    await user.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(linkOf(TOKEN).length);
    expect(field).toHaveAttribute('readonly');
  });

  it('after a lost answer, tries again with the same request and gets a link, never a second invitation', async () => {
    const user = await lobby();
    const create = vi
      .spyOn(gameApi, 'createFriendInvitation')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockRejectedValueOnce(new ApiError(503, 'unavailable', 'x'))
      .mockResolvedValueOnce({ invitation: { ...waiting(1), token: NEW_TOKEN }, duplicate: true });
    await user.click(within(card()).getByRole('button', { name: 'Create an invitation link' }));
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      'Couldn’t confirm whether the invitation was created: the game server didn’t answer. Trying again is safe; it won’t create a second invitation.',
    );
    await user.click(within(card()).getByRole('button', { name: 'Try again' }));
    await user.click(await within(card()).findByRole('button', { name: 'Try again' }));
    expect(await within(card()).findByLabelText('Invitation link')).toHaveValue(linkOf(NEW_TOKEN));
    const ids = create.mock.calls.map((call) => call[1]);
    expect(new Set(ids).size).toBe(1);
    // The next creation is a new request.
    create.mockResolvedValueOnce({ invitation: { ...waiting(2), token: TOKEN }, duplicate: false });
    await user.click(within(card()).getByRole('button', { name: 'Create another invitation' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(4));
    expect(create.mock.calls[3][1]).not.toBe(ids[0]);
  });

  it('at the cap, says so, offers no creation, and points to replacement', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue({ invitations: Array.from({ length: 20 }, (_, i) => waiting(i + 1)), limit: 20, validDays: 30 });
    await lobby();
    expect(await within(card()).findByText('You have 20 invitations waiting, which is the most you can have. Replace one of them below to get a new link.')).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Create an invitation link' })).toBeDisabled();
    expect(within(card()).getByRole('list', { name: 'Waiting to be accepted (20 of 20)' })).toBeInTheDocument();
    expect(within(card()).getAllByRole('button', { name: /^Replace the link of Invitation \d+, created/ })).toHaveLength(20);
  });

  it('explains the server’s refusals: the cap reached meanwhile, accepted meanwhile, expired', async () => {
    const user = await lobby();
    const create = vi.spyOn(gameApi, 'createFriendInvitation');
    const cases: [ApiError, string][] = [
      [new ApiError(409, 'friend_invitation_limit', 'x'), 'You have 20 invitations waiting, which is the most you can have. Replace one of them below to get a new link.'],
      [new ApiError(409, 'friend_invitation_accepted', 'x'), 'That invitation was created and has already been accepted. Your friend is under Play with.'],
      [new ApiError(410, 'friend_invitation_expired', 'x'), 'That invitation has expired. Create a new one.'],
      [new ApiError(400, 'bad_request', 'x'), 'Couldn’t create an invitation. Please try again.'],
    ];
    const ids: string[] = [];
    for (const [refusal, text] of cases) {
      create.mockRejectedValueOnce(refusal);
      await user.click(within(card()).getByRole('button', { name: 'Create an invitation link' }));
      await waitFor(() => expect(within(card()).getAllByRole('alert')[0]).toHaveTextContent(text));
      ids.push(create.mock.calls[create.mock.calls.length - 1][1]);
    }
    expect(new Set(ids).size).toBe(4); // a refused request is never reused
    expect(gameApi.listFriendInvitations).toHaveBeenCalledTimes(5); // the list is re-read after each
  });

  it('says when the waiting list could not be loaded, without calling that "none", and loads it again', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockRejectedValueOnce(new NetworkError('offline')).mockResolvedValue({ invitations: [waiting(1)], limit: 20, validDays: 30 });
    const user = await lobby();
    expect(await within(card()).findByText(/Couldn’t load your waiting invitations\./)).toBeInTheDocument();
    expect(within(card()).getByRole('button', { name: 'Create an invitation link' })).toBeEnabled();
    await user.click(within(card()).getByRole('button', { name: 'Load them again' }));
    expect(await within(card()).findByRole('list', { name: 'Waiting to be accepted (1 of 20)' })).toBeInTheDocument();
    expect(within(card()).queryByText(/Couldn’t load your waiting invitations/)).not.toBeInTheDocument();
  });
});

describe('replacing a waiting invitation', () => {
  const two = { invitations: [waiting(1, '2026-11-01T10:00:00Z', '2026-12-01T10:00:00Z'), waiting(2)], limit: 20, validDays: 30 };
  const row = (n: number) => within(card()).getAllByRole('listitem')[n - 1];
  const openQuestion = async (user: ReturnType<typeof userEvent.setup>, n: number) => {
    await user.click(within(row(n)).getByRole('button', { name: /^Replace the link of Invitation/ }));
    return within(row(n)).getByRole('group', { name: /^Confirm replacing the link of Invitation/ });
  };

  it('asks first, saying the old link stops working; Keep it changes nothing', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue(two);
    const user = await lobby();
    await within(card()).findByRole('list');
    const replace = vi.spyOn(gameApi, 'replaceFriendInvitation');
    const question = await openQuestion(user, 1);
    expect(within(question).getByText(/Replace this link\?/)).toHaveFocus();
    expect(question).toHaveTextContent('Replace this link? The old link stops working at once, also if you’ve already sent it. The new link is valid for 30 days.');
    await user.click(within(question).getByRole('button', { name: 'Keep it' }));
    expect(within(card()).queryByRole('group', { name: /^Confirm replacing/ })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces the chosen one once, shows its new link, and the list keeps its length and new expiry', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue(two);
    const user = await lobby();
    await within(card()).findByRole('list');
    const replaced = { ...two.invitations[0], expiresAt: '2026-12-21T12:00:00Z' };
    let answer!: (value: Awaited<ReturnType<typeof gameApi.replaceFriendInvitation>>) => void;
    const replace = vi.spyOn(gameApi, 'replaceFriendInvitation').mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue({ ...two, invitations: [replaced, two.invitations[1]] });

    const question = await openQuestion(user, 1);
    await user.dblClick(within(question).getByRole('button', { name: 'Replace link' }));
    expect(within(question).getByRole('button', { name: 'Replacing…' })).toBeDisabled();
    expect(within(question).getByRole('button', { name: 'Keep it' })).toBeDisabled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(CREDENTIAL, two.invitations[0].id);
    await act(async () => answer({ invitation: { ...replaced, token: NEW_TOKEN } }));

    const shown = within(card()).getByRole('group', { name: 'The new link to send' });
    expect(within(shown).getByLabelText('Invitation link')).toHaveValue(linkOf(NEW_TOKEN));
    expect(shown).toHaveTextContent('Here is the new link; the old one no longer works.');
    await waitFor(() => expect(row(1)).toHaveTextContent('1. Created 1 Nov 2026Expires 21 Dec 2026Its link is shown above'));
    expect(within(card()).getAllByRole('listitem')).toHaveLength(2);
    expect(row(2)).toHaveTextContent('2. Created 21 Nov 2026Expires 21 Dec 2026');
  });

  it('after a lost answer, says the old link may be dead and replaces again safely', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue(two);
    const user = await lobby();
    await within(card()).findByRole('list');
    const replace = vi
      .spyOn(gameApi, 'replaceFriendInvitation')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValueOnce({ invitation: { ...two.invitations[1], token: NEW_TOKEN } });
    const question = await openQuestion(user, 2);
    await user.click(within(question).getByRole('button', { name: 'Replace link' }));
    expect(await within(question).findByRole('alert')).toHaveTextContent(
      'Couldn’t confirm whether the link was replaced: the game server didn’t answer. Trying again is safe. The old link may already have stopped working.',
    );
    await user.click(within(question).getByRole('button', { name: 'Try again' }));
    expect(await within(card()).findByLabelText('Invitation link')).toHaveValue(linkOf(NEW_TOKEN));
    expect(replace.mock.calls.map((call) => call[1])).toEqual([two.invitations[1].id, two.invitations[1].id]);
  });

  it('says so when the invitation was accepted or expired while the question was open', async () => {
    vi.mocked(gameApi.listFriendInvitations).mockResolvedValue(two);
    const user = await lobby();
    await within(card()).findByRole('list');
    const replace = vi.spyOn(gameApi, 'replaceFriendInvitation');
    for (const [refusal, text] of [
      [new ApiError(409, 'friend_invitation_accepted', 'x'), 'That invitation has just been accepted, so there is nothing to replace. Your friend is under Play with.'],
      [new ApiError(404, 'friend_invitation_not_found', 'x'), 'That invitation is no longer waiting (it may have expired). Create a new one if you need a link.'],
    ] as const) {
      replace.mockRejectedValueOnce(refusal);
      const question = await openQuestion(user, 1);
      await user.click(within(question).getByRole('button', { name: 'Replace link' }));
      await waitFor(() => expect(within(card()).getAllByRole('alert')[0]).toHaveTextContent(text));
      expect(within(card()).queryByRole('group', { name: /^Confirm replacing/ })).not.toBeInTheDocument();
    }
  });
});

describe('a friend invitation link', () => {
  const open = (token = TOKEN) => {
    window.location.hash = `#/friend/${token}`;
    return render(<App />);
  };
  const page = () => screen.getByRole('region', { name: /invites you to play|This is your own|isn’t available|are connected|Couldn’t open|Opening the/ });

  it('shows who invites before anything else, then asks a new visitor for their email, then waits for Accept', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    vi.spyOn(gameApi, 'enterPlayer').mockResolvedValue({ player: { id: 'p-arne', displayName: 'Arne' }, deviceCredential: CREDENTIAL } as never);
    const accept = vi.spyOn(gameApi, 'acceptFriendInvitation').mockResolvedValue({ friend: { id: 'p-harald', displayName: 'Harald' }, duplicate: false });
    open();
    expect(await screen.findByRole('heading', { name: 'Harald invites you to play' })).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(TOKEN, undefined);
    expect(page()).toHaveTextContent('Accept to connect with Harald on FriendlyGames. You’ll then find each other under Play with and can start Chess, Fischer Random or Yatzy. Accepting doesn’t start a game.');
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
    // Onboarding as usual, worded for this.
    expect(screen.getByRole('heading', { name: 'First, who are you?' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Your email'), 'arne@example.test');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Now known, and asked again with the credential; nothing is accepted without the click.
    const button = await screen.findByRole('button', { name: 'Accept and connect with Harald' });
    expect(preview).toHaveBeenLastCalledWith(TOKEN, CREDENTIAL);
    expect(page()).toHaveTextContent('You’re accepting as Arne.');
    expect(accept).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#/friend/${TOKEN}`);
    await user.click(button);
    expect(await screen.findByRole('heading', { name: 'You and Harald are connected' })).toBeInTheDocument();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(CREDENTIAL, TOKEN);
    expect(screen.getByRole('status')).toHaveTextContent('You’ll find Harald under Play with when you start a game, and Harald finds you there too. No game has been started');
  });

  it('for a known player: one click accepts once, then the lobby says so and the link is out of the address', async () => {
    signIn();
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    let answer!: (value: Awaited<ReturnType<typeof gameApi.acceptFriendInvitation>>) => void;
    const accept = vi.spyOn(gameApi, 'acceptFriendInvitation').mockReturnValue(new Promise((resolve) => (answer = resolve)));
    vi.mocked(gameApi.listOpponents).mockResolvedValue({
      opponents: [{ id: 'p-harald', displayName: 'Harald', sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: '2026-11-21T10:00:00Z' }],
    });
    open();
    expect(screen.queryByRole('heading', { name: 'First, who are you?' })).not.toBeInTheDocument();
    await user.dblClick(await screen.findByRole('button', { name: 'Accept and connect with Harald' }));
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
    expect(accept).toHaveBeenCalledTimes(1);
    await act(async () => answer({ friend: { id: 'p-harald', displayName: 'Harald' }, duplicate: false }));
    await user.click(await screen.findByRole('button', { name: 'Go to your games' }));

    expect(await screen.findByRole('heading', { name: 'Your games' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
    expect(screen.getByText('You and Harald are connected. Find them under Play with.')).toHaveAttribute('role', 'status');
    // In Play with, without an invented date or count.
    const picker = await screen.findByRole('group', { name: 'Play with' });
    const harald = within(picker).getByRole('radio', { name: 'Harald' });
    expect(harald).toHaveAccessibleDescription('No games together yet');
    expect(picker).not.toHaveTextContent(/1970|0 games|Invalid/);
    expect(gameApi.listGames).toHaveBeenCalled();
  });

  it('after a reload, shows an invitation this player already accepted as accepted', async () => {
    signIn();
    const accept = vi.spyOn(gameApi, 'acceptFriendInvitation');
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'accepted' } });
    open();
    expect(await screen.findByRole('heading', { name: 'You and Harald are connected' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('You’ve already accepted this invitation.');
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
  });

  it('after a lost answer, says so and accepts again safely', async () => {
    signIn();
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    const accept = vi
      .spyOn(gameApi, 'acceptFriendInvitation')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValueOnce({ friend: { id: 'p-harald', displayName: 'Harald' }, duplicate: true });
    open();
    await user.click(await screen.findByRole('button', { name: 'Accept and connect with Harald' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t confirm that you’re connected: the game server didn’t answer. Trying again is safe.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'You and Harald are connected' })).toBeInTheDocument();
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('says plainly when the link is your own, with nothing to accept', async () => {
    signIn();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Arne' }, state: 'own' } });
    open();
    expect(await screen.findByRole('heading', { name: 'This is your own invitation' })).toBeInTheDocument();
    expect(page()).toHaveTextContent('Send this link to a friend. It connects you with the first person who accepts it, so you can’t accept it yourself.');
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your games' })).toHaveAttribute('href', '#/');
  });

  it('gives one explanation for an expired, replaced or used link, to a visitor and to a player, without asking for an email', async () => {
    vi.spyOn(gameApi, 'previewFriendInvitation').mockRejectedValue(new ApiError(404, 'friend_invitation_unavailable', 'x'));
    const visitor = open();
    expect(await screen.findByRole('heading', { name: 'This invitation isn’t available' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('It may have expired, been replaced by a newer link, or already been used by someone. A link works for one friend, once. Ask your friend for a new one.');
    expect(screen.queryByLabelText('Your email')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open FriendlyGames' })).toHaveAttribute('href', '#/');
    visitor.unmount();
    signIn();
    open();
    expect(await screen.findByRole('heading', { name: 'This invitation isn’t available' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your games' })).toBeInTheDocument();
  });

  it('says so when someone else accepted it, or it was replaced, between opening and accepting', async () => {
    signIn();
    const user = userEvent.setup();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    vi.spyOn(gameApi, 'acceptFriendInvitation').mockRejectedValue(new ApiError(404, 'friend_invitation_unavailable', 'x'));
    open();
    await user.click(await screen.findByRole('button', { name: 'Accept and connect with Harald' }));
    expect(await screen.findByRole('heading', { name: 'This invitation isn’t available' })).toBeInTheDocument();
  });

  it('tells a failure to reach the server apart from a dead link, and tries again', async () => {
    const user = userEvent.setup();
    const preview = vi
      .spyOn(gameApi, 'previewFriendInvitation')
      .mockRejectedValueOnce(new NetworkError('offline'))
      .mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    open();
    expect(await screen.findByRole('heading', { name: 'Couldn’t open the invitation' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach the game server. The invitation itself may be fine.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Harald invites you to play' })).toBeInTheDocument();
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it('says this browser is no longer recognised when the server says so', async () => {
    signIn();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockRejectedValue(new ApiError(401, 'unauthenticated', 'x'));
    open();
    expect(await screen.findByRole('heading', { name: 'We don’t recognise this browser any more' })).toBeInTheDocument();
  });

  it('is its own kind of link: pasted in the lobby it opens this page, and a game link still joins a game', async () => {
    const user = await lobby();
    vi.spyOn(gameApi, 'previewFriendInvitation').mockResolvedValue({ invitation: { inviter: { displayName: 'Harald' }, state: 'open' } });
    await user.type(screen.getByLabelText('Paste an invitation link'), ` ${linkOf(TOKEN)} `);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByRole('heading', { name: 'Harald invites you to play' })).toBeInTheDocument();
    expect(window.location.hash).toBe(`#/friend/${TOKEN}`);
  });
});

describe('Play with', () => {
  it('lists a friend without a shared game beside people played with, and either can be chosen', async () => {
    vi.mocked(gameApi.listOpponents).mockResolvedValue({
      opponents: [
        { id: '00000000-0000-4000-8000-00000000000a', displayName: 'Harald', sharedGames: 3, lastSharedGameUpdatedAt: '2026-11-09T18:00:00Z', connectedAt: null },
        { id: '00000000-0000-4000-8000-00000000000b', displayName: 'Ingrid', sharedGames: 0, lastSharedGameUpdatedAt: null, connectedAt: '2026-11-20T10:00:00Z' },
        { id: '00000000-0000-4000-8000-00000000000c', displayName: 'William', sharedGames: 1, lastSharedGameUpdatedAt: '2026-10-02T10:00:00Z', connectedAt: '2026-10-01T10:00:00Z' },
      ],
    });
    const user = await lobby();
    const picker = await screen.findByRole('group', { name: 'Play with' });
    expect(within(picker).getByRole('radio', { name: 'Harald' })).toHaveAccessibleDescription('3 games together · Last shared game 9 Nov 2026');
    expect(within(picker).getByRole('radio', { name: 'Ingrid' })).toHaveAccessibleDescription('No games together yet');
    expect(within(picker).getByRole('radio', { name: 'William' })).toHaveAccessibleDescription('1 game together · Last shared game 2 Oct 2026');
    expect(gameApi.listOpponents).toHaveBeenCalledWith(CREDENTIAL);

    const start = vi.spyOn(gameApi, 'createGameWith').mockRejectedValue(new ApiError(400, 'bad_request', 'x'));
    await user.click(within(picker).getByRole('radio', { name: 'Ingrid' }));
    expect(screen.getByText('You play White. Ingrid plays Black and sees the game in their lobby.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(CREDENTIAL, '00000000-0000-4000-8000-00000000000b', expect.any(String), 'chess'));
    // And seated at a Yatzy table.
    await user.click(screen.getByRole('radio', { name: 'Yatzy' }));
    expect(screen.getByRole('checkbox', { name: 'Ingrid' })).toBeEnabled();
  });
});
