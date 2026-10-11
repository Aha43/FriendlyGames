import ChessTable from '../components/ChessTable';
import SharedHistory from '../components/SharedHistory';

// Both sides on one device, kept in this browser only. Separate from shared games by design.
const PLAYERS = { w: 'White', b: 'Black' };

export default function LocalPage() {
  return (
    <>
      <ChessTable players={PLAYERS} />
      <SharedHistory />
    </>
  );
}
