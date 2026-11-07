// Real finished games, per friend, with the win/draw tally. (The sample panel lives only in local play.)
import { typeLabel } from '../games/registry';
import type { HistoryEntry } from '../shared/gameApi';

const ENDINGS: Record<HistoryEntry['games'][number]['termination'], string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  stalemate: 'by stalemate',
  'insufficient-material': 'by insufficient material',
  'threefold-repetition': 'by threefold repetition',
  'fifty-move-rule': 'by the fifty-move rule',
};

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function outcomeText(game: HistoryEntry['games'][number], opponent: string): string {
  if (game.outcome === 'draw') return `Draw ${ENDINGS[game.termination]}`;
  return `${game.outcome === 'win' ? 'You' : opponent} won ${ENDINGS[game.termination]}`;
}

export default function ChessHistory({ history }: { history: HistoryEntry[] }) {
  return (
    <section className="card" aria-labelledby="history-title">
      <h2 id="history-title">Chess history</h2>
      {history.length === 0 && <p className="muted">Finished games will be kept here.</p>}
      {history.map((entry) => {
        const name = entry.opponent.displayName;
        // Tallies are kept per type (#54): standard chess keeps its original headings.
        const type = typeLabel(entry.gameType);
        const standard = entry.gameType === 'chess';
        return (
          <section key={`${entry.gameType}:${entry.opponent.id}`} className="history-friend" aria-label={`${type} with ${name}`}>
            <h3 className="panel-title">{standard ? `With ${name}` : `${type} with ${name}`}</h3>
            <dl className="tally" aria-label={standard ? `Tally with ${name}` : `${type} tally with ${name}`}>
              <div className="tally-item">
                <dt>You</dt>
                <dd>{entry.wins}</dd>
              </div>
              <div className="tally-item tally-draws">
                <dt>Draws</dt>
                <dd>{entry.draws}</dd>
              </div>
              <div className="tally-item">
                <dt>{name}</dt>
                <dd>{entry.losses}</dd>
              </div>
            </dl>
            <ol className="games" aria-label={standard ? `Finished games with ${name}` : `Finished ${type} games with ${name}`}>
              {entry.games.map((game) => (
                <li key={game.id}>
                  <a className="game game-link-plain" href={`#/game/${game.id}`}>
                    <time dateTime={game.finishedAt}>{dateFormat.format(new Date(game.finishedAt))}</time>
                    <span className="game-players">You played {game.yourSeat === 'white' ? 'White' : 'Black'}</span>
                    <span className={`game-result${game.outcome === 'draw' ? ' game-result-draw' : ''}${game.outcome === 'loss' ? ' game-result-loss' : ''}`}>
                      {game.outcome === 'win' ? 'Won' : game.outcome === 'loss' ? 'Lost' : 'Draw'}
                    </span>
                    <span className="game-ending">
                      {outcomeText(game, name)} · {game.moveCount} moves
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </section>
  );
}
