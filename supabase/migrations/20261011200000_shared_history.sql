-- Shared history (#10): rematches, and finished games kept exactly as they ended.

-- "Play again" links the new game to the finished one. At most one rematch per game, so both
-- players asking for it land in the same new game.
alter table public.games add column rematch_of uuid references public.games (id);

alter table public.games add constraint games_rematch_of_unique unique (rematch_of);

-- A finished game is an archived record: nothing may change it any more.
create function public.keep_finished_games_unchanged() returns trigger
  language plpgsql as $$
begin
  if old.status = 'finished' then
    raise exception 'game % is finished and cannot be changed', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger keep_finished_games_unchanged
  before update on public.games
  for each row execute function public.keep_finished_games_unchanged();

revoke all on function public.keep_finished_games_unchanged() from public, anon, authenticated;
