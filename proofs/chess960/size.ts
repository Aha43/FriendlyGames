// What a Chess960 game page would actually ship: the rules module and start generator, not the fixtures.
export { applyAction, capturedPieces, legalCastles, sanMoves, status } from '../../supabase/functions/_shared/chess960/rules.ts';
export { randomStartIndex, startFen } from '../../supabase/functions/_shared/chess960/start.ts';
