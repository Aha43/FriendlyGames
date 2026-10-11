import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { newGame } from './chess/game';

const board = () => screen.getByRole('grid', { name: 'Chess board' });
const square = (name: string) => within(board()).getByRole('gridcell', { name: new RegExp(`^${name},`) });
const status = () => screen.getByRole('status');

async function clickMoves(user: ReturnType<typeof userEvent.setup>, ...moves: string[]) {
  for (const m of moves) {
    await user.click(square(m.slice(0, 2)));
    await user.click(square(m.slice(2, 4)));
  }
}

beforeEach(() => localStorage.clear());

describe('App', () => {
  it('sets the table with both players, the starting position and whose turn it is', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'FriendlyGames' })).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Chess: Arne vs Harald' });
    expect(within(table).getByText('Arne')).toBeInTheDocument();
    expect(within(table).getByText('Harald')).toBeInTheDocument();
    expect(status()).toHaveTextContent('Arne to move');

    const squares = within(board()).getAllByRole('gridcell');
    expect(squares).toHaveLength(64);
    expect(squares[0]).toHaveAccessibleName('a8, black rook');
    expect(squares[63]).toHaveAccessibleName('h1, white rook');
    expect(board().querySelectorAll('img.piece')).toHaveLength(32);
  });

  it('moves a piece by tapping it and then a highlighted legal square', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(square('e2'));
    expect(square('e2')).toHaveAccessibleName('e2, white pawn, selected');
    expect(square('e3')).toHaveAccessibleName('e3, empty, legal move');
    expect(square('e4')).toHaveAccessibleName('e4, empty, legal move');
    expect(square('e5')).toHaveAccessibleName('e5, empty');

    await user.click(square('e4'));
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    expect(square('e2')).toHaveAccessibleName('e2, empty');
    expect(status()).toHaveTextContent('Harald to move');
    expect(within(screen.getByRole('list', { name: 'Moves' })).getByText('e4')).toBeInTheDocument();
  });

  it('rejects an illegal move and keeps the position', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(square('e2'));
    await user.click(square('e5'));
    expect(screen.getByText('That move isn’t allowed.')).toBeInTheDocument();
    expect(square('e2')).toHaveAccessibleName('e2, white pawn');
    expect(status()).toHaveTextContent('Arne to move');

    await user.click(square('e7'));
    expect(screen.getByText('It’s Arne’s turn.')).toBeInTheDocument();
    expect(square('e7')).toHaveAccessibleName('e7, black pawn');
  });

  it('plays moves from the keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    expect(square('e2')).toHaveFocus();
    await user.keyboard('{Enter}{ArrowUp}{ArrowUp}{Enter}');
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    expect(status()).toHaveTextContent('Harald to move');

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{Enter}{Escape}');
    expect(square('e7')).toHaveAccessibleName('e7, black pawn');
    expect(square('e6')).toHaveAccessibleName('e6, empty');
  });

  it('shows check and checkmate, then stops play', async () => {
    const user = userEvent.setup();
    render(<App />);
    await clickMoves(user, 'f2f3', 'e7e5', 'g2g4');
    await clickMoves(user, 'd8h4');
    expect(status()).toHaveTextContent('Checkmate. Harald wins');
    expect(square('e1')).toHaveAccessibleName('e1, white king, in check');
    expect(screen.getByText('Winner')).toBeInTheDocument();

    await user.click(square('a2'));
    expect(square('a2')).toHaveAccessibleName('a2, white pawn');
  });

  it('asks which piece to promote to', async () => {
    localStorage.setItem(
      'friendlygames.localChess',
      JSON.stringify(newGame('8/P6k/8/8/8/8/6K1/8 w - - 0 1')),
    );
    const user = userEvent.setup();
    render(<App />);
    await clickMoves(user, 'a7a8');
    const dialog = screen.getByRole('dialog', { name: 'Promote pawn to' });
    expect(within(dialog).getByRole('button', { name: 'Queen' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Knight' }));
    expect(square('a8')).toHaveAccessibleName('a8, white knight');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('promotion dialog from the keyboard', () => {
    // White pawn on a7 about to promote; black king h7 and pawn d5, white king g2.
    beforeEach(() =>
      localStorage.setItem('friendlygames.localChess', JSON.stringify(newGame('8/P6k/8/3p4/8/8/6K1/8 w - - 0 1'))),
    );

    /** Tab onto the board (focus starts on e2), walk to a7 and push the pawn to a8. */
    async function openPicker(user: ReturnType<typeof userEvent.setup>) {
      await user.tab();
      await user.keyboard('{ArrowLeft>4/}{ArrowUp>5/}');
      expect(square('a7')).toHaveFocus();
      await user.keyboard('{Enter}{ArrowUp}{Enter}');
      return screen.getByRole('dialog', { name: 'Promote pawn to' });
    }

    it('keeps Tab and Shift+Tab inside the dialog', async () => {
      const user = userEvent.setup();
      render(<App />);
      const dialog = await openPicker(user);
      const button = (name: string) => within(dialog).getByRole('button', { name });

      expect(button('Queen')).toHaveFocus();
      for (const name of ['Rook', 'Bishop', 'Knight', 'Cancel', 'Queen']) {
        await user.tab();
        expect(button(name)).toHaveFocus();
      }
      await user.tab({ shift: true });
      expect(button('Cancel')).toHaveFocus();
      await user.tab({ shift: true });
      expect(button('Knight')).toHaveFocus();

      // Everything behind the dialog is inert while it is open, and released afterwards.
      const newGameButton = screen.getByRole('button', { name: 'New game' });
      expect(newGameButton.closest('[inert]')).not.toBeNull();
      expect(board().closest('[inert]')).not.toBeNull();
      expect(dialog.closest('[inert]')).toBeNull();
      await user.keyboard('{Escape}');
      expect(document.querySelector('[inert]')).toBeNull();
    });

    it('returns focus to the promoted square and keyboard play continues', async () => {
      const user = userEvent.setup();
      render(<App />);
      const dialog = await openPicker(user);
      await user.tab({ shift: true });
      await user.tab({ shift: true });
      expect(within(dialog).getByRole('button', { name: 'Knight' })).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(square('a8')).toHaveAccessibleName('a8, white knight');
      expect(square('a8')).toHaveFocus();
      expect(status()).toHaveTextContent('Harald to move');

      // Black replies from the keyboard: king h7 → h6.
      await user.keyboard('{ArrowRight>7/}{ArrowDown}{Enter}{ArrowDown}{Enter}');
      expect(square('h6')).toHaveAccessibleName('h6, black king');
      expect(square('h6')).toHaveFocus();
      expect(status()).toHaveTextContent('Arne to move');
    });

    it('cancels with Escape, returns focus to the pawn and can promote again', async () => {
      const user = userEvent.setup();
      render(<App />);
      await openPicker(user);
      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(square('a7')).toHaveAccessibleName('a7, white pawn');
      expect(square('a7')).toHaveFocus();
      expect(status()).toHaveTextContent('Arne to move');

      await user.keyboard('{Enter}{ArrowUp}{Enter}');
      expect(screen.getByRole('dialog', { name: 'Promote pawn to' })).toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(square('a8')).toHaveAccessibleName('a8, white queen');
      expect(square('a8')).toHaveFocus();
    });

    it('returns focus to the pawn when cancelled with the Cancel button', async () => {
      const user = userEvent.setup();
      render(<App />);
      const dialog = await openPicker(user);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(square('a7')).toHaveFocus();
    });
  });

  it('keeps the game across a refresh and starts a new one on request', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await clickMoves(user, 'e2e4', 'c7c5');
    unmount();

    render(<App />);
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    expect(square('c5')).toHaveAccessibleName('c5, black pawn');
    expect(status()).toHaveTextContent('Arne to move');

    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');

    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(square('e2')).toHaveAccessibleName('e2, white pawn');
    expect(screen.getByText('No moves yet. White starts.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('friendlygames.localChess')!).moves).toEqual([]);
  });

  it('labels the history and tally as sample data', () => {
    render(<App />);
    const history = screen.getByRole('complementary', { name: 'Chess history' });
    expect(within(history).getByText('Sample data')).toBeInTheDocument();
    expect(within(history).getByRole('list', { name: 'Sample completed games' }).children).toHaveLength(6);
  });

  it('credits third-party work and links the licenses', () => {
    render(<App />);
    const credit = screen.getByRole('link', { name: 'Chess pieces by Cburnett, BSD license' });
    expect(credit).toHaveAttribute('href', '/licenses/cburnett-chess-pieces.txt');
    const rules = screen.getByRole('link', { name: 'Rules by chess.js, BSD license' });
    expect(rules).toHaveAttribute('href', '/licenses/chess.js.txt');
  });
});
