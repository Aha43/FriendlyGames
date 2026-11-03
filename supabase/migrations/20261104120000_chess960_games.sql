-- Fischer Random (Chess960) as a second game type (#54). Additive: existing chess games,
-- payloads, actions, results, invitations and credentials are not touched, and every
-- existing row already satisfies the widened checks.

-- A game is standard chess or Chess960 (see supabase/functions/game-api/gameTypes.ts).
alter table public.games drop constraint games_game_type_check;
alter table public.games add constraint games_game_type_check check (game_type in ('chess', 'chess960'));

-- Castling is its own action in Chess960, saved as the king moving onto its own rook in UCI
-- ("f1h1"), which the existing move pattern already fits. Moves and castles carry
-- notation; resignations do not.
alter table public.game_actions drop constraint game_actions_kind_check;
alter table public.game_actions add constraint game_actions_kind_check check (kind in ('move', 'resign', 'castle'));
alter table public.game_actions drop constraint move_has_notation;
alter table public.game_actions add constraint move_has_notation check ((kind in ('move', 'castle')) = (move is not null));
