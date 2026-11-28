// Sign-in and sign-up for the two separate portals: /doctor (clinicians) and /patient (patients).
// Each portal only accepts accounts of its own role, so the two entry points cannot be mixed up.
import * as S from "/static/store.js";

const PORTAL = location.pathname.startsWith("/patient") ? "patient" : "doctor";
const $ = (id) => document.getElementById(id);
const say = (text, cls = "") => { const m = $("auth-msg"); m.className = "small " + cls; m.textContent = text; };
let MODE = "in";

const COPY = {
  doctor: {
    eyebrow: "Clinician workspace",
    h1: 'Stage hydatid cysts with <em>evidence you can check.</em>',
    lede: "Triage your patients, run the WHO-IWGE staging with the reasons shown, and send each patient a clear report.",
    sub: "Doctor sign-in",
    other: 'Patient? <a href="/patient">Go to the patient portal</a>',
    title: "Doctor sign-in",
  },
  patient: {
    eyebrow: "Patient portal",
    h1: 'Your cyst, explained <em>in plain language.</em>',
    lede: "See your stage, how it has changed over time, what your doctor is considering, and your reports.",
    sub: "Patient sign-in",
    other: 'Doctor? <a href="/doctor">Go to the clinician sign-in</a>',
    title: "Patient sign-in",
  },
};

function applyCopy() {
  const c = COPY[PORTAL];
  document.body.dataset.portal = PORTAL;
  document.title = `CystStage AI · ${c.title}`;
  $("p-eyebrow").textContent = c.eyebrow;
  $("p-h1").innerHTML = c.h1;
  $("p-lede").textContent = c.lede;
  $("p-sub").textContent = c.sub;
  $("p-switch").innerHTML = c.other;
}

function setMode(mode) {
  MODE = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("up-only").hidden = mode !== "up";
  $("code-row").hidden = PORTAL !== "doctor";
  $("auth-go").textContent = mode === "up" ? "Create account" : "Sign in";
  $("a-pass").autocomplete = mode === "up" ? "new-password" : "current-password";
  $("a-name").required = mode === "up";
  say("");
}

// role must match the portal; a mismatched account is signed out again
async function checkRole() {
  const role = S.store.profile?.role;
  if (PORTAL === "doctor" && role !== "doctor") {
    await S.signOut();
    throw new Error("This is a patient account. Sign in at the patient portal instead.");
  }
  if (PORTAL === "patient" && role !== "patient") {
    await S.signOut();
    throw new Error("This is a clinician account. Sign in at the doctor portal instead.");
  }
}

function goApp() {
  location.replace("/#home");
}

async function onSubmit(e) {
  e.preventDefault();
  const go = $("auth-go");
  const email = $("a-email").value.trim();
  const password = $("a-pass").value;
  go.disabled = true; say("");
  try {
    if (MODE === "in") {
      await S.signIn(email, password);
      await checkRole();
      return goApp();
    }
    const name = $("a-name").value.trim();
    const code = $("a-code").value.trim();
    if (!name) throw new Error("Please enter your full name.");
    if (PORTAL === "doctor") {
      if (!code) throw new Error("Enter the clinician access code from your hospital admin.");
      // checked BEFORE the account exists, so a wrong code leaves nothing behind
      if (!(await S.checkAccessCode(code))) throw new Error("That is not a valid clinician access code. Ask your hospital admin, or use a sample code (see the hint under the box).");
    }
    const out = await S.signUp({ email, password, full_name: name, role: PORTAL, doctor_code: code });
    if (out.confirm) {
      say("Account created. Check your email to confirm, then sign in.", "ok");
      go.disabled = false;
      return;
    }
    if (PORTAL === "doctor" && S.store.profile?.role !== "doctor") {
      await S.signOut();
      throw new Error("The access code was used up while you signed up. Ask your hospital admin for a new one.");
    }
    goApp();
  } catch (err) {
    say(err.message || String(err), "err");
    go.disabled = false;
  }
}

// live hint under the access code box, so a wrong code is obvious before the form is sent
let hintTimer = null;
function wireCodeHint() {
  const input = $("a-code"), hint = $("code-hint");
  input.addEventListener("input", () => {
    clearTimeout(hintTimer);
    const v = input.value.trim();
    if (!v) { hint.textContent = "Sample codes for testing: DOC-SAMPLE-01 to DOC-SAMPLE-05, or DECEPTICONS-DOC"; hint.className = "small muted"; return; }
    hintTimer = setTimeout(async () => {
      try {
        const ok = await S.checkAccessCode(v);
        hint.textContent = ok ? "✓ Valid clinician code" : "✗ Not a clinician code (an assessment ID like CS-… is not an access code)";
        hint.className = "small " + (ok ? "ok" : "err");
      } catch (e) { hint.textContent = ""; }
    }, 400);
  });
  hint.textContent = "Sample codes for testing: DOC-SAMPLE-01 to DOC-SAMPLE-05, or DECEPTICONS-DOC";
  hint.className = "small muted";
}

async function boot() {
  applyCopy();
  document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  setMode("in");
  await S.initStore();
  if (!S.store.configured) {
    say("Sign-in is not configured on this server (missing Supabase settings).", "err");
    $("auth-go").disabled = true;
    return;
  }
  if (S.store.user) {
    try { await checkRole(); return goApp(); } catch (err) { say(err.message, "err"); return; }
  }
  $("auth-form").addEventListener("submit", onSubmit);
  if (PORTAL === "doctor") wireCodeHint();
}

boot();
