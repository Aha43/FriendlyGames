import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardOf, newGame, replay } from '@shared/chess/game.ts';
import ChessBoard from './ChessBoard';

function renderBoard(orientation: 'w' | 'b' = 'w') {
  render(
    <ChessBoard
      board={boardOf(replay(newGame()))}
      orientation={orientation}
      selected={null}
      targets={new Set()}
      lastMove={null}
      checkSquare={null}
      focusSquare="e2"
      onFocusSquare={() => {}}
      onActivate={() => {}}
      onCancel={() => {}}
    />,
  );
  return within(screen.getByRole('grid', { name: 'Chess board' }));
}

const bubble = () => document.querySelector('.square-name');

describe('square names', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the name of the square under a finger, then hides it after release', () => {
    vi.useFakeTimers();
    const grid = renderBoard();
    const e4 = grid.getByRole('gridcell', { name: 'e4, empty' });

    fireEvent.pointerDown(e4, { pointerType: 'touch' });
    expect(bubble()).toHaveTextContent('e4');
    expect(bubble()).toHaveAttribute('aria-hidden', 'true');

    fireEvent.pointerUp(e4, { pointerType: 'touch' });
    expect(bubble()).toHaveTextContent('e4'); // lingers briefly after a quick tap
    act(() => vi.advanceTimersByTime(700));
    expect(bubble()).toBeNull();
  });

  it('follows the board orientation', () => {
    const grid = renderBoard('b');
    fireEvent.pointerDown(grid.getAllByRole('gridcell')[0], { pointerType: 'touch' });
    expect(bubble()).toHaveTextContent('h1');
  });

  it('does not show for a mouse, which gets a hover title instead', () => {
    const grid = renderBoard();
    const d2 = grid.getByRole('gridcell', { name: 'd2, white pawn' });
    fireEvent.pointerDown(d2, { pointerType: 'mouse' });
    expect(bubble()).toBeNull();
    expect(d2).toHaveAttribute('title', 'd2');
  });
});
