-- make prod-name-check (#76): player names that collide under the uniqueness rule, read-only.
--
-- Sent as one query, so all statements share one implicit transaction: it is READ ONLY before
-- anything is read, and bounded in time. It needs nothing from the #76 migration, so it works on
-- the schema before and after it. No emails, credentials or invitations are read.
--
-- The canonical name is the uniqueness rule, written exactly as in the migration's index
-- (supabase/migrations/20261108120000_unique_player_names.sql; a test keeps the two identical):
-- trim surrounding spaces, Unicode NFC, then lowercase with ICU's Unicode case rules (the
-- database's own default collation may not lowercase letters such as Å).
set transaction read only;
set local statement_timeout = '15s';
-- query
with canonical as (
  select p.id, p.display_name, p.created_at,
         lower(normalize(btrim(p.display_name), NFC) collate "und-x-icu") as name_key
    from public.players p
), colliding as (
  select c.id, c.display_name, c.created_at, c.name_key,
         (select count(distinct gp.game_id) from public.game_participants gp where gp.player_id = c.id) as games
    from canonical c
   where c.name_key in (select name_key from canonical group by name_key having count(*) > 1)
)
select 'summary' as kind,
       null::text as name_key, null::uuid as player_id, null::text as display_name,
       null::bigint as games, null::timestamptz as created_at,
       (select count(*) from canonical) as players,
       (select count(distinct name_key) from colliding) as collision_groups,
       current_setting('transaction_read_only') as read_only
union all
select 'collision', name_key, id, display_name, games, created_at, null, null, null
  from colliding
order by kind desc, name_key, created_at;
