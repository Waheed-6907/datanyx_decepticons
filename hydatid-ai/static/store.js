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
