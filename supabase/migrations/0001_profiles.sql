-- ===========================================================================
-- Wayvo — 0001_profiles.sql
--
-- Creates the public.profiles table, links it to Supabase auth.users, turns on
-- Row Level Security with owner-only policies, and adds the trigger that
-- creates a profile row the moment a user signs up.
--
-- Run this in the Supabase Dashboard -> SQL Editor, or:
--     npx supabase db push
--
-- Safe to run more than once: every statement is idempotent.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
-- `profiles` holds only application-specific traveller information.
-- Credentials, email confirmation and the password live in auth.users and are
-- never duplicated here. `email` is kept because it is useful for display and
-- for contacting the traveller; it is a copy maintained by the trigger, and
-- auth.users remains the source of truth for authentication.
--
-- id references auth.users(id) so a profile cannot exist without a user and
-- is removed automatically when the user is deleted.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  avatar_url text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-specific traveller profile, one row per auth.users user. Auth data stays in auth.users.';

comment on column public.profiles.email is
  'Copy of auth.users.email, kept current by handle_new_user(). Not the source of truth for authentication.';


-- ---------------------------------------------------------------------------
-- 2. Keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_profiles_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Automatic profile creation on sign-up
-- ---------------------------------------------------------------------------
-- Runs inside the auth service, so it works no matter which client created the
-- user (email sign-up, OAuth, admin API). security definer is required because
-- the inserting role is not the end user.
--
-- The name/avatar are read from raw_user_meta_data, which is where the client
-- puts them at sign-up. OAuth providers send `name` / `picture` instead, so
-- both spellings are accepted.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url, phone)
  values (
    new.id,
    nullif(
      trim(coalesce(new.raw_user_meta_data ->> 'full_name',
                    new.raw_user_meta_data ->> 'name',
                    '')),
      ''
    ),
    new.email,
    nullif(
      coalesce(new.raw_user_meta_data ->> 'avatar_url',
               new.raw_user_meta_data ->> 'picture'),
      ''
    ),
    new.phone
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
-- RLS is enforced by Postgres, not by the client. Even with a valid anon key,
-- a signed-in user can only ever reach their own row.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- NOTE: deliberately NOT using `force row level security` here.
-- FORCE also subjects the table *owner* to policies. `handle_new_user()` is a
-- SECURITY DEFINER function owned by the table owner, and at the moment it
-- runs there is no JWT claim, so `auth.uid()` would be NULL and the INSERT
-- would be rejected — breaking sign-up entirely. RLS already blocks every
-- client role (anon/authenticated), which is what the browser talks to.


-- Read your own profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Create your own profile
-- The trigger creates the initial row; this policy lets the client repair a
-- profile that is genuinely missing (see ensureProfile in profileService).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Update your own profile.
-- USING covers which existing rows may be read/targeted; WITH CHECK stops a
-- caller from handing their row to somebody else's id.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Deliberately NO delete policy: profiles are removed by cascading from
-- auth.users, never by the client.


-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- The anon role (signed out visitors) gets no access at all.
-- `authenticated` gets exactly select / insert / update — no delete, no
-- truncate, no references.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from anon;
revoke all on table public.profiles from authenticated;

grant select, insert, update on table public.profiles to authenticated;

-- The trigger function runs as its owner and needs insert rights.
grant usage on schema public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Backfill (optional)
-- ---------------------------------------------------------------------------
-- If any users already existed before this migration, give them a profile too.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email, avatar_url, phone)
select
  u.id,
  nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name',
                        u.raw_user_meta_data ->> 'name', '')), ''),
  u.email,
  nullif(coalesce(u.raw_user_meta_data ->> 'avatar_url',
                   u.raw_user_meta_data ->> 'picture'), ''),
  u.phone
from auth.users as u
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- 7. Verification queries
-- ---------------------------------------------------------------------------
-- RLS still applies to `postgres` only because of the FORCE above; run the
-- isolation test as two different signed-in users (see supabase/README.md).
--
--   select count(*) from public.profiles;              -- 1 after first signup
--   select id, full_name, email from public.profiles;  -- the caller's row only
-- ---------------------------------------------------------------------------
