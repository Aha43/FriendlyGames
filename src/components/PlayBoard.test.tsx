// Fischer Random castle controls on the shared board (#55), and standard chess left as it was.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Color } from '@shared/chess/board.ts';
import { chessRules } from '../games/chess';
import { chess960Rules } from '../games/chess960';
import type { ChessFamilyRules } from '../games/chessFamily';
import PlayBoard from './PlayBoard';

function renderBoard(fen: string, { rules = chess960Rules, orientation = 'w' as Color, movable = 'both' as Color | 'both' } = {}) {
  const onAction = vi.fn();
  const onNotice = vi.fn();
  const position = (rules as ChessFamilyRules).position({ schemaVersion: 1, initialFen: fen, moves: [] });
  render(
    <PlayBoard
      position={position}
      movable={movable}
      orientation={orientation}
      onAction={onAction}
      onNotice={onNotice}
      explainBlocked={() => 'Not yours.'}
    />,
  );
  return { onAction, onNotice };
}

const square = (name: string) =>
  within(screen.getByRole('grid', { name: 'Chess board' })).getByRole('gridcell', { name: new RegExp(`^${name},`) });
const castleButtons = () => within(screen.queryByRole('group', { name: 'Castle' }) ?? document.createElement('div')).queryAllByRole('button');

// Every Chess960 castling form, White to move, nothing in the way (Shredder-FEN rights name the rook files).
const KING_STAYS = 'k7/8/8/8/8/8/8/6KR w H - 0 1'; // Kg1, Rh1: O-O leaves the king on g1
const ROOK_STAYS = 'k7/8/8/8/8/8/8/4KR2 w F - 0 1'; // Ke1, Rf1: O-O leaves the rook on f1
const SWAP = 'k7/8/8/8/8/8/8/5KR1 w G - 0 1'; // Kf1, Rg1: king and rook swap
const BOTH_SIDES = '4k3/8/8/8/8/8/8/1R2KR2 w FB - 0 1'; // Ke1 between Rb1 and Rf1
const NEXT_TO_ROOK = '4k3/8/8/8/8/8/8/RK6 w A - 0 1'; // Kb1, Ra1: O-O-O ends Kc1 Rd1, and Kb1-c1 is a step

describe('castle controls (Fischer Random)', () => {
  it('appear only while the king that can castle is selected', async () => {
    const user = userEvent.setup();
    renderBoard(BOTH_SIDES);
    expect(castleButtons()).toHaveLength(0);
    await user.click(square('b1')); // a rook
    expect(castleButtons()).toHaveLength(0);
    await user.click(square('e1'));
    expect(castleButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Castle queenside: king to c1, rook to d1',
      'Castle kingside: king to g1, rook to f1',
    ]);
    await user.click(square('e1')); // deselect
    expect(castleButtons()).toHaveLength(0);
  });

  it.each([
    ['the king stays put', KING_STAYS, 'g1', 'Castle kingside: king to g1, rook to f1'],
    ['the rook stays put', ROOK_STAYS, 'e1', 'Castle kingside: king to g1, rook to f1'],
    ['king and rook swap', SWAP, 'f1', 'Castle kingside: king to g1, rook to f1'],
    ['queenside next to the rook', NEXT_TO_ROOK, 'b1', 'Castle queenside: king to c1, rook to d1'],
  ])('sends an explicit castle when %s', async (_case, fen, king, label) => {
    const user = userEvent.setup();
    const { onAction } = renderBoard(fen);
    await user.click(square(king));
    await user.click(screen.getByRole('button', { name: label }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ type: 'castle', side: label.includes('kingside') ? 'kingside' : 'queenside' });
  });

  it('keeps a one-square king step an ordinary move, even onto a castle square', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBoard(NEXT_TO_ROOK);
    await user.click(square('b1'));
    // Kb1-c1 is a step, even though O-O-O also puts the king on c1.
    expect(square('c1')).toHaveAccessibleName('c1, empty, legal move');
    await user.click(square('c1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'move', from: 'b1', to: 'c1' });
  });

  it('never castles from a king move two squares or onto its own rook', async () => {
    const user = userEvent.setup();
    const { onAction, onNotice } = renderBoard(BOTH_SIDES);
    await user.click(square('e1'));
    expect(square('g1')).not.toHaveAccessibleName(/legal move/);
    await user.click(square('g1'));
    expect(onNotice).toHaveBeenLastCalledWith('To castle, use a castle button below the board.');
    await user.click(square('f1'));
    expect(onNotice).toHaveBeenLastCalledWith('To castle, use a castle button below the board.');
    expect(onAction).not.toHaveBeenCalled();
    expect(castleButtons()).toHaveLength(2); // the king stays selected
  });

  it('tells the player the selected king can castle', async () => {
    const user = userEvent.setup();
    const { onNotice } = renderBoard(SWAP);
    await user.click(square('f1'));
    expect(onNotice).toHaveBeenLastCalledWith('Your king can castle: use a castle button below the board.');
  });

  it('works from the keyboard and returns focus to the king’s new square', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBoard(ROOK_STAYS);
    square('e1').focus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Castle kingside: king to g1, rook to f1' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith({ type: 'castle', side: 'kingside' });
    expect(square('g1')).toHaveFocus();
  });

  it('orders the controls as the rooks sit on screen for Black', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBoard('1r2kr2/8/8/8/8/8/8/4K3 b fb - 0 1', { orientation: 'b', movable: 'b' });
    await user.click(square('e8'));
    expect(castleButtons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Castle kingside: king to g8, rook to f8',
      'Castle queenside: king to c8, rook to d8',
    ]);
    await user.click(screen.getByRole('button', { name: /Castle queenside/ }));
    expect(onAction).toHaveBeenCalledWith({ type: 'castle', side: 'queenside' });
  });

  it('are not offered when castling is illegal or it is not this player’s turn', async () => {
    const user = userEvent.setup();
    // The king would pass through f1, attacked by the black rook.
    renderBoard('5rk1/8/8/8/8/8/8/4K2R w H - 0 1');
    await user.click(square('e1'));
    expect(castleButtons()).toHaveLength(0);
  });
});

describe('standard chess keeps its castling', () => {
  it('castles by moving the king two squares, with no castle controls', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBoard('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', { rules: chessRules });
    await user.click(square('e1'));
    expect(castleButtons()).toHaveLength(0);
    expect(square('g1')).toHaveAccessibleName('g1, empty, legal move');
    await user.click(square('g1'));
    expect(onAction).toHaveBeenCalledWith({ type: 'move', from: 'e1', to: 'g1' });
  });
});
