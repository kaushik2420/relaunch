-- ============================================================
-- Add role_family to users
-- ============================================================
-- Drives smarter per-provider query translation:
--   Adzuna: maps to their `category` param (huge recall improvement)
--   Greenhouse: filters scanned company boards by department signal
--   Jooble / JSearch: enriches the keyword query
-- Optional column — nullable, no default constraint.
-- ============================================================

alter table public.users
  add column if not exists role_family text
  check (role_family is null or role_family in (
    'engineering', 'product', 'design', 'data', 'marketing', 'operations', 'sales', 'other'
  ));
