// Role-specific home screens.
// Doctors: a triage workspace (who needs attention first, the numbers, stage mix).
// Patients: a plain-language journey (where the cyst is, what changed, what to ask, their files).
import * as S from "/static/store.js";

const ORDER = ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"];
const PRI = { 1: ["Urgent", "pri-1"], 2: ["Review", "pri-2"], 3: ["Treat", "pri-3"], 4: ["Follow-up", "pri-4"] };
const PATIENT_QUESTIONS = [
  "What stage is my cyst, and what does that mean for me day to day?",
  "Does it need treatment now, or is watching it enough?",
  "When should my next scan be?",
  "Which warning signs mean I should come in sooner?",
];

const fmt = (d) => d ? new Date(String(d).length <= 10 ? d + "T00:00:00" : d)
  .toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–";
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };
const loading = (root) => (root.innerHTML = `<div class="dash-loading muted">Loading…</div>`);
const fail = (root, esc, e) => (root.innerHTML = `<div class="card"><p class="err">Could not load this screen: ${esc(e.message || e)}</p></div>`);

/* ============================ DOCTOR ============================ */
export async function renderDoctor(root, ctx) {
  const { esc, HEX, go, openTwin, profile } = ctx;
  loading(root);
  let k, mix, q;
  try { [k, mix, q] = await Promise.all([S.dashboardKpis(), S.stageMix(), S.triageQueue(20)]); }
  catch (e) { return fail(root, esc, e); }
  const kpi = (label, val, sub, tone = "") =>
    `<div class="kpi ${tone}"><div class="kpi-v">${val ?? 0}</div><div class="kpi-l">${label}</div><div class="kpi-s">${sub}</div></div>`;
  const top = Math.max(1, ...mix.map((m) => m.patients));
  const name = profile.full_name || profile.email || "colleague";
  root.innerHTML = `
    <div class="dash doctor">
      <div class="dash-head">
        <div>
          <span class="eyebrow">Clinician workspace · ${fmt(new Date().toISOString())}</span>
          <h2>Good ${greeting()}, ${esc(name)}</h2>
          <p class="muted">${k.needs_review ?? 0} patient${k.needs_review === 1 ? "" : "s"} need your review${k.complicated ? ` · ${k.complicated} with a reported complication` : ""}.</p>
        </div>
        <div class="dash-actions">
          <button class="btn btn-primary" data-go="assess">+ New assessment</button>
          <button class="btn" data-go="twin">Digital twins</button>
          <button class="btn" data-go="records">Records</button>
        </div>
      </div>

      <div class="kpis">
        ${kpi("Patients under care", k.patients, `${k.assessments_total ?? 0} assessments in total`)}
        ${kpi("This week", k.assessments_7d, "assessments in the last 7 days")}
        ${kpi("Need review", k.needs_review, "low AI confidence or CL", k.needs_review ? "alert" : "")}
        ${kpi("Complications", k.complicated, "rupture, infection or leak reported", k.complicated ? "danger" : "")}
        ${kpi("Active or transitional", k.active_or_transitional, "need treatment planning")}
        ${kpi("CT scans stored", k.ct_scans, "in the secure scan store")}
        ${kpi("PDF reports", k.pdf_reports, "issued to patients")}
        ${kpi("Live QR links", k.live_qr_links, "patient links still valid")}
      </div>

      <div class="dash-grid">
        <div class="card">
          <h3 class="card-h">Triage queue</h3>
          <p class="small muted">One row per patient, latest exam, most urgent first. Open a patient to see the full digital twin.</p>
          ${q.length ? `<table class="tri"><thead><tr><th>Priority</th><th>Patient</th><th>Stage</th><th>Size</th><th>Last exam</th><th></th></tr></thead><tbody>
            ${q.map((r) => `<tr>
              <td><span class="pri ${PRI[r.priority][1]}">${PRI[r.priority][0]}</span></td>
              <td><b>${esc(r.patient_code)}</b><div class="small muted">${esc(r.patient_email || "no email")}</div></td>
              <td><span class="stg-pill" style="background:${HEX[r.final_stage] || "#64748B"}">${esc(r.final_stage)}</span>${r.complicated ? ` <span class="small" style="color:#B91C1C">⚠ complication</span>` : ""}</td>
              <td>${r.size_cm ? esc(r.size_cm) + " cm" : "–"}</td>
              <td>${fmt(r.exam_date)}</td>
              <td><button class="btn" data-open="${esc(r.patient_code)}">Open</button></td></tr>`).join("")}
          </tbody></table>` : `<div class="empty-note">No patients yet. Run an assessment and confirm it to start the queue.</div>`}
        </div>

        <div class="card">
          <h3 class="card-h">Stage mix</h3>
          <p class="small muted">Patients at each stage (latest exam).</p>
          ${mix.map((m) => `<div class="mix-row"><span class="stg-pill" style="background:${HEX[m.stage]}">${m.stage}</span>
            <div class="mix-bar"><i style="width:${((m.patients / top) * 100).toFixed(0)}%;background:${HEX[m.stage]}"></i></div>
            <span>${m.patients}</span></div>`).join("")}
          <div class="dash-links"><button class="btn" data-go="graph">Knowledge graph</button> <button class="btn" data-go="explore">3D stages</button></div>
        </div>
      </div>
    </div>`;
  root.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openTwin(b.dataset.open)));
}

/* ============================ PATIENT ============================ */
export async function renderPatient(root, ctx) {
  const { esc, META, HEX, SHORT_PHASE, go, profile } = ctx;
  loading(root);
  let rows, files;
  try { [rows, files] = await Promise.all([S.myReports(), S.patientFiles()]); }
  catch (e) { return fail(root, esc, e); }
  const first = (profile.full_name || "").split(" ")[0] || "there";
  if (!rows.length) {
    root.innerHTML = `
      <div class="dash patient">
        <div class="pt-hero card">
          <div><span class="eyebrow">Patient portal</span><h2>Hello ${esc(first)}</h2>
          <p>There is no result to show yet. Your doctor will save your assessment here, using the email address you gave them.</p>
          <p class="muted small">When it appears, you will see your stage in plain language, how it has changed over time, and your reports.</p></div>
        </div>
        <div class="card"><h3 class="card-h">Questions you can bring to your next visit</h3><ul class="ask">${PATIENT_QUESTIONS.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>`;
    return;
  }
  const twin = S.toTwin(rows[0].patient_code, rows);
  const exams = twin.exams;
  const last = exams[exams.length - 1];
  const st = last.final_stage || last.stage;
  const info = META.stage_info[st] || {};
  const idx = ORDER.indexOf(st);
  const pct = (idx + 1) / ORDER.length;
  const C = 2 * Math.PI * 50;
  const prevStage = exams.length > 1 ? exams[exams.length - 2].final_stage : null;
  const tx = (rows[rows.length - 1].result && rows[rows.length - 1].result.treatment) || { options: [], reason: "" };
  const questions = [...PATIENT_QUESTIONS];
  if (["CE1", "CE2", "CE3a", "CE3b"].includes(st)) questions.splice(1, 0, "Is medicine or a procedure the right option for my cyst's size?");
  if (["CE4", "CE5"].includes(st)) questions.splice(1, 0, "Can my cyst be left alone safely?");

  root.innerHTML = `
    <div class="dash patient">
      <div class="pt-hero card">
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="10"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="${HEX[st]}" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg>
          <div class="ring-t" style="color:${HEX[st]}">${st}<small>${esc(SHORT_PHASE[st] || "")}</small></div>
        </div>
        <div>
          <span class="eyebrow">Your latest result · ${fmt(last.date)}</span>
          <h2 style="margin:6px 0 4px;color:${HEX[st]}">${esc(info.name || st)}</h2>
          <p style="font-size:16px;margin:6px 0">${esc(info.plain || "")}</p>
          <p class="small"><b>What it means:</b> ${esc(info.means || "")}</p>
          ${prevStage && prevStage !== st ? `<p class="small" style="margin-top:8px"><b>Change since last scan:</b> ${esc(prevStage)} → ${esc(st)}</p>` : ""}
          <p class="small muted" style="margin-top:8px">Assessed by ${esc(last.doctor || "your doctor")}. Always discuss results with your doctor.</p>
        </div>
      </div>

      <div class="card">
        <h3 class="card-h">Your cyst's journey</h3>
        <div class="journey">${ORDER.map((s, i) => `<div class="jstep ${s === st ? "on" : i < idx ? "past" : ""}"
          style="${s === st ? `background:${HEX[s]}` : ""}">${s}<span class="jsub">${esc(SHORT_PHASE[s] || "")}</span></div>`).join("")}</div>
        <p class="small muted" style="margin:10px 0 0">Stages run from left (undetermined) to right (inactive). The highlighted stage is where your cyst is now.</p>
      </div>

      <div class="dash-grid">
        <div class="card">
          <h3 class="card-h">What changed</h3>
          ${(last.changes || []).map((c) => `<p class="small" style="margin:6px 0">• ${esc(c)}</p>`).join("")}
          <h3 class="card-h" style="margin-top:14px">Exam history</h3>
          <div class="hist">${exams.slice().reverse().map((e) => `<div class="hist-row">
            <span class="small muted">${fmt(e.date)}</span>
            <span class="stg-pill" style="background:${HEX[e.final_stage]}">${esc(e.final_stage)}</span>
            <span class="small">${(e.changes || []).map(esc).join(" · ")}</span></div>`).join("")}</div>
        </div>
        <div class="card">
          <h3 class="card-h">What your doctor may consider</h3>
          <div class="treatments">${(tx.options || []).map((o, i) => `<div class="tx ${i === 0 ? "first" : ""}"><span class="n">${i + 1}</span><span>${esc(o)}</span></div>`).join("")}</div>
          <p class="small muted">${esc(tx.reason || "")} Your doctor decides the right option for you.</p>
          <h3 class="card-h" style="margin-top:14px">Questions to ask your doctor</h3>
          <ul class="ask">${questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>
      </div>

      <div class="card">
        <h3 class="card-h">Your reports and scans</h3>
        ${files.pdfs.length || files.scans.length ? `<div class="files">
          ${files.pdfs.map((p) => `<div class="file"><b>PDF report</b><div class="small muted">${fmt(p.created_at)}</div>
            ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">Open PDF</a>` : `<span class="muted">unavailable</span>`}</div>`).join("")}
          ${files.scans.map((s) => `<div class="file">${s.url ? `<img src="${esc(s.url)}" alt="CT scan" />` : ""}
            <div class="small muted" style="margin-top:6px">CT scan · ${fmt(s.created_at)}</div></div>`).join("")}
        </div>` : `<p class="muted small">Your doctor will add reports and scans here.</p>`}
      </div>
    </div>`;
}
