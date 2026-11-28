-- CystStage AI · patient QR pass (point 3). Run after schema.sql and care_team.sql. Safe to re-run.
-- A pass is a permanent random link for one patient. Scanning it opens the clinician sign-in;
-- only a signed-in doctor can read the record, and every view is logged. A pass can be revoked and replaced.

-- ---------- passes ----------
create table if not exists public.patient_passes (
  token text primary key,                       -- 32 random hex characters (128 bits); the QR carries this
  patient_code text not null,                   -- the patient ID the doctor used
  patient_email text,                           -- lets the patient see their own pass
  owner_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists patient_passes_code_idx on public.patient_passes (patient_code);

-- ---------- who opened which pass, and when ----------
create table if not exists public.pass_access_log (
  id bigint generated always as identity primary key,
  token text not null,
  doctor_id uuid not null,
  accessed_at timestamptz not null default now()
);

alter table public.patient_passes enable row level security;
alter table public.pass_access_log enable row level security;   -- no policies: only the functions below write or read it

drop policy if exists "owner reads passes" on public.patient_passes;
create policy "owner reads passes" on public.patient_passes for select
  using (owner_id = auth.uid() and public.is_doctor());
drop policy if exists "patient reads own pass" on public.patient_passes;
create policy "patient reads own pass" on public.patient_passes for select
  using (lower(patient_email) = lower(auth.jwt()->>'email') and revoked_at is null);
grant select on public.patient_passes to authenticated;

-- ---------- doctor: create a new pass for a patient (replaces the old one) ----------
create or replace function public.create_patient_pass(p_patient_code text, p_email text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_doctor() then raise exception 'Clinicians only'; end if;
  if coalesce(trim(p_patient_code), '') = '' then raise exception 'Patient ID is required'; end if;
  update public.patient_passes set revoked_at = now()
    where patient_code = p_patient_code and owner_id = auth.uid() and revoked_at is null;
  insert into public.patient_passes (token, patient_code, patient_email, owner_id)
    values (v_token, p_patient_code, nullif(lower(trim(p_email)), ''), auth.uid());
  return v_token;
end $$;
grant execute on function public.create_patient_pass(text, text) to authenticated;

-- ---------- doctor: the record behind a scanned pass ----------
create or replace function public.get_patient_pass(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pass public.patient_passes;
  v_out jsonb;
begin
  if not public.is_doctor() then raise exception 'Clinicians only'; end if;
  select * into v_pass from public.patient_passes where token = p_token;
  if v_pass.token is null then raise exception 'This QR code is not valid.'; end if;
  if v_pass.revoked_at is not null then raise exception 'This QR code was replaced. Ask the patient for their current code.'; end if;

  insert into public.pass_access_log (token, doctor_id) values (p_token, auth.uid());

  select jsonb_build_object(
    'patient_code', v_pass.patient_code,
    'patient_email', v_pass.patient_email,
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_date', a.exam_date, 'final_stage', a.final_stage, 'ai_stage', a.ai_stage,
        'size_cm', a.findings->>'size_cm', 'assessment_code', a.assessment_code,
        'doctor_name', a.doctor_name, 'note', a.note, 'treatment', a.result->'treatment')
        order by a.exam_date desc, a.created_at desc)
      from public.assessments a where a.patient_code = v_pass.patient_code), '[]'::jsonb),
    'scans', (select count(*) from public.ct_scans c where c.patient_code = v_pass.patient_code),
    'reports', (select count(*) from public.pdf_reports r where r.patient_code = v_pass.patient_code),
    'viewed_by_you', (select count(*) from public.pass_access_log l where l.token = p_token and l.doctor_id = auth.uid())
  ) into v_out;
  return v_out;
end $$;
grant execute on function public.get_patient_pass(text) to authenticated;

-- ---------- doctor: list the passes you issued ----------
create or replace function public.my_patient_passes()
returns table (token text, patient_code text, patient_email text, created_at timestamptz, views bigint)
language sql stable security definer set search_path = public as $$
  select p.token, p.patient_code, p.patient_email, p.created_at,
         (select count(*) from public.pass_access_log l where l.token = p.token)
  from public.patient_passes p
  where p.owner_id = auth.uid() and p.revoked_at is null and public.is_doctor()
  order by p.created_at desc;
$$;
grant execute on function public.my_patient_passes() to authenticated;

-- ---------- patient: their own current pass (to show their QR) ----------
create or replace function public.my_pass()
returns text
language sql stable security definer set search_path = public as $$
  select p.token from public.patient_passes p
  where lower(p.patient_email) = lower(auth.jwt()->>'email') and p.revoked_at is null
  order by p.created_at desc limit 1;
$$;
grant execute on function public.my_pass() to authenticated;

-- ---------- doctor: revoke a pass ----------
create or replace function public.revoke_patient_pass(p_token text)
returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update public.patient_passes set revoked_at = now()
    where token = p_token and owner_id = auth.uid() and revoked_at is null and public.is_doctor()
    returning 1)
  select exists (select 1 from u);
$$;
grant execute on function public.revoke_patient_pass(text) to authenticated;

-- ---------- handy queries (the SQL Editor sees everything) ----------
-- all passes and how often they were opened:
--   select p.patient_code, p.patient_email, p.created_at, p.revoked_at, count(l.id) as views
--   from public.patient_passes p left join public.pass_access_log l on l.token = p.token
--   group by p.token order by p.created_at desc;
-- who opened patient records, most recent first:
--   select l.accessed_at, pr.full_name as doctor, p.patient_code
--   from public.pass_access_log l join public.profiles pr on pr.id = l.doctor_id
--   join public.patient_passes p on p.token = l.token order by l.accessed_at desc limit 50;
-- revoke every pass for one patient:
--   update public.patient_passes set revoked_at = now() where patient_code = 'UI-PT-1' and revoked_at is null;
