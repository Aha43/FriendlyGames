// Keeps each local game across a refresh, one saved game per type (#55): switching between local
// chess and local Fischer Random never overwrites the other. Standard chess keeps its original key,
// so existing local saves load unchanged.
import type { ChessFamilyRules, ChessRecord } from '../games/chessFamily';
import { chessRules } from '../games/chess';

export const LOCAL_KEYS: Record<ChessFamilyRules['type'], string> = {
  chess: 'friendlygames.localChess',
  chess960: 'friendlygames.localChess960',
};

export function loadGame(rules: ChessFamilyRules = chessRules, storage: Storage = window.localStorage): ChessRecord | null {
  try {
    const raw = storage.getItem(LOCAL_KEYS[rules.type]);
    if (!raw) return null;
    const record = JSON.parse(raw) as ChessRecord;
    if (record?.schemaVersion !== 1 || typeof record.initialFen !== 'string' || !Array.isArray(record.moves)) {
      return null;
    }
    rules.position(record); // reject records that are not a legal game of this type
    return record;
  } catch {
    return null;
  }
}

export function saveGame(record: ChessRecord, rules: ChessFamilyRules = chessRules, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(LOCAL_KEYS[rules.type], JSON.stringify(record));
  } catch {
    // Storage can be unavailable (private mode, quota); play continues without persistence.
  }
}
