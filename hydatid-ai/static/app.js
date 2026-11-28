const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const PHASE_STYLE = {
  CL:   ["var(--cl)", "var(--cl-soft)"],
  CE1:  ["var(--active)", "var(--active-soft)"], CE2: ["var(--active)", "var(--active-soft)"],
  CE3a: ["var(--trans)", "var(--trans-soft)"],   CE3b: ["var(--trans)", "var(--trans-soft)"],
  CE4:  ["var(--inactive)", "var(--inactive-soft)"], CE5: ["var(--inactive)", "var(--inactive-soft)"],
};
const SHORT_PHASE = { CL: "Undetermined", CE1: "Active", CE2: "Active", CE3a: "Transitional", CE3b: "Transitional", CE4: "Inactive", CE5: "Inactive" };
const CONF = { High: [90, "#15803D"], Medium: [60, "#D97706"], Low: [30, "#B42318"] };
const CHECK_TEXT = {
  judges_agree: ["Rule judge and ML judge agree", "Rule judge and ML judge disagree"],
  ml_confident: ["ML model is confident (≥ 70%)", "ML model is not confident (< 70%)"],
  key_clues_present: ["All key findings for this stage were reported", "Some key findings were not reported"],
};

let META = null, MODE = "text", LAST = null, IMAGE = null;
const checklist = {};

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Request failed (${r.status})`); }
  return r;
}

function payload() {
  return MODE === "text"
    ? { mode: "text", text: $("#report").value, use_llm: $("#use-llm").checked }
    : { mode: "checklist", case: { ...checklist } };
}

/* ---------------- init ---------------- */
async function init() {
  META = await (await fetch("/api/meta")).json();
  const b = $("#model-badge");
  b.textContent = META.model_loaded ? "Rules + ML model active" : "Rules only · train model.py";
  if (!META.model_loaded) b.classList.add("badge-off");
  if (!META.llm_available) { $("#use-llm").disabled = true; $(".toggle").title = "Set ANTHROPIC_API_KEY or GEMINI_API_KEY to enable"; }

  // samples
  const box = $("#samples");
  Object.keys(META.samples).forEach((k) => {
    const c = document.createElement("button");
    c.className = "chip"; c.textContent = k;
    c.onclick = () => { document.querySelectorAll(".chip").forEach((x) => x.classList.remove("on")); c.classList.add("on"); $("#report").value = META.samples[k]; analyse(); };
    box.appendChild(c);
  });

  // final stage select
  $("#final-stage").innerHTML = META.stages.map((s) => `<option>${s}</option>`).join("");

  buildChecklist();

  document.querySelectorAll(".seg-btn").forEach((btn) => btn.onclick = () => {
    document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active"); MODE = btn.dataset.mode;
    $("#mode-text").hidden = MODE !== "text"; $("#mode-checklist").hidden = MODE !== "checklist";
    if (MODE === "checklist") analyse();
  });
  $("#analyze").onclick = analyse;
  $("#report").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") analyse(); });
  $("#confirm").onclick = confirmDecision;
  $("#pdf").onclick = downloadPdf;
  $("#final-stage").onchange = () => setStatus();
  setupImage();
}

function buildChecklist() {
  const rows = [];
  META.binary.forEach((k) => { checklist[k] = "unknown"; rows.push(triRow(k, META.labels[k], [["unknown","?"],["yes","Yes"],["no","No"]])); });
  checklist.calcification = "unknown";
  rows.push(triRow("calcification", META.labels.calcification, [["unknown","?"],["none","None"],["partial","Partial"],["complete","Full"]]));
  checklist.organ = "liver";
  rows.push(triRow("organ", "Organ", [["liver","Liver"],["lung","Lung"],["other","Other"]]));
  checklist.size_cm = null;
  rows.push(`<div class="cl-row"><span class="cl-label">${esc(META.labels.size_cm)}</span><input id="size" class="size-in" type="number" min="0" step="0.5" placeholder="cm" /></div>`);
  $("#checklist").innerHTML = rows.join("");
  document.querySelectorAll(".tri button").forEach((b) => b.onclick = () => {
    const key = b.parentElement.dataset.key;
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); checklist[key] = b.dataset.v; analyse();
  });
  $("#size").oninput = (e) => { checklist.size_cm = e.target.value ? Number(e.target.value) : null; analyse(); };
}
function triRow(key, label, opts) {
  return `<div class="cl-row"><span class="cl-label">${esc(label)}</span><div class="tri" data-key="${key}">` +
    opts.map(([v, t]) => `<button data-v="${v}" class="${checklist[key] === v ? "on" : ""}">${t}</button>`).join("") + `</div></div>`;
}

function setupImage() {
  const drop = $("#drop"), input = $("#image");
  const load = (file) => {
    if (!file || !file.type.startsWith("image/")) return toast("Please choose an image file");
    const r = new FileReader();
    r.onload = () => { IMAGE = r.result; $("#preview").src = IMAGE; $("#preview").hidden = false; $("#drop-empty").hidden = true; };
    r.readAsDataURL(file);
  };
  input.onchange = () => load(input.files[0]);
  ["dragenter","dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave","drop"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (ev) => load(ev.dataTransfer.files[0]));
}

/* ---------------- analyse ---------------- */
let busy = 0;
async function analyse() {
  if (MODE === "text" && !$("#report").value.trim()) return toast("Paste a report or pick a sample first");
  const btn = $("#analyze"); btn.disabled = true; btn.textContent = "Analysing…";
  const my = ++busy;
  try {
    const data = await (await api("/api/assess", payload())).json();
    if (my !== busy) return;
    LAST = data; render(data);
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = "Analyse report"; }
}

function render({ case: c, evidence, engine, result: r }) {
  $("#empty").hidden = true;
  const res = $("#results"); res.hidden = false; res.classList.remove("fade-in"); void res.offsetWidth; res.classList.add("fade-in");

  // hero
  const [col, soft] = PHASE_STYLE[r.stage];
  const hero = document.querySelector(".hero");
  hero.style.setProperty("--phase", col); hero.style.setProperty("--phase-soft", soft);
  $("#stage").textContent = r.stage;
  $("#phase").textContent = r.phase;
  $("#rule-line").textContent = r.rule.rule;
  const [pct, ccol] = CONF[r.confidence];
  const ring = $("#ring"); ring.style.setProperty("--p", pct); ring.style.setProperty("--c", ccol);
  $("#conf-level").textContent = r.confidence; $("#conf-level").style.color = ccol;

  // track
  const alts = new Set(r.rule.alternatives.map((a) => a.stage));
  $("#stage-track").innerHTML = META.stages.map((s) => {
    const [sc, ss] = PHASE_STYLE[s];
    const cls = s === r.stage ? "on" : alts.has(s) ? "alt" : "";
    return `<div class="st ${cls}" style="--col:${sc};--soft:${ss}" title="${alts.has(s) ? "Possible if missing findings are present" : ""}">${s}<small>${SHORT_PHASE[s]}</small><div class="st-bar"></div></div>`;
  }).join("");

  // checks
  $("#checks").innerHTML = Object.entries(r.checks).map(([k, ok]) => {
    const na = k !== "key_clues_present" && !r.ml_probs;
    const txt = na ? CHECK_TEXT[k][0].replace(/ \(.*\)/, "") + " (no ML model loaded)" : CHECK_TEXT[k][ok ? 0 : 1];
    return `<li><span class="ic ${na ? "na" : ok ? "ok" : "no"}">${na ? "–" : ok ? "✓" : "!"}</span><span>${esc(txt)}</span></li>`;
  }).join("");

  // probabilities
  if (r.ml_probs) {
    const top = Object.entries(r.ml_probs).sort((a, b) => b[1] - a[1]);
    $("#probs").hidden = false;
    $("#probs").innerHTML = `<div class="small muted">ML model probabilities</div>` + top.slice(0, 4).map(([s, p], i) =>
      `<div class="prob ${i === 0 ? "top" : ""}"><span>${s}</span><div class="prob-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
  } else { $("#probs").hidden = true; }

  // evidence
  const L = META.labels;
  const items = Object.entries(r.rule.fired_on).map(([k, v]) =>
    `<li><span class="k">${esc(L[k] || k)}</span> = <span class="v">${esc(v)}</span>${evidence[k] ? `<q>${esc(evidence[k])}</q>` : ""}</li>`);
  if (!items.length) items.push(`<li>No pathognomonic sign reported, so the lesion stays <b>CL</b> (unconfirmed).</li>`);
  r.ml_reasons.forEach(([k, v]) => items.push(`<li class="w">Model weight · ${esc(L[k] || k)} <b>${v > 0 ? "+" : ""}${v.toFixed(2)}</b></li>`));
  $("#evidence").innerHTML = items.join("");
  $("#engine").textContent = engine === "checklist" ? "Findings entered by clinician" : `Report read by: ${engine === "llm" ? "LLM extractor" : "keyword extractor (offline)"}`;

  // highlighted report
  const rc = $("#report-card");
  if (MODE === "text") {
    rc.hidden = false;
    let html = esc($("#report").value);
    const quotes = [...new Set(Object.values(evidence))].filter(Boolean).sort((a, b) => b.length - a.length);
    quotes.forEach((q) => { const e = esc(q); if (html.includes(e)) html = html.split(e).join(`\u0000${e}\u0001`); });
    $("#highlighted").innerHTML = html.replace(/\u0000/g, "<mark>").replace(/\u0001/g, "</mark>");
  } else rc.hidden = true;

  // uncertainty
  const uc = $("#uncertain-card");
  if (r.differential.length || r.ask_for.length) {
    uc.hidden = false;
    $("#differential").innerHTML = r.differential.map((d) => `<li>${esc(d.replace(/_/g, " "))}</li>`).join("");
    $("#ask-for").innerHTML = r.ask_for.length ? `<span class="small muted">Please check:</span>` + r.ask_for.map((k) => `<span class="tag">${esc(L[k] || k)}</span>`).join("") : "";
  } else uc.hidden = true;

  // treatment
  $("#treatments").innerHTML = r.treatment.options.map((o, i) => `<div class="tx ${i === 0 ? "first" : ""}"><span class="n">${i + 1}</span><span>${esc(o)}</span></div>`).join("");
  $("#t-reason").textContent = r.treatment.reason;
  $("#t-notes").innerHTML = r.treatment.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  // decision
  $("#final-stage").value = r.stage; $("#note").value = "";
  setStatus();
}

function setStatus(saved) {
  const s = $("#decision-status");
  if (!LAST) return;
  const over = $("#final-stage").value !== LAST.result.stage;
  if (saved) { s.textContent = over ? `Saved as override → ${$("#final-stage").value} (queued for retraining)` : "Saved · clinician agrees with AI"; s.className = "small " + (over ? "ovr" : "ok"); }
  else { s.textContent = over ? `Overriding AI (${LAST.result.stage} → ${$("#final-stage").value})` : "Not yet confirmed"; s.className = "small " + (over ? "ovr" : "muted"); }
}

async function confirmDecision() {
  if (!LAST) return;
  try {
    await api("/api/decision", { patient_id: $("#p-id").value, ai_stage: LAST.result.stage, ai_confidence: LAST.result.confidence, final_stage: $("#final-stage").value, note: $("#note").value });
    setStatus(true); toast("Decision saved");
  } catch (e) { toast(e.message); }
}

async function downloadPdf() {
  if (!LAST) return;
  const btn = $("#pdf"); btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const body = { ...payload(), patient: { id: $("#p-id").value, age: $("#p-age").value, sex: $("#p-sex").value },
      decision: { final: $("#final-stage").value, note: $("#note").value }, image_b64: IMAGE };
    const blob = await (await api("/api/report", body)).blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `cyststage_${($("#p-id").value || "patient").replace(/\s+/g, "_")}.pdf`; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = "Download PDF report"; }
}

init();
