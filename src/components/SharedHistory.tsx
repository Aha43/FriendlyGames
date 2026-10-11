import { SAMPLE_GAMES, tally, winner } from '../sample/sampleHistory';

const PLAYERS: [string, string] = ['Arne', 'Harald'];

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function SharedHistory() {
  const { wins, draws } = tally(SAMPLE_GAMES, PLAYERS);

  return (
    <aside className="history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">Chess history</h2>
        <span className="sample-badge">Sample data</span>
      </div>
      <p className="sample-note">Invented games to preview the layout. Real results will appear here.</p>

      <dl className="tally" aria-label="Sample chess tally">
        <div className="tally-item">
          <dt>{PLAYERS[0]}</dt>
          <dd>{wins[PLAYERS[0]]}</dd>
        </div>
        <div className="tally-item tally-draws">
          <dt>Draws</dt>
          <dd>{draws}</dd>
        </div>
        <div className="tally-item">
          <dt>{PLAYERS[1]}</dt>
          <dd>{wins[PLAYERS[1]]}</dd>
        </div>
      </dl>

      <ol className="games" aria-label="Sample completed games">
        {SAMPLE_GAMES.map((game) => {
          const w = winner(game);
          return (
            <li key={game.id} className="game">
              <time dateTime={game.date}>{dateFormat.format(new Date(game.date))}</time>
              <span className="game-players">
                {game.white} <span className="game-vs">vs</span> {game.black}
              </span>
              <span className={`game-result${w ? '' : ' game-result-draw'}`}>{w ? `${w} won` : 'Draw'}</span>
              <span className="game-ending">
                {game.ending} · {game.moves} moves
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
