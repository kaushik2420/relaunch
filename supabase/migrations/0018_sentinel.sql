-- 0018_sentinel.sql
-- Sentinel = hourly self-diagnosis cron. Two tables:
--
--   sentinel_runs   — audit trail of every hourly triage. Even 'all
--                     clear' runs get logged so we can prove the
--                     sentinel itself is alive.
--
--   sentinel_alerts — one row per DISTINCT problem currently active.
--                     Deduped by problem_signature (a hash of the
--                     top failure pattern). Kept open (resolved_at
--                     null) until a subsequent sentinel run doesn't
--                     detect the same signature, at which point the
--                     next sentinel run resolves it.
--
-- Design: cheap enough to run forever (~$1/month), quiet enough not
-- to spam (dedup by signature), auditable enough to trust (every
-- decision is a row).

CREATE TABLE IF NOT EXISTS public.sentinel_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at         timestamptz NOT NULL DEFAULT now(),
  window_start   timestamptz NOT NULL,
  window_end     timestamptz NOT NULL,
  signals        jsonb NOT NULL,         -- raw counts we handed to Claude
  severity       int NOT NULL,           -- 0-5; 0 means all clear
  headline       text NOT NULL,
  root_cause     text,
  suggested_fix  text,
  problem_sig    text,                   -- null when severity=0
  notified       boolean NOT NULL DEFAULT false,
  duration_ms    int
);

CREATE INDEX IF NOT EXISTS idx_sentinel_runs_ran
  ON public.sentinel_runs(ran_at DESC);

CREATE TABLE IF NOT EXISTS public.sentinel_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_sig      text NOT NULL UNIQUE,  -- one open alert per signature
  first_detected   timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  severity         int NOT NULL,
  headline         text NOT NULL,
  root_cause       text,
  suggested_fix    text,
  occurrence_count int NOT NULL DEFAULT 1,
  resolved_at      timestamptz,
  resolved_reason  text
);

CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_open
  ON public.sentinel_alerts(resolved_at, last_seen_at DESC);

COMMENT ON TABLE public.sentinel_runs IS
  'Audit trail — one row per hourly sentinel invocation, all-clears included.';
COMMENT ON TABLE public.sentinel_alerts IS
  'One row per distinct active problem. Deduped by problem_sig so repeated hourly detections update rather than duplicate.';

ALTER TABLE public.sentinel_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_alerts ENABLE ROW LEVEL SECURITY;
