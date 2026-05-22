-- ============================================================
-- Relaunch — invite-gated launch
-- ============================================================
-- The public site now collects early-access requests on a waitlist.
-- We review applicants and mint a single-use invite token for each
-- approved person; /signup is gated on a valid, unused token.
-- ============================================================

-- ---- waitlist: capture enough to review an applicant, track status
alter table public.waitlist
  add column if not exists linkedin_url text,
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'invited', 'joined')),
  add column if not exists invited_at timestamptz;

-- ============================================================
-- INVITES — one row per approved applicant.
-- Signup is allowed only with a valid, unused token. The table is
-- reachable solely via the service-role key (admin actions mint
-- tokens; the signup flow validates them server-side), so RLS is
-- enabled with no policies to block all anon/authenticated access.
-- ============================================================
create table if not exists public.invites (
  id           uuid primary key default uuid_generate_v4(),
  token        text not null unique,
  email        text not null,
  first_name   text,
  waitlist_id  uuid references public.waitlist(id) on delete set null,
  created_at   timestamptz default now() not null,
  expires_at   timestamptz,
  used_at      timestamptz,
  used_by      uuid references public.users(id) on delete set null
);

create index if not exists invites_token_idx on public.invites(token);
create index if not exists invites_email_idx on public.invites(lower(email));

alter table public.invites enable row level security;
-- (no policies — service-role only)
