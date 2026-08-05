-- 0022_mentor_signup.sql
-- Public mentor signup form. Adds columns so we can distinguish
-- admin-created mentors from public submissions, review submissions
-- before publishing, and hold onto the mentor's contact info + why
-- they want to help.

ALTER TABLE public.mentors
  ADD COLUMN IF NOT EXISTS submission_source text NOT NULL DEFAULT 'admin'
    CHECK (submission_source IN ('admin', 'public_form')),
  ADD COLUMN IF NOT EXISTS submitted_email text,
  ADD COLUMN IF NOT EXISTS submission_note text;

-- Public submissions default to inactive (needs admin approval).
-- Admin creates already flow through /admin/mentors where the Active
-- checkbox is on by default, so their behaviour is unchanged.

CREATE INDEX IF NOT EXISTS idx_mentors_pending_review
  ON public.mentors(submission_source, is_active)
  WHERE submission_source = 'public_form' AND is_active = false;

COMMENT ON COLUMN public.mentors.submission_source IS
  '''admin'' when created via /admin/mentors, ''public_form'' when a mentor filled the /join-as-mentor form themselves.';
COMMENT ON COLUMN public.mentors.submitted_email IS
  'Contact email a public submitter provided. Not shown on /mentors — for admin outreach only.';
