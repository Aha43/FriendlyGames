-- PROPOSED for #85, rehearsed by #84 (tests/backend/migrations/yatzy-format.test.ts). Not a
-- migration yet: `supabase db push` only reads supabase/migrations, so nothing here reaches any
-- database until #85 copies it there after review. See docs/decisions/0002-yatzy-format.md.
--
-- Yatzy as a third game type, for two to four players. Additive: only checks are widened, every
-- existing row already satisfies them and none is rewritten. Chess and Fischer Random keep their
-- seats, results, actions and invitations exactly as they are.

-- A game is standard chess, Chess960 or Yatzy.
alter table public.games drop constraint games_game_type_check;
alter table public.games add constraint games_game_type_check
  check (game_type in ('chess', 'chess960', 'yatzy'));

-- A finished Yatzy table records that it was scored to the end; the scores, tokens and winners
-- are replayed from its payload (one ranking per table, never a per-opponent result).
alter table public.games drop constraint games_result_check;
alter table public.games add constraint games_result_check
  check (result in ('white', 'black', 'draw', 'scored'));
alter table public.games drop constraint games_termination_check;
alter table public.games add constraint games_termination_check
  check (termination in (
    'checkmate', 'resignation', 'stalemate',
    'insufficient-material', 'threefold-repetition', 'fifty-move-rule',
    'scorecards-complete'
  ));

-- Ordered seats p1..p4 (turn order; p1 is the host) next to White and Black. The primary key
-- (game_id, seat) and unique (game_id, player_id) are unchanged, so a player sits once per table
-- and every seat holds one player. Invitations stay White/Black: Yatzy tables have none.
alter table public.game_participants drop constraint game_participants_seat_check;
alter table public.game_participants add constraint game_participants_seat_check
  check (seat in ('white', 'black', 'p1', 'p2', 'p3', 'p4'));

-- Throwing and scoring are actions. Their notation is the intent a retry is compared with:
-- "keep:" and the kept positions (sorted, 0-4, at most four), or "row:" and the scorecard row.
-- The dice themselves are rolled by the server and saved in the game's payload with the throw.
alter table public.game_actions drop constraint game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check
  check (kind in ('move', 'resign', 'castle', 'throw', 'score'));
alter table public.game_actions drop constraint game_actions_move_check;
alter table public.game_actions add constraint game_actions_move_check
  check (
    (kind in ('move', 'castle') and move ~ '^[a-h][1-8][a-h][1-8][qrbn]?$')
    or (kind = 'throw' and move ~ '^keep:(0?1?2?3?4?)$' and char_length(move) <= 9)
    or (kind = 'score' and move ~ '^row:[a-zA-Z]{3,13}$')
    or (kind = 'resign' and move is null)
  );
alter table public.game_actions drop constraint move_has_notation;
alter table public.game_actions add constraint move_has_notation
  check ((kind in ('move', 'castle', 'throw', 'score')) = (move is not null));
