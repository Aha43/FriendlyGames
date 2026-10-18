-- One player per email (#27). Email identifies a player; it never authorises anyone.
--
-- Emails are stored trimmed and lowercased by the API; the index normalises the same way so
-- case or surrounding whitespace can never slip past it. No provider-specific rules (dots,
-- plus suffixes).

-- Refuse to run while emails are shared: the whole migration then rolls back, nothing is
-- dropped or merged. The message gives a count only (emails are private).
do $$
declare
  shared integer;
begin
  select count(*) into shared
    from (select lower(btrim(email)) from public.player_contacts group by 1 having count(*) > 1) d;
  if shared > 0 then
    raise exception '% email(s) are used by more than one player; reconcile them first (docs/backend.md, "One player per email")', shared
      using errcode = 'unique_violation';
  end if;
end;
$$;

-- The constraint itself: also what makes simultaneous sign-ups safe.
create unique index player_contacts_email_unique on public.player_contacts (lower(btrim(email)));
