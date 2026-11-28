-- CystStage AI · clinician access codes (run in the SQL Editor; safe to re-run).
-- Codes are stored HASHED (bcrypt via pgcrypto), never in plain text. Each code can have a usage limit and an expiry.
-- Sample codes for testing are listed at the bottom of this file.

create extension if not exists pgcrypto with schema extensions;

-- ---------- the codes (hashed) ----------
create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  label text unique not null,                 -- who the code is for, e.g. "City Hospital ward 3"
  code_hash text not null,                    -- bcrypt hash of the code; the code itself is never stored
  role text not null default 'doctor' check (role in ('doctor')),
  max_uses int not null default 50,
  uses int not null default 0,
  expires_at timestamptz,                     -- null = never expires
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.access_codes enable row level security;   -- no policies: app users can never read this table

-- ---------- check a code before sign-up (the portal calls this; it does not use up a code) ----------
create or replace function public.check_access_code(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.access_codes c
    where c.active and (c.expires_at is null or c.expires_at > now()) and c.uses < c.max_uses
      and crypt(p_code, c.code_hash) = c.code_hash);
$$;
grant execute on function public.check_access_code(text) to anon, authenticated;

-- ---------- sign-up trigger: a doctor role is granted only with a valid code, and that code is used up ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_role text := 'patient';
  v_code uuid;
begin
  if new.raw_user_meta_data->>'role' = 'doctor' then
    select c.id into v_code from public.access_codes c
    where c.active and (c.expires_at is null or c.expires_at > now()) and c.uses < c.max_uses
      and crypt(new.raw_user_meta_data->>'doctor_code', c.code_hash) = c.code_hash
    limit 1;
    if v_code is not null then
      update public.access_codes set uses = uses + 1 where id = v_code;
      v_role := 'doctor';
    end if;
  end if;
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email, v_role)
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------- sample codes (hashed on insert) ----------
insert into public.access_codes (label, code_hash, max_uses) values
  ('Sample clinician 1', crypt('DOC-SAMPLE-01', gen_salt('bf')), 50),
  ('Sample clinician 2', crypt('DOC-SAMPLE-02', gen_salt('bf')), 50),
  ('Sample clinician 3', crypt('DOC-SAMPLE-03', gen_salt('bf')), 50),
  ('Sample clinician 4', crypt('DOC-SAMPLE-04', gen_salt('bf')), 50),
  ('Sample clinician 5', crypt('DOC-SAMPLE-05', gen_salt('bf')), 50),
  ('Team Decepticons demo', crypt('DECEPTICONS-DOC', gen_salt('bf')), 1000)
on conflict (label) do nothing;

-- Passwords: Supabase Auth already stores every password as a bcrypt hash in auth.users.encrypted_password.
-- Check it (the value starts with $2a$ or $2b$):
--   select email, left(encrypted_password, 4) as hash_prefix from auth.users limit 5;
-- Access codes you can give out for testing: DOC-SAMPLE-01 … DOC-SAMPLE-05 and DECEPTICONS-DOC.
-- To add a hospital code: insert into public.access_codes (label, code_hash, max_uses, expires_at)
--   values ('City Hospital', crypt('YOUR-LONG-CODE', gen_salt('bf')), 20, now() + interval '90 days');
-- To disable a code:      update public.access_codes set active = false where label = 'Sample clinician 1';
