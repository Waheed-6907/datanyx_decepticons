-- CystStage AI · Supabase schema
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Roles: 'doctor' (creates and reviews assessments) and 'patient' (reads their own reports).

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'patient' check (role in ('doctor', 'patient')),
  created_at timestamptz not null default now()
);

-- secret doctor access code (not readable by app users: RLS on, no policies)
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('doctor_code', 'DECEPTICONS-DOC')
  on conflict (key) do nothing;
-- change it any time:  update public.app_settings set value = 'NEW-CODE' where key = 'doctor_code';

-- create a profile automatically when someone signs up (role + name come from sign-up metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          new.email,
          case when new.raw_user_meta_data->>'role' = 'doctor'
                and new.raw_user_meta_data->>'doctor_code' = (select value from public.app_settings where key = 'doctor_code')
               then 'doctor' else 'patient' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_doctor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'doctor');
$$;

-- ---------- assessments (every saved exam = one row; builds the digital twin) ----------
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  doctor_name text,
  patient_code text not null,
  patient_email text,
  patient_age int,
  patient_sex text,
  exam_date date not null default current_date,
  findings jsonb not null,
  result jsonb,
  ai_stage text,
  ai_confidence text,
  final_stage text,
  note text,
  report_text text,
  image_path text,
  image_stage text,
  image_prob real,
  created_at timestamptz not null default now()
);
create index if not exists assessments_patient_idx on public.assessments (patient_code, exam_date);
create index if not exists assessments_email_idx on public.assessments (lower(patient_email));

-- ---------- API grants (RLS still decides which rows; these only let signed-in users reach the tables) ----------
grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.assessments to authenticated;
-- app_settings is deliberately NOT granted: only the trigger (security definer) reads the doctor code

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.assessments enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_doctor());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

drop policy if exists "doctors insert" on public.assessments;
create policy "doctors insert" on public.assessments for insert
  with check (public.is_doctor() and created_by = auth.uid());
drop policy if exists "doctors read" on public.assessments;
create policy "doctors read" on public.assessments for select using (public.is_doctor());
drop policy if exists "patients read own" on public.assessments;
create policy "patients read own" on public.assessments for select
  using (lower(patient_email) = lower(auth.jwt()->>'email'));
drop policy if exists "doctors update own" on public.assessments;
create policy "doctors update own" on public.assessments for update using (created_by = auth.uid());

-- ---------- storage for scan images (private bucket) ----------
insert into storage.buckets (id, name, public) values ('scans', 'scans', false)
  on conflict (id) do nothing;
drop policy if exists "doctors upload scans" on storage.objects;
create policy "doctors upload scans" on storage.objects for insert
  with check (bucket_id = 'scans' and public.is_doctor() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "doctors read scans" on storage.objects;
create policy "doctors read scans" on storage.objects for select
  using (bucket_id = 'scans' and public.is_doctor());
drop policy if exists "patients read own scans" on storage.objects;
create policy "patients read own scans" on storage.objects for select
  using (bucket_id = 'scans' and exists (
    select 1 from public.assessments a
    where a.image_path = storage.objects.name and lower(a.patient_email) = lower(auth.jwt()->>'email')));
