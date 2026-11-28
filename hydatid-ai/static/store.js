// Supabase auth + data layer. Falls back to local demo mode when Supabase is not configured.
const LABEL = {
  wall_visible: "Visible cyst wall", hydatid_sand: "Hydatid sand", septations: "Septations / honeycomb",
  daughter_cysts: "Daughter cysts", detached_membrane: "Detached membrane", solid_matrix: "Solid matrix",
  ball_of_wool: "Ball-of-wool content", calcification: "Calcification", complicated: "Complication",
};
const ORDER = ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"];

export const store = { sb: null, user: null, profile: null, configured: false };

export async function initStore() {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  if (cfg.supabase_url && cfg.supabase_anon_key && window.supabase) {
    store.sb = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key, { auth: { persistSession: true } });
    store.configured = true;
    const { data } = await store.sb.auth.getSession();
    if (data.session) await loadProfile(data.session.user);
  }
  return store;
}

async function loadProfile(user) {
  store.user = user;
  const { data, error } = await store.sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  store.profile = data || { id: user.id, role: "patient", full_name: user.user_metadata?.full_name || "", email: user.email };
  if (error) console.warn(error);
}

export async function signIn(email, password) {
  const { data, error } = await store.sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await loadProfile(data.user);
}

export async function signUp({ email, password, full_name, role, doctor_code }) {
  const { data, error } = await store.sb.auth.signUp({ email, password, options: { data: { full_name, role, doctor_code } } });
  if (error) throw error;
  if (!data.session) return { confirm: true };
  await loadProfile(data.user);
  return { confirm: false };
}

/* ---------- care team (point 2): contact details, hospital directory ---------- */
export async function myCareTeam() {
  const { data, error } = await store.sb.rpc("my_care_team");
  if (error) throw error;
  return data || [];
}
export async function hospitalDirectory() {
  const { data, error } = await store.sb.from("hospitals").select("*").order("name");
  if (error) throw error;
  return data || [];
}
export async function updateMyProfile(fields) {
  const { error } = await store.sb.from("profiles").update(fields).eq("id", store.user.id);
  if (error) throw error;
  Object.assign(store.profile, fields);
}

/* ---------- patient QR passes (point 3) ---------- */
export async function createPass(patientCode, email) {
  const { data, error } = await store.sb.rpc("create_patient_pass", { p_patient_code: patientCode, p_email: email || null });
  if (error) throw error;
  return data;
}
export async function createMyPass() {
  const { data, error } = await store.sb.rpc("create_my_pass");
  if (error) throw error;
  return data;
}
export async function listPasses() {
  const { data, error } = await store.sb.rpc("my_patient_passes");
  if (error) throw error;
  return data || [];
}
export async function revokePass(token) {
  const { data, error } = await store.sb.rpc("revoke_patient_pass", { p_token: token });
  if (error) throw error;
  return !!data;
}
export async function myPass() {
  const { data, error } = await store.sb.rpc("my_pass");
  if (error) throw error;
  return data || null;
}
export async function getPatientPass(token) {
  const { data, error } = await store.sb.rpc("get_patient_pass", { p_token: token });
  if (error) throw error;
  return data;
}
// QR image for a link. Built on the server, so no third-party QR service sees the link.
export async function makeQr(text) {
  const r = await fetch("/api/qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error("Could not make the QR code");
  return (await r.json()).qr;
}

// true when the clinician access code is valid and unused up. Does not use the code up (the sign-up does).
export async function checkAccessCode(code) {
  const { data, error } = await store.sb.rpc("check_access_code", { p_code: code });
  if (error) throw error;
  return !!data;
}

export async function signOut() { if (store.sb) await store.sb.auth.signOut(); store.user = null; store.profile = null; }

export const isDoctor = () => !store.configured || store.profile?.role === "doctor";

/* ---------- assessments ---------- */
export async function saveAssessment(rec, imageDataUrl) {
  let image_path = null;
  if (imageDataUrl) {
    const blob = await (await fetch(imageDataUrl)).blob();
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    image_path = `${store.user.id}/${rec.assessment_code}.${ext}`;
    const up = await store.sb.storage.from("scans").upload(image_path, blob, { upsert: true, contentType: blob.type });
    if (up.error) { console.warn(up.error); image_path = null; }
  }
  const { error } = await store.sb.from("assessments").insert({ ...rec, image_path, created_by: store.user.id,
    doctor_name: store.profile?.full_name || store.user.email });
  if (error) throw error;
}

export async function updateAssessment(code, fields) {
  const { error } = await store.sb.from("assessments").update(fields).eq("assessment_code", code).eq("created_by", store.user.id);
  if (error) throw error;
}

export async function listPatients() {
  const { data, error } = await store.sb.from("assessments").select("patient_code, final_stage, exam_date, created_at").order("exam_date");
  if (error) throw error;
  const by = {};
  data.forEach((r) => { (by[r.patient_code] = by[r.patient_code] || []).push(r); });
  return Object.entries(by).map(([id, rows]) => ({ id, name: id, exams: rows.length, last_stage: rows[rows.length - 1].final_stage }));
}

export async function getPatient(code) {
  const { data, error } = await store.sb.from("assessments").select("*").eq("patient_code", code).order("exam_date").order("created_at");
  if (error) throw error;
  return toTwin(code, data);
}

export async function myReports() {
  const { data, error } = await store.sb.from("assessments").select("*").order("exam_date").order("created_at");
  if (error) throw error;
  return data;
}

export async function scanUrl(path) {
  if (!path) return null;
  const { data } = await store.sb.storage.from("scans").createSignedUrl(path, 600);
  return data?.signedUrl || null;
}

/* ---------- v2 tables: every feature writes here (see supabase/schema_v2.sql) ---------- */
export async function saveAnalysis(row) {
  const { error } = await store.sb.from("analyses").insert({ ...row, created_by: store.user.id });
  if (error) throw error;
}

// Stores the CT image in the private 'scans' bucket and one row in ct_scans. imagePred may be null (model not trained).
export async function saveCtScan(imageDataUrl, meta, imagePred) {
  const blob = await (await fetch(imageDataUrl)).blob();
  const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const file = `scan-${Date.now()}.${ext}`;
  const path = `${store.user.id}/${file}`;
  const up = await store.sb.storage.from("scans").upload(path, blob, { contentType: blob.type });
  if (up.error) throw up.error;
  const row = { ...meta, storage_path: path, file_name: file, content_type: blob.type, size_bytes: blob.size,
    image_stage: imagePred ? imagePred.stage : null, image_prob: imagePred ? imagePred.prob : null,
    image_probs: imagePred ? imagePred.probs : null, model_version: imagePred ? imagePred.model_used || "CNN" : null };
  const { error } = await store.sb.from("ct_scans").insert({ ...row, created_by: store.user.id });
  if (error) throw error;
  return path;
}

export async function saveShare(row) {
  const { error } = await store.sb.from("share_links").insert({ ...row, created_by: store.user.id });
  if (error) throw error;
}

export async function savePdf(blob, meta) {
  const file = `${meta.assessment_code || "report"}-${Date.now()}.pdf`;
  const path = `${store.user.id}/${file}`;
  const up = await store.sb.storage.from("reports").upload(path, blob, { contentType: "application/pdf" });
  if (up.error) throw up.error;
  const { error } = await store.sb.from("pdf_reports").insert({ ...meta, storage_path: path, file_name: file,
    size_bytes: blob.size, created_by: store.user.id });
  if (error) throw error;
}

// Generic read for the Records view. RLS decides what each user gets back.
const SORT = { stage_reference: ["sort_order", true], kg_nodes: ["id", true], kg_edges: ["id", true] };
export const RECORD_TABLES = ["assessments", "analyses", "ct_scans", "share_links", "pdf_reports", "stage_reference", "kg_nodes", "kg_edges"];
export async function loadTable(name, limit = 200) {
  const [col, asc] = SORT[name] || ["created_at", false];
  const { data, error } = await store.sb.from(name).select("*").order(col, { ascending: asc }).limit(limit);
  if (error) throw error;
  return data;
}

/* ---------- dashboards (views from supabase/dashboard_views.sql; RLS limits each user to their own rows) ---------- */
export async function dashboardKpis() {
  const { data, error } = await store.sb.from("v_doctor_kpis").select("*").maybeSingle();
  if (error) throw error;
  return data || {};
}
export async function stageMix() {
  const { data, error } = await store.sb.from("v_stage_mix").select("*");
  if (error) throw error;
  return data || [];
}
export async function triageQueue(limit = 20) {
  const { data, error } = await store.sb.from("v_triage_queue").select("*").limit(limit);
  if (error) throw error;
  return data || [];
}
// patient's own PDFs and CT images, each with a short-lived signed link
export async function patientFiles() {
  const [p, c] = await Promise.all([
    store.sb.from("pdf_reports").select("*").order("created_at", { ascending: false }),
    store.sb.from("ct_scans").select("*").order("created_at", { ascending: false }),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  const sign = async (bucket, rows) => Promise.all(rows.map(async (r) => ({
    ...r, url: (await store.sb.storage.from(bucket).createSignedUrl(r.storage_path, 600)).data?.signedUrl || null })));
  return { pdfs: await sign("reports", p.data || []), scans: await sign("scans", c.data || []) };
}

export function toTwin(code, rows) {
  const exams = rows.map((r) => ({ date: r.exam_date, case: r.findings, stage: r.ai_stage, confidence: r.ai_confidence,
    final_stage: r.final_stage || r.ai_stage, source: "clinician", doctor: r.doctor_name, note: r.note }));
  exams.forEach((e, i) => (e.changes = i ? changes(exams[i - 1], e) : ["Baseline examination"]));
  return { id: code, name: code, exams };
}

function changes(prev, cur) {
  const out = [], a = prev.case || {}, b = cur.case || {};
  if (prev.final_stage !== cur.final_stage) {
    const dir = ORDER.indexOf(cur.final_stage) > ORDER.indexOf(prev.final_stage) ? "towards inactive" : "towards active";
    out.push(`Stage ${prev.final_stage} -> ${cur.final_stage} (${dir})`);
  }
  if (a.size_cm && b.size_cm && Math.abs(b.size_cm - a.size_cm) >= 0.2) {
    const d = b.size_cm - a.size_cm; out.push(`Size ${a.size_cm} -> ${b.size_cm} cm (${d > 0 ? "+" : ""}${d.toFixed(1)} cm)`);
  }
  Object.keys(LABEL).forEach((k) => { if (a[k] !== b[k] && a[k] && b[k] && a[k] !== "unknown" && b[k] !== "unknown") out.push(`${LABEL[k]}: ${a[k]} -> ${b[k]}`); });
  return out.length ? out : ["No structural change reported"];
}
