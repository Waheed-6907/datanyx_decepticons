-- CystStage AI · dashboard views (run after schema.sql and schema_v2 / run_v2_all.sql).
-- Every view uses security_invoker, so it runs with the caller's row-level security:
-- doctors see all assessments, patients see only their own. Safe to re-run.

-- ---------- doctor KPIs: one row ----------
create or replace view public.v_doctor_kpis with (security_invoker = true) as
select
  (select count(*) from public.assessments)                                                              as assessments_total,
  (select count(distinct patient_code) from public.assessments)                                          as patients,
  (select count(*) from public.assessments where exam_date >= current_date - 7)                          as assessments_7d,
  (select count(*) from public.assessments where final_stage in ('CE1','CE2','CE3a','CE3b'))             as active_or_transitional,
  (select count(*) from public.assessments
     where final_stage = 'CL' or lower(coalesce(ai_confidence, '')) = 'low')                             as needs_review,
  (select count(*) from public.assessments where lower(coalesce(findings->>'complicated', 'no')) = 'yes') as complicated,
  (select count(*) from public.ct_scans)                                                                 as ct_scans,
  (select count(*) from public.pdf_reports)                                                              as pdf_reports,
  (select count(*) from public.share_links where expires_at > now())                                     as live_qr_links;

-- ---------- stage mix: how many patients are at each WHO stage (latest exam per patient) ----------
create or replace view public.v_stage_mix with (security_invoker = true) as
select s.stage, s.sort_order, coalesce(c.patients, 0) as patients
from public.stage_reference s
left join (
  select final_stage, count(distinct patient_code) as patients
  from public.assessments group by final_stage
) c on c.final_stage = s.stage
order by s.sort_order;

-- ---------- triage queue: one row per patient, latest exam, sorted by urgency ----------
--   priority 1 = complication reported, 2 = CL or low AI confidence (needs review),
--   priority 3 = active or transitional cyst (needs treatment planning), 4 = inactive / follow-up
create or replace view public.v_triage_queue with (security_invoker = true) as
select * from (
  select distinct on (a.patient_code)
    a.patient_code,
    a.patient_email,
    a.assessment_code,
    a.final_stage,
    a.ai_confidence,
    a.exam_date,
    (a.findings->>'size_cm')::numeric                                              as size_cm,
    lower(coalesce(a.findings->>'complicated', 'no')) = 'yes'                      as complicated,
    a.doctor_name,
    case
      when lower(coalesce(a.findings->>'complicated', 'no')) = 'yes' then 1
      when a.final_stage = 'CL' or lower(coalesce(a.ai_confidence, '')) = 'low'   then 2
      when a.final_stage in ('CE1','CE2','CE3a','CE3b')                            then 3
      else 4
    end                                                                            as priority
  from public.assessments a
  order by a.patient_code, a.exam_date desc, a.created_at desc
) latest
order by priority, exam_date desc;

grant select on public.v_doctor_kpis, public.v_stage_mix, public.v_triage_queue to authenticated;

-- patients can open the CT images saved for their own assessments (ct_scans rows, not only assessments.image_path)
drop policy if exists "patients read own ct scan files" on storage.objects;
create policy "patients read own ct scan files" on storage.objects for select using (
  bucket_id = 'scans' and exists (
    select 1 from public.ct_scans c join public.assessments a on a.assessment_code = c.assessment_code
    where c.storage_path = storage.objects.name and lower(a.patient_email) = lower(auth.jwt()->>'email')));

-- ---------- handy queries for the SQL Editor (the SQL Editor is an admin view: it shows all rows) ----------
-- Dashboard numbers:            select * from public.v_doctor_kpis;
-- Stage mix:                    select * from public.v_stage_mix;
-- Triage queue (most urgent first): select * from public.v_triage_queue limit 20;
-- Full timeline of one patient:  select exam_date, final_stage, size_cm, assessment_code
--                                from public.assessments where patient_code = 'UI-PT-2' order by exam_date;
-- Patients who need review now:  select patient_code, final_stage, ai_confidence, exam_date
--                                from public.v_triage_queue where priority <= 2 order by priority, exam_date desc;
