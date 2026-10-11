import { useEffect, useRef } from 'react';
import type { Color } from '../chess/board';
import type { PromotionPiece } from '../chess/game';
import { pieceImage } from './pieceSet';

const CHOICES: { type: PromotionPiece; name: string }[] = [
  { type: 'q', name: 'Queen' },
  { type: 'r', name: 'Rook' },
  { type: 'b', name: 'Bishop' },
  { type: 'n', name: 'Knight' },
];

interface PromotionPickerProps {
  color: Color;
  onChoose: (piece: PromotionPiece) => void;
  onCancel: () => void;
}

export default function PromotionPicker({ color, onChoose, onCancel }: PromotionPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();

    // aria-modal: make everything behind the dialog inert (unfocusable, unclickable, hidden from
    // assistive tech) by marking the siblings of each of its ancestors.
    const madeInert: Element[] = [];
    for (let node: HTMLElement | null = dialogRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (sibling !== node && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          madeInert.push(sibling);
        }
      }
    }

    // Backstop for focus that still escapes while the dialog is open.
    function keepFocusInside(event: FocusEvent) {
      if (!dialogRef.current?.contains(event.target as Node)) firstRef.current?.focus();
    }
    document.addEventListener('focusin', keepFocusInside);

    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      for (const element of madeInert) element.removeAttribute('inert');
    };
  }, []);

  return (
    <div
      ref={dialogRef}
      className="promotion"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promotion-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Tab') {
          // aria-modal: keep Tab and Shift+Tab cycling inside the dialog.
          const buttons = [...event.currentTarget.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
          event.preventDefault();
          buttons[next].focus();
        }
      }}
    >
      <div className="promotion-card">
        <h2 id="promotion-title">Promote pawn to</h2>
        <div className="promotion-choices">
          {CHOICES.map((choice, i) => (
            <button
              key={choice.type}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="promotion-choice"
              onClick={() => onChoose(choice.type)}
            >
              <img src={pieceImage({ color, type: choice.type })} alt="" />
              <span>{choice.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
