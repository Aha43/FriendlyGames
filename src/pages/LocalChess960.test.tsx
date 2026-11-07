// Local Fischer Random (#55): its own saved game next to local chess, played on the shared board.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyMove, newGame } from '@shared/chess/game.ts';
import { startFen, START_COUNT } from '@shared/chess960/start.ts';
import App from '../App';

const CHESS_KEY = 'friendlygames.localChess';
const FISCHER_KEY = 'friendlygames.localChess960';
const board = () => screen.getByRole('grid', { name: 'Chess board' });
const square = (name: string) => within(board()).getByRole('gridcell', { name: new RegExp(`^${name},`) });
const saved = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

async function go(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/local/chess960';
});

describe('local Fischer Random', () => {
  it('starts from one of the 960 arrangements, labelled and explained', () => {
    render(<App />);
    expect(screen.getByRole('region', { name: 'Fischer Random: White vs Black' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fischer Random' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('About Fischer Random (Chess960)')).toBeInTheDocument();
    const fens = Array.from({ length: START_COUNT }, (_, i) => startFen(i));
    expect(fens).toContain(saved(FISCHER_KEY).initialFen);
  });

  it('castles through the controls and saves the king onto its rook', async () => {
    // Kf1 between Rb1 and Rg1, nothing in the way.
    const fen = '1r3kr1/pppppppp/8/8/8/8/PPPPPPPP/1R3KR1 w GBgb - 0 1';
    localStorage.setItem(FISCHER_KEY, JSON.stringify({ schemaVersion: 1, initialFen: fen, moves: [] }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(square('f1'));
    await user.click(screen.getByRole('button', { name: 'Castle queenside: king to c1, rook to d1' }));

    expect(square('c1')).toHaveAccessibleName('c1, white king');
    expect(square('d1')).toHaveAccessibleName('d1, white rook');
    expect(square('b1')).toHaveAccessibleName('b1, empty');
    expect(screen.getByRole('list', { name: 'Moves' })).toHaveTextContent('O-O-O');
    expect(saved(FISCHER_KEY).moves).toEqual(['f1b1']);
    expect(screen.getByRole('status')).toHaveTextContent('Black to move');
  });

  it('keeps local chess and local Fischer Random as separate saved games', async () => {
    const chessGame = applyMove(newGame(), 'e2', 'e4')!;
    localStorage.setItem(CHESS_KEY, JSON.stringify(chessGame));
    const user = userEvent.setup();
    render(<App />);
    const fischerStart = saved(FISCHER_KEY).initialFen;

    // A move in Fischer Random: a pawn, wherever the pieces behind it stand.
    await user.click(square('a2'));
    await user.click(square('a3'));
    expect(saved(FISCHER_KEY).moves).toEqual(['a2a3']);
    expect(saved(CHESS_KEY)).toEqual(chessGame);

    // Switching to chess loads the existing chess save unchanged.
    await go('#/local');
    expect(screen.getByRole('region', { name: 'Chess: White vs Black' })).toBeInTheDocument();
    expect(square('e4')).toHaveAccessibleName('e4, white pawn');
    await user.click(square('e7'));
    await user.click(square('e5'));
    expect(saved(CHESS_KEY).moves).toEqual(['e2e4', 'e7e5']);
    expect(saved(FISCHER_KEY)).toEqual({ schemaVersion: 1, initialFen: fischerStart, moves: ['a2a3'] });

    // And back: the Fischer Random game is where it was.
    await go('#/local/chess960');
    expect(square('a3')).toHaveAccessibleName('a3, white pawn');
    expect(saved(FISCHER_KEY).initialFen).toBe(fischerStart);
  });

  it('starts over in Fischer Random without touching the chess save', async () => {
    const chessGame = applyMove(newGame(), 'd2', 'd4')!;
    localStorage.setItem(CHESS_KEY, JSON.stringify(chessGame));
    const user = userEvent.setup();
    render(<App />);
    await user.click(square('a2'));
    await user.click(square('a3'));
    await user.click(screen.getByRole('button', { name: 'New game' }));
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(saved(FISCHER_KEY).moves).toEqual([]);
    expect(saved(CHESS_KEY)).toEqual(chessGame);
  });

  it('replaces an unusable Fischer Random save with a fresh start, never writing the chess save', async () => {
    localStorage.setItem(FISCHER_KEY, JSON.stringify({ schemaVersion: 1, initialFen: 'not a fen', moves: [] }));
    render(<App />);
    expect(saved(FISCHER_KEY).initialFen).not.toBe('not a fen');
    expect(localStorage.getItem(CHESS_KEY)).toBeNull();
  });
});
