// Starting a Yatzy table (#86): the host picks one to three people already played with, in the
// order they will take their turns, and a mode. Everyone is seated at once; nobody is invited.
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MODE_LABELS, MODE_SUMMARY, TOKENS_SUMMARY } from '../games/yatzy';
import { ApiError, gameApi, NetworkError, type PreviousOpponent } from '../shared/gameApi';
import type { Identity } from '../shared/identity';
import { newRequestId } from '../shared/requestId';
import { navigate } from '../shared/route';

const MAX_GUESTS = 3;
const UNCONFIRMED =
  'Couldn’t confirm whether the table was created: the game server didn’t answer. Trying again is safe; it won’t create a second table.';
const SHORT_LIST = 6;

interface NewTableProps {
  identity: Identity;
  /** The game-type choice, shared with the chess form. */
  typePicker: ReactNode;
  /** Loading and failure notes for the list of previous opponents. */
  opponentsStatus: ReactNode;
  opponents: PreviousOpponent[] | null;
  /**
   * A start whose outcome is unknown, kept by the lobby: this form is taken away when another
   * game is chosen, and the request ID must survive that. The same mode and ordered roster
   * retries with it and finds the table if it was created; any change is a new request.
   */
  uncertain: UncertainTable | null;
  onUncertain: (attempt: UncertainTable | null) => void;
  /**
   * Told while a start is on its way to the server, so the lobby can hold the game choice still:
   * leaving this form mid-request would forget the request before its outcome is known.
   */
  onBusy: (busy: boolean) => void;
  onCreated: () => void;
  onIdentityRejected: () => void;
}

export interface UncertainTable {
  requestId: string;
  /** Mode and ordered guest IDs. */
  intent: string;
}

export default function NewTable({
  identity,
  typePicker,
  opponentsStatus,
  opponents,
  uncertain,
  onUncertain,
  onBusy,
  onCreated,
  onIdentityRejected,
}: NewTableProps) {
  const [mode, setMode] = useState<'forced' | 'free'>('forced');
  // Guests in the order picked: that is the turn order after the host.
  const [guests, setGuests] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const known = opponents ?? [];
  // Only people still on the list can be seated (a refreshed list never leaves a stale ID chosen).
  const roster = guests.filter((id) => known.some((o) => o.id === id));
  const nameOf = (id: string) => known.find((o) => o.id === id)?.displayName ?? '';
  const intent = `${mode}:${roster.join(',')}`;
  const retrying = uncertain !== null && uncertain.intent === intent;
  const full = roster.length >= MAX_GUESTS;

  function toggle(id: string) {
    setGuests(roster.includes(id) ? roster.filter((g) => g !== id) : [...roster, id]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || roster.length === 0) return;
    const requestId = retrying && uncertain ? uncertain.requestId : newRequestId();
    submitting.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const { game } = await gameApi.createTable(identity.credential, mode, roster, requestId);
      onUncertain(null);
      onCreated();
      navigate(`#/game/${game.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onIdentityRejected();
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        onUncertain({ requestId, intent });
        setError(UNCONFIRMED);
      } else {
        onUncertain(null);
        setError(creationError(e));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      {typePicker}
      <div className="type-explainer">
        <p>Yatzy for two to four players, with people you’ve already played. The server throws the dice.</p>
        <p>{TOKENS_SUMMARY}</p>
      </div>

      <fieldset className="type-picker mode-picker">
        <legend>Order</legend>
        {(['forced', 'free'] as const).map((option) => (
          <label key={option} className="type-option">
            <input type="radio" name="yatzy-mode" value={option} checked={mode === option} onChange={() => setMode(option)} />
            {MODE_LABELS[option]}
          </label>
        ))}
      </fieldset>
      <p className="fine-print-inline">{MODE_SUMMARY[mode]}</p>

      {opponentsStatus}
      {opponents !== null && known.length === 0 && (
        <p className="muted">
          Nobody to seat yet. Yatzy is for people you’ve already played: invite someone to a chess game first, and once
          they’ve joined you can seat them here.
        </p>
      )}
      {known.length > 0 && (
        <>
          <fieldset className="opponent-picker">
            <legend>Players (pick 1 to {MAX_GUESTS}, in playing order)</legend>
            {(showAll ? known : known.slice(0, SHORT_LIST)).map((o) => {
              const place = roster.indexOf(o.id);
              return (
                <label key={o.id} className="opponent-option">
                  <input
                    type="checkbox"
                    name="guest"
                    value={o.id}
                    checked={place >= 0}
                    disabled={place < 0 && full}
                    onChange={() => toggle(o.id)}
                    aria-labelledby={`guest-${o.id}-name`}
                  />
                  <span className="opponent-text">
                    <span id={`guest-${o.id}-name`} className="opponent-name">
                      {o.displayName}
                    </span>
                    {place >= 0 && <span className="opponent-meta">Plays {['second', 'third', 'fourth'][place]}</span>}
                  </span>
                </label>
              );
            })}
            {!showAll && known.length > SHORT_LIST && (
              <button type="button" className="text-button show-all" onClick={() => setShowAll(true)}>
                Show all {known.length}
              </button>
            )}
          </fieldset>
          {full && <p className="fine-print-inline">That’s a full table of four.</p>}

          <div className="turn-order">
            <p id="turn-order-title" className="turn-order-title">
              Turn order
            </p>
            <ol aria-labelledby="turn-order-title">
              <li>You (host)</li>
              {roster.map((id) => (
                <li key={id}>{nameOf(id)}</li>
              ))}
            </ol>
            {roster.length === 0 ? (
              <p id="new-table-hint" className="fine-print-inline">
                Pick who plays. They take their turns in the order you pick them.
              </p>
            ) : (
              <p className="fine-print-inline">Everyone is seated at once and finds the table in their lobby.</p>
            )}
          </div>
        </>
      )}

      <p className="form-error" role="alert">
        {error ?? (retrying ? UNCONFIRMED : null)}
      </p>
      <button
        type="submit"
        className="button button-primary"
        disabled={busy || roster.length === 0}
        aria-describedby={roster.length === 0 && known.length > 0 ? 'new-table-hint' : undefined}
      >
        {busy ? 'Creating…' : retrying ? 'Try again' : 'Start Yatzy'}
      </button>
    </form>
  );
}

function creationError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'unsupported_game_type') return 'Yatzy isn’t available here yet. Reload the page to update.';
    if (e.code === 'unsupported_game') return e.message;
    if (e.code === 'opponent_not_found') return 'You can only seat people you’ve already played a game with.';
  }
  return 'Couldn’t start that table. Please try again.';
}
