-- ============================================================
-- Career-pivot mode.
--
-- When a job seeker wants to switch into a DIFFERENT kind of role
-- (not just more of what their resume already shows), they turn on
-- "pivot mode" in preferences and describe the change they want.
--
--   pivot_enabled  — toggle; false means the app behaves exactly as before
--   pivot_brief    — jsonb capturing the refined search plan:
--     {
--       "goal":               "<their raw description>",
--       "qa": [ { "question": "...", "answer": "..." }, ... ],
--       "refinedSummary":     "<human-readable summary of the pivot plan>",
--       "searchQuery":        "<short keyword phrase for the job APIs>",
--       "suggestedRoleFamily":"<role-family id, or null>"
--     }
--
-- Nullable + defaulted so existing rows need no backfill.
-- ============================================================

alter table public.users
  add column if not exists pivot_enabled boolean default false;

alter table public.users
  add column if not exists pivot_brief jsonb default null;
