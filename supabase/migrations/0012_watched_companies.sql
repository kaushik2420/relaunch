-- ============================================================
-- 0012: user-curated company watchlist
-- ============================================================
-- Users can name specific companies they want to track (e.g.
-- "Stripe", "Razorpay") and we'll pull from those companies' ATS
-- career boards in every daily run alongside the global providers.
--
-- detection_status:
--   pending     — just added, auto-detect hasn't run yet
--   detected    — we found the company on one of the 6 supported
--                 ATSes; ats + ats_slug are populated
--   manual      — user provided a careers URL but no auto-detect
--                 match (we won't scrape custom pages in v1; this
--                 row is parked for later)
--   not_found   — auto-detect couldn't find this company anywhere
--                 we support. User can retry or remove.
--
-- Each row is a (user_id, name) pair so a user can have the same
-- company tracked once. Lower-casing is done in app code; we use
-- a unique index instead of a citext column to keep the schema
-- light.
-- ============================================================

create table if not exists public.watched_companies (
  id                        uuid primary key default uuid_generate_v4(),
  user_id                   uuid not null references public.users(id) on delete cascade,
  name                      text not null,
  ats                       text,
  ats_slug                  text,
  detection_status          text not null default 'pending'
    check (detection_status in ('pending', 'detected', 'manual', 'not_found')),
  detection_attempted_at    timestamptz,
  careers_url               text,
  created_at                timestamptz default now() not null
);

-- One row per (user, normalised name). Case-insensitive uniqueness
-- is enforced via the lower() expression index.
create unique index if not exists watched_companies_user_name_lower_idx
  on public.watched_companies (user_id, lower(name));

create index if not exists watched_companies_user_status_idx
  on public.watched_companies (user_id, detection_status);

-- RLS: owner can read + insert + delete their own rows. Server-role
-- bypass is what daily-runner uses to read across all users.
alter table public.watched_companies enable row level security;

create policy watched_companies_owner_read
  on public.watched_companies for select
  using (auth.uid() = user_id);

create policy watched_companies_owner_write
  on public.watched_companies for insert
  with check (auth.uid() = user_id);

create policy watched_companies_owner_delete
  on public.watched_companies for delete
  using (auth.uid() = user_id);

create policy watched_companies_owner_update
  on public.watched_companies for update
  using (auth.uid() = user_id);
