-- 0016_polish_sessions.sql
-- Persist résumé-polish analyses so users don't have to re-run Claude
-- every time they return to /polish. Also powers a Version history
-- panel (rolling window of the 5 most recent runs per user).
--
-- Storage model:
--   feedback jsonb = full array of feedback objects
--     [{ experienceIndex, bulletIndex, original, feedback,
--        suggested, isWeak, accepted }]
--   accepted rewrites still get written to users.profile.experience[].
--   bullets[] on accept — this table is the *analysis*, not the résumé.
--
-- Rolling cap of 5 per user is enforced in the server action after
-- insert (delete FROM ... WHERE user_id = $1 AND id NOT IN (SELECT id
-- FROM polish_sessions WHERE user_id = $1 ORDER BY created_at DESC
-- LIMIT 5)). No trigger — the action needs to run atomically per
-- user, and Postgres triggers on the same table get gnarly.

CREATE TABLE IF NOT EXISTS public.polish_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  feedback       jsonb NOT NULL,
  total_bullets  int NOT NULL DEFAULT 0,
  weak_bullets   int NOT NULL DEFAULT 0,
  accepted_count int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_polish_sessions_user_id_created
  ON public.polish_sessions(user_id, created_at DESC);

COMMENT ON TABLE public.polish_sessions IS
  'One row per résumé-polish analysis. feedback carries the full per-bullet suggestion set; the accepted counter is denormalised for the version history panel.';

ALTER TABLE public.polish_sessions ENABLE ROW LEVEL SECURITY;
