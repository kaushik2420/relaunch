-- ============================================================
-- JOB MATCHES (per-match storage for the Chrome extension)
-- ============================================================
-- Each row is one tailored match the daily-runner produced for a user.
-- The Chrome extension queries this table via /api/extension/job to
-- pull the right tailored content for whichever job page the user is
-- currently viewing.
--
-- We dedupe by (user_id, apply_url) — re-running the daily-runner for
-- the same job updates the existing row instead of inserting a duplicate.
-- ============================================================

create table if not exists public.job_matches (
  id                        uuid primary key default uuid_generate_v4(),
  user_id                   uuid not null references public.users(id) on delete cascade,
  job_run_id                uuid references public.job_runs(id) on delete set null,

  -- Where the job lives. apply_url is the canonical URL the user clicks
  -- to apply. ats_id is the extracted source-side job identifier (e.g.
  -- Greenhouse gh_jid, Lever posting id) — it lets the extension match
  -- the right row even when the user lands on a wrapper URL (e.g.
  -- careers.datadoghq.com/detail/123/?gh_jid=123 -> Greenhouse job 123).
  apply_url                 text not null,
  ats                       text,      -- 'greenhouse' | 'lever' | 'ashby' | 'linkedin' | null
  ats_id                    text,      -- the source-side id, when extractable

  job_title                 text not null,
  company                   text not null,
  match_percent             int,
  verify_score              int,

  -- Tailored content. Text columns are the source of truth (the PDF/Doc
  -- URLs are derived). Both kept so the extension can either auto-fill
  -- the form (text) or trigger a download (pdf_url).
  tailored_resume_text      text,
  tailored_resume_pdf_url   text,
  tailored_resume_doc_url   text,
  cover_letter_text         text,
  cover_letter_pdf_url      text,
  cover_letter_doc_url      text,

  -- Short-form answers that map onto common application questions.
  why_this_role             text,      -- "Why are you interested in this role?"
  summary                   text,      -- 2-3 sentence elevator pitch tailored to the JD

  created_at                timestamptz default now() not null,
  updated_at                timestamptz default now() not null,

  -- One row per (user, job). Re-running the daily-runner for the same
  -- job replaces the row instead of inserting a duplicate.
  unique (user_id, apply_url)
);

create index if not exists job_matches_user_recent_idx
  on public.job_matches (user_id, created_at desc);

-- Extension lookups: by canonical apply_url, by ATS-side id. Both
-- partial-index to skip nulls.
create index if not exists job_matches_user_url_idx
  on public.job_matches (user_id, apply_url);

create index if not exists job_matches_user_atsid_idx
  on public.job_matches (user_id, ats, ats_id)
  where ats_id is not null;

-- ============================================================
-- RLS: owner can read their own matches. Inserts/updates happen
-- via the service-role admin client from the daily-runner, so we
-- don't need user-level INSERT policies.
-- ============================================================
alter table public.job_matches enable row level security;

create policy job_matches_owner_read
  on public.job_matches
  for select
  using (auth.uid() = user_id);
