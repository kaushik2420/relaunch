-- ============================================================
-- BROWSER EXTENSION SUPPORT
-- ============================================================
-- Single token per user, generated/rotated from /settings.
-- We store it in plain text intentionally — same security level as
-- the user's session cookie. If we ever want to add multi-device
-- (multiple tokens per user, revocable individually) this becomes
-- a separate `extension_tokens` table.
--
-- For job_matches (the per-match storage the extension reads from),
-- see migration 0010 (deferred — extension can still connect + show
-- profile data without it; the /api/extension/job endpoint will 404
-- until that lands).
-- ============================================================

alter table public.users
  add column if not exists extension_token text;

create unique index if not exists users_extension_token_idx
  on public.users (extension_token)
  where extension_token is not null;
