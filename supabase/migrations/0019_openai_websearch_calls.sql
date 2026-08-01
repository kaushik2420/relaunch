-- 0019_openai_websearch_calls.sql
-- Per-call audit log for the OpenAI Web Search job-discovery provider.
--
-- Purpose:
--   1. Rate limit: enforce per-user daily cap (OPENAI_WEB_SEARCH_DAILY_CAP)
--   2. Cache: identical (user_id, criteria_hash) within 6h reuses jobs
--   3. Cost tracking: /admin surfaces MTD spend for this feature
--   4. Debug: openai_response_id lets us re-fetch a call in OpenAI's console
--
-- Why not extend job_runs: job_runs is one-row-per-user-per-day. OpenAI
-- calls are ad-hoc, up to N per user per day, and have their own cost
-- semantics ($10/1K calls + token cost). Separate table = clean queries.

CREATE TABLE IF NOT EXISTS public.openai_websearch_calls (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  criteria_hash         text NOT NULL,           -- sha1 of stringified criteria; used for 6h cache
  criteria_snapshot     jsonb NOT NULL,          -- what we actually sent; kept for debugging
  cached                boolean NOT NULL DEFAULT false,
  openai_response_id    text,                    -- OpenAI's server-side response id (null when cached)
  duration_ms           int,
  jobs_returned         int NOT NULL DEFAULT 0,
  cost_estimate_usd     numeric(8, 4) NOT NULL DEFAULT 0,
  error                 text,                    -- non-null iff the call failed
  -- Cache payload: the parsed job array + sources. Populated on the
  -- authoritative (non-cached) call, then re-read by subsequent cached
  -- calls in the 6h window. Kept small — jobs are already summaries.
  cached_jobs           jsonb,
  cached_sources        jsonb
);

CREATE INDEX IF NOT EXISTS idx_openai_wsc_user_created
  ON public.openai_websearch_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openai_wsc_hash_created
  ON public.openai_websearch_calls(criteria_hash, created_at DESC);

COMMENT ON TABLE public.openai_websearch_calls IS
  'One row per OpenAI Responses+web_search call. Enforces per-user daily cap, powers 6h cache, feeds cost telemetry.';

ALTER TABLE public.openai_websearch_calls ENABLE ROW LEVEL SECURITY;

-- Enrich job_matches with the OpenAI-specific metadata (reasons, gaps,
-- evidence URLs, match level). Kept as a single jsonb blob so we can
-- iterate the UI without more schema migrations. Aggregator-sourced
-- rows leave this column null.
ALTER TABLE public.job_matches
  ADD COLUMN IF NOT EXISTS openai_metadata jsonb;

COMMENT ON COLUMN public.job_matches.openai_metadata IS
  'AI-discovery enrichment: match_reasons[], potential_gaps[], evidence_urls[], match_level. Populated only for jobs where ats=''openai_web''.';
