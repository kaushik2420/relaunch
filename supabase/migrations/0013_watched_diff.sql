-- ============================================================
-- 0013: active monitoring of manual-tracked careers pages
-- ============================================================
-- When auto-detect can't find a company on a supported ATS, the
-- user can paste their careers page URL. Every daily run, we fetch
-- that page, extract job-like links, and diff against last_seen_urls.
-- New URLs become job_matches rows so the user sees them in their
-- /all-matches view alongside the global pool.
--
-- last_seen_urls       jsonb array of URLs we've seen at the company
-- last_checked_at      when we last fetched the page (null = never)
-- ============================================================

alter table public.watched_companies
  add column if not exists last_seen_urls jsonb,
  add column if not exists last_checked_at timestamptz;
