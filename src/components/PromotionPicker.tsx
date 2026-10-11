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
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div
      className="promotion"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promotion-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
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
