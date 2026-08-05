-- 0021_mentors.sql
-- Mentor directory: industry mentors we curate to offer 1:1 sessions
-- to users on Relaunch. Booking itself is off-platform — each mentor
-- provides a calendar_url (Calendly / Cal.com / SavvyCal etc.) that
-- we deep-link to.
--
-- Design:
--   - mentors table is admin-curated. Not linked to public.users;
--     mentors don't need to be Relaunch users to appear here.
--   - expertise is a text[] of tag strings. Kept as a bare array
--     rather than a normalised join so admin CRUD stays trivial;
--     the tag universe is small enough that duplicates are cheap.
--   - display_order lets the admin pin featured mentors on top.
--   - mentor_link_clicks is a light attribution log: one row every
--     time a user clicks "Book a session". Useful for measuring
--     which mentors get traffic; also gives us funnel data if we
--     later add real booking webhooks.

CREATE TABLE IF NOT EXISTS public.mentors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  headline       text NOT NULL,               -- "Ex-Head of Product at Razorpay"
  bio            text,                        -- 2-4 sentence self-intro
  avatar_url     text,                        -- headshot / initial fallback if null
  calendar_url   text NOT NULL,               -- Calendly / Cal.com deep link
  linkedin_url   text,
  expertise      text[] NOT NULL DEFAULT '{}',
  is_active      boolean NOT NULL DEFAULT true,
  display_order  int NOT NULL DEFAULT 100,    -- lower = higher on the page
  session_length_minutes int,                 -- optional metadata: "30 min chat"
  session_price_note     text,                -- "free for laid-off engineers" etc.
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentors_active_order
  ON public.mentors(is_active, display_order, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mentor_link_clicks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id    uuid NOT NULL REFERENCES public.mentors(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  clicked_at   timestamptz NOT NULL DEFAULT now(),
  from_page    text                            -- '/mentors' etc.
);

CREATE INDEX IF NOT EXISTS idx_mentor_clicks_mentor_time
  ON public.mentor_link_clicks(mentor_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentor_clicks_user_time
  ON public.mentor_link_clicks(user_id, clicked_at DESC);

COMMENT ON TABLE public.mentors IS
  'Industry mentors offering 1:1 sessions. Bookings live in the mentor''s own calendar tool — calendar_url is a deep link.';
COMMENT ON TABLE public.mentor_link_clicks IS
  'One row per Book-a-session click. Not a real booking record — attribution + funnel signal.';

ALTER TABLE public.mentors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_link_clicks ENABLE ROW LEVEL SECURITY;
