// Opens when a QR code is scanned. Nothing is shown to people who are not signed-in clinicians.
import * as S from "/static/store.js";

const TOKEN = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const ORDER = ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"];
const HEX = { CL: "#64748B", CE1: "#DC4B3E", CE2: "#DC4B3E", CE3a: "#D97706", CE3b: "#D97706", CE4: "#2563EB", CE5: "#2563EB" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => d ? new Date(String(d).length <= 10 ? d + "T00:00:00" : d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–";
const main = () => document.getElementById("pass-main");
const card = (html) => (main().innerHTML = `<div class="card pass-card">${html}</div>`);

function gate() {
  card(`<span class="eyebrow">Clinician sign-in required</span>
    <h2>This QR code opens a patient record</h2>
    <p>Only a signed-in doctor can see the record. Sign in with your clinician account to continue.</p>
    <div class="pass-actions"><a class="btn btn-primary btn-lg" href="/doctor?next=${encodeURIComponent("/p/" + TOKEN)}">Sign in as a clinician</a></div>
    <p class="small muted">Patients: your own QR code is on your dashboard. Open <a href="/patient">the patient portal</a>.</p>`);
}

function notAllowed() {
  card(`<span class="eyebrow">Clinicians only</span>
    <h2>This is the clinician view</h2>
    <p>You are signed in as a patient. Your own reports and your doctor's details are on your dashboard.</p>
    <div class="pass-actions"><a class="btn btn-primary" href="/#home">Go to my dashboard</a></div>`);
}

function failed(msg) {
  card(`<span class="eyebrow">Cannot open this record</span><h2>${esc(msg)}</h2>
    <p class="muted">If the patient has a newer QR code, ask them to show it to you.</p>`);
}

async function render(rec, meta) {
  const exams = rec.exams || [];
  const last = exams[0];
  const st = last ? (last.final_stage || last.ai_stage) : null;
  const info = (st && meta.stage_info[st]) || {};
  const idx = st ? ORDER.indexOf(st) : -1;
  const C = 2 * Math.PI * 50;
  const tx = (last && last.treatment) || { options: [], reason: "" };
  main().innerHTML = `
    <div class="pass-grid">
      <div class="card pass-hero">
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="10"/>
            ${st ? `<circle cx="60" cy="60" r="50" fill="none" stroke="${HEX[st]}" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - (idx + 1) / ORDER.length)).toFixed(1)}"/>` : ""}</svg>
          <div class="ring-t" style="color:${st ? HEX[st] : "#64748B"}">${esc(st || "–")}<small>${esc(info.phase || "no result yet")}</small></div>
        </div>
        <div>
          <span class="eyebrow">Patient ID</span>
          <h2 class="pass-id">${esc(rec.patient_code)}</h2>
          ${rec.patient_email ? `<div class="small muted">${esc(rec.patient_email)}</div>` : ""}
          <p style="font-size:16px;margin:12px 0 4px">${esc(info.plain || "No assessment has been saved for this patient yet.")}</p>
          ${info.name ? `<p class="small"><b>${esc(info.name)}</b></p>` : ""}
        </div>
      </div>

      <div class="kpis pass-kpis">
        <div class="kpi"><div class="kpi-v">${exams.length}</div><div class="kpi-l">Exams</div></div>
        <div class="kpi"><div class="kpi-v">${rec.scans || 0}</div><div class="kpi-l">CT scans</div></div>
        <div class="kpi"><div class="kpi-v">${rec.reports || 0}</div><div class="kpi-l">PDF reports</div></div>
        <div class="kpi"><div class="kpi-v">${rec.viewed_by_you || 0}</div><div class="kpi-l">Times you opened this</div></div>
      </div>

      <div class="card">
        <h3 class="card-h">Exam history</h3>
        ${exams.length ? `<div class="hist">${exams.map((e) => `<div class="hist-row">
          <span class="small muted">${fmt(e.exam_date)}</span>
          <span class="stg-pill" style="background:${HEX[e.final_stage] || "#64748B"}">${esc(e.final_stage || e.ai_stage)}</span>
          <span class="small">${e.size_cm ? esc(e.size_cm) + " cm · " : ""}${esc(e.doctor_name || "")} · <code>${esc(e.assessment_code || "")}</code></span></div>`).join("")}</div>`
          : `<p class="muted small">No exams saved yet.</p>`}
      </div>

      <div class="card">
        <h3 class="card-h">Latest treatment options</h3>
        ${tx.options && tx.options.length ? `<div class="treatments">${tx.options.map((o, i) => `<div class="tx ${i === 0 ? "first" : ""}"><span class="n">${i + 1}</span><span>${esc(o)}</span></div>`).join("")}</div>
          <p class="small muted">${esc(tx.reason || "")}</p>` : `<p class="muted small">None recorded.</p>`}
      </div>

      <div class="card">
        <h3 class="card-h">Care team</h3>
        ${[...new Set(exams.map((e) => e.doctor_name).filter(Boolean))].length
          ? [...new Set(exams.map((e) => e.doctor_name).filter(Boolean))].map((d) => `<div class="small">• ${esc(d)}</div>`).join("")
          : `<p class="muted small">No clinician recorded yet.</p>`}
      </div>

      <div class="card" id="pass-hosp">
        <div class="row-btns" style="justify-content:space-between"><h3 class="card-h" style="margin:0">Hospitals near the patient</h3>
          <button class="btn" id="pass-loc">Use my location</button></div>
        <p class="small muted" id="pass-hosp-note">Finding hospitals…</p>
        <div id="pass-hosp-list" class="hlist" style="max-height:none"></div>
      </div>

      <div class="card pass-foot-card">
        <div class="small muted">Decision support only. Outputs are experimental and must be confirmed by a qualified clinician. <b>This view is logged.</b></div>
        <div class="pass-actions">
          <button class="btn btn-primary" id="pass-open">Open in my workspace</button>
        </div>
      </div>
    </div>`;
  loadNearby(st, tx, exams);
  document.getElementById("pass-loc").onclick = () => loadNearby(st, tx, exams, true);
  document.getElementById("pass-open").onclick = () => {
    sessionStorage.setItem("openPatient", rec.patient_code);
    location.href = "/#twin";
  };
}

async function boot() {
  await S.initStore();
  if (!S.store.configured) return failed("Sign-in is not set up on this server.");
  if (!S.store.user) return gate();
  if (S.store.profile?.role !== "doctor") return notAllowed();
  try {
    const [rec, meta] = await Promise.all([S.getPatientPass(TOKEN), fetch("/api/meta").then((r) => r.json())]);
    if (!rec) return failed("This QR code is not valid.");
    await render(rec, meta);
  } catch (e) {
    failed((e && e.message) || "This QR code could not be opened.");
  }
}
boot();

// hospitals that can deliver what this stage needs, nearest first (same ranking as the patient dashboard)
function here(force) {
  return new Promise((resolve) => {
    if (!navigator.geolocation || !force) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 6000 });
  });
}
async function loadNearby(st, tx, exams, force) {
  const note = document.getElementById("pass-hosp-note"), list = document.getElementById("pass-hosp-list");
  if (!note || !list) return;
  const pos = await here(force);
  const body = { stage: st || "CL", options: (tx && tx.options) || [], organ: (exams[0] && exams[0].organ) || "liver",
    complicated: "no", ...(pos || {}) };
  try {
    const r = await fetch("/api/hospitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("could not load hospitals");
    const d = await r.json();
    note.textContent = pos ? "Distances from your location." : "Distances are from the campus. Use your location for exact distances.";
    list.innerHTML = d.hospitals.slice(0, 6).map((h) => `
      <div class="hrow ${h.match ? "ok" : ""}">
        <div class="hrow-top"><b>${esc(h.name)}</b><span class="dist">${h.distance_km} km</span></div>
        <div class="small muted">${esc(h.area || "")} · ${esc(h.type || "")}</div>
        <div class="small">${h.match ? '<span class="pill-ok">Can deliver this care</span>' : '<span class="pill-part">Partly available</span>'}</div>
        <div class="hrow-actions"><a class="btn btn-primary" href="${esc(h.maps)}" target="_blank" rel="noopener">Directions</a></div>
      </div>`).join("");
  } catch (e) { note.textContent = "Hospitals could not be loaded: " + e.message; }
}
