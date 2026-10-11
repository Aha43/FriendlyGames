// Keeps the local game across a refresh. Sprint 2 replaces this with the shared backend.
import { replay, type GameRecord } from '@shared/chess/game.ts';

const KEY = 'friendlygames.localChess';

export function loadGame(storage: Storage = window.localStorage): GameRecord | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as GameRecord;
    if (record?.schemaVersion !== 1 || typeof record.initialFen !== 'string' || !Array.isArray(record.moves)) {
      return null;
    }
    replay(record); // reject records that are not a legal game
    return record;
  } catch {
    return null;
  }
}

export function saveGame(record: GameRecord, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable (private mode, quota); play continues without persistence.
  }
}
