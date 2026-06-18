-- ============================================================
-- 0011: track when a user marks a match as 'applied'
-- ============================================================
-- The Google Sheet has an "Applied?" column the user can flip Yes/No
-- manually. Mirroring that in job_matches lets the dashboard, the
-- /all-matches view, and the Chrome extension all default-filter out
-- already-applied roles without reaching for the Sheet.
--
-- A timestamp (not a bool) so we can show "applied 3d ago" in lists
-- and unwind it later if we ever want an "undo" path.
-- ============================================================

alter table public.job_matches
  add column if not exists applied_at timestamptz;

-- Partial index — most queries filter "where applied_at is null"
-- (active matches). Skipping the bulk of applied rows keeps the
-- index small.
create index if not exists job_matches_user_not_applied_idx
  on public.job_matches (user_id, created_at desc)
  where applied_at is null;
