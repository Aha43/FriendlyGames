-- Unique player names (#76). Player IDs stay the identity; names are what friends pick each
-- other by (#72, #73), so two players may not share one.
--
-- The rule: trim surrounding spaces, Unicode NFC (so a precomposed "Å" and "A" + combining ring
-- are the same), then lowercase with ICU's Unicode case rules. The explicit ICU collation matters:
-- the database's default collation (C.UTF-8) leaves letters such as "Å" unchanged by lower().
-- Stored names are not rewritten; they keep the capitalization, accents and inner spaces chosen.
-- scripts/name-check.sql (`make prod-name-check`) uses this exact expression, and a test keeps
-- the two identical.

-- Refuse to run while names collide: the whole migration then rolls back and nothing is renamed,
-- merged or deleted. The message gives a count only; `make prod-name-check` lists them.
do $$
declare
  shared integer;
begin
  select count(*) into shared
    from (select lower(normalize(btrim(display_name), NFC) collate "und-x-icu")
            from public.players group by 1 having count(*) > 1) d;
  if shared > 0 then
    raise exception '% player name(s) are used by more than one player; reconcile them first (docs/backend.md, "Unique player names")', shared
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- The constraint itself: also what settles simultaneous sign-ups with the same name.
create unique index players_display_name_unique
  on public.players (lower(normalize(btrim(display_name), NFC) collate "und-x-icu"));
