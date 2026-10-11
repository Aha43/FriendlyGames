-- Shared chess games for FriendlyGames (Sprint 2, issue #8).
--
-- Clients never touch these tables. Every read and write goes through the
-- game-api Edge Function, which connects as the database owner. Row level
-- security is enabled with no policies and privileges are revoked from the
-- API roles, so PostgREST/GraphQL expose nothing.

-- Players are identified by a random device credential; only its SHA-256 hash is stored.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 40),
  credential_hash bytea not null unique check (octet_length(credential_hash) = 32),
  created_at timestamptz not null default now()
);

-- Private contact details, kept apart from anything returned to other players.
create table public.player_contacts (
  player_id uuid primary key references public.players (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  created_at timestamptz not null default now()
);

-- Common game envelope; game-specific state lives in payload.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  game_type text not null check (game_type = 'chess'),
  schema_version integer not null default 1,
  status text not null check (status in ('waiting', 'active', 'finished')),
  result text check (result in ('white', 'black', 'draw')),
  termination text check (
    termination in (
      'checkmate', 'resignation', 'stalemate',
      'insufficient-material', 'threefold-repetition', 'fifty-move-rule'
    )
  ),
  revision integer not null default 0 check (revision >= 0),
  -- chess: { "initialFen": string, "moves": ["e2e4", ...] }
  payload jsonb not null,
  created_by uuid not null references public.players (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finished_has_result check ((status = 'finished') = (result is not null and termination is not null))
);

create table public.game_participants (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id),
  seat text not null check (seat in ('white', 'black')),
  joined_at timestamptz not null default now(),
  primary key (game_id, seat),
  unique (game_id, player_id)
);

create index game_participants_player_idx on public.game_participants (player_id);

-- One invitation per game. Possession of the token (stored hashed) lets one player claim the seat, once.
create table public.game_invitations (
  game_id uuid primary key references public.games (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  seat text not null check (seat in ('white', 'black')),
  invited_email text not null check (char_length(invited_email) <= 254),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references public.players (id),
  constraint redeemed_together check ((redeemed_at is null) = (redeemed_by is null))
);

-- Every accepted action, keyed by the client's request ID so a retry is recognised, not repeated.
create table public.game_actions (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id),
  request_id uuid not null,
  kind text not null check (kind in ('move', 'resign')),
  move text check (move ~ '^[a-h][1-8][a-h][1-8][qrbn]?$'),
  revision integer not null,
  created_at timestamptz not null default now(),
  unique (game_id, player_id, request_id),
  unique (game_id, revision),
  constraint move_has_notation check ((kind = 'move') = (move is not null))
);

alter table public.players enable row level security;
alter table public.player_contacts enable row level security;
alter table public.games enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_invitations enable row level security;
alter table public.game_actions enable row level security;

revoke all on
  public.players, public.player_contacts, public.games,
  public.game_participants, public.game_invitations, public.game_actions
from anon, authenticated;

revoke all on sequence public.game_actions_id_seq from anon, authenticated;
