-- CystStage AI · care team: the doctor's contact details, the hospital directory, and "my doctor" for patients.
-- Run AFTER schema.sql. Safe to re-run. Then run seed_hospitals.sql (or use care_team_all.sql).

-- ---------- contact details a doctor chooses to share with their patients ----------
alter table public.profiles add column if not exists specialty text default 'Hepatology / hydatid disease';
alter table public.profiles add column if not exists hospital_name text;
alter table public.profiles add column if not exists hospital_phone text;
alter table public.profiles add column if not exists clinic_phone text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists contact_visible boolean not null default true;

-- ---------- hospital directory (read by signed-in users) ----------
create table if not exists public.hospitals (
  id text primary key,
  name text not null,
  area text,
  kind text,
  lat double precision not null,
  lng double precision not null,
  phone text,                                   -- null until the hospital confirms its number
  caps jsonb not null default '[]'::jsonb,      -- what the hospital can deliver (ultrasound, ct_mri, ...)
  capabilities_confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.hospitals enable row level security;
drop policy if exists "read hospitals" on public.hospitals;
create policy "read hospitals" on public.hospitals for select to authenticated using (true);
grant select on public.hospitals to authenticated;

-- ---------- "my doctors": the clinicians who saved an assessment for this patient ----------
-- Patients cannot read the profiles table directly, so this function returns only what the doctor allowed.
create or replace function public.my_care_team()
returns table (
  doctor_id uuid, doctor_name text, specialty text, hospital_name text,
  hospital_phone text, clinic_phone text, city text, email text, last_exam date
)
language sql stable security definer set search_path = public as $$
  select distinct on (p.id)
    p.id,
    p.full_name,
    p.specialty,
    case when p.contact_visible then p.hospital_name end,
    case when p.contact_visible then p.hospital_phone end,
    case when p.contact_visible then p.clinic_phone end,
    case when p.contact_visible then p.city end,
    case when p.contact_visible then p.email end,
    a.exam_date
  from public.assessments a
  join public.profiles p on p.id = a.created_by
  where lower(a.patient_email) = lower(auth.jwt()->>'email')
    and p.role = 'doctor'
  order by p.id, a.exam_date desc;
$$;
grant execute on function public.my_care_team() to authenticated;
