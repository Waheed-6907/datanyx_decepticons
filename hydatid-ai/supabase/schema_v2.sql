-- CystStage AI · schema v2: every feature writes to its own table.
-- Run AFTER schema.sql (it needs public.is_doctor() and public.assessments). Safe to re-run.
-- Roles: doctors write and read everything they produce; patients read only rows tied to their own email.

-- ---------- 1. analyses: one row per AI run (every "Analyse report" click) ----------
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  assessment_code text,                       -- the unique code shown on the report (assessments.assessment_code)
  patient_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  input_mode text,                            -- 'text' or 'checklist'
  input_text text,
  case_json jsonb,                            -- structured findings the engine used
  engine text,                                -- rules / xgboost / checklist
  stage text not null,                        -- WHO-IWGE stage the AI predicted
  confidence text,
  probabilities jsonb,
  evidence jsonb,
  treatment jsonb,
  rule_path jsonb,                            -- which rule decided the stage (knowledge-graph path)
  created_at timestamptz not null default now()
);
create index if not exists analyses_code_idx on public.analyses (assessment_code);
create index if not exists analyses_patient_idx on public.analyses (patient_code);

-- ---------- 2. ct_scans: every CT image saved, plus the image model result when it exists ----------
create table if not exists public.ct_scans (
  id uuid primary key default gen_random_uuid(),
  assessment_code text,
  patient_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  storage_path text not null,                 -- path in the private 'scans' bucket: <uid>/<file>
  file_name text,
  content_type text,
  size_bytes int,
  image_stage text,                           -- null when the image model is not trained yet
  image_prob real,
  image_probs jsonb,
  model_version text,
  created_at timestamptz not null default now()
);
create index if not exists ct_scans_code_idx on public.ct_scans (assessment_code);

-- ---------- 3. share_links: QR / unique report links (the phone opens these) ----------
create table if not exists public.share_links (
  token text primary key,
  assessment_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  patient_id text,
  payload jsonb not null,                     -- what the phone page shows: case, result, image summary
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists share_links_code_idx on public.share_links (assessment_code);

-- ---------- 4. pdf_reports: each generated PDF, stored in the private 'reports' bucket ----------
create table if not exists public.pdf_reports (
  id uuid primary key default gen_random_uuid(),
  assessment_code text,
  patient_code text,
  created_by uuid not null default auth.uid() references auth.users(id),
  storage_path text not null,                 -- <uid>/<file>.pdf in bucket 'reports'
  file_name text,
  size_bytes int,
  created_at timestamptz not null default now()
);
create index if not exists pdf_reports_code_idx on public.pdf_reports (assessment_code);

-- ---------- 5. reference tables (filled by seed_reference.sql from the app's knowledge base) ----------
create table if not exists public.stage_reference (
  stage text primary key,
  name text, phase text, plain text, means text, rule text,
  signs jsonb, key_clues jsonb, triggers jsonb,
  sort_order int
);
create table if not exists public.kg_nodes (
  id text primary key, label text, grp text, info text
);
create table if not exists public.kg_edges (
  id bigint generated always as identity primary key,
  source text not null references public.kg_nodes(id) on delete cascade,
  target text not null references public.kg_nodes(id) on delete cascade,
  kind text
);

-- unique code must be unique (the QR and the report both show it)
create unique index if not exists assessments_code_uidx on public.assessments (assessment_code);

-- ---------- row level security ----------
alter table public.analyses enable row level security;
alter table public.ct_scans enable row level security;
alter table public.share_links enable row level security;
alter table public.pdf_reports enable row level security;
alter table public.stage_reference enable row level security;
alter table public.kg_nodes enable row level security;
alter table public.kg_edges enable row level security;

-- analyses: doctors only
drop policy if exists "doctors insert analyses" on public.analyses;
create policy "doctors insert analyses" on public.analyses for insert
  with check (public.is_doctor() and created_by = auth.uid());
drop policy if exists "doctors read analyses" on public.analyses;
create policy "doctors read analyses" on public.analyses for select using (public.is_doctor());

-- ct_scans: doctors read all; patients read scans of their own assessments
drop policy if exists "doctors insert ct_scans" on public.ct_scans;
create policy "doctors insert ct_scans" on public.ct_scans for insert
  with check (public.is_doctor() and created_by = auth.uid());
drop policy if exists "read ct_scans" on public.ct_scans;
create policy "read ct_scans" on public.ct_scans for select using (
  public.is_doctor() or exists (select 1 from public.assessments a
    where a.assessment_code = ct_scans.assessment_code and lower(a.patient_email) = lower(auth.jwt()->>'email')));

-- share_links: doctors insert their own; reads go through get_share_link() for phones
drop policy if exists "doctors insert share_links" on public.share_links;
create policy "doctors insert share_links" on public.share_links for insert
  with check (public.is_doctor() and created_by = auth.uid());
drop policy if exists "doctors read share_links" on public.share_links;
create policy "doctors read share_links" on public.share_links for select using (public.is_doctor());

-- pdf_reports: doctors insert and read all; patients read reports of their own assessments
drop policy if exists "doctors insert pdf_reports" on public.pdf_reports;
create policy "doctors insert pdf_reports" on public.pdf_reports for insert
  with check (public.is_doctor() and created_by = auth.uid());
drop policy if exists "read pdf_reports" on public.pdf_reports;
create policy "read pdf_reports" on public.pdf_reports for select using (
  public.is_doctor() or exists (select 1 from public.assessments a
    where a.assessment_code = pdf_reports.assessment_code and lower(a.patient_email) = lower(auth.jwt()->>'email')));

-- reference tables: any signed-in user can read
drop policy if exists "read stage_reference" on public.stage_reference;
create policy "read stage_reference" on public.stage_reference for select to authenticated using (true);
drop policy if exists "read kg_nodes" on public.kg_nodes;
create policy "read kg_nodes" on public.kg_nodes for select to authenticated using (true);
drop policy if exists "read kg_edges" on public.kg_edges;
create policy "read kg_edges" on public.kg_edges for select to authenticated using (true);

-- ---------- API grants (RLS above decides which rows) ----------
grant select, insert on public.analyses, public.ct_scans, public.share_links, public.pdf_reports to authenticated;
grant select on public.stage_reference, public.kg_nodes, public.kg_edges to authenticated;

-- ---------- phone share links: read one link by its token, without exposing the table ----------
create or replace function public.get_share_link(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select payload || jsonb_build_object('token', token, 'expires', expires_at, 'created', created_at)
  from public.share_links
  where token = p_token and expires_at > now()
  limit 1;
$$;
grant execute on function public.get_share_link(text) to anon, authenticated;

-- ---------- storage: 'reports' bucket for PDFs (private) ----------
insert into storage.buckets (id, name, public) values ('reports', 'reports', false)
  on conflict (id) do nothing;

drop policy if exists "doctors upload reports" on storage.objects;
create policy "doctors upload reports" on storage.objects for insert
  with check (bucket_id = 'reports' and public.is_doctor() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read reports files" on storage.objects;
create policy "read reports files" on storage.objects for select using (
  bucket_id = 'reports' and (public.is_doctor() or exists (
    select 1 from public.pdf_reports p join public.assessments a on a.assessment_code = p.assessment_code
    where p.storage_path = storage.objects.name and lower(a.patient_email) = lower(auth.jwt()->>'email'))));

-- scans bucket: doctors may also read CT images they uploaded for patients (already allowed in schema.sql)
