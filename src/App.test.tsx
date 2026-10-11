import { render, screen, within } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('sets the table with both players and whose turn it is', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'FriendlyGames' })).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Chess: Arne vs Harald' });
    expect(within(table).getByText('Arne')).toBeInTheDocument();
    expect(within(table).getByText('Harald')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Arne to move');
  });

  it('shows the starting position on a 64-square board with white at the bottom', () => {
    render(<App />);
    const board = screen.getByRole('grid', { name: 'Chess board' });
    const squares = within(board).getAllByRole('gridcell');
    expect(squares).toHaveLength(64);
    expect(squares[0]).toHaveAccessibleName('a8, black rook');
    expect(squares[63]).toHaveAccessibleName('h1, white rook');
    expect(within(board).getByRole('gridcell', { name: 'e1, white king' })).toBeInTheDocument();
    expect(within(board).getByRole('gridcell', { name: 'd8, black queen' })).toBeInTheDocument();
    expect(board.querySelectorAll('img.piece')).toHaveLength(32);
  });

  it('labels the history and tally as sample data', () => {
    render(<App />);
    const history = screen.getByRole('complementary', { name: 'Chess history' });
    expect(within(history).getByText('Sample data')).toBeInTheDocument();
    expect(within(history).getByRole('list', { name: 'Sample completed games' }).children).toHaveLength(6);
    expect(within(history).getByLabelText('Sample chess tally')).toBeInTheDocument();
  });

  it('credits the piece artwork and links its license', () => {
    render(<App />);
    const credit = screen.getByRole('link', { name: 'Chess pieces by Cburnett, BSD license' });
    expect(credit).toHaveAttribute('href', '/licenses/cburnett-chess-pieces.txt');
  });
});
