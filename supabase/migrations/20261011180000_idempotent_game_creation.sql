-- Let a creator retry game creation safely: the client's request ID identifies one creation,
-- so a retry after a lost response finds the game instead of creating a second one (#9 review).
alter table public.games add column create_request_id uuid;

alter table public.games
  add constraint games_creator_request_unique unique (created_by, create_request_id);
