-- ============================================================
-- Relaunch — initial schema
-- ============================================================
-- We store only what's needed to run the cron and bill users.
-- Resume content, generated resumes, and job match history all
-- live in the user's Google Sheet — never on our servers.
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
-- signup_position auto-increments; 1..30 = founder cohort,
-- 31..500 = early cohort, 501+ = rejected at signup (waitlist).
-- Free-trial windows are decided by signup_position at signup time
-- so they can never change once granted.
-- ============================================================
create table public.users (
  id                            uuid primary key references auth.users on delete cascade,
  email                         text not null unique,
  first_name                    text,
  signup_position               int not null,
  cohort                        text not null check (cohort in ('founder', 'early', 'waitlist')),

  -- Voluntary self-declaration (NOT required, NOT used to gate access)
  affected_by_layoff            boolean default null,
  declared_at                   timestamptz,

  -- Extracted from resume (jsonb so we can iterate freely)
  profile                       jsonb default '{}'::jsonb,

  -- User preferences (collected at onboarding)
  locations                     text[] default '{}',
  work_modes                    text[] default '{}',     -- {remote, hybrid, onsite, any}
  target_ctc                    text,
  phone                         text,
  notice_period                 text,
  notes                         text,

  -- Automation
  email_frequency               text default 'daily' check (email_frequency in ('daily','2days','weekly','realtime','paused')),
  email_time                    time default '08:30',
  timezone                      text default 'Asia/Kolkata',

  -- Google integration (encrypted; never read raw)
  google_refresh_token_enc      text,
  google_email                  text,
  user_sheet_id                 text,

  -- Lifecycle
  free_until                    timestamptz not null,
  is_paying                     boolean default false,
  is_active                     boolean default true,
  paused_until                  timestamptz,
  last_run_at                   timestamptz,
  last_login_at                 timestamptz,

  created_at                    timestamptz default now() not null,
  updated_at                    timestamptz default now() not null
);

create unique index users_signup_position_uidx on public.users(signup_position);
create index users_active_freq_idx on public.users(is_active, email_frequency) where is_active = true;
create index users_free_until_idx on public.users(free_until) where is_paying = false;

-- ============================================================
-- DAILY RUN LOG (audit only — no job content stored)
-- ============================================================
create table public.job_runs (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.users(id) on delete cascade,
  run_at       timestamptz default now() not null,
  jobs_found   int default 0,
  jobs_emailed int default 0,
  status       text not null check (status in ('ok','partial','error')),
  error        text,
  duration_ms  int
);

create index job_runs_user_run_idx on public.job_runs(user_id, run_at desc);

-- ============================================================
-- BILLING EVENTS (subscription lifecycle, no card data)
-- ============================================================
create table public.billing_events (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.users(id) on delete cascade,
  provider        text not null check (provider in ('razorpay','stripe')),
  event_type      text not null,            -- subscription.activated | invoice.paid | subscription.cancelled etc.
  provider_id     text,                     -- subscription id / invoice id from provider
  amount_minor    int,                      -- in paise / cents
  currency        text,
  payload         jsonb,                    -- raw webhook payload
  occurred_at     timestamptz default now() not null
);

create index billing_user_idx on public.billing_events(user_id, occurred_at desc);

-- ============================================================
-- WAITLIST (once we hit TOTAL_CAP)
-- ============================================================
create table public.waitlist (
  id          uuid primary key default uuid_generate_v4(),
  email       text not null unique,
  first_name  text,
  reason      text,
  created_at  timestamptz default now()
);

-- ============================================================
-- TRIGGER: assign signup_position and cohort + free_until
-- ============================================================
-- We use a SECURITY DEFINER function with serializable isolation to
-- avoid race conditions when 1000 people sign up in the same second.
-- ============================================================
create or replace function public.assign_cohort_on_insert()
returns trigger
language plpgsql
security definer
as $$
declare
  v_founder_cap  int := coalesce(current_setting('app.founder_cap', true)::int, 30);
  v_total_cap    int := coalesce(current_setting('app.total_cap', true)::int, 500);
  v_founder_days int := coalesce(current_setting('app.founder_days', true)::int, 90);
  v_default_days int := coalesce(current_setting('app.default_days', true)::int, 20);
  v_pos          int;
begin
  -- Atomically reserve the next position
  select coalesce(max(signup_position), 0) + 1 into v_pos from public.users;
  new.signup_position := v_pos;

  if v_pos <= v_founder_cap then
    new.cohort := 'founder';
    new.free_until := now() + (v_founder_days || ' days')::interval;
  elsif v_pos <= v_total_cap then
    new.cohort := 'early';
    new.free_until := now() + (v_default_days || ' days')::interval;
  else
    -- App layer should reject before this point and add to waitlist,
    -- but if we get here, the user is marked waitlist and inactive.
    new.cohort := 'waitlist';
    new.free_until := now();
    new.is_active := false;
  end if;

  return new;
end;
$$;

create trigger users_assign_cohort_trg
  before insert on public.users
  for each row execute function public.assign_cohort_on_insert();

-- ============================================================
-- TRIGGER: keep updated_at fresh
-- ============================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at_trg
  before update on public.users
  for each row execute function public.touch_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.job_runs enable row level security;
alter table public.billing_events enable row level security;
alter table public.waitlist enable row level security;

-- Users can read & update their own row
create policy "users_self_read"
  on public.users for select
  using (auth.uid() = id);

create policy "users_self_update"
  on public.users for update
  using (auth.uid() = id);

-- Insert is done via the trigger above; we allow auth user to insert their own row
create policy "users_self_insert"
  on public.users for insert
  with check (auth.uid() = id);

-- job_runs and billing_events: read-only for the owning user
create policy "job_runs_self_read"
  on public.job_runs for select
  using (auth.uid() = user_id);

create policy "billing_events_self_read"
  on public.billing_events for select
  using (auth.uid() = user_id);

-- Waitlist: anyone can insert their own email; no reads (admin-only via service role)
create policy "waitlist_anon_insert"
  on public.waitlist for insert
  with check (true);

-- ============================================================
-- VIEW: cohort counts (used by signup flow to enforce TOTAL_CAP)
-- ============================================================
create or replace view public.cohort_counts as
select
  count(*) filter (where cohort = 'founder')  as founder_count,
  count(*) filter (where cohort = 'early')    as early_count,
  count(*) as total_count
from public.users
where cohort in ('founder', 'early');

grant select on public.cohort_counts to anon, authenticated;
