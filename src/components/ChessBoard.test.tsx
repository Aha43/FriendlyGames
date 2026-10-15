import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMove, boardOf, newGame, replay } from '@shared/chess/game.ts';
import ChessBoard from './ChessBoard';

function renderBoard(
  orientation: 'w' | 'b' = 'w',
  { board = boardOf(replay(newGame())), selected = null as string | null, targets = new Set<string>(), onActivate = () => {} } = {},
) {
  render(
    <ChessBoard
      board={board}
      orientation={orientation}
      selected={selected}
      targets={targets}
      lastMove={null}
      checkSquare={null}
      focusSquare="e2"
      onFocusSquare={() => {}}
      onActivate={onActivate}
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

const labels = () => [...document.querySelectorAll('.target-label')].map((l) => l.textContent).sort();

describe('legal destination labels', () => {
  it('names each legal destination instead of showing a dot', () => {
    const grid = renderBoard('w', { selected: 'd2', targets: new Set(['d3', 'd4']) });
    expect(labels()).toEqual(['d3', 'd4']);
    const d3 = grid.getByRole('gridcell', { name: 'd3, empty, legal move' });
    expect(within(d3).getByText('d3')).toHaveAttribute('aria-hidden', 'true');
    expect(grid.getByRole('gridcell', { name: 'd5, empty' }).querySelector('.target-label')).toBeNull();
  });

  it('labels a capture as a corner badge and keeps the piece', () => {
    // 1. e4 d5: the e4 pawn may capture on d5.
    const record = applyMove(applyMove(newGame(), 'e2', 'e4')!, 'd7', 'd5')!;
    const grid = renderBoard('w', { board: boardOf(replay(record)), selected: 'e4', targets: new Set(['e5', 'd5']) });
    const d5 = grid.getByRole('gridcell', { name: 'd5, black pawn, capture' });
    expect(d5.querySelector('img.piece')).not.toBeNull();
    expect(d5.querySelector('.target-label')).toHaveClass('target-label-capture');
    expect(d5.querySelector('.target-label')).toHaveTextContent('d5');
    expect(grid.getByRole('gridcell', { name: 'e5, empty, legal move' }).querySelector('.target-label')).not.toHaveClass(
      'target-label-capture',
    );
  });

  it('keeps the real square names with Black at the bottom', () => {
    const grid = renderBoard('b', { selected: 'g8', targets: new Set(['f6', 'h6']) });
    expect(labels()).toEqual(['f6', 'h6']);
    // From Black's side h6 is on the left of the board, f6 to its right.
    const order = grid.getAllByRole('gridcell').flatMap((c) => c.querySelector('.target-label')?.textContent ?? []);
    expect(order).toEqual(['h6', 'f6']);
  });

  it('lets a click on a labelled destination reach the square', () => {
    const onActivate = vi.fn();
    const grid = renderBoard('w', { selected: 'd2', targets: new Set(['d3', 'd4']), onActivate });
    fireEvent.click(within(grid.getByRole('gridcell', { name: 'd4, empty, legal move' })).getByText('d4'));
    expect(onActivate).toHaveBeenCalledWith('d4');
  });
});
