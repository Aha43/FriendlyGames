// Finished Yatzy tables (#86): each with its own ranking. Kept apart from the per-opponent chess
// tallies: a table has one result for everyone at it.
import { decidedBy, listNames, ordinal, resultLine, seated } from '../games/yatzy';
import type { TableResult } from '../shared/gameApi';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function YatzyHistory({ tables }: { tables: TableResult[] }) {
  if (tables.length === 0) return null;
  return (
    <section className="card" aria-labelledby="yatzy-history-title">
      <h2 id="yatzy-history-title">Yatzy results</h2>
      <ol className="games" aria-label="Finished Yatzy tables">
        {tables.map((table) => {
          const game = { players: table.players, yourSeat: table.yourSeat, yatzy: table.result.yatzy };
          const standings = table.result.yatzy.standings ?? [];
          const mine = standings.find((s) => s.seat === table.yourSeat);
          const won = mine?.place === 1;
          const others = listNames(seated(table.players).filter(({ seat }) => seat !== table.yourSeat).map(({ player }) => player.displayName));
          return (
            <li key={table.id}>
              <a className="game game-link-plain" href={`#/game/${table.id}`}>
                <time dateTime={table.finishedAt}>{dateFormat.format(new Date(table.finishedAt))}</time>
                <span className="game-players">With {others}</span>
                <span className={`game-result${won ? '' : ' game-result-loss'}`}>
                  {won ? (decidedBy(standings) === 'shared' ? 'Shared win' : 'Won') : mine ? ordinal(mine.place) : ''}
                </span>
                <span className="game-ending">
                  {resultLine(game)}
                  {mine ? ` · You scored ${mine.total}` : ''} · {table.result.yatzy.mode === 'forced' ? 'Forced' : 'Free'}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
