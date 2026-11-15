-- Deleting finished games (#93). Any participant may delete a finished shared game for
-- everyone; the API authorizes it. This migration makes that possible without loosening what a
-- finished game is: an archived record nothing may change.
--
-- Additive for existing rows: no game, seat, invitation or action is rewritten or removed.

-- 1. A rematch outlives its source. Deleting the source detaches the rematch (rematch_of becomes
--    null) instead of being refused by the foreign key; the rematch stays a game of its own.
alter table public.games drop constraint games_rematch_of_fkey;
alter table public.games add constraint games_rematch_of_fkey
  foreign key (rematch_of) references public.games (id) on delete set null;

-- 2. That detaching is an update of the rematch row, which may itself be finished. A finished
--    game still cannot change, with exactly one exception: its rematch_of going to null while
--    every other column stays as it was.
create or replace function public.keep_finished_games_unchanged() returns trigger
  language plpgsql as $$
begin
  if old.status = 'finished' then
    if old.rematch_of is not null and new.rematch_of is null
       and (to_jsonb(new) - 'rematch_of') = (to_jsonb(old) - 'rematch_of') then
      return new;
    end if;
    raise exception 'game % is finished and cannot be changed', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 3. What is left of a deleted game: only the creator and the request ID it was created with,
--    so a late retry of that creation is answered "that game was deleted" (410) instead of
--    quietly creating it again. Nothing about the game's players, type or content is kept.
create table public.deleted_game_requests (
  created_by uuid not null references public.players (id) on delete cascade,
  create_request_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (created_by, create_request_id)
);

alter table public.deleted_game_requests enable row level security;
revoke all on public.deleted_game_requests from anon, authenticated;
