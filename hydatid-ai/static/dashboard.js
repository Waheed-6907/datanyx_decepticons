// Role-specific home screens.
// Doctors: a triage workspace (who needs attention first, the numbers, stage mix).
// Patients: a plain-language journey (where the cyst is, what changed, what to ask, their files).
import * as S from "/static/store.js";
import { mountMap } from "/static/map.js";

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
// each render gets a number; a render that is no longer the latest stops, so sections are never added twice
let SEQ = 0;
const fail = (root, esc, e) => (root.innerHTML = `<div class="card"><p class="err">Could not load this screen: ${esc(e.message || e)}</p></div>`);

/* ============================ DOCTOR ============================ */
export async function renderDoctor(root, ctx) {
  const { esc, HEX, go, openTwin, profile } = ctx;
  loading(root);
  const my = ++SEQ;
  let k, mix, q;
  try { [k, mix, q] = await Promise.all([S.dashboardKpis(), S.stageMix(), S.triageQueue(20)]); }
  catch (e) { return fail(root, esc, e); }
  if (my !== SEQ) return;
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
  const my = ++SEQ;
  let rows, files;
  try { [rows, files] = await Promise.all([S.myReports(), S.patientFiles()]); }
  catch (e) { return fail(root, esc, e); }
  if (my !== SEQ) return;
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
  await renderCareAndMap(root, ctx, last, st, tx, my);
  await renderMyPass(root, my);
}

/* ============================ POINT 2: CARE TEAM + HOSPITAL MAP (patient) ============================ */
const STAGE_NEEDS = { CL: "a confirmatory scan", CE1: "albendazole and drainage planning", CE2: "albendazole and drainage planning",
  CE3a: "albendazole and PAIR or surgery planning", CE3b: "surgery or PAIR planning", CE4: "follow-up imaging", CE5: "follow-up imaging" };
const CAP_NAME = { ultrasound: "Ultrasound", medicine: "Albendazole (physician)", interventional_radiology: "PAIR / drainage",
  hepatobiliary_surgery: "Liver surgery", thoracic_surgery: "Chest surgery", ct_mri: "CT / MRI", emergency: "24x7 emergency" };

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 });
  });
}

const escText = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tel = (n) => (n ? `<a href="tel:${String(n).replace(/[^+\d]/g, "")}">${escText(n)}</a>` : null);

let MAP_CTRL = null;
async function renderCareAndMap(root, ctx, last, st, tx, my) {
  const { esc } = ctx;
  let team = [];
  try { team = await S.myCareTeam(); } catch (e) { console.warn("care team", e); }
  if (my !== SEQ) return;
  const careHtml = team.length ? team.map((d) => {
    const phones = [d.hospital_phone && `Hospital: ${tel(d.hospital_phone)}`, d.clinic_phone && `Clinic: ${tel(d.clinic_phone)}`].filter(Boolean);
    return `<div class="team-row">
      <div class="avatar big">${esc((d.doctor_name || "D")[0].toUpperCase())}</div>
      <div class="team-info">
        <b>${esc(d.doctor_name || "Your doctor")}</b>
        <div class="small muted">${esc(d.specialty || "")}${d.city ? " · " + esc(d.city) : ""}</div>
        ${d.hospital_name ? `<div class="small"><b>${esc(d.hospital_name)}</b></div>` : ""}
        ${phones.length ? `<div class="small">${phones.join(" · ")}</div>`
          : `<div class="small muted">Your doctor has not shared a phone number yet. Use the map to find the hospital and ask at reception.</div>`}
        ${d.email ? `<div class="small"><a href="mailto:${esc(d.email)}">Email ${esc(d.email)}</a></div>` : ""}
        <div class="small muted">Last exam with you: ${fmt(d.last_exam)}</div>
      </div></div>`;
  }).join("") : `<p class="muted small">No doctor is linked to your account yet. Once a doctor saves an assessment with your email, their details appear here.</p>`;

  root.insertAdjacentHTML("beforeend", `
    <div class="dash-grid care-grid">
      <div class="card"><h3 class="card-h">Your care team</h3>
        <p class="small muted" style="margin-top:0">Who to contact about your cyst. Doctors choose what they share.</p>${careHtml}</div>
      <div class="card"><h3 class="card-h">What your next step needs</h3>
        <p class="small">Your stage (<b>${esc(st)}</b>) usually means <b>${esc(STAGE_NEEDS[st] || "a review with your doctor")}</b>.</p>
        <p class="small muted">The hospitals on the map are ranked by whether they offer what this needs, then by distance.</p>
        <div class="kpi-s" id="route-why"></div></div>
    </div>
    <div class="card map-card">
      <div class="map-head"><div><h3 class="card-h">Hospitals near you</h3>
        <p class="small muted" id="map-note">Finding your location…</p></div>
        <button class="btn" id="loc-btn">📍 Use my location</button></div>
      <div class="map-grid"><div id="pt-map" class="map"></div><div class="hlist" id="hlist"><div class="muted small">Loading hospitals…</div></div></div>
      <p class="small muted map-foot">Capabilities come from a demo directory and must be confirmed with each hospital before you travel. Distances are straight-line. Map data © OpenStreetMap contributors.</p>
    </div>`);

  const alreadyBy = team.map((d) => d.hospital_name).filter(Boolean);
  const complicated = last.case && String(last.case.complicated || "").toLowerCase() === "yes" ? "yes" : "no";
  const organ = (last.case && last.case.organ && last.case.organ !== "unknown") ? last.case.organ : "liver";
  async function loadRoute(pos) {
    const body = { stage: st, options: tx.options || [], organ, complicated, ...(pos || {}) };
    const r = await fetch("/api/hospitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("Could not load hospitals");
    return r.json();
  }
  const pos = await getPosition();
  let route;
  try { route = await loadRoute(pos); }
  catch (e) { $$note("Could not load hospitals: " + e.message); return; }
  draw(route, !!pos);

  $("#loc-btn").onclick = async () => {
    const p = await getPosition();
    if (!p) return $$note("Location was not allowed. Showing hospitals near the campus instead.");
    route = await loadRoute(p); draw(route, true);
  };

  function $(id) { return document.querySelector(id); }
  function $$note(t) { const n = $("#map-note"); if (n) n.textContent = t; }

  function draw(r, precise) {
    const hs = r.hospitals.map((h, i) => ({ ...h, id: "h" + i, has: h.has || [],
      careTeam: alreadyBy.includes(h.name) }));
    $("#route-why").textContent = r.why || "";
    $$note(precise ? `Distances from your location. ${hs.filter((h) => h.match).length} hospitals can deliver what you need.`
      : `Location not shared, so distances are from the campus. Allow location for exact distances.`);
    if (MAP_CTRL) MAP_CTRL.destroy();
    const ctrl = mountMap($("#pt-map"), { user: { lat: r.origin.lat, lng: r.origin.lng, label: r.origin.name },
      hospitals: hs, onSelect: (id) => highlight(id) });
    MAP_CTRL = ctrl;
    setTimeout(() => ctrl.resize(), 150);
    $("#hlist").innerHTML = hs.map((h) => `
      <div class="hrow ${h.match ? "ok" : ""}" data-id="${h.id}">
        <div class="hrow-top"><b>${esc(h.name)}</b><span class="dist">${h.distance_km} km</span></div>
        <div class="small muted">${esc(h.area || "")} · ${esc(h.type || "")}</div>
        <div class="small">${h.match ? `<span class="pill-ok">Can deliver your care</span>` : `<span class="pill-part">Missing: ${h.missing.map((m) => esc(CAP_NAME[m] || m)).join(", ")}</span>`}
          ${h.careTeam ? ` <span class="pill-care">Your doctor's hospital</span>` : ""}</div>
        <div class="hrow-actions"><button class="btn" data-show="${h.id}">Show on map</button>
          <a class="btn btn-primary" href="${esc(h.maps)}" target="_blank" rel="noopener">Directions</a></div>
      </div>`).join("");
    document.querySelectorAll("#hlist [data-show]").forEach((b) => (b.onclick = () => highlight(b.dataset.show)));
  }
  function highlight(id) {
    document.querySelectorAll("#hlist .hrow").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
    if (MAP_CTRL) MAP_CTRL.select(id);
    const row = document.querySelector(`#hlist .hrow[data-id="${id}"]`);
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ============================ POINT 2: CONTACT CARD (doctor) ============================ */
export async function renderContact(root, ctx, my) {
  const { esc, profile } = ctx;
  let dir = [];
  try { dir = await S.hospitalDirectory(); } catch (e) { console.warn("hospitals", e); }
  if (my !== SEQ) return;
  const opts = dir.map((h) => `<option value="${esc(h.name)}" ${profile.hospital_name === h.name ? "selected" : ""}>${esc(h.name)}</option>`).join("");
  root.insertAdjacentHTML("beforeend", `
    <div class="card contact-card">
      <div class="row-between"><div><h3 class="card-h">Your contact details for patients</h3>
        <p class="small muted" style="margin:0">Patients see these on their dashboard, so they can call you directly. Leave a field empty if you do not want to share it.</p></div>
        <label class="switch"><input type="checkbox" id="c-visible" ${profile.contact_visible !== false ? "checked" : ""}/> <span>Share with my patients</span></label></div>
      <div class="form-grid">
        <label class="field"><span>Hospital</span><select id="c-hosp"><option value="">Not listed / other</option>${opts}</select></label>
        <label class="field"><span>Hospital name (if not listed)</span><input id="c-hosp-other" value="${esc(profile.hospital_name && !dir.some((h) => h.name === profile.hospital_name) ? profile.hospital_name : "")}" placeholder="e.g. District Hospital" /></label>
        <label class="field"><span>Hospital phone</span><input id="c-hphone" value="${esc(profile.hospital_phone || "")}" placeholder="+91 …" inputmode="tel" /></label>
        <label class="field"><span>Your clinic phone</span><input id="c-cphone" value="${esc(profile.clinic_phone || "")}" placeholder="+91 …" inputmode="tel" /></label>
        <label class="field"><span>City</span><input id="c-city" value="${esc(profile.city || "")}" placeholder="Hyderabad" /></label>
        <label class="field"><span>Specialty</span><input id="c-spec" value="${esc(profile.specialty || "")}" placeholder="Hepatology / hydatid disease" /></label>
      </div>
      <div class="row-between" style="margin-top:10px"><span class="small muted" id="c-status"></span>
        <button class="btn btn-primary" id="c-save">Save contact details</button></div>
    </div>`);
  const status = document.getElementById("c-status");
  document.getElementById("c-save").onclick = async () => {
    const hospSel = document.getElementById("c-hosp").value;
    const hospName = hospSel || document.getElementById("c-hosp-other").value.trim() || null;
    const phone = (v) => (v.trim() || null);
    const fields = {
      hospital_name: hospName,
      hospital_phone: phone(document.getElementById("c-hphone").value),
      clinic_phone: phone(document.getElementById("c-cphone").value),
      city: phone(document.getElementById("c-city").value),
      specialty: phone(document.getElementById("c-spec").value),
      contact_visible: document.getElementById("c-visible").checked,
    };
    try {
      await S.updateMyProfile(fields);
      status.textContent = "Saved. Patients will see the new details on their next visit.";
      status.className = "small ok";
    } catch (e) { status.textContent = e.message; status.className = "small err"; }
  };
}

/* ============================ POINT 3: PATIENT QR PASS ============================ */
const passLink = (token) => `${location.origin}/p/${token}`;

function openModal(html) {
  closeModal();
  const d = document.createElement("div");
  d.className = "modal-wrap"; d.id = "modal";
  d.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Close">×</button>${html}</div>`;
  d.addEventListener("click", (e) => { if (e.target === d || e.target.classList.contains("modal-x")) closeModal(); });
  document.body.appendChild(d);
  return d;
}
function closeModal() { document.getElementById("modal")?.remove(); }

function qrBlock(qr, link) {
  return `<div class="qr-box"><img src="${qr}" alt="QR code for this patient" class="qr-img" />
    <div class="qr-link"><code>${escText(link)}</code></div>
    <div class="row-btns"><button class="btn" id="qr-copy">Copy link</button><button class="btn" id="qr-print">Print</button></div></div>`;
}
function wireQrBlock(link) {
  document.getElementById("qr-copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(link); e.target.textContent = "Copied ✓"; } catch { e.target.textContent = "Copy failed"; }
  };
  document.getElementById("qr-print").onclick = () => window.print();
}

async function passModal(code, email) {
  const d = openModal(`<span class="eyebrow">Patient QR</span><h3 class="card-h">Patient ${escText(code)}</h3>
    <p class="small muted">Making a new code replaces the old one. The patient shows it at visits. Scanning it opens the clinician sign-in, and only a signed-in doctor sees the record. Every view is logged.</p>
    <div id="qr-area"><div class="muted small">Making the code…</div></div>`);
  try {
    const token = await S.createPass(code, email);
    const link = passLink(token);
    const qr = await S.makeQr(link);
    d.querySelector("#qr-area").innerHTML = qrBlock(qr, link);
    wireQrBlock(link);
    refreshPassList();
  } catch (e) {
    d.querySelector("#qr-area").innerHTML = `<p class="err">${escText(e.message)}</p>`;
  }
}

async function renderPasses(root, ctx, my) {
  const { esc } = ctx;
  let list = [];
  try { list = await S.listPasses(); } catch (e) { console.warn("passes", e); }
  if (my !== SEQ) return;
  root.insertAdjacentHTML("beforeend", `
    <div class="card" id="passes-card">
      <div class="row-between"><div><h3 class="card-h">Patient QR codes you issued</h3>
        <p class="small muted" style="margin:0">Each code opens one patient's record after clinician sign-in. Revoke a code if it is lost or a patient stops using it.</p></div></div>
      ${list.length ? `<table class="tri"><thead><tr><th>Patient</th><th>Issued</th><th>Opened</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr><td><b>${esc(p.patient_code)}</b><div class="small muted">${esc(p.patient_email || "")}</div></td>
          <td>${fmt(p.created_at)}</td><td>${p.views || 0}×</td>
          <td><div class="row-btns"><button class="btn" data-showqr="${esc(p.token)}">Show QR</button>
          <button class="btn btn-ghost" data-revoke="${esc(p.token)}">Revoke</button></div></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty-note" style="margin-top:10px">No QR codes yet. Use the QR button on a patient in the triage queue.</div>`}
    </div>`);
  wirePassList(root);
}

function wirePassList(scope) {
  scope.querySelectorAll("[data-showqr]").forEach((b) => (b.onclick = async () => {
    const link = passLink(b.dataset.showqr);
    const d = openModal(`<span class="eyebrow">Patient QR</span><h3 class="card-h">Scan to open the record</h3>
      <div id="qr-area"><div class="muted small">Making the code…</div></div>`);
    try { d.querySelector("#qr-area").innerHTML = qrBlock(await S.makeQr(link), link); wireQrBlock(link); }
    catch (e) { d.querySelector("#qr-area").innerHTML = `<p class="err">${escText(e.message)}</p>`; }
  }));
  scope.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Revoke this QR code? The patient will need a new one from you.")) return;
    try { await S.revokePass(b.dataset.revoke); toastPass("QR code revoked"); refreshPassList(); }
    catch (e) { toastPass(e.message); }
  }));
}

async function refreshPassList() {
  const old = document.getElementById("passes-card");
  if (!old) return;
  const ctx = { esc: escText };
  const tmp = document.createElement("div");
  await renderPasses(tmp, ctx, SEQ);
  const fresh = tmp.querySelector("#passes-card");
  if (fresh) old.replaceWith(fresh);
  // the new card is in the document now; re-wire its buttons
  wirePassList(document.getElementById("passes-card") || document);
}
function toastPass(m) { const t = document.getElementById("toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(toastPass._t); toastPass._t = setTimeout(() => (t.hidden = true), 2800); }

async function renderMyPass(root, my) {
  let token = null;
  try { token = await S.myPass(); } catch (e) { console.warn("my pass", e); }
  if (my !== SEQ) return;
  let qr = null;
  if (token) { try { qr = await S.makeQr(passLink(token)); } catch (e) { console.warn("qr", e); } }
  root.insertAdjacentHTML("beforeend", `
    <div class="card mypass-card" id="mypass">
      <div class="mypass-qr">${qr ? `<img src="${qr}" alt="Your QR code" />` : `<div class="qr-empty">🔒</div>`}</div>
      <div>
        <span class="eyebrow">Your QR code</span>
        <h3 class="card-h">${token ? "Show this to your doctor" : "Create your QR code"}</h3>
        <p class="small">${token
          ? "Your doctor scans this code to open your summary: your stage, history, treatment options, and the hospitals and doctors near you. The clinician must sign in first, and each look is logged."
          : "Create a code to show your doctor at a visit. It opens your summary when your doctor signs in."}</p>
        <div class="row-btns" style="margin-top:8px">
          <button class="btn btn-primary" id="mypass-make">${token ? "Replace my code" : "Create my QR code"}</button>
          ${token ? `<button class="btn" id="mypass-copy">Copy link</button>` : ""}
        </div>
        <p class="small muted" id="mypass-msg"></p>
      </div>
    </div>`);
  const make = document.getElementById("mypass-make");
  if (make) make.onclick = async () => {
    make.disabled = true; document.getElementById("mypass-msg").textContent = "Making your code…";
    try { await S.createMyPass(); const home = document.getElementById("mypass"); home.remove(); await renderMyPass(root, SEQ); }
    catch (e) { document.getElementById("mypass-msg").textContent = e.message; make.disabled = false; }
  };
  const copy = document.getElementById("mypass-copy");
  if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(passLink(token)); copy.textContent = "Copied ✓"; } catch { copy.textContent = "Copy failed"; } };
}
