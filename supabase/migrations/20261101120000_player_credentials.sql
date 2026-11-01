-- Email entry from several browsers (#29): a player can have many device credentials, one per
-- browser that entered their email. Only SHA-256 hashes are stored, as before.
create table public.player_credentials (
  credential_hash bytea primary key check (octet_length(credential_hash) = 32),
  player_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index player_credentials_player_idx on public.player_credentials (player_id);

-- Every browser that works today keeps working: its credential carries over unchanged.
insert into public.player_credentials (credential_hash, player_id, created_at)
select credential_hash, id, created_at from public.players;

-- Compatibility stage. players.credential_hash stays (the first browser's credential), so the
-- previous function version still works if it is serving, or is rolled back to. A player that
-- version creates gets its credential here too, so the new version accepts it.
create function public.copy_first_player_credential() returns trigger
  language plpgsql as $$
begin
  insert into public.player_credentials (credential_hash, player_id)
  values (new.credential_hash, new.id)
  on conflict (credential_hash) do nothing;
  return new;
end;
$$;

create trigger copy_first_player_credential
  after insert on public.players
  for each row execute function public.copy_first_player_credential();

-- Private like the other tables: only the game API (service connection) reads or writes it.
alter table public.player_credentials enable row level security;
revoke all on public.player_credentials from anon, authenticated;
revoke all on function public.copy_first_player_credential() from public, anon, authenticated;
