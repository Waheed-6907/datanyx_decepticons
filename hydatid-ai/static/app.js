import { createCystViewer } from "/static/cyst3d.js";
import { createGraph } from "/static/graph3d.js";
import { createBodyViewer, createLiverViewer } from "/static/xray.js";
import * as S from "/static/store.js";
import { renderDoctor, renderPatient } from "/static/dashboard.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PHASE_STYLE = {
  CL: ["var(--cl)", "var(--cl-soft)"],
  CE1: ["var(--active)", "var(--active-soft)"], CE2: ["var(--active)", "var(--active-soft)"],
  CE3a: ["var(--trans)", "var(--trans-soft)"], CE3b: ["var(--trans)", "var(--trans-soft)"],
  CE4: ["var(--inactive)", "var(--inactive-soft)"], CE5: ["var(--inactive)", "var(--inactive-soft)"],
};
const HEX = { CL: "#64748B", CE1: "#DC4B3E", CE2: "#DC4B3E", CE3a: "#D97706", CE3b: "#D97706", CE4: "#2563EB", CE5: "#2563EB" };
const SHORT_PHASE = { CL: "Undetermined", CE1: "Active", CE2: "Active", CE3a: "Transitional", CE3b: "Transitional", CE4: "Inactive", CE5: "Inactive" };
const CONF = { High: [90, "#15803D"], Medium: [60, "#D97706"], Low: [30, "#B42318"] };
const CHECK_TEXT = {
  judges_agree: ["Rule judge and ML judge agree", "Rule judge and ML judge disagree"],
  ml_confident: ["ML model is confident (≥ 70%)", "ML model is not confident (< 70%)"],
  key_clues_present: ["All key findings for this stage were reported", "Some key findings were not reported"],
};
const ALL_NO = { wall_visible: "no", hydatid_sand: "no", septations: "no", daughter_cysts: "no", detached_membrane: "no", solid_matrix: "no", ball_of_wool: "no", calcification: "none", complicated: "no" };
const PRESET = {
  CL: { ...ALL_NO },
  CE1: { ...ALL_NO, wall_visible: "yes", hydatid_sand: "yes" },
  CE2: { ...ALL_NO, wall_visible: "yes", septations: "yes", daughter_cysts: "yes" },
  CE3a: { ...ALL_NO, wall_visible: "yes", detached_membrane: "yes" },
  CE3b: { ...ALL_NO, wall_visible: "yes", daughter_cysts: "yes", solid_matrix: "yes" },
  CE4: { ...ALL_NO, solid_matrix: "yes", ball_of_wool: "yes" },
  CE5: { ...ALL_NO, solid_matrix: "yes", ball_of_wool: "yes", calcification: "complete" },
};
const VIEWS = ["home", "assess", "explore", "twin", "whatif", "graph", "reports", "records"];

let SCANS = {}, SIM = false, IMG_LABEL = null;
let META = null, MODE = "text", LAST = null, IMAGE = null, QUALITY = null, DOC_STAGE = null, IMGSTAT = null, IMGPRED = null;
const checklist = {};
const viewers = {};

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2800);
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `Request failed (${r.status})`); }
  return r;
}
const getJSON = async (p, b) => (await api(p, b)).json();

/* ============================ NAV + SLIDES ============================ */
let current = "home";
const inited = {};
function movePill() {
  const b = $(`.nav button[data-view="${current}"]`), pill = $("#nav-pill");
  pill.style.left = b.offsetLeft + "px"; pill.style.width = b.offsetWidth + "px";
}
function setView(name, push = true) {
  if (!VIEWS.includes(name)) name = "home";
  const dir = VIEWS.indexOf(name) >= VIEWS.indexOf(current) ? "in-right" : "in-left";
  $$(".view").forEach((v) => v.classList.remove("on", "in-right", "in-left"));
  const v = $("#view-" + name); v.classList.add("on", dir);
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  current = name; movePill();
  if (push) history.replaceState(null, "", "#" + name);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (S.store.configured && S.store.profile && S.store.profile.role === "patient" && ["assess", "twin", "whatif"].includes(name)) return setView("reports");
  const init = { explore: initExplorer, twin: initTwin, whatif: initWhatif, graph: initGraph, reports: initReports, records: initRecords }[name];
  if (init && !inited[name]) { inited[name] = true; requestAnimationFrame(init); }
  if (name === "twin" && inited.twin) loadPatients();
  if (name === "reports" && inited.reports) loadReports();
  if (name === "records" && inited.records) loadRecords();
  if (name === "home" && S.store.profile) renderDashboard();
  observeReveals();
}
function observeReveals() {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("shown"); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$(".view.on .reveal:not(.shown)").forEach((el) => io.observe(el));
}

/* ============================ INIT ============================ */
async function init() {
  META = await getJSON("/api/meta");
  const b = $("#model-badge");
  b.textContent = META.model_loaded ? "Rules + ML model active" : "Rules only · ML model not loaded";
  if (!META.model_loaded) b.classList.add("badge-off");
  if (!META.llm_available) { $("#use-llm").disabled = true; $("#use-llm").closest(".toggle").title = "Set ANTHROPIC_API_KEY or GEMINI_API_KEY to enable"; }

  IMGSTAT = await getJSON("/api/image/status").catch(() => ({ available: false }));
  if (IMGSTAT.available) { const ib = $("#img-badge"); ib.hidden = false; ib.textContent = `Image AI · ${(IMGSTAT.metrics.test_accuracy * 100).toFixed(0)}% test acc.`; }
  { const ds = await getJSON("/api/demo_scans").catch(() => ({ scans: {} })); SCANS = ds.scans || {}; SIM = !!ds.simulated; }
  $$(".nav button").forEach((btn) => (btn.onclick = () => setView(btn.dataset.view)));
  $$("[data-go]").forEach((el) => (el.onclick = () => setView(el.dataset.go)));
  window.addEventListener("resize", movePill);
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== current) setView(h, false); });

  initHome();
  initAssess();
  await S.initStore();
  setupAuth();
  if (!S.store.configured) {
    const b = document.createElement("div"); b.className = "local-mode";
    b.textContent = "Local demo mode: Supabase is not connected, so there is no sign-in and data stays on this computer.";
    document.querySelector(".topbar").after(b);
  } else if (!S.store.user) { showAuth(); } else applyRole();
  setView((location.hash || "#home").slice(1), false);
  setTimeout(movePill, 300);
}

/* ============================ HOME ============================ */
function initHome() {
  const feats = [
    ["🧠", "Self-doubt engine", "Says “review required” instead of guessing when judges disagree, findings are missing or the image is poor.", "assess"],
    ["🧊", "3D stage explorer", "Every WHO stage as an interactive 3D model with labelled signs, in plain language for anyone.", "explore"],
    ["🧬", "Cyst digital twin", "A life history for each cyst: stage, size and structural changes across examinations.", "twin"],
    ["⚖️", "Doctor vs AI second opinion", "Doctor reads blind; the system compares and explains exactly which findings cause any disagreement.", "assess"],
    ["🎛", "What-if simulator", "Change size, organ or complications and watch the guideline pathway respond live.", "whatif"],
    ["🕸", "3D knowledge graph", "Sign → stage → phase → management: every rule the engine uses, explorable in 3D.", "graph"],
    ["🚦", "Referral priority", "Urgent, expert, priority, routine or follow-up, with the reason spelled out.", "assess"],
    ["🛂", "Assessment passport", "Every result carries an ID, input hash, engine, model and guideline versions.", "assess"],
    ["🎙", "Voice + image quality coach", "Dictate the report; get sharpness, exposure and contrast checks on the scan image.", "assess"],
  ];
  $("#features").innerHTML = feats.map(([i, t, d, go]) => `<div class="card feature reveal" data-go="${go}"><div class="fi">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join("");
  $$("#features [data-go]").forEach((el) => (el.onclick = () => setView(el.dataset.go)));

  if (Object.keys(SCANS).length) return initScanMonitor();
  const v = createBodyViewer($("#home-3d"), { distance: 6.2 });
  viewers.home = v;
  let i = 1; const order = META.stages, organs = ["liver", "liver", "lung", "liver", "other", "liver", "lung"];
  const show = () => {
    const s = order[i % order.length], org = organs[i % organs.length], size = [4, 6, 9, 7, 5, 8, 3][i % 7];
    v.set({ stage: s, size, organ: org });
    $("#home-site").textContent = { liver: "LIVER", lung: "RIGHT LUNG", other: "SPLEEN" }[org];
    const badge = $("#home-stage"); badge.textContent = `${s} · ${SHORT_PHASE[s]}`; badge.style.color = HEX[s];
    i++;
  };
  show(); setInterval(() => { if (current === "home") show(); }, 4200);
}

/* ============================ ASSESS ============================ */
function payload() {
  const base = MODE === "text"
    ? { mode: "text", text: $("#report").value, use_llm: $("#use-llm").checked }
    : { mode: "checklist", case: { ...checklist } };
  if (QUALITY) base.image_quality = { score: QUALITY.score, issues: QUALITY.issues };
  if (IMGPRED) base.image_pred = { stage: IMGPRED.stage, prob: IMGPRED.prob };
  return base;
}

function initAssess() {
  Object.keys(META.samples).forEach((k) => {
    const c = document.createElement("button");
    c.className = "chip"; c.textContent = k;
    c.onclick = () => pickSample(k);
    $("#samples").appendChild(c);
  });
  $("#final-stage").innerHTML = META.stages.map((s) => `<option>${s}</option>`).join("");
  $("#doc-stage").innerHTML = `<button class="chip on" data-s="">Skip</button>` + META.stages.map((s) => `<button class="chip" data-s="${s}">${s}</button>`).join("");
  $$("#doc-stage .chip").forEach((c) => (c.onclick = () => {
    $$("#doc-stage .chip").forEach((x) => x.classList.remove("on")); c.classList.add("on");
    DOC_STAGE = c.dataset.s || null; if (LAST) renderVs(LAST);
  }));
  buildChecklist();
  $$("#view-assess .seg-btn").forEach((btn) => (btn.onclick = () => {
    $$("#view-assess .seg-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active"); MODE = btn.dataset.mode;
    $("#mode-text").hidden = MODE !== "text"; $("#mode-checklist").hidden = MODE !== "checklist";
    const el = MODE === "text" ? $("#mode-text") : $("#mode-checklist");
    el.classList.remove("slide-up"); void el.offsetWidth; el.classList.add("slide-up");
    if (MODE === "checklist") analyse();
  }));
  $("#analyze").onclick = analyse;
  $("#report").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") analyse(); });
  $("#confirm").onclick = confirmDecision;
  $("#pdf").onclick = downloadPdf;
  $("#save-twin").onclick = saveTwin;
  $("#final-stage").onchange = () => setStatus();
  $("#to-whatif").onclick = () => { setView("whatif"); setTimeout(() => loadWhatifFromAssessment(), 50); };
  setupImage();
  setupVoice();
  buildScanWall();
  viewers.empty = createBodyViewer($("#empty-3d"), { distance: 5.6, stage: "CE2", size: 7, organ: "liver" });
  viewers.assess = createCystViewer($("#assess-3d"), { distance: 4.0, xray: true });
  viewers.body = createBodyViewer($("#assess-body"), { distance: 5.4 });
  viewers.liver = createLiverViewer($("#liver-3d"), {});
  $("#use-loc").onclick = useLocation;
  $("#make-qr").onclick = makeQR;
  $("#retrain").onclick = retrain;
  getJSON("/api/feedback/status").then((f) => ($("#fb-count").textContent = f.total)).catch(() => {});
}

function buildChecklist() {
  const rows = [];
  META.binary.forEach((k) => { checklist[k] = "unknown"; rows.push(triRow(k, META.labels[k], [["unknown", "?"], ["yes", "Yes"], ["no", "No"]])); });
  checklist.calcification = "unknown";
  rows.push(triRow("calcification", META.labels.calcification, [["unknown", "?"], ["none", "None"], ["partial", "Partial"], ["complete", "Full"]]));
  checklist.organ = "liver";
  rows.push(triRow("organ", "Organ", [["liver", "Liver"], ["lung", "Lung"], ["other", "Other"]]));
  checklist.segment = null;
  rows.push(`<div class="cl-row"><span class="cl-label">${esc(META.labels.segment || "Liver segment")}</span><select id="seg-sel" class="size-in" style="width:110px"><option value="">–</option>${["I", "II", "III", "IVa", "IVb", "V", "VI", "VII", "VIII", "right lobe", "left lobe"].map((x) => `<option>${x}</option>`).join("")}</select></div>`);
  checklist.size_cm = null;
  rows.push(`<div class="cl-row"><span class="cl-label">${esc(META.labels.size_cm)}</span><input id="size" class="size-in" type="number" min="0" step="0.5" placeholder="cm" /></div>`);
  $("#checklist").innerHTML = rows.join("");
  $$("#checklist .tri button").forEach((b) => (b.onclick = () => {
    const key = b.parentElement.dataset.key;
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); checklist[key] = b.dataset.v; analyse();
  }));
  $("#size").oninput = (e) => { checklist.size_cm = e.target.value ? Number(e.target.value) : null; analyse(); };
  $("#seg-sel").onchange = (e) => { checklist.segment = e.target.value || null; analyse(); };
}
function triRow(key, label, opts) {
  return `<div class="cl-row"><span class="cl-label">${esc(label)}</span><div class="tri" data-key="${key}">` +
    opts.map(([v, t]) => `<button data-v="${v}" class="${checklist[key] === v ? "on" : ""}">${t}</button>`).join("") + `</div></div>`;
}

/* ---- voice dictation ---- */
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, mic = $("#mic");
  if (!SR) { mic.title = "Voice dictation needs Chrome or Edge"; mic.onclick = () => toast("Voice dictation works in Chrome or Edge"); return; }
  const rec = new SR(); rec.lang = "en-IN"; rec.continuous = true; rec.interimResults = false;
  let on = false;
  rec.onresult = (e) => {
    let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
    if (t) { const ta = $("#report"); ta.value = (ta.value ? ta.value.trimEnd() + " " : "") + t.trim().replace(/^./, (c) => c.toUpperCase()) + "."; }
  };
  rec.onend = () => { if (on) { on = false; mic.classList.remove("rec"); if ($("#report").value.trim()) analyse(); } };
  rec.onerror = (e) => { toast("Microphone: " + e.error); };
  mic.onclick = () => { if (on) { rec.stop(); } else { on = true; mic.classList.add("rec"); rec.start(); toast("Listening… click the mic again to stop"); } };
}

/* ---- real scans from the team dataset ---- */
function initScanMonitor() {
  $("#home-3d").hidden = true; $("#home-scan").hidden = false;
  const keys = ["CL", "CE1", "CE2", "CE3", "CE3a", "CE3b", "CE4", "CE5"].filter((k) => SCANS[k]);
  $(".mon-tl span").textContent = SIM ? "Simulated ultrasound · WHO signs" : "Team dataset · real scan";
  const phaseOf = (k) => (k === "CE3" ? "Transitional" : SHORT_PHASE[k]);
  const colOf = (k) => HEX[k === "CE3" ? "CE3a" : k];
  $("#mon-strip").innerHTML = keys.map((k) => `<button data-k="${k}" style="--c:${colOf(k)}">${k}<small>${phaseOf(k)}</small></button>`).join("");
  let ki = 0, n = 0, front = $("#mon-a"), back = $("#mon-b");
  const show = (k) => {
    const list = SCANS[k], url = list[n % list.length];
    back.onload = () => { back.classList.add("on"); front.classList.remove("on"); [front, back] = [back, front]; };
    back.src = url;
    $("#mon-stage").textContent = k === "CE3" ? "CE3a/b" : k; $("#mon-stage").style.color = colOf(k);
    $("#mon-phase").textContent = phaseOf(k);
    $("#mon-count").textContent = SIM ? `Simulated · ${(META.stage_info && META.stage_info[k] && META.stage_info[k].name) || k}` : `Scan ${(n % list.length) + 1} / ${list.length} · labelled by dataset`;
    $$("#mon-strip button").forEach((b) => b.classList.toggle("on", b.dataset.k === k));
    const sw = $(".mon-sweep"); sw.style.animation = "none"; void sw.offsetWidth; sw.style.animation = "";
  };
  $$("#mon-strip button").forEach((b) => (b.onclick = () => { ki = keys.indexOf(b.dataset.k); n++; show(b.dataset.k); }));
  show(keys[0]);
  setInterval(() => { if (current !== "home") return; ki = (ki + 1) % keys.length; if (ki === 0) n++; show(keys[ki]); }, 3800);
}
const scanKey = (k) => (SCANS[k] ? k : (k === "CE3a" || k === "CE3b") && SCANS.CE3 ? "CE3" : null);
async function pickSample(k) {
  $$("#samples .chip").forEach((x) => x.classList.toggle("on", x.textContent === k));
  $("#report").value = META.samples[k];
  const key = SIM ? null : scanKey(k);
  if (key) {
    const list = SCANS[key], url = list[Math.floor(Math.random() * list.length)];
    await loadScanUrl(url, key, false);
  }
  analyse();
}
async function loadScanUrl(url, label, rerun = true) {
  const blob = await (await fetch(url)).blob();
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  IMG_LABEL = label;
  await useImage(data, rerun);
}
function buildScanWall() {
  const keys = (SIM ? ["CL", "CE1", "CE2", "CE3a", "CE3b", "CE4", "CE5"] : ["CE1", "CE2", "CE3", "CE4", "CE5"]).filter((k) => SCANS[k]);
  if (!keys.length) return;
  const wall = $("#empty-scans"); wall.hidden = false; $("#empty-3d").hidden = true;
  wall.style.gridTemplateColumns = `repeat(${keys.length},1fr)`;
  wall.innerHTML = keys.map((k) => `<div class="sw" data-k="${k}"><img src="${SCANS[k][0]}" alt="${SIM ? "Simulated" : "Real"} ${k} scan"/><b>${k}</b></div>`).join("");
  $$("#empty-scans .sw").forEach((t) => (t.onclick = () => pickSample(t.dataset.k === "CE3" ? "CE3a" : t.dataset.k)));
  let i = 0;
  setInterval(() => {
    if ($("#empty").hidden) return;
    i++;
    $$("#empty-scans .sw").forEach((t) => { const l = SCANS[t.dataset.k], im = t.querySelector("img"); im.style.opacity = 0; setTimeout(() => { im.src = l[i % l.length]; im.style.opacity = 1; }, 300); });
  }, 3500);
}
function renderScanView() {
  const v = $("#scan-view");
  if (!IMAGE) { v.hidden = true; return; }
  v.hidden = false;
  $("#sv-img").src = IMAGE;
  const line = v.querySelector(".sv-scanline"); line.style.animation = "none"; void line.offsetWidth; line.style.animation = "";
  const sw = $("#sv-sw"); sw.hidden = !(IMGPRED && IMGPRED.heatmap);
  $$("#sv-sw button").forEach((b) => { b.classList.toggle("on", b.dataset.v === "scan"); b.onclick = () => {
    $$("#sv-sw button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
    $("#sv-img").src = b.dataset.v === "heat" ? IMGPRED.heatmap : IMAGE; }; });
  $("#sv-tag").textContent = IMG_LABEL ? `DATASET SCAN · LABELLED ${IMG_LABEL}` : "UPLOADED SCAN";
  $("#sv-title").textContent = IMGPRED ? `Image AI: ${IMGPRED.stage} · ${(IMGPRED.prob * 100).toFixed(0)}%` : "Scan attached";
  $("#sv-note").textContent = IMGPRED
    ? "Toggle Heatmap to see where the image model looked. The final stage combines this with the report findings."
    : "Image AI is not trained yet, so this scan is shown for the doctor but not scored. Run TRAIN_IMAGE_MODEL to enable it.";
}

/* ---- image + quality coach ---- */
function setupImage() {
  const drop = $("#drop"), input = $("#image");
  const load = (file) => {
    if (!file || !file.type.startsWith("image/")) return toast("Please choose an image file");
    const r = new FileReader();
    r.onload = async () => { IMG_LABEL = null; await useImage(r.result); };
    r.readAsDataURL(file);
  };
  input.onchange = () => load(input.files[0]);
  ["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (ev) => load(ev.dataTransfer.files[0]));
}
async function useImage(data, rerun = true) {
  IMAGE = data; $("#preview").src = IMAGE; $("#preview").hidden = false; $("#drop-empty").hidden = true;
  QUALITY = await analyzeImage(IMAGE); renderQuality();
  await runImageJudge();
  if (rerun && LAST) analyse();
}
function analyzeImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 320 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
      let sum = 0;
      for (let i = 0; i < w * h; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
      const mean = sum / (w * h); let v = 0; for (let i = 0; i < w * h; i++) v += (g[i] - mean) ** 2;
      const std = Math.sqrt(v / (w * h));
      let lap = [], lm = 0;
      for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; const L = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; lap.push(L); lm += L; }
      lm /= lap.length; let lv = 0; lap.forEach((L) => (lv += (L - lm) ** 2)); lv /= lap.length;
      const minSide = Math.min(img.width, img.height), issues = [];
      if (minSide < 300) issues.push("low resolution");
      if (mean < 40) issues.push("image too dark"); else if (mean > 215) issues.push("image overexposed");
      if (std < 25) issues.push("low contrast");
      if (lv < 40) issues.push("blurry / out of focus");
      const m = {
        Sharpness: Math.min(100, lv / 3), Exposure: 100 - Math.min(100, Math.abs(mean - 115) / 1.15),
        Contrast: Math.min(100, std * 1.8), Resolution: Math.min(100, minSide / 6),
      };
      const score = Math.round((m.Sharpness + m.Exposure + m.Contrast + m.Resolution) / 4);
      res({ score, metrics: m, issues, size: `${img.width}×${img.height}` });
    };
    img.src = src;
  });
}
function renderQuality() {
  const q = QUALITY, box = $("#quality"); box.hidden = false;
  box.innerHTML = `<div class="row-between small"><b>Scan quality coach · ${q.score}/100</b><span class="muted">${q.size}px</span></div>` +
    Object.entries(q.metrics).map(([k, v]) => {
      const c = v >= 55 ? "#15803D" : v >= 35 ? "#D97706" : "#B42318";
      return `<div class="q-row"><span>${k}</span><div class="q-bar"><i style="width:${v.toFixed(0)}%;background:${c}"></i></div><span class="${v >= 35 ? "q-ok" : "q-bad"}">${v >= 55 ? "Good" : v >= 35 ? "Fair" : "Poor"}</span></div>`;
    }).join("") +
    `<div class="small ${q.issues.length ? "q-bad" : "q-ok"}">${q.issues.length ? "⚠ " + esc(q.issues.join(", ")) + " — consider capturing another view." : "✓ Image is usable for review."}</div>` +
    `<div class="small muted">Generic checks only (sharpness, exposure, contrast, resolution); the cyst itself is not detected.</div>`;
}

/* ---- image AI judge ---- */
async function runImageJudge() {
  const box = $("#img-judge"); box.hidden = false; IMGPRED = null;
  if (!IMGSTAT || !IMGSTAT.available) {
    box.innerHTML = `<div class="ij-note">🧠 Image AI: not trained.</div>`;
    persistScan(null);
    return;
  }
  box.innerHTML = `<div class="ij-note">Image AI is reading the scan…</div>`;
  try {
    const r = await getJSON("/api/image", { image_b64: IMAGE });
    IMGPRED = r;
    persistScan(r);
    const col = HEX[r.stage === "CE3" ? "CE3a" : r.stage], phase = r.stage === "CE3" ? "Transitional" : SHORT_PHASE[r.stage];
    const bars = Object.entries(r.probs).sort((a, b) => b[1] - a[1]).map(([s, p], i) =>
      `<div class="prob ${i === 0 ? "top" : ""}"><span>${s}</span><div class="prob-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
    box.innerHTML = `<div class="ij-head"><div><div class="small muted" style="font-weight:600">Image AI judge</div><div class="ij-stage" style="color:${col}">${r.stage}</div><div class="small" style="color:${col}">${phase} · ${(r.prob * 100).toFixed(0)}% sure</div></div>
      <div class="ij-sw"><button class="on" data-v="scan">Scan</button><button data-v="heat">Heatmap</button></div></div>
      ${r.prob < 0.6 ? `<div class="ij-warn">⚠ Low confidence: ${r.stage} or ${r.second}? Get a specialist read.</div>` : ""}
      <div class="probs" style="border:0;padding:0">${bars}</div>
      <div class="ij-note">Heatmap (Grad-CAM) shows where the model looked. Engine: ${esc(r.model_used || "CNN")}, calibrated probabilities. Scored ${(r.test_accuracy * 100).toFixed(1)}% accuracy / ${r.test_macro_f1.toFixed(2)} macro-F1 on held-out test scans${r.cv ? ` (cross-validation ${(r.cv * 100).toFixed(1)}% ± ${(r.cv_std * 100).toFixed(1)}%)` : ""}. CE3a vs CE3b is separated by the report findings, not the image.</div>`;
    $$("#img-judge .ij-sw button").forEach((b) => (b.onclick = () => {
      $$("#img-judge .ij-sw button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
      $("#preview").src = b.dataset.v === "heat" ? r.heatmap : IMAGE;
    }));
  } catch (e) { box.innerHTML = `<div class="ij-warn">${esc(e.message)}</div>`; }
}

/* ---- v2: every feature writes its record to Supabase (no-op in demo mode) ---- */
const dbOn = () => !!(S.store.configured && S.store.user);
const dbWarn = (what) => (e) => { console.warn(what + " not saved:", e); toast(`${what} not saved to Supabase: ${e && e.message ? e.message : e}`); };
const codeNow = () => (LAST && LAST.result && LAST.result.passport ? LAST.result.passport.assessment_id : null);
const patientNow = () => $("#p-id").value.trim() || null;
function refreshRecords() { if (current === "records" && inited.records) loadRecords(); }

function persistAnalysis(data) {
  if (!dbOn()) return;
  const r = data.result;
  S.saveAnalysis({ assessment_code: r.passport.assessment_id, patient_code: patientNow(), input_mode: MODE,
    input_text: MODE === "text" ? $("#report").value : null, case_json: data.case, engine: data.engine, stage: r.stage,
    confidence: r.confidence, probabilities: r.ml_probs || null, evidence: data.evidence || null, treatment: r.treatment || null,
    rule_path: { rule: r.rule, checks: r.checks, differential: r.differential, ask_for: r.ask_for } })
    .then(refreshRecords).catch(dbWarn("analysis"));
}

// One CT image row per uploaded scan. pred is the image model result, or null while the model is not trained.
let SCAN_SAVED = null;
function persistScan(pred) {
  if (!dbOn() || !IMAGE || SCAN_SAVED === IMAGE) return;
  SCAN_SAVED = IMAGE;
  S.saveCtScan(IMAGE, { assessment_code: codeNow(), patient_code: patientNow() }, pred)
    .then(refreshRecords).catch(dbWarn("scan"));
}

/* ============================ RECORDS (one table per feature) ============================ */
function initRecords() {
  const sel = $("#rec-table");
  if (!sel.options.length) sel.innerHTML = S.RECORD_TABLES.map((t) => `<option value="${t}">${t}</option>`).join("");
  sel.onchange = loadRecords;
  $("#rec-refresh").onclick = loadRecords;
  loadRecords();
}
const recCell = (v) => v === null || v === undefined ? `<span class="muted">–</span>`
  : typeof v === "object" ? `<code>${esc(JSON.stringify(v)).slice(0, 200)}</code>` : esc(String(v)).slice(0, 200);
async function loadRecords() {
  const box = $("#rec-out"), count = $("#rec-count"), name = $("#rec-table").value;
  if (!S.store.configured) { box.innerHTML = `<p class="muted" style="padding:18px">Connect Supabase to see the saved tables.</p>`; count.textContent = ""; return; }
  box.innerHTML = `<p class="muted" style="padding:18px">Loading ${esc(name)}…</p>`;
  try {
    const rows = await S.loadTable(name);
    count.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}${rows.length === 200 ? " (latest 200)" : ""}`;
    if (!rows.length) { box.innerHTML = `<p class="muted" style="padding:18px">No rows yet. A row appears here after you use the matching feature.</p>`; return; }
    const cols = Object.keys(rows[0]);
    box.innerHTML = `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) =>
      `<tr>${cols.map((c) => `<td>${recCell(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  } catch (e) { box.innerHTML = `<p class="err" style="padding:18px">${esc(e.message)}</p>`; count.textContent = ""; }
}

/* ---- analyse + render ---- */
let busy = 0;
async function analyse() {
  if (MODE === "text" && !$("#report").value.trim()) return toast("Paste a report, dictate one, or pick a sample first");
  const btn = $("#analyze"); btn.disabled = true; btn.textContent = "Analysing…";
  const my = ++busy;
  try {
    const data = await getJSON("/api/assess", payload());
    if (my !== busy) return;
    LAST = data; SAVED_CODE = null; render(data);
    persistAnalysis(data);
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = "Analyse report"; }
}

function render({ case: c, evidence, engine, result: r }) {
  $("#empty").hidden = true;
  renderScanView();
  const res = $("#results"); res.hidden = false;
  res.classList.remove("stagger"); void res.offsetWidth; res.classList.add("stagger");
  const L = META.labels;

  // self-doubt banner
  const sd = r.self_doubt, ico = { review: "⛔", caution: "⚠️", confident: "✅" }[sd.verdict];
  $("#doubt").className = "doubt " + sd.verdict;
  $("#doubt").innerHTML = `<div class="d-ico">${ico}</div><div><div class="kicker">Self-doubt engine</div><h3>${esc(sd.title)}</h3>` +
    (sd.reasons.length ? `<ul>${sd.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "") +
    `<p><b>Suggested action:</b> ${esc(sd.action)}</p></div>`;

  // hero
  const [col, soft] = PHASE_STYLE[r.stage];
  const hero = $(".hero"); hero.style.setProperty("--phase", col); hero.style.setProperty("--phase-soft", soft);
  $("#stage").textContent = sd.verdict === "review" ? r.stage + "?" : r.stage;
  $("#phase").textContent = r.phase;
  $("#rule-line").textContent = r.rule.rule;
  const ref = $("#referral"); ref.className = "ref-pill ref-" + r.referral.level; ref.textContent = "🚦 " + r.referral.label; ref.title = r.referral.why;
  const [pct, ccol] = CONF[r.confidence];
  $("#ring").style.setProperty("--p", pct); $("#ring").style.setProperty("--c", ccol);
  $("#ring").style.setProperty("--p", r.confidence_score);
  $("#conf-level").textContent = r.confidence_score + "%"; $("#conf-level").style.color = ccol;
  $("#conf-sub").textContent = r.confidence + " confidence";
  const stampEl = $("#review-stamp"); stampEl.hidden = !r.needs_review;
  if (r.needs_review) { stampEl.style.animation = "none"; void stampEl.offsetWidth; stampEl.style.animation = ""; }
  viewers.assess.setStage(r.stage, c.size_cm);
  viewers.body.set({ stage: r.stage, size: c.size_cm, organ: c.organ });
  $("#assess-site").textContent = ({ liver: "LIVER", lung: "RIGHT LUNG", other: "OTHER ORGAN" }[c.organ] || "ORGAN NOT STATED");
  $("#assess-cstage").textContent = r.stage + " · " + SHORT_PHASE[r.stage].toUpperCase();

  // track
  const alts = new Set(r.rule.alternatives.map((a) => a.stage));
  $("#stage-track").innerHTML = META.stages.map((s) => {
    const [sc, ss] = PHASE_STYLE[s], cls = s === r.stage ? "on" : alts.has(s) ? "alt" : "";
    return `<div class="st ${cls}" data-s="${s}" style="--col:${sc};--soft:${ss}" title="${alts.has(s) ? "Still possible if missing findings are present" : "See in 3D"}">${s}<small>${SHORT_PHASE[s]}</small></div>`;
  }).join("");
  $$("#stage-track .st").forEach((el) => (el.onclick = () => { setView("explore"); setTimeout(() => exGo(META.stages.indexOf(el.dataset.s)), 60); }));

  // checks + probs
  $("#checks").innerHTML = Object.entries(r.checks).filter(([k]) => k !== "image_agrees").map(([k, ok]) => {
    const na = k !== "key_clues_present" && !r.ml_probs;
    const txt = na ? CHECK_TEXT[k][0].replace(/ \(.*\)/, "") + " (no ML model loaded)" : CHECK_TEXT[k][ok ? 0 : 1];
    return `<li><span class="ic ${na ? "na" : ok ? "ok" : "no"}">${na ? "–" : ok ? "✓" : "!"}</span><span>${esc(txt)}</span></li>`;
  }).join("") + (IMGPRED ? (() => {
    const same = IMGPRED.stage === r.stage || (IMGPRED.stage === "CE3" && ["CE3a", "CE3b"].includes(r.stage));
    return `<li><span class="ic ${same ? "ok" : "no"}">${same ? "✓" : "!"}</span><span>Image AI ${same ? "agrees" : "disagrees"}: sees ${IMGPRED.stage} (${(IMGPRED.prob * 100).toFixed(0)}%)</span></li>`;
  })() : "");
  if (r.ml_probs) {
    const top = Object.entries(r.ml_probs).sort((a, b) => b[1] - a[1]);
    $("#probs").hidden = false;
    $("#probs").innerHTML = `<div class="small muted">ML model probabilities</div>` + top.slice(0, 4).map(([s, p], i) =>
      `<div class="prob ${i === 0 ? "top" : ""}"><span>${s}</span><div class="prob-bar"><i style="width:0%" data-w="${(p * 100).toFixed(1)}"></i></div><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
    requestAnimationFrame(() => $$("#probs i").forEach((i) => (i.style.width = i.dataset.w + "%")));
  } else $("#probs").hidden = true;

  // evidence
  const items = Object.entries(r.rule.fired_on).map(([k, v]) => `<li><span class="k">${esc(L[k] || k)}</span> = <span class="v">${esc(v)}</span>${evidence[k] ? `<q>${esc(evidence[k])}</q>` : ""}</li>`);
  if (!items.length) items.push(`<li>No pathognomonic sign reported, so the lesion stays <b>CL</b> (unconfirmed).</li>`);
  r.ml_reasons.forEach(([k, v]) => items.push(`<li class="w">Model weight · ${esc(L[k] || k)} <b>${v > 0 ? "+" : ""}${v.toFixed(2)}</b></li>`));
  $("#evidence").innerHTML = items.join("");
  $("#engine").textContent = engine === "checklist" ? "Findings entered by clinician" : `Report read by: ${engine === "llm" ? "LLM extractor" : "keyword extractor (offline)"}`;

  // highlighted report
  if (MODE === "text") {
    $("#report-card").hidden = false;
    let html = esc($("#report").value);
    [...new Set(Object.values(evidence))].filter(Boolean).sort((a, b) => b.length - a.length)
      .forEach((q) => { const e = esc(q); if (html.includes(e)) html = html.split(e).join(`\u0000${e}\u0001`); });
    $("#highlighted").innerHTML = html.replace(/\u0000/g, "<mark>").replace(/\u0001/g, "</mark>");
  } else $("#report-card").hidden = true;

  // uncertainty
  if (r.differential.length || r.ask_for.length) {
    $("#uncertain-card").hidden = false;
    $("#differential").innerHTML = r.differential.map((d) => `<li>${esc(d.replace(/_/g, " "))}</li>`).join("");
    $("#ask-for").innerHTML = r.ask_for.length ? `<span class="small muted">Please check:</span>` + r.ask_for.map((k) => `<span class="tag">${esc(L[k] || k)}</span>`).join("") : "";
  } else $("#uncertain-card").hidden = true;

  // treatment
  $("#treatments").innerHTML = r.treatment.options.map((o, i) => `<div class="tx ${i === 0 ? "first" : ""}"><span class="n">${i + 1}</span><span>${esc(o)}</span></div>`).join("");
  $("#t-reason").textContent = r.treatment.reason;
  $("#t-notes").innerHTML = r.treatment.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  // passport
  const p = r.passport;
  $("#passport").innerHTML = [["Assessment ID", `<code>${p.assessment_id}</code>`], ["Timestamp", p.timestamp.replace("T", " ")], ["Input hash", `<code>${p.input_hash}</code>`],
    ["Engine", p.engine], ["Rule set", p.ruleset], ["ML model", p.model], ["Guidelines", p.guidelines.join(", ")], ["Status", p.status]]
    .map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join("");

  renderVs(LAST);
  renderLadder(r, c, evidence);
  renderFlow(r, c);
  loadReferral();
  resetShare();
  $("#final-stage").value = r.stage; $("#note").value = "";
  setStatus();
}

function renderVs(data) {
  const card = $("#vs-card");
  if (!DOC_STAGE || !data) { card.hidden = true; return; }
  card.hidden = false;
  const r = data.result, c = data.case, L = META.labels, agree = DOC_STAGE === r.stage;
  $("#vs-doc").textContent = DOC_STAGE; $("#vs-doc").style.color = HEX[DOC_STAGE];
  $("#vs-ai").textContent = r.stage; $("#vs-ai").style.color = HEX[r.stage];
  $("#vs-mid").innerHTML = agree ? `<span class="agree">✓ Agree</span>` : `<span class="disagree">≠ Disagree</span>`;
  if (agree) { $("#vs-detail").innerHTML = `<p class="small">Both independent reads reach <b>${r.stage}</b>. Agreement between human and AI raises trust in the stage.</p>`; return; }
  const docRule = META.rules.find((x) => x.stage === DOC_STAGE);
  const aiWhy = Object.entries(r.rule.fired_on).map(([k, v]) => `<li>${esc(L[k] || k)} = <b>${esc(v)}</b></li>`).join("") || "<li>No specific sign reported</li>";
  const need = docRule.triggers.map((k) => `<li>${esc(L[k] || k)} — report says <b>${esc(c[k])}</b></li>`).join("") || "<li>Absence of all specific signs</li>";
  const unknown = docRule.triggers.filter((k) => c[k] === "unknown");
  const order = META.rules.map((x) => x.stage);
  const blocked = order.indexOf(r.stage) < order.indexOf(DOC_STAGE);
  $("#vs-detail").innerHTML = `<div class="grid2" style="gap:12px">
    <div><b>Why the AI chose ${r.stage}</b><ul>${aiWhy}</ul></div>
    <div><b>What ${DOC_STAGE} requires</b> <span class="muted">(${esc(docRule.rule)})</span><ul>${need}</ul></div></div>
    <p class="small" style="margin:6px 0 0"><b>To resolve:</b> ${unknown.length ? "re-check " + unknown.map((k) => esc(L[k] || k)).join(", ") + " on the scan." :
      blocked ? `the findings for ${r.stage} take priority in the WHO sequence; confirm whether they are really present.` : "review the scan together; neither read is assumed correct."}</p>`;
}

function setStatus(saved) {
  const s = $("#decision-status"); if (!LAST) return;
  const over = $("#final-stage").value !== LAST.result.stage;
  if (saved) { s.textContent = over ? `Saved as override → ${$("#final-stage").value} (queued for retraining)` : "Saved · clinician agrees with AI"; s.className = "small " + (over ? "ovr" : "ok"); }
  else { s.textContent = over ? `Overriding AI (${LAST.result.stage} → ${$("#final-stage").value})` : "Not yet confirmed"; s.className = "small " + (over ? "ovr" : "muted"); }
}
let SAVED_CODE = null;
function recordFromLast() {
  const r = LAST.result;
  return { assessment_code: r.passport.assessment_id, patient_code: $("#p-id").value.trim(), patient_email: $("#p-email").value.trim() || null,
    patient_age: $("#p-age").value ? parseInt($("#p-age").value, 10) : null, patient_sex: $("#p-sex").value || null,
    findings: LAST.case, result: r, ai_stage: r.stage, ai_confidence: r.confidence, final_stage: $("#final-stage").value,
    note: $("#note").value || null, report_text: MODE === "text" ? $("#report").value : null,
    image_stage: IMGPRED ? IMGPRED.stage : null, image_prob: IMGPRED ? IMGPRED.prob : null };
}
async function saveToSupabase() {
  const rec = recordFromLast();
  if (!rec.patient_code) { $("#p-id").focus(); throw new Error("Enter a Patient ID first (top left)"); }
  if (SAVED_CODE === rec.assessment_code) await S.updateAssessment(rec.assessment_code, { final_stage: rec.final_stage, note: rec.note, patient_email: rec.patient_email });
  else { await S.saveAssessment(rec, IMAGE); SAVED_CODE = rec.assessment_code; }
  TWIN_PICK = rec.patient_code;
}
async function queueFeedback() {
  try {
    const f = await getJSON("/api/feedback", { case: LAST.case, ai_stage: LAST.result.stage, final_stage: $("#final-stage").value });
    $("#fb-count").textContent = f.total;
    $("#learn-status").textContent = `Learning queue: ${f.total} confirmed case${f.total === 1 ? "" : "s"} (${f.overrides} correction${f.overrides === 1 ? "" : "s"}). Click Retrain to learn from them.`;
  } catch (e) { /* non-blocking */ }
}
async function confirmDecision() {
  if (!LAST) return;
  queueFeedback();
  if (S.store.configured) { try { await saveToSupabase(); setStatus(true); toast("Decision saved to Supabase"); } catch (e) { toast(e.message); } return; }
  try {
    await api("/api/decision", { patient_id: $("#p-id").value, ai_stage: LAST.result.stage, ai_confidence: LAST.result.confidence, final_stage: $("#final-stage").value, note: $("#note").value });
    setStatus(true); toast("Decision saved");
  } catch (e) { toast(e.message); }
}
async function saveTwin() {
  if (!LAST) return;
  if (S.store.configured) { try { await saveToSupabase(); toast(`Saved to ${$("#p-id").value.trim()}'s digital twin (Supabase)`); } catch (e) { toast(e.message); } return; }
  const pid = $("#p-id").value.trim();
  if (!pid) { $("#p-id").focus(); return toast("Enter a Patient ID first (top left)"); }
  try {
    const out = await getJSON("/api/patients/exam", { patient_id: pid, name: pid, age: $("#p-age").value, sex: $("#p-sex").value, case: LAST.case,
      stage: LAST.result.stage, confidence: LAST.result.confidence, final_stage: $("#final-stage").value });
    toast(`Saved to ${pid}'s digital twin (${out.exams} exam${out.exams > 1 ? "s" : ""})`);
    TWIN_PICK = pid;
  } catch (e) { toast(e.message); }
}
async function downloadPdf() {
  if (!LAST) return;
  const btn = $("#pdf"); btn.disabled = true; btn.textContent = "Preparing…";
  try {
    const body = { ...payload(), patient: { id: $("#p-id").value, age: $("#p-age").value, sex: $("#p-sex").value }, decision: { final: $("#final-stage").value, note: $("#note").value }, image_b64: IMAGE };
    const blob = await (await api("/api/report", body)).blob();
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `cyststage_${($("#p-id").value || "patient").replace(/\s+/g, "_")}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    if (dbOn()) S.savePdf(blob, { assessment_code: codeNow(), patient_code: patientNow() }).then(refreshRecords).catch(dbWarn("pdf"));
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = "PDF report"; }
}

/* ============================ 3D EXPLORER ============================ */
let exIdx = 0, exTimer = null;
function initExplorer() {
  viewers.ex = createCystViewer($("#ex-3d"), { distance: 4.2, xray: true });
  $("#ex-xray").onchange = (e) => viewers.ex.setXray(e.target.checked);
  $("#ex-dots").innerHTML = META.stages.map((s, i) => { const [c, so] = PHASE_STYLE[s]; return `<div class="st" data-i="${i}" style="--col:${c};--soft:${so};padding:6px 2px;font-size:12.5px">${s}</div>`; }).join("");
  $$("#ex-dots .st").forEach((d) => (d.onclick = () => exGo(+d.dataset.i)));
  $("#ex-prev").onclick = () => exGo((exIdx + META.stages.length - 1) % META.stages.length);
  $("#ex-next").onclick = () => exGo((exIdx + 1) % META.stages.length);
  $("#ex-size").oninput = (e) => { $("#ex-size-v").textContent = e.target.value + " cm"; viewers.ex.setSize(+e.target.value); };
  $("#ex-notes").onchange = (e) => viewers.ex.setNotes(e.target.checked);
  $("#ex-play").onchange = (e) => { clearInterval(exTimer); if (e.target.checked) exTimer = setInterval(() => current === "explore" && exGo((exIdx + 1) % META.stages.length), 4500); };
  document.addEventListener("keydown", (e) => { if (current !== "explore") return; if (e.key === "ArrowRight") $("#ex-next").click(); if (e.key === "ArrowLeft") $("#ex-prev").click(); });
  exGo(exIdx, true);
}
function exGo(i, first) {
  if (!viewers.ex) { exIdx = i; return; }
  const back = i < exIdx; exIdx = i;
  const s = META.stages[i], info = META.stage_info[s], [col, soft] = PHASE_STYLE[s];
  viewers.ex.setStage(s, +$("#ex-size").value);
  $("#ex-badge").textContent = `${s} · ${SHORT_PHASE[s]}`; $("#ex-badge").style.color = HEX[s];
  $("#ex-phase").textContent = info.phase; $("#ex-phase").style.color = col; $("#ex-phase").style.background = soft; $("#ex-phase").style.borderColor = "transparent";
  $("#ex-title").textContent = s; $("#ex-title").style.color = HEX[s];
  $("#ex-name").textContent = info.name;
  $("#ex-plain").textContent = info.plain;
  $("#ex-signs").innerHTML = info.signs.map((x) => `<div>${esc(x)}</div>`).join("");
  $("#ex-means").textContent = info.means;
  $("#ex-mgmt").textContent = { CL: "Confirm the diagnosis first.", CE1: "Tablets for small cysts; PAIR + tablets for medium/large.", CE2: "Catheter drainage or surgery with tablets.",
    CE3a: "Tablets for small cysts; PAIR + tablets for medium/large.", CE3b: "Catheter drainage or surgery with tablets.", CE4: "Watch and wait with ultrasound.", CE5: "Watch and wait with ultrasound." }[s];
  const t = $("#ex-text"); t.classList.remove("slide-swap", "slide-swap-back"); void t.offsetWidth; if (!first) t.classList.add(back ? "slide-swap-back" : "slide-swap");
  $$("#ex-dots .st").forEach((d) => d.classList.toggle("on", +d.dataset.i === i));
}

/* ============================ DIGITAL TWIN ============================ */
let TWIN_PICK = null, TWIN = null;
async function initTwin() {
  viewers.twin = createCystViewer($("#twin-3d"), { distance: 4.4, xray: true });
  $("#twin-patient").onchange = (e) => openPatient(e.target.value);
  loadPatients();
}
async function loadPatients() {
  if (!viewers.twin) return;
  let list = await getJSON("/api/patients");
  if (S.store.configured) { try { const sbl = await S.listPatients(); list = [...sbl, ...list.filter((p) => p.id.startsWith("DEMO"))]; } catch (e) { toast(e.message); } }
  const pick = TWIN_PICK && list.some((p) => p.id === TWIN_PICK) ? TWIN_PICK : (TWIN && TWIN.id) || list[0]?.id;
  $("#twin-patient").innerHTML = list.map((p) => `<option value="${esc(p.id)}" ${p.id === pick ? "selected" : ""}>${esc(p.id)} · ${esc(p.name)} (${p.exams} exams)</option>`).join("");
  if (pick) openPatient(pick);
}
async function openPatient(id) {
  TWIN = S.store.configured && !id.startsWith("DEMO") ? await S.getPatient(id) : await getJSON("/api/patients/" + encodeURIComponent(id));
  const ex = TWIN.exams;
  $("#timeline").innerHTML = ex.map((e, i) => `<div class="card tl-card" data-i="${i}" style="border-top:4px solid ${HEX[e.final_stage]}">
      <div class="date">${esc(e.date)} · Exam ${i + 1}</div><div class="stg" style="color:${HEX[e.final_stage]}">${e.final_stage}</div>
      <div class="small muted">${SHORT_PHASE[e.final_stage]} · ${e.case.size_cm ? e.case.size_cm + " cm" : "size n/a"}</div>
      <div class="small" style="margin-top:6px">${esc(e.changes[0])}</div></div>`).join("");
  $("#timeline").classList.remove("stagger"); void $("#timeline").offsetWidth; $("#timeline").classList.add("stagger");
  $$("#timeline .tl-card").forEach((c) => (c.onclick = () => pickExam(+c.dataset.i)));
  drawChart(ex);
  renderVerdict(ex);
  $("#twin-illus").innerHTML = ex.some((e) => e.source === "illustrative") ? `<span class="illus">Illustrative demo data, not a validated natural progression sequence.</span>` : "";
  pickExam(ex.length - 1);
}
function pickExam(i) {
  const e = TWIN.exams[i];
  $$("#timeline .tl-card").forEach((c) => c.classList.toggle("sel", +c.dataset.i === i));
  viewers.twin.setStage(e.final_stage, e.case.size_cm);
  $("#twin-badge").textContent = `${e.final_stage} · ${e.date}`; $("#twin-badge").style.color = HEX[e.final_stage];
  $("#twin-sel").textContent = `exam ${i + 1} of ${TWIN.exams.length}`;
  const ch = $("#changes"); ch.innerHTML = e.changes.map((x) => `<li>${esc(x)}</li>`).join("");
  ch.classList.remove("stagger"); void ch.offsetWidth; ch.classList.add("stagger");
  $$("#chart .pt").forEach((p) => p.setAttribute("r", +p.dataset.i === i ? 9 : 6));
}
function drawChart(ex) {
  const W = 560, H = 230, P = 40, sizes = ex.map((e) => e.case.size_cm || 0), max = Math.max(4, ...sizes) * 1.25;
  const X = (i) => P + (ex.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (ex.length - 1)), Y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = ex.map((e, i) => `${i ? "L" : "M"}${X(i)},${Y(sizes[i])}`).join(" ");
  const grid = [0, 0.5, 1].map((k) => `<line x1="${P}" x2="${W - P}" y1="${Y(max * k / 1.25)}" y2="${Y(max * k / 1.25)}" stroke="#E2E8F0"/><text x="${P - 8}" y="${Y(max * k / 1.25) + 4}" font-size="11" text-anchor="end" fill="#64748B">${(max * k / 1.25).toFixed(0)}cm</text>`).join("");
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}
    <path d="${path}" fill="none" stroke="#14B8A6" stroke-width="3" stroke-linecap="round" stroke-dasharray="1000" stroke-dashoffset="1000"><animate attributeName="stroke-dashoffset" to="0" dur="1.2s" fill="freeze"/></path>
    ${ex.map((e, i) => `<circle class="pt" data-i="${i}" cx="${X(i)}" cy="${Y(sizes[i])}" r="6" fill="${HEX[e.final_stage]}" stroke="#fff" stroke-width="2" style="cursor:pointer"/>
      <text x="${X(i)}" y="${Y(sizes[i]) - 14}" font-size="12" font-weight="700" text-anchor="middle" fill="${HEX[e.final_stage]}">${e.final_stage}</text>
      <text x="${X(i)}" y="${H - 14}" font-size="11" text-anchor="middle" fill="#64748B">${e.date}</text>`).join("")}</svg>`;
  $$("#chart .pt").forEach((p) => (p.onclick = () => pickExam(+p.dataset.i)));
}

/* ============================ WHAT-IF ============================ */
let WI = null, WI_BASE = null, WI_PREV = null;
function initWhatif() {
  viewers.wi = createBodyViewer($("#wi-3d"), { distance: 5.2 });
  $("#wi-stage").innerHTML = META.stages.map((s) => `<button class="chip" data-s="${s}">${s}</button>`).join("");
  $$("#wi-stage .chip").forEach((c) => (c.onclick = () => { WI.findings = { ...PRESET[c.dataset.s] }; WI.preset = c.dataset.s; runWhatif(); }));
  let t; $("#wi-size").oninput = (e) => { WI.size = +e.target.value; $("#wi-size-v").textContent = e.target.value + " cm"; viewers.wi.set({ size: WI.size }); clearTimeout(t); t = setTimeout(runWhatif, 120); };
  $$("#wi-organ .seg-btn").forEach((b) => (b.onclick = () => { WI.organ = b.dataset.v; runWhatif(); }));
  $("#wi-comp").onchange = (e) => { WI.comp = e.target.checked; runWhatif(); };
  $("#wi-load").onclick = loadWhatifFromAssessment;
  $("#wi-reset").onclick = () => { WI = WI_BASE ? JSON.parse(JSON.stringify(WI_BASE)) : defaultWI(); WI_PREV = null; syncWiControls(); runWhatif(true); };
  if (!WI) { WI = LAST ? fromLast() : defaultWI(); WI_BASE = JSON.parse(JSON.stringify(WI)); }
  syncWiControls(); runWhatif(true);
}
const defaultWI = () => ({ findings: { ...PRESET.CE1 }, preset: "CE1", size: 6, organ: "liver", comp: false });
function fromLast() {
  const c = LAST.case, f = {}; Object.keys(ALL_NO).forEach((k) => (f[k] = c[k]));
  return { findings: f, preset: LAST.result.stage, size: c.size_cm || 6, organ: c.organ === "unknown" ? "liver" : c.organ, comp: c.complicated === "yes" };
}
function loadWhatifFromAssessment() {
  if (!LAST) return toast("Run an assessment in the Assess tab first");
  WI = fromLast(); WI_BASE = JSON.parse(JSON.stringify(WI)); WI_PREV = null;
  if (inited.whatif && viewers.wi) { syncWiControls(); runWhatif(true); }
  toast("Loaded the current assessment");
}
function syncWiControls() {
  $$("#wi-stage .chip").forEach((c) => c.classList.toggle("on", c.dataset.s === WI.preset));
  $("#wi-size").value = WI.size; $("#wi-size-v").textContent = WI.size + " cm";
  $$("#wi-organ .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.v === WI.organ));
  $("#wi-comp").checked = WI.comp;
}
async function runWhatif(reset) {
  syncWiControls();
  const c = { ...WI.findings, size_cm: WI.size, organ: WI.organ, complicated: WI.comp ? "yes" : "no" };
  const r = (await getJSON("/api/assess", { mode: "checklist", case: c })).result;
  viewers.wi.set({ stage: r.stage, size: WI.size, organ: WI.organ });
  $("#wi-site").textContent = { liver: "LIVER", lung: "RIGHT LUNG", other: "SPLEEN" }[WI.organ];
  $("#wi-badge").textContent = `${r.stage} · ${SHORT_PHASE[r.stage]}`; $("#wi-badge").style.color = HEX[r.stage];
  const steps = [
    ["1", "Stage", `<b style="color:${HEX[r.stage]}">${r.stage}</b> · ${esc(r.phase)}`, r.stage],
    ["2", "Referral priority", `${esc(r.referral.label)} <span class="muted small">— ${esc(r.referral.why)}</span>`, r.referral.label],
    ["3", "Management options", r.treatment.options.map((o) => esc(o)).join("<br>"), r.treatment.options.join("|")],
    ["4", "Why", esc(r.treatment.reason) + (r.treatment.notes.length ? `<br><span class="small" style="color:#92400E">${r.treatment.notes.map(esc).join("<br>")}</span>` : ""), r.treatment.reason + r.treatment.notes.join()],
  ];
  const prev = reset ? null : WI_PREV;
  $("#pathway").innerHTML = steps.map(([n, t, html, key], i) => `<div class="path-step ${prev && prev[i] !== key ? "changed" : ""}"><span class="pi">${n}</span><div><div class="small muted" style="font-weight:600">${t}</div><div>${html}</div></div></div>`).join("");
  WI_PREV = steps.map((s) => s[3]);
  if (!WI_BASE) WI_BASE = JSON.parse(JSON.stringify(WI));
  const d = [];
  if (WI.preset !== WI_BASE.preset) d.push(`Findings changed to a ${WI.preset} pattern (was ${WI_BASE.preset})`);
  if (WI.size !== WI_BASE.size) d.push(`Size ${WI_BASE.size} → ${WI.size} cm`);
  if (WI.organ !== WI_BASE.organ) d.push(`Organ ${WI_BASE.organ} → ${WI.organ}`);
  if (WI.comp !== WI_BASE.comp) d.push(WI.comp ? "Marked as complicated" : "Complication removed");
  $("#wi-diff").innerHTML = d.length ? `<div class="small muted" style="margin-top:12px;font-weight:600">Changed vs. starting scenario</div><ul class="diff">${d.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:12px 0 0">Move a control to see which steps of the pathway change (highlighted in yellow).</p>`;
}

/* ============================ KNOWLEDGE GRAPH ============================ */
async function initGraph() {
  const data = await getJSON("/api/graph");
  const g = createGraph($("#graph-3d"), data, (node, conn) => {
    const box = $("#g-info");
    if (!node) { box.innerHTML = `<div class="muted">Click any node to light up everything it connects to.</div>`; return; }
    const grp = { sign: "Ultrasound sign", stage: "Stage", phase: "Phase", mgmt: "Management option" }[node.group];
    const extra = node.group === "stage" ? META.stage_info[node.label] : null;
    box.innerHTML = `<span class="eyebrow">${grp}</span><h3>${esc(node.label)}</h3>
      <div class="small">${esc(extra ? extra.plain : node.info || "")}</div>
      ${extra ? `<button class="btn btn-ghost" style="margin-top:10px" id="g-3d">View ${esc(node.label)} in 3D →</button>` : ""}
      <div class="small muted" style="margin-top:12px;font-weight:600">Directly connected</div>
      <div class="g-conn">${conn.map((n) => `<span class="tag" data-id="${esc(n.id)}">${esc(n.label)}</span>`).join("")}</div>`;
    box.classList.remove("slide-up"); void box.offsetWidth; box.classList.add("slide-up");
    $$("#g-info .tag").forEach((t) => (t.onclick = () => g.select(t.dataset.id)));
    if (extra) $("#g-3d").onclick = () => { setView("explore"); setTimeout(() => exGo(META.stages.indexOf(node.label)), 60); };
  });
  $("#g-guides").innerHTML = META.guidelines.map((x) => `<p style="margin:0 0 8px"><b>${esc(x.title)}</b><br><span class="muted">${esc(x.used_for)}</span></p>`).join("");
}

/* ============================ AUTH ============================ */
let authViewer = null;
// Signed out, the start page offers two doors: /doctor and /patient (sign-in lives there, see portal.js).
function showAuth() {
  $("#auth").hidden = false;
  if (!authViewer) authViewer = createBodyViewer($("#auth-3d"), { distance: 5.6, stage: "CE3a", size: 7, organ: "liver" });
}
function setupAuth() {
  $("#signout").onclick = async () => { await S.signOut(); location.href = "/"; };
}
// Home screen for the signed-in user: doctors get the triage workspace, patients their journey.
async function renderDashboard() {
  const dash = $("#dash"), home = $("#view-home");
  const signed = S.store.configured && !!S.store.profile;
  [...home.children].forEach((c) => { if (c !== dash) c.hidden = signed; });
  dash.hidden = !signed;
  if (!signed) return;
  const ctx = { esc, HEX, SHORT_PHASE, META, profile: S.store.profile, go: setView,
    openTwin: (id) => { TWIN_PICK = id; setView("twin"); } };
  const draw = S.store.profile.role === "patient" ? renderPatient : renderDoctor;
  await draw(dash, ctx);
  $$("#dash [data-go]").forEach((el) => (el.onclick = () => setView(el.dataset.go)));
}
function applyRole() {
  const p = S.store.profile; if (!p) return;
  const chip = $("#user-chip"); chip.hidden = false;
  $("#auth").hidden = true;
  $("#u-name").textContent = p.full_name || p.email;
  $("#u-role").textContent = p.role === "patient" ? "Patient" : "Clinician";
  $("#u-avatar").textContent = (p.full_name || p.email || "?").trim()[0].toUpperCase();
  const patient = p.role === "patient";
  document.body.dataset.role = p.role;
  // patients: Home (their journey), My Reports, 3D stages. clinicians: the full workspace.
  const patientNav = ["home", "reports", "explore"];
  $$(".nav button").forEach((b) => { const v = b.dataset.view;
    b.hidden = patient ? !patientNav.includes(v) : false;
    if (v === "reports") b.textContent = patient ? "My Reports" : "Reports"; });
  $("#rep-title").textContent = patient ? "My reports" : "Patient reports";
  $("#rep-sub").textContent = patient ? "Your hydatid cyst assessments, explained in plain language. Always discuss them with your doctor."
    : "Every assessment saved to Supabase, newest first. Click a card to open its 3D view and plan.";
  $$("#view-home [data-go=assess]").forEach((b) => (b.dataset.go = patient ? "reports" : "assess"));
  setTimeout(movePill, 50);
  renderDashboard();
}

/* ============================ MY REPORTS (patient) ============================ */
let REPORTS = [];
function initReports() { viewers.rep = createCystViewer($("#rep-3d"), { distance: 4.2, xray: true }); loadReports(); }
async function loadReports() {
  if (!S.store.configured) { $("#rep-empty").hidden = false; return; }
  try { REPORTS = await S.myReports(); } catch (e) { return toast(e.message); }
  $("#rep-empty").hidden = REPORTS.length > 0; $("#rep-detail").hidden = !REPORTS.length;
  $("#rep-list").innerHTML = REPORTS.map((r, i) => { const st = r.final_stage || r.ai_stage;
    return `<div class="card tl-card rep-card" data-i="${i}" style="border-top:4px solid ${HEX[st]}"><div class="date">${esc(r.exam_date)} · ${esc(r.patient_code)}</div><div class="stg" style="color:${HEX[st]}">${st}</div><div class="small muted">${SHORT_PHASE[st]} · ${r.findings && r.findings.size_cm ? r.findings.size_cm + " cm" : "size n/a"}</div><div class="small" style="margin-top:6px">Doctor: ${esc(r.doctor_name || "–")}</div></div>`; }).join("");
  $("#rep-list").classList.remove("stagger"); void $("#rep-list").offsetWidth; $("#rep-list").classList.add("stagger");
  $$("#rep-list .tl-card").forEach((c) => (c.onclick = () => openReport(+c.dataset.i)));
  if (REPORTS.length) openReport(REPORTS.length - 1);
}
async function openReport(i) {
  const r = REPORTS[i], st = r.final_stage || r.ai_stage, info = META.stage_info[st];
  $$("#rep-list .tl-card").forEach((c) => c.classList.toggle("sel", +c.dataset.i === i));
  viewers.rep.setStage(st, r.findings && r.findings.size_cm);
  $("#rep-badge").textContent = `${st} · ${SHORT_PHASE[st]}`; $("#rep-badge").style.color = HEX[st];
  $("#rep-info").innerHTML = `<span class="eyebrow">${esc(info.phase)}</span><h2 style="margin:8px 0 2px;color:${HEX[st]}">${st} · ${esc(info.name)}</h2>
    <p style="font-size:16px;margin:8px 0">${esc(info.plain)}</p><div class="small"><b>What it means:</b> ${esc(info.means)}</div>
    ${r.note ? `<div class="small" style="margin-top:8px"><b>Doctor's note:</b> ${esc(r.note)}</div>` : ""}
    <div class="small muted" style="margin-top:10px">Assessed ${esc(r.exam_date)} by ${esc(r.doctor_name || "your doctor")} · ID ${esc(r.assessment_code || "")}</div>`;
  const tx = (r.result && r.result.treatment) || { options: [], reason: "" };
  $("#rep-tx").innerHTML = `<div class="treatments">${tx.options.map((o, k) => `<div class="tx ${k === 0 ? "first" : ""}"><span class="n">${k + 1}</span><span>${esc(o)}</span></div>`).join("")}</div><p class="muted small">${esc(tx.reason)} Your doctor decides the right option for you.</p>`;
  const url = await S.scanUrl(r.image_path);
  $("#rep-scan-card").hidden = !url; if (url) $("#rep-scan").src = url;
  ["#rep-info", "#rep-tx"].forEach((q) => { const el = $(q); el.classList.remove("slide-up"); void el.offsetWidth; el.classList.add("slide-up"); });
}

/* ============================ USP 2: WHO sign ladder ============================ */
function renderLadder(r, c, evidence) {
  const L = META.labels, firedIdx = META.rules.findIndex((x) => x.stage === r.stage);
  const alt = new Set(r.rule.alternatives.map((a) => a.stage));
  const sym = (v) => (v === "yes" || v === "complete" ? ["yes", "✓"] : v === "unknown" || v == null ? ["unk", "?"] : ["no", "✗"]);
  $("#sign-ladder").innerHTML = META.rules.map((rule, i) => {
    const [col, soft] = PHASE_STYLE[rule.stage];
    const state = i === firedIdx ? "fired" : i < firedIdx ? (alt.has(rule.stage) ? "possible" : "") : "skipped";
    const res = state === "fired" ? "Rule met → stage" : state === "possible" ? "Could apply if confirmed" : state === "skipped" ? "Not checked (decided above)" : "Not met";
    const signs = rule.triggers.length ? rule.triggers.map((k) => { const [cls, ch] = sym(c[k]);
      const label = (L[k] || k).split(" (")[0] + (k === "calcification" ? " (complete)" : "");
      return `<span class="rsig" title="${esc(evidence[k] || "")}"><i class="sg ${cls}">${ch}</i>${esc(label)}</span>`; }).join("") : `<span class="rsig">No specific sign (default)</span>`;
    return `<div class="rung ${state}" style="--col:${col};--soft:${soft};animation-delay:${i * 0.09}s"><span class="rs">${rule.stage}</span><div><div class="small muted" style="margin-bottom:4px">${esc(rule.rule)}</div><div class="rsigns">${signs}</div></div><span class="rres">${res}</span></div>`;
  }).join("");
}

/* ============================ USP 5: stage -> treatment -> location ============================ */
function renderFlow(r, c) {
  const organ = c.organ === "unknown" ? "liver" : c.organ;
  viewers.liver.set({ stage: r.stage, size: c.size_cm, segment: organ === "liver" ? c.segment : null });
  $("#liver-seg").textContent = organ !== "liver" ? (organ === "lung" ? "LUNG CYST · SEE BODY VIEW" : "OTHER ORGAN") : (c.segment ? "SEG " + String(c.segment).toUpperCase() : "SEGMENT NOT REPORTED");
  const [col] = PHASE_STYLE[r.stage];
  const where = organ === "liver" ? (c.segment ? `Liver · ${/lobe/.test(c.segment) ? c.segment : "segment " + c.segment}` : "Liver · segment not reported") : organ === "lung" ? "Right lung (see X-ray body view)" : "Other organ";
  const tx = r.treatment.options.map((o) => `<span>${esc(o.split(" (")[0])}</span>`).join("");
  const nodes = [
    ["Stage", `<span class="big" style="color:${col}">${r.stage}</span> <span class="muted">· ${esc(r.phase)}</span>`],
    ["Treatment", `<div class="fl-tx">${tx}</div><div class="small muted" style="margin-top:6px">${esc(r.treatment.reason)}</div>`],
    ["Location", `<span class="big" style="font-size:16px">${esc(where)}</span>${c.size_cm ? ` <span class="muted">· ${c.size_cm} cm</span>` : ""}`],
    ["Referral", `<span style="font-weight:600">${esc(r.referral.label)}</span><div class="small muted">${esc(r.referral.why)}</div>`],
  ];
  $("#flowline").innerHTML = nodes.map(([h, b], i) => `${i ? `<div class="fl-arrow" style="animation-delay:0s, ${i * 0.25}s"></div>` : ""}<div class="fl-node" style="animation-delay:${i * 0.25}s"><b>${h}</b>${b}</div>`).join("");
}

/* ============================ USP 7: stage-based referral ============================ */
let GEO = null;
async function loadReferral() {
  if (!LAST) return;
  const r = LAST.result, c = LAST.case;
  const d = await getJSON("/api/hospitals", { stage: r.stage, options: r.treatment.options, organ: c.organ === "unknown" ? "liver" : c.organ,
    complicated: c.complicated || "no", lat: GEO ? GEO.lat : null, lng: GEO ? GEO.lng : null });
  $("#ref-needs").innerHTML = `<b>This stage needs:</b> ${d.required.map((x) => `<span class="tag" style="margin:2px">${esc(x.label)}</span>`).join("")}<div class="muted" style="margin-top:4px">${esc(d.why)}</div>`;
  const top = d.hospitals.slice(0, 5);
  $("#ref-list").innerHTML = top.map((h, i) => `<div class="ref-item ${h.match ? "" : "no"}" style="animation-delay:${i * 0.08}s"><span class="rk">${h.match ? i + 1 : "–"}</span>
    <div><b>${esc(h.name)}</b><br/><small>${esc(h.type)} · ${esc(h.area)} · ${h.distance_km} km${h.match ? "" : " · lacks " + esc(h.missing.join(", ").replace(/_/g, " "))}</small></div>
    <a href="${h.maps}" target="_blank" rel="noopener">Directions ↗</a></div>`).join("");
  $("#ref-origin").textContent = "From: " + d.origin.name; $("#ref-disc").textContent = d.disclaimer;
  drawRadar(d.hospitals);
}
function drawRadar(list) {
  const maxD = Math.max(5, ...list.map((h) => Math.hypot(h.dx, h.dy))), k = 92 / maxD;
  const rings = [0.33, 0.66, 1].map((f) => `<circle r="${92 * f}" fill="none" stroke="rgba(56,189,248,.25)" stroke-dasharray="2 3"/><text x="3" y="${-92 * f + 9}" font-size="7" fill="#67E8F9">${(maxD * f).toFixed(0)} km</text>`).join("");
  const dots = list.map((h, i) => { const x = h.dx * k, y = -h.dy * k, col = h.match ? "#34D399" : "#64748B";
    return `<g><title>${esc(h.name)} · ${h.distance_km} km</title>${h.match && i < 3 ? `<circle class="ping" cx="${x}" cy="${y}" r="3" fill="none" stroke="${col}" stroke-width="1.5"/>` : ""}<circle class="hosp" cx="${x}" cy="${y}" r="${h.match ? 4.5 : 3}" fill="${col}"/>${h.match && i < 3 ? `<text x="${x + 6}" y="${y + 3}" font-size="8" fill="#E0F2FE">${i + 1}</text>` : ""}</g>`; }).join("");
  $("#radar").innerHTML = `<defs><linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22D3EE" stop-opacity="0"/><stop offset="1" stop-color="#22D3EE" stop-opacity=".45"/></linearGradient></defs>
    ${rings}<line x1="-100" y1="0" x2="100" y2="0" stroke="rgba(56,189,248,.15)"/><line x1="0" y1="-100" x2="0" y2="100" stroke="rgba(56,189,248,.15)"/>
    <path class="sweep" d="M0 0 L100 0 A100 100 0 0 0 70.7 -70.7 Z" fill="url(#sw)"/>${dots}
    <circle r="5" fill="#FDE68A"/><circle class="ping" r="5" fill="none" stroke="#FDE68A"/><text x="7" y="-7" font-size="8" fill="#FDE68A">You</text>`;
}
function useLocation() {
  if (!navigator.geolocation) return toast("Location not available in this browser");
  navigator.geolocation.getCurrentPosition((p) => { GEO = { lat: p.coords.latitude, lng: p.coords.longitude }; loadReferral(); toast("Using your location"); },
    () => toast("Location permission denied: using MJCET, Banjara Hills"), { timeout: 8000 });
}

/* ============================ USP 8 + 9: secure QR + local languages ============================ */
let SHARE = null;
function resetShare() { SHARE = null; $("#qr-card").classList.remove("flipped"); $("#open-share").disabled = true; $("#share-info").textContent = ""; $("#share-langs").innerHTML = ""; }
async function makeQR() {
  if (!LAST) return;
  const btn = $("#make-qr"); btn.disabled = true; btn.textContent = "Generating…";
  try {
    SHARE = await getJSON("/api/share", { patient: { id: $("#p-id").value, age: $("#p-age").value, sex: $("#p-sex").value }, case: LAST.case, result: LAST.result,
      heatmap: IMGPRED ? IMGPRED.heatmap : null, image_pred: IMGPRED });
    $("#qr-img").src = SHARE.qr; $("#qr-card").classList.add("flipped");
    if (dbOn()) {
      const { heatmap, ...imgPred } = IMGPRED || {};   // heatmap stays out of the database
      S.saveShare({ token: SHARE.token, assessment_code: codeNow(), patient_id: patientNow(),
        payload: { patient: { id: $("#p-id").value, age: $("#p-age").value, sex: $("#p-sex").value }, case: LAST.case, result: LAST.result,
          image_pred: IMGPRED ? imgPred : null },
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }).then(refreshRecords).catch(dbWarn("share link"));
    }
    $("#open-share").disabled = false; $("#open-share").onclick = () => window.open(SHARE.local_url, "_blank");
    $("#share-info").innerHTML = `Phone link (same Wi-Fi): <a href="${SHARE.local_url}" target="_blank">${esc(SHARE.url)}</a><br/>Expires ${esc(SHARE.expires.replace("T", " "))}`;
    $("#share-langs").innerHTML = [["en", "English"], ["hi", "हिन्दी"], ["te", "తెలుగు"], ["ur", "اردو"]].map(([k, v]) => `<button class="chip" data-l="${k}">${v} summary</button>`).join("");
    $$("#share-langs .chip").forEach((b) => (b.onclick = () => window.open(SHARE.local_url + "?lang=" + b.dataset.l, "_blank")));
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; btn.textContent = "New QR code"; }
}

/* ============================ USP 4: learn from doctors ============================ */
async function retrain() {
  const b = $("#retrain"); b.disabled = true; const old = b.innerHTML; b.textContent = "Retraining…";
  try {
    const r = await getJSON("/api/retrain", {});
    $("#learn-status").textContent = `Retrained on ${r.training_rows} cases including ${r.used_feedback} clinician-confirmed case${r.used_feedback === 1 ? "" : "s"}. Test accuracy now ${(r.after.accuracy * 100).toFixed(1)}% (calibrated).`;
    toast("Model retrained with clinician feedback");
    if (LAST) analyse();
  } catch (e) { toast(e.message); }
  finally { b.disabled = false; b.innerHTML = old; getJSON("/api/feedback/status").then((f) => ($("#fb-count").textContent = f.total)); }
}

/* ============================ USP 6: is treatment working? ============================ */
function renderVerdict(ex) {
  const box = $("#verdict");
  if (!ex || ex.length < 2) { box.hidden = true; return; }
  const ord = { CL: 0, CE1: 1, CE2: 2, CE3a: 3, CE3b: 3, CE4: 4, CE5: 5 };
  const a = ex[0], b = ex[ex.length - 1], dStage = ord[b.final_stage] - ord[a.final_stage];
  const s0 = a.case.size_cm, s1 = b.case.size_cm, dSize = s0 && s1 ? (s1 - s0) / s0 : null;
  let v, icon, col, soft, pos;
  if (dStage > 0 || (dStage === 0 && dSize !== null && dSize <= -0.1)) { v = "Responding: the cyst is moving towards inactive"; icon = "📉"; col = "#15803D"; soft = "#DCFCE7"; pos = 85; }
  else if (dStage < 0 || (dSize !== null && dSize >= 0.1)) { v = "Not responding: review the treatment plan"; icon = "⚠️"; col = "#B42318"; soft = "#FEE4E2"; pos = 15; }
  else { v = "Stable: no clear change yet"; icon = "⏸"; col = "#B45309"; soft = "#FEF0C7"; pos = 50; }
  const pts = [`Stage ${a.final_stage} → ${b.final_stage} over ${ex.length} exams (${a.date} → ${b.date})`];
  if (dSize !== null) pts.push(`Size ${s0} → ${s1} cm (${dSize > 0 ? "+" : ""}${(dSize * 100).toFixed(0)}%)`);
  if (["CE4", "CE5"].includes(b.final_stage)) pts.push("Now inactive: usually watch-and-wait with periodic ultrasound");
  box.hidden = false; box.style.setProperty("--vc", col); box.style.setProperty("--vs", soft);
  box.innerHTML = `<div class="vi">${icon}</div><div><div class="small muted" style="font-weight:600">Is the treatment working?</div><h3>${esc(v)}</h3><ul>${pts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
    <div class="vgauge"><div class="bar"><span class="dotm" style="left:50%"></span></div><div class="lbl"><span>Worse</span><span>Stable</span><span>Better</span></div></div>`;
  box.classList.remove("slide-up"); void box.offsetWidth; box.classList.add("slide-up");
  requestAnimationFrame(() => setTimeout(() => (box.querySelector(".dotm").style.left = pos + "%"), 80));
}

init();
