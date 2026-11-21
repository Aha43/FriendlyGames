-- Friends before games (#110): a player invites a friend with a single-use link, without
-- choosing a game. Accepting connects the two players for good and creates no game.
--
-- Additive: two new tables. No existing row, column, constraint or trigger changes. The API
-- before this migration never reads these tables, so it keeps working on the migrated schema.

-- One link per invitation. Possession of the token (stored hashed) lets one other player accept,
-- once, until it expires. Replacing an invitation gives the same row a new token and expiry, so
-- the earlier link stops working and no second invitation exists.
create table public.friend_invitations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.players (id) on delete cascade,
  -- Makes creation retryable: the same creator and request ID are the same invitation.
  create_request_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.players (id) on delete cascade,
  constraint friend_invitation_accepted_together check ((accepted_at is null) = (accepted_by is null)),
  constraint friend_invitation_not_own check (accepted_by is null or accepted_by <> created_by),
  unique (created_by, create_request_id)
);

-- The creator's pending list and the cap count read by creator.
create index friend_invitations_pending on public.friend_invitations (created_by, expires_at)
  where accepted_at is null;

-- A lasting connection between two players: one row per pair, the smaller ID first, so it is the
-- same row whichever of them asks. Independent of games: deleting a game never removes it.
create table public.player_connections (
  player_low uuid not null references public.players (id) on delete cascade,
  player_high uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_low, player_high),
  constraint player_connection_ordered check (player_low < player_high)
);

create index player_connections_high on public.player_connections (player_high);

-- As every other table: reachable only through the Edge Function's database role.
alter table public.friend_invitations enable row level security;
alter table public.player_connections enable row level security;
revoke all on public.friend_invitations, public.player_connections from anon, authenticated;
