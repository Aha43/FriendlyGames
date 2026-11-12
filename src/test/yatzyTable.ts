// Yatzy tables for component tests: built from a scripted record through the same adapter the
// server uses, so the views are exactly what the API would send.
import { play, type Scripted } from '@shared/yatzy/fixtures.ts';
import { newRecord, type Mode, type YatzyRecord } from '@shared/yatzy/rules.ts';
import { yatzyAdapter } from '../../supabase/functions/game-api/gameTypes.ts';
import type { PlayerSummary, TableGame, TableSeat, YatzyView } from '../shared/gameApi';

export const TABLE_ID = '99999999-2222-3333-4444-555555555555';
export const PEOPLE: PlayerSummary[] = [
  { id: 'p-arne', displayName: 'Arne' },
  { id: 'p-harald', displayName: 'Harald' },
  { id: 'p-william', displayName: 'William' },
  { id: 'p-oystein', displayName: 'Øystein' },
];
const SEATS: TableSeat[] = ['p1', 'p2', 'p3', 'p4'];
const adapter = yatzyAdapter();

/** The table after `script` (or a ready record), seen from `yourSeat`. */
export function table(
  mode: Mode,
  players: number,
  script: Scripted[] | YatzyRecord = [],
  overrides: Partial<TableGame> = {},
): TableGame {
  const record = Array.isArray(script) ? play(newRecord(mode, players), script) : script;
  const payload = { mode: record.mode, players: record.players, log: record.log };
  const view = adapter.view(payload).yatzy as YatzyView;
  const finished = view.standings !== null;
  return {
    id: TABLE_ID,
    type: 'yatzy',
    schemaVersion: 1,
    status: finished ? 'finished' : 'active',
    result: finished ? 'scored' : null,
    termination: finished ? 'scorecards-complete' : null,
    revision: record.log.length,
    createdAt: '2026-11-12T10:00:00Z',
    updatedAt: '2026-11-12T11:00:00Z',
    players: Object.fromEntries(PEOPLE.slice(0, players).map((p, i) => [SEATS[i], p])),
    yourSeat: 'p1',
    turn: view.current,
    moveCount: record.log.length,
    yatzy: view,
    rematchGameId: null,
    ...overrides,
  };
}
