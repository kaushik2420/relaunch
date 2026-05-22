-- ============================================================
-- Relaunch — migration 0006: in-app feedback
-- ============================================================
-- A lightweight feedback table. Anyone (signed in or not) can leave
-- feedback; the admin reads it via the service role on /admin.
-- ============================================================
create table if not exists public.feedback (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.users(id) on delete set null,
  name        text,
  email       text,
  rating      int check (rating between 1 and 5),
  message     text not null,
  created_at  timestamptz default now() not null
);

create index if not exists feedback_created_idx
  on public.feedback(created_at desc);

alter table public.feedback enable row level security;

-- Anyone can leave feedback; reads happen via the service role (admin only).
create policy "feedback_insert_anyone"
  on public.feedback for insert
  with check (true);
