-- 0014_current_ctc.sql
-- Add current_ctc column so the salary reality-check can compute a
-- realistic *hike percentage* against each listing (not just show a
-- range in isolation).
--
-- Stored as text — users type "18L", "22 LPA", "1,800,000", "$140k".
-- We parse into a normalised numeric value at compute time via
-- parseCtcToNumber() so we don't have to force a specific input format.
--
-- Distinct from target_ctc (which is what the user *wants* — set at
-- onboarding). current_ctc is what they earn *now*, needed as the
-- baseline for the hike calculation.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_ctc text;

COMMENT ON COLUMN public.users.current_ctc IS
  'User''s current annual compensation (baseline for salary-hike calc). Free-form text ("18L", "22 LPA", "$140k") — parsed into a numeric value at read time.';
