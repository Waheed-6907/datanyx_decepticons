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
-- Reference data generated by make_reference_seed.py (do not hand-edit)

insert into public.stage_reference (stage, name, phase, plain, means, rule, signs, key_clues, triggers, sort_order) values
  ('CL', 'Cystic lesion (unconfirmed)', 'Undetermined (needs confirmation)', 'A simple fluid bubble with no sign that proves it is a hydatid cyst yet.', 'It might be hydatid, or another kind of cyst. Confirm before treating.', 'Simple cystic lesion without pathognomonic signs', '["Uniform fluid content", "No visible cyst wall", "No hydatid sand"]'::jsonb, '["wall_visible", "hydatid_sand", "septations", "detached_membrane"]'::jsonb, '[]'::jsonb, 0),
  ('CE1', 'Unilocular active cyst', 'Active', 'A single fluid-filled bubble with a visible double wall, sometimes with floating ''sand''.', 'The parasite is alive and the cyst is active.', 'Unilocular cyst with visible wall and/or hydatid sand', '["Double-line wall", "Hydatid sand (snowflake sign)", "One compartment"]'::jsonb, '["wall_visible", "hydatid_sand", "septations", "detached_membrane", "daughter_cysts"]'::jsonb, '["wall_visible", "hydatid_sand"]'::jsonb, 1),
  ('CE2', 'Multivesicular active cyst', 'Active', 'A big bubble packed with many smaller ''daughter'' bubbles, like a honeycomb.', 'Active and actively multiplying.', 'Multiseptated cyst / daughter cysts filling the cyst', '["Septations / honeycomb", "Daughter cysts filling the cyst"]'::jsonb, '["septations", "daughter_cysts", "solid_matrix", "detached_membrane"]'::jsonb, '["septations", "daughter_cysts"]'::jsonb, 2),
  ('CE3a', 'Transitional cyst, detached membrane', 'Transitional', 'The inner lining has peeled off and floats inside, like a water lily.', 'The cyst is starting to fail; it is in transition.', 'Detached laminated membrane (water-lily sign)', '["Detached laminated membrane", "Water-lily sign"]'::jsonb, '["detached_membrane", "daughter_cysts"]'::jsonb, '["detached_membrane"]'::jsonb, 3),
  ('CE3b', 'Transitional cyst, daughter cysts in matrix', 'Transitional', 'Daughter bubbles sitting inside a thicker, partly solid material.', 'Transitional, but can become active again; often harder to treat.', 'Daughter cysts inside a solid matrix', '["Daughter cysts", "Solid / echogenic matrix"]'::jsonb, '["daughter_cysts", "solid_matrix", "calcification"]'::jsonb, '["daughter_cysts", "solid_matrix"]'::jsonb, 4),
  ('CE4', 'Inactive degenerating cyst', 'Inactive', 'The contents have turned into a tangled solid mass, like a ball of wool.', 'Usually inactive and degenerating.', 'Heterogeneous ''ball-of-wool'' content without daughter cysts', '["Ball-of-wool content", "No daughter cysts"]'::jsonb, '["ball_of_wool", "daughter_cysts", "calcification"]'::jsonb, '["ball_of_wool"]'::jsonb, 5),
  ('CE5', 'Inactive calcified cyst', 'Inactive', 'The wall has hardened into an egg-shell of calcium.', 'Inactive; usually only monitored.', 'Complete or near-complete calcified wall', '["Egg-shell calcification", "Solid content"]'::jsonb, '["calcification"]'::jsonb, '["calcification"]'::jsonb, 6)
on conflict (stage) do update set name = excluded.name, phase = excluded.phase, plain = excluded.plain, means = excluded.means, rule = excluded.rule, signs = excluded.signs, key_clues = excluded.key_clues, triggers = excluded.triggers, sort_order = excluded.sort_order;

insert into public.kg_nodes (id, label, grp, info) values
  ('phase:active', 'Active', 'phase', ''),
  ('phase:trans', 'Transitional', 'phase', ''),
  ('phase:inactive', 'Inactive', 'phase', ''),
  ('phase:cl', 'Undetermined', 'phase', ''),
  ('stage:CL', 'CL', 'stage', 'A simple fluid bubble with no sign that proves it is a hydatid cyst yet.'),
  ('stage:CE1', 'CE1', 'stage', 'A single fluid-filled bubble with a visible double wall, sometimes with floating ''sand''.'),
  ('stage:CE2', 'CE2', 'stage', 'A big bubble packed with many smaller ''daughter'' bubbles, like a honeycomb.'),
  ('stage:CE3a', 'CE3a', 'stage', 'The inner lining has peeled off and floats inside, like a water lily.'),
  ('stage:CE3b', 'CE3b', 'stage', 'Daughter bubbles sitting inside a thicker, partly solid material.'),
  ('stage:CE4', 'CE4', 'stage', 'The contents have turned into a tangled solid mass, like a ball of wool.'),
  ('stage:CE5', 'CE5', 'stage', 'The wall has hardened into an egg-shell of calcium.'),
  ('sign:ball_of_wool', 'Ball-of-wool content', 'sign', 'Ball-of-wool content'),
  ('sign:calcification', 'Calcification of the wall', 'sign', 'Calcification of the wall'),
  ('sign:daughter_cysts', 'Daughter cysts', 'sign', 'Daughter cysts'),
  ('sign:detached_membrane', 'Detached membrane', 'sign', 'Detached membrane (water-lily sign)'),
  ('sign:hydatid_sand', 'Hydatid sand', 'sign', 'Hydatid sand (snowflake sign)'),
  ('sign:septations', 'Septations / honeycomb pattern', 'sign', 'Septations / honeycomb pattern'),
  ('sign:solid_matrix', 'Solid / echogenic matrix', 'sign', 'Solid / echogenic matrix'),
  ('sign:wall_visible', 'Visible cyst wall', 'sign', 'Visible cyst wall (double-line sign)'),
  ('sign:complicated', 'Complication', 'sign', 'Complication (rupture, infection, biliary leak)'),
  ('mgmt:Confirm diagnosis first', 'Confirm diagnosis first', 'mgmt', ''),
  ('mgmt:PAIR + Albendazole tablets', 'PAIR + Albendazole tablets', 'mgmt', ''),
  ('mgmt:Non-PAIR percutaneous treatment', 'Non-PAIR percutaneous treatment', 'mgmt', ''),
  ('mgmt:Surgery + Albendazole tablets', 'Surgery + Albendazole tablets', 'mgmt', ''),
  ('mgmt:Watch and wait with periodic ultrasound', 'Watch and wait with periodic ultrasound', 'mgmt', '')
on conflict (id) do update set label = excluded.label, grp = excluded.grp, info = excluded.info;

delete from public.kg_edges;
insert into public.kg_edges (source, target, kind) values
  ('stage:CL', 'phase:cl', 'phase'),
  ('stage:CL', 'mgmt:Confirm diagnosis first', 'mgmt'),
  ('stage:CE1', 'phase:active', 'phase'),
  ('sign:wall_visible', 'stage:CE1', 'sign'),
  ('sign:hydatid_sand', 'stage:CE1', 'sign'),
  ('stage:CE1', 'mgmt:PAIR + Albendazole tablets', 'mgmt'),
  ('stage:CE2', 'phase:active', 'phase'),
  ('sign:septations', 'stage:CE2', 'sign'),
  ('sign:daughter_cysts', 'stage:CE2', 'sign'),
  ('stage:CE2', 'mgmt:Non-PAIR percutaneous treatment', 'mgmt'),
  ('stage:CE2', 'mgmt:Surgery + Albendazole tablets', 'mgmt'),
  ('stage:CE3a', 'phase:trans', 'phase'),
  ('sign:detached_membrane', 'stage:CE3a', 'sign'),
  ('stage:CE3a', 'mgmt:PAIR + Albendazole tablets', 'mgmt'),
  ('stage:CE3b', 'phase:trans', 'phase'),
  ('sign:daughter_cysts', 'stage:CE3b', 'sign'),
  ('sign:solid_matrix', 'stage:CE3b', 'sign'),
  ('stage:CE3b', 'mgmt:Non-PAIR percutaneous treatment', 'mgmt'),
  ('stage:CE3b', 'mgmt:Surgery + Albendazole tablets', 'mgmt'),
  ('stage:CE4', 'phase:inactive', 'phase'),
  ('sign:ball_of_wool', 'stage:CE4', 'sign'),
  ('stage:CE4', 'mgmt:Watch and wait with periodic ultrasound', 'mgmt'),
  ('stage:CE5', 'phase:inactive', 'phase'),
  ('sign:calcification', 'stage:CE5', 'sign'),
  ('stage:CE5', 'mgmt:Watch and wait with periodic ultrasound', 'mgmt'),
  ('sign:complicated', 'mgmt:Surgery + Albendazole tablets', 'mgmt');
