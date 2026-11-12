// A Yatzy table shared with friends (#86). The server is authoritative: it rolls the dice,
// calculates scores and banked throws, and this page shows the last confirmed table. Holding dice
// and choosing a row are local until the player presses Throw or Score.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cardOf,
  decidedBy,
  describeTable,
  FREE_THROWS,
  listNames,
  MODE_LABELS,
  MODE_SUMMARY,
  nameAt,
  nextThrow,
  openRows,
  ordinal,
  othersAt,
  preview,
  ROW_LABELS,
  ROWS,
  seated,
  TOKENS_SUMMARY,
  UPPER_BONUS,
  UPPER_BONUS_THRESHOLD,
  type Row,
} from '../games/yatzy';
import { tableView, UNSUPPORTED_GAME_TEXT } from '../games/registry';
import { ApiError, gameApi, isTable, NetworkError, type TableAction, type TableGame, type TableSeat } from '../shared/gameApi';
import type { Identity } from '../shared/identity';
import { newRequestId } from '../shared/requestId';

const POLL_MS = 4_000;
const POSITIONS = [0, 1, 2, 3, 4];
const UPPER: readonly Row[] = ROWS.slice(0, 6);
const LOWER: readonly Row[] = ROWS.slice(6);

const finishedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const bankedThrows = (n: number) => plural(n, 'banked throw', 'banked throws');

interface Pending {
  requestId: string;
  expectedRevision: number;
  action: TableAction;
  /** Set when sending failed: whether it was saved is unknown, and it can be retried as-is. */
  failure: string | null;
}

interface YatzyPageProps {
  identity: Identity;
  gameId: string;
  /** The table as first loaded by the game route. */
  initial: TableGame;
  onIdentityRejected: () => void;
}

export default function YatzyPage({ identity, gameId, initial, onIdentityRejected }: YatzyPageProps) {
  const [game, setGame] = useState<TableGame>(initial);
  const [missing, setMissing] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Dice held for the next throw and the row picked to score: local choices, tied to the revision
  // they were made on so a newer table never inherits them.
  const [held, setHeld] = useState<{ revision: number; positions: number[] } | null>(null);
  const [picked, setPicked] = useState<{ revision: number; row: Row } | null>(null);
  const sending = useRef(false);

  /** Accept a confirmed table from the server, never going back to an older revision. */
  const accept = useCallback((next: TableGame) => {
    if (!tableView(next)) return setUnsupported(true);
    setGame((current) => (current.id === next.id && current.revision > next.revision ? current : next));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { game } = await gameApi.getGame(identity.credential, gameId);
      if (isTable(game)) accept(game);
      else setUnsupported(true);
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) setOffline(true);
      else if (e instanceof ApiError && e.status === 401) onIdentityRejected();
      else if (e instanceof ApiError && e.status === 404) setMissing(true);
      else if (e instanceof ApiError && e.code === 'unsupported_game') setUnsupported(true);
    }
  }, [identity.credential, gameId, accept, onIdentityRejected]);

  const finished = game.status === 'finished';

  // Poll while the page is visible and the table can still change.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !finished && !sending.current) refresh();
    }, POLL_MS);
    const onReturn = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [refresh, finished]);

  // An unconfirmed action is settled once the server's table has moved past the revision it was
  // based on: only the player to move can change the table, so that newer table is the answer.
  const resolved = !!(pending?.failure && game.revision > pending.expectedRevision);
  const active = resolved ? null : pending;

  async function send(next: Pending) {
    sending.current = true;
    setPending({ ...next, failure: null });
    setNotice(null);
    try {
      const result = await gameApi.submitTableAction(identity.credential, gameId, next.requestId, next.expectedRevision, next.action);
      accept(result.game);
      setPending(null);
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        // Unknown whether it arrived. Keep it for a retry with the same request ID and intent:
        // the server then answers with the dice or score it already saved.
        const what = next.action.type === 'throw' ? 'throw' : 'score';
        setPending({
          ...next,
          failure: `Couldn’t confirm whether your ${what} was saved: the game server didn’t answer. Retrying is safe; it won’t ${next.action.type === 'throw' ? 'roll or cost a banked throw' : 'be scored'} twice.`,
        });
      } else if (e instanceof ApiError && e.status === 401) {
        onIdentityRejected();
      } else {
        setPending(null);
        if (e instanceof ApiError && e.code === 'stale_revision' && e.game && isTable(e.game)) {
          accept(e.game);
          setNotice('The table changed before that was saved. Here’s the latest.');
        } else {
          setNotice(e instanceof ApiError ? e.message : 'That didn’t work.');
          refresh();
        }
      }
    } finally {
      sending.current = false;
    }
  }

  function act(action: TableAction) {
    if (active || sending.current) return;
    send({ requestId: newRequestId(), expectedRevision: game.revision, action, failure: null });
  }

  const view = game.yatzy;
  const me = game.yourSeat;
  const players = useMemo(() => seated(game.players), [game.players]);
  const myTurn = !finished && view.current === me;
  const turn = view.turn;
  const thrown = turn.throws > 0 && turn.dice !== null;

  if (unsupported) {
    return (
      <div className="page">
        <section className="card">
          <h2>Can’t show this game</h2>
          <p>{UNSUPPORTED_GAME_TEXT}</p>
          <a className="button" href="#/">
            Your games
          </a>
        </section>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="page">
        <section className="card">
          <h2>Game not found</h2>
          <p>This game doesn’t exist, or it isn’t one of yours.</p>
          <a className="button" href="#/">
            Your games
          </a>
        </section>
      </div>
    );
  }

  // Dice kept for the last throw stay held for the next one until the player changes them.
  const heldNow = myTurn && thrown ? (held?.revision === game.revision ? held.positions : turn.kept) : [];
  const cost = nextThrow(view, me);
  const open = myTurn && thrown ? openRows(view, me) : [];
  // Forced has one row to score, so nothing to pick; Free needs a choice.
  const row = view.mode === 'forced' ? (open[0] ?? null) : picked?.revision === game.revision && open.includes(picked.row) ? picked.row : null;
  const rowPreview = row ? preview(view, row) : null;
  const busy = !!active;

  function toggle(position: number) {
    const next = heldNow.includes(position) ? heldNow.filter((p) => p !== position) : [...heldNow, position].sort((a, b) => a - b);
    setHeld({ revision: game.revision, positions: next });
  }

  let statusLine = describeTable(game);
  if (myTurn) statusLine = thrown ? 'Your turn: keep dice and throw again, or score' : 'Your turn: throw the dice';
  if (active && !active.failure) statusLine = active.action.type === 'throw' ? 'Throwing…' : 'Saving your score…';

  const rolling = 5 - heldNow.length;
  let throwLabel = 'Throw the dice';
  if (thrown) throwLabel = heldNow.length === 0 ? 'Throw all five again' : `Keep ${heldNow.length}, throw ${rolling} again`;
  const throwBlocked = !myTurn || busy || (thrown && (heldNow.length === 5 || !cost.allowed));
  let throwNote: string | null = null;
  if (myTurn && thrown) {
    if (!cost.allowed) throwNote = 'No throws left this turn and none banked: score a row.';
    else if (heldNow.length === 5) throwNote = 'Keep at most four dice to throw again.';
    else if (cost.cost === 1) throwNote = `Another throw uses 1 of your ${bankedThrows(cardOf(view, me).tokens)}.`;
  }

  const current = view.current;
  const whose = current ? nameAt(game, current) : null;
  const throwInfo = !thrown
    ? null
    : turn.throws <= FREE_THROWS
      ? `Throw ${turn.throws} of ${FREE_THROWS}`
      : `Throw ${turn.throws} (${plural(turn.throws - FREE_THROWS, 'banked throw', 'banked throws')} used)`;

  return (
    <>
      <section className="table yatzy-table" aria-label={`Yatzy: you with ${othersAt(game)}`}>
        <div className="yatzy-head">
          <p className="yatzy-mode">Yatzy · {MODE_LABELS[view.mode]}</p>
          <p className={`yatzy-status${finished ? ' yatzy-status-finished' : ''}`} role="status">
            {statusLine}
          </p>
        </div>

        {!finished && (
          <>
            <div className="dice-tray" role="group" aria-label={myTurn ? 'Your dice' : `${whose}’s dice`}>
              {POSITIONS.map((position) => {
                const value = thrown ? turn.dice![position] : null;
                // Your own holds while it is your turn; for everyone else, what was kept for the latest throw.
                const kept = myTurn ? heldNow.includes(position) : thrown && turn.kept.includes(position);
                return (
                  <button
                    key={position}
                    type="button"
                    className={`die${kept ? ' die-kept' : ''}${value === null ? ' die-blank' : ''}`}
                    aria-pressed={kept}
                    aria-label={value === null ? `Die ${position + 1}: not thrown yet` : `Die ${position + 1}: ${value}`}
                    disabled={!myTurn || !thrown || busy}
                    onClick={() => toggle(position)}
                  >
                    <DieFace value={value} />
                    <span className="die-state">{value === null ? '' : kept ? 'Kept' : myTurn ? 'Keep' : ''}</span>
                  </button>
                );
              })}
            </div>
            <p className="throw-info">
              {throwInfo ?? (myTurn ? 'Three throws a turn. Tap a die to keep it between throws.' : `Waiting for ${whose} to throw.`)}
              {myTurn && ` · You have ${bankedThrows(cardOf(view, me).tokens)}.`}
            </p>
            {myTurn && (
              <div className="yatzy-actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={throwBlocked}
                  aria-describedby={throwNote ? 'throw-note' : undefined}
                  onClick={() => act({ type: 'throw', keep: thrown ? heldNow : [] })}
                >
                  {throwLabel}
                </button>
                {throwNote && (
                  <p id="throw-note" className="throw-note">
                    {throwNote}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {finished && view.standings && (
          <Results game={game} />
        )}
      </section>

      <section className="game-panel yatzy-panel" aria-label="Scorecard">
        {offline && (
          <p className="banner banner-warning" role="alert">
            Can’t reach the game server. Showing the last saved table.
          </p>
        )}
        <p className="game-notice" aria-live="polite">
          {notice ?? (resolved ? 'The table moved on. Here’s the latest.' : null)}
        </p>
        {active?.failure && (
          <div className="banner banner-error" role="alert">
            <p>{active.failure}</p>
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={() => send(active)}>
                Retry
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPending(null);
                  refresh();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <table className={`scorecard scorecard-${players.length}`}>
          <caption>
            {finished ? 'Final scorecard' : view.mode === 'forced' ? 'Scorecard, filled top to bottom' : 'Scorecard'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Row</th>
              {players.map(({ seat, player }) => (
                <th
                  key={seat}
                  scope="col"
                  className={`${seat === me ? 'scorecard-me' : ''}${seat === current ? ' scorecard-current' : ''}`}
                  title={player.displayName}
                >
                  <span className="scorecard-name">{seat === me ? 'You' : player.displayName}</span>
                  {seat === current && <span className="visually-hidden"> (to play)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {UPPER.map((r) => (
              <ScoreRow key={r} row={r} game={game} open={open} chosen={row} busy={busy} onPick={(r) => setPicked({ revision: game.revision, row: r })} />
            ))}
            <SumRow label="Sum" game={game} value={(seat) => cardOf(view, seat).upperSum} />
            <SumRow label={`Bonus (at ${UPPER_BONUS_THRESHOLD})`} game={game} value={(seat) => cardOf(view, seat).bonus} />
            {LOWER.map((r) => (
              <ScoreRow key={r} row={r} game={game} open={open} chosen={row} busy={busy} onPick={(r) => setPicked({ revision: game.revision, row: r })} />
            ))}
          </tbody>
          <tfoot>
            <SumRow label="Total" game={game} value={(seat) => cardOf(view, seat).total} strong />
            <SumRow label="Banked throws" game={game} value={(seat) => cardOf(view, seat).tokens} />
          </tfoot>
        </table>

        {myTurn && thrown && (
          <div className="score-bar">
            {row && rowPreview ? (
              <>
                <button type="button" className="button button-primary" disabled={busy} onClick={() => act({ type: 'score', row })}>
                  Score {rowPreview.points} in {ROW_LABELS[row]}
                </button>
                <p className="score-bar-note">
                  {rowPreview.banked > 0 ? `Banks ${plural(rowPreview.banked, 'throw', 'throws')} for later.` : 'Banks no throws.'}
                  {view.mode === 'forced' && ' Forced order: this is your next row.'}
                </p>
              </>
            ) : (
              <p className="score-bar-note">Pick an empty row on your card to score these dice. Each shows what it would give.</p>
            )}
          </div>
        )}

        {finished && <p className="finished-date">Finished {finishedDate.format(new Date(game.updatedAt))}</p>}

        <details className="about-type">
          <summary>How this Yatzy works</summary>
          <p>{MODE_SUMMARY[view.mode]}</p>
          <p>{TOKENS_SUMMARY}</p>
          <p>
            Pairs and three or four of a kind count only the matching dice; full house and chance count all five. Small
            straight (1–5) is 15, large straight (2–6) is 20, Yatzy is 50. {UPPER_BONUS_THRESHOLD} or more in Ones to Sixes
            adds {UPPER_BONUS}. Highest total wins.
          </p>
        </details>

        <p className="page-footnote">
          <a href="#/">← Your games</a>
        </p>
      </section>
    </>
  );
}

function ScoreRow({
  row,
  game,
  open,
  chosen,
  busy,
  onPick,
}: {
  row: Row;
  game: TableGame;
  open: Row[];
  chosen: Row | null;
  busy: boolean;
  onPick: (row: Row) => void;
}) {
  const view = game.yatzy;
  const me = game.yourSeat;
  const forced = view.mode === 'forced';
  return (
    <tr className={chosen === row ? 'scorecard-chosen' : undefined}>
      <th scope="row">{ROW_LABELS[row]}</th>
      {seated(game.players).map(({ seat }) => {
        const score = cardOf(view, seat).scores[row];
        const className = `${seat === me ? 'scorecard-me' : ''}${seat === view.current ? ' scorecard-current' : ''}`;
        if (score !== undefined) {
          return (
            <td key={seat} className={className}>
              {score}
            </td>
          );
        }
        const points = seat === me && open.includes(row) ? preview(view, row)?.points : undefined;
        if (points === undefined) {
          return <td key={seat} className={className} />;
        }
        // An open row shows what the dice would give. In Free it is the control that picks the row;
        // in Forced there is nothing to pick, so it is only shown.
        return (
          <td key={seat} className={`${className} scorecard-open`}>
            {forced ? (
              <span className="scorecard-preview" aria-label={`${ROW_LABELS[row]} would score ${points}`}>
                {points}
              </span>
            ) : (
              <button
                type="button"
                className="scorecard-pick"
                aria-pressed={chosen === row}
                aria-label={`${ROW_LABELS[row]}: would score ${points}`}
                disabled={busy}
                onClick={() => onPick(row)}
              >
                {points}
              </button>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function SumRow({ label, game, value, strong = false }: { label: string; game: TableGame; value: (seat: TableSeat) => number; strong?: boolean }) {
  return (
    <tr className={`scorecard-sum${strong ? ' scorecard-total' : ''}`}>
      <th scope="row">{label}</th>
      {seated(game.players).map(({ seat }) => (
        <td key={seat} className={`${seat === game.yourSeat ? 'scorecard-me' : ''}${seat === game.yatzy.current ? ' scorecard-current' : ''}`}>
          {value(seat)}
        </td>
      ))}
    </tr>
  );
}

/** The finished table: places, and how a tie on points was settled. */
function Results({ game }: { game: TableGame }) {
  const standings = game.yatzy.standings!;
  const how = decidedBy(standings);
  const top = standings[0];
  const youFirst = (seats: TableSeat[]) => listNames(seats.map((seat) => nameAt(game, seat)).sort((a, b) => Number(b === 'You') - Number(a === 'You')));
  // Everyone level on points with the leader, and of those, who actually won (first place).
  const level = standings.filter((s) => s.total === top.total).map((s) => s.seat);
  const winners = standings.filter((s) => s.place === 1).map((s) => s.seat);
  return (
    <div className="yatzy-results">
      <ol className="standings" aria-label="Final standings">
        {standings.map((s) => (
          <li key={s.seat} className={s.place === 1 ? 'standing standing-winner' : 'standing'}>
            <span className="standing-place">{ordinal(s.place)}</span>
            <span className="standing-name">{nameAt(game, s.seat)}</span>
            <span className="standing-score">
              {plural(s.total, 'point', 'points')} · {bankedThrows(s.tokens)}
            </span>
          </li>
        ))}
      </ol>
      {how === 'tokens' && (
        <p className="tiebreak">
          {youFirst(level)} tied on {top.total} points. The most banked throws left decides: {nameAt(game, top.seat)} had{' '}
          {top.tokens}.
        </p>
      )}
      {how === 'shared' &&
        (level.length > winners.length ? (
          // More players were level on points than share the win: banked throws separated them.
          <p className="tiebreak">
            {youFirst(level)} tied on {top.total} points. {youFirst(winners)} had the most banked throws left ({top.tokens}{' '}
            each), so they share the win.
          </p>
        ) : (
          <p className="tiebreak">
            {youFirst(winners)} tied on both points ({top.total}) and banked throws ({top.tokens}), so they share the win.
          </p>
        ))}
    </div>
  );
}

/** One die drawn with pips; blank before the first throw of a turn. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export function DieFace({ value }: { value: number | null }) {
  return (
    <svg className="die-face" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="18" />
      {value !== null && PIPS[value]?.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" />)}
    </svg>
  );
}
