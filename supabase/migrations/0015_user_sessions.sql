-- 0015_user_sessions.sql
-- Session tracking so we can see, per user, when they last logged in
-- and how much time they've actually spent using Relaunch.
--
-- Design: the client sends a heartbeat POST every ~60 seconds while a
-- Relaunch tab is active (paused when document.hidden). Each browser
-- tab / page load creates ONE row in user_sessions. Heartbeats bump
-- last_seen_at. Total active time per user is then
--   SUM(last_seen_at - started_at)
-- computed at read time in the admin panel — no counter increments,
-- no double-counting.

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  user_agent     text
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions(user_id, last_seen_at DESC);

-- Convenience column on users so we don't have to aggregate for the
-- most common question ("when did they last sign in / open the app?").
-- Updated on every session creation (first heartbeat of a tab).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON TABLE public.user_sessions IS
  'Per-tab session records. One row per browser tab/page-load; last_seen_at bumps every heartbeat (~60s while tab is active).';
COMMENT ON COLUMN public.users.last_login_at IS
  'Most recent time this user opened the app. Set on the first heartbeat of any new session.';

-- RLS: locked down — service role only. The heartbeat endpoint uses
-- the admin client. Users never read this table directly.
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
