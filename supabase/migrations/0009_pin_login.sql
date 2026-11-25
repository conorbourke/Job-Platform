-- ============================================================================
-- PIN-only login for a single owner account, with brute-force lockout.
--
--   • The PIN is stored only as a bcrypt hash (pgcrypto). It is never in code.
--   • verify_pin() checks a PIN and enforces the lockout ATOMICALLY: the single
--     pin_auth row is locked (SELECT … FOR UPDATE) for each attempt, so parallel
--     requests can't race past the counter. The lockout is per account, not per
--     IP, so rotating IP addresses doesn't help an attacker.
--   • 3 consecutive wrong PINs → locked for 1 hour. While locked, NO PIN is
--     evaluated (even the correct one) and attempts don't extend the lock. When
--     the hour is up, a fresh set of 3 attempts begins. A correct PIN resets it.
--   • Only the service role may call verify_pin (the app's /api/auth/pin route).
--     set_owner_pin() and clear_pin_lockout() are for the SQL editor only.
--
-- The owner's email and PIN are NOT in this file (the repo is public). Set them
-- in the Supabase SQL editor:   select public.set_owner_pin('<email>', '<pin>');
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Single-row table (id is always 1): the owner account and its PIN state.
create table if not exists public.pin_auth (
  id smallint primary key default 1 check (id = 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Audit trail of attempts (no PINs are ever stored here).
create table if not exists public.pin_auth_log (
  id bigint generated always as identity primary key,
  attempted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('ok', 'invalid', 'locked', 'lockout_started')),
  ip text
);
create index if not exists pin_auth_log_attempted_idx on public.pin_auth_log (attempted_at desc);

-- Nobody but the service role / SQL editor can touch these tables.
alter table public.pin_auth enable row level security;
alter table public.pin_auth_log enable row level security;
revoke all on table public.pin_auth from anon, authenticated;
revoke all on table public.pin_auth_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- verify_pin: check a PIN and apply the lockout. Returns jsonb:
--   {"status":"ok","email":"…"}                      correct PIN
--   {"status":"invalid","attempts_left":N}          wrong PIN, N tries left
--   {"status":"locked","locked_until":"…"}          locked (now, or just became)
--   {"status":"not_configured"}                     no PIN set yet
-- ---------------------------------------------------------------------------
create or replace function public.verify_pin(p_pin text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_max_attempts constant int := 3;
  v_lockout constant interval := interval '1 hour';
  r public.pin_auth%rowtype;
  v_email text;
begin
  -- Row lock: concurrent attempts queue here, one at a time.
  select * into r from public.pin_auth where id = 1 for update;
  if not found then
    return jsonb_build_object('status', 'not_configured');
  end if;

  -- Locked: don't evaluate the PIN at all, and don't extend the lock.
  if r.locked_until is not null and r.locked_until > now() then
    insert into public.pin_auth_log (outcome, ip) values ('locked', p_ip);
    return jsonb_build_object('status', 'locked', 'locked_until', r.locked_until);
  end if;

  -- A lockout that has expired starts a fresh set of attempts.
  if r.locked_until is not null then
    r.failed_attempts := 0;
  end if;

  if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
    update public.pin_auth
       set failed_attempts = 0, locked_until = null, last_success_at = now(), updated_at = now()
     where id = 1;
    select u.email into v_email from auth.users u where u.id = r.user_id;
    insert into public.pin_auth_log (outcome, ip) values ('ok', p_ip);
    return jsonb_build_object('status', 'ok', 'email', v_email);
  end if;

  r.failed_attempts := r.failed_attempts + 1;

  if r.failed_attempts >= v_max_attempts then
    update public.pin_auth
       set failed_attempts = r.failed_attempts, locked_until = now() + v_lockout, updated_at = now()
     where id = 1
    returning locked_until into r.locked_until;
    insert into public.pin_auth_log (outcome, ip) values ('lockout_started', p_ip);
    return jsonb_build_object('status', 'locked', 'locked_until', r.locked_until);
  end if;

  update public.pin_auth
     set failed_attempts = r.failed_attempts, locked_until = null, updated_at = now()
   where id = 1;
  insert into public.pin_auth_log (outcome, ip) values ('invalid', p_ip);
  return jsonb_build_object('status', 'invalid', 'attempts_left', v_max_attempts - r.failed_attempts);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_owner_pin: (SQL editor only) set or change the PIN, make that account the
-- ONLY one allowed into the app, and clear any lockout. Rejects weak PINs.
-- ---------------------------------------------------------------------------
create or replace function public.set_owner_pin(p_email text, p_pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    raise exception 'The PIN must be exactly 6 digits.';
  end if;
  -- Weak PINs are the first thing an attacker tries; refuse them.
  if p_pin ~ '^([0-9])\1{5}$'                       -- 111111
     or p_pin ~ '^([0-9]{2})\1\1$'                  -- 121212
     or p_pin ~ '^([0-9]{3})\1$'                    -- 123123
     or p_pin in ('012345', '123456', '234567', '345678', '456789',
                  '987654', '876543', '765432', '654321', '543210',
                  '112233', '123321', '159753', '147258', '102030') then
    raise exception 'That PIN is too easy to guess (repeated or sequential digits). Choose a random 6-digit PIN.';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'No account found with that email address.';
  end if;

  insert into public.pin_auth (id, user_id, pin_hash)
  values (1, v_uid, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (id) do update
     set user_id = excluded.user_id,
         pin_hash = excluded.pin_hash,
         failed_attempts = 0,
         locked_until = null,
         updated_at = now();

  -- The app lets in only the account carrying this flag (app_metadata can be
  -- written only by the service role / SQL, never by a user).
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"pin_owner": true}'::jsonb
   where id = v_uid;
  update auth.users
     set raw_app_meta_data = raw_app_meta_data - 'pin_owner'
   where id <> v_uid and raw_app_meta_data ? 'pin_owner';

  return 'PIN set. Lockout cleared. This is now the only account that can sign in.';
end;
$$;

-- ---------------------------------------------------------------------------
-- clear_pin_lockout: (SQL editor only) end a lockout early without changing the PIN.
-- ---------------------------------------------------------------------------
create or replace function public.clear_pin_lockout()
returns text
language sql
security definer
set search_path = public
as $$
  update public.pin_auth set failed_attempts = 0, locked_until = null, updated_at = now() where id = 1;
  select 'Lockout cleared.'::text;
$$;

-- Lock the functions down. Supabase grants EXECUTE on new functions to anon and
-- authenticated by default, which would expose them through the public API.
revoke execute on function public.verify_pin(text, text) from public, anon, authenticated;
revoke execute on function public.set_owner_pin(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.clear_pin_lockout() from public, anon, authenticated, service_role;
grant execute on function public.verify_pin(text, text) to service_role;

notify pgrst, 'reload schema';
