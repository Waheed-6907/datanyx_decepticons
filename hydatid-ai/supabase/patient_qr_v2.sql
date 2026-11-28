-- CystStage AI · patient QR v2 (run after patient_pass.sql). Safe to re-run.
-- 1) A patient creates their own QR code from their dashboard (the doctor scans it).
-- 2) The scanned summary now includes the organ and location of the cyst.

-- ---------- patient: create or replace my own QR code ----------
create or replace function public.create_my_pass()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(auth.jwt()->>'email');
  v_code text;
  v_doctor uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  select a.patient_code, a.created_by into v_code, v_doctor
  from public.assessments a
  where lower(a.patient_email) = v_email
  order by a.exam_date desc, a.created_at desc
  limit 1;
  if v_code is null then
    raise exception 'No assessment has been saved for your email yet. Ask your doctor to save one.';
  end if;
  update public.patient_passes set revoked_at = now()
    where lower(patient_email) = v_email and revoked_at is null;
  insert into public.patient_passes (token, patient_code, patient_email, owner_id)
    values (v_token, v_code, v_email, v_doctor);
  return v_token;
end $$;
grant execute on function public.create_my_pass() to authenticated;

-- ---------- doctor: the summary behind a scanned QR (now with organ and location) ----------
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
        'size_cm', a.findings->>'size_cm', 'organ', a.findings->>'organ',
        'segment', a.findings->>'segment', 'lobe', a.findings->>'lobe', 'depth', a.findings->>'depth',
        'assessment_code', a.assessment_code, 'doctor_name', a.doctor_name, 'note', a.note,
        'treatment', a.result->'treatment')
        order by a.exam_date desc, a.created_at desc)
      from public.assessments a where a.patient_code = v_pass.patient_code), '[]'::jsonb),
    'scans', (select count(*) from public.ct_scans c where c.patient_code = v_pass.patient_code),
    'reports', (select count(*) from public.pdf_reports r where r.patient_code = v_pass.patient_code),
    'viewed_by_you', (select count(*) from public.pass_access_log l where l.token = p_token and l.doctor_id = auth.uid())
  ) into v_out;
  return v_out;
end $$;
grant execute on function public.get_patient_pass(text) to authenticated;

-- ---------- handy queries ----------
-- every QR code a patient has made, and how often a clinician opened it:
--   select p.patient_code, p.patient_email, p.created_at, p.revoked_at, count(l.id) as views
--   from public.patient_passes p left join public.pass_access_log l on l.token = p.token
--   group by p.token order by p.created_at desc;
-- who opened which patient summary, most recent first:
--   select l.accessed_at, pr.full_name as clinician, p.patient_code, p.patient_email
--   from public.pass_access_log l join public.profiles pr on pr.id = l.doctor_id
--   join public.patient_passes p on p.token = l.token order by l.accessed_at desc limit 50;
-- one patient's current QR code:
--   select token, created_at from public.patient_passes
--   where lower(patient_email) = 'patient@example.com' and revoked_at is null;
