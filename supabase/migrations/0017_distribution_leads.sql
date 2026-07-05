-- 0017_distribution_leads.sql
-- Distribution pipeline: leads sourced from public communities where
-- laid-off tech folks vent openly. Kaushik reviews each one manually
-- from /admin/leads and replies in the source community.
--
-- Sources supported today:
--   reddit   — public .json feeds from a curated subreddit set
-- Kept generic so future sources (hackernews, blind, twitter/x API)
-- can slot in without a schema change.
--
-- Status lifecycle: 'new' → 'replied' | 'dismissed' | 'irrelevant'.
-- 'dismissed' means "not a good fit, no reply"; 'irrelevant' means
-- "false positive from the keyword filter".

CREATE TABLE IF NOT EXISTS public.distribution_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,                       -- 'reddit', etc
  source_id         text NOT NULL,                       -- e.g. reddit post t3_id
  community         text NOT NULL,                       -- 'r/layoffs' etc
  author            text,
  title             text NOT NULL,
  body              text,
  url               text NOT NULL,                       -- link to the post/comment
  posted_at         timestamptz,
  score             int    NOT NULL DEFAULT 0,           -- upvotes / equivalent
  num_comments      int    NOT NULL DEFAULT 0,
  matched_keywords  text[] NOT NULL DEFAULT '{}',
  lead_score        real   NOT NULL DEFAULT 0,           -- our composite ranking
  status            text   NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','replied','dismissed','irrelevant')),
  notes             text,
  seen_at           timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_distribution_leads_status_score
  ON public.distribution_leads(status, lead_score DESC, seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_distribution_leads_seen_at
  ON public.distribution_leads(seen_at DESC);

COMMENT ON TABLE public.distribution_leads IS
  'Curated laid-off / job-hunting posts from public communities. Reviewed manually from /admin/leads for cold outreach.';

ALTER TABLE public.distribution_leads ENABLE ROW LEVEL SECURITY;
