-- ============================================================
-- Relaunch — migration 0007: explicit search-keyword override
-- ============================================================
-- Most users get sensible search keywords derived from their résumé,
-- but some are mid career-change and the résumé doesn't reflect that.
-- This column lets them type the keywords they want job providers to
-- search for, overriding the auto-derived default.
-- ============================================================
alter table public.users
  add column if not exists search_query text;
