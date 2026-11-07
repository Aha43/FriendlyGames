import { CHESS960_CASTLING, CHESS960_SUMMARY } from '../games/registry';

/** A short, always-available explanation of Fischer Random (not a tutorial). */
export default function AboutChess960({ open = false }: { open?: boolean }) {
  return (
    <details className="about-type" open={open}>
      <summary>About Fischer Random (Chess960)</summary>
      <p>{CHESS960_SUMMARY}</p>
      <p>{CHESS960_CASTLING}</p>
    </details>
  );
}
