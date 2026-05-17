-- ============================================================
-- Drop the role_family CHECK constraint so we can expand the role
-- list freely from the app layer without DB migrations every time.
-- App-layer validation in savePreferencesAction is the source of truth.
-- ============================================================

do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.users'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role_family%';
  if con_name is not null then
    execute 'alter table public.users drop constraint ' || quote_ident(con_name);
  end if;
end $$;
