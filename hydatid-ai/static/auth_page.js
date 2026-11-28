// Shared logic for the standalone /login and /signup pages. Uses the same Supabase layer as the app (store.js).
import * as S from "/static/store.js";

const page = document.body.dataset.page; // "login" | "signup"
const $ = (id) => document.getElementById(id);
// patients land on their reports, doctors on the assessment screen
const goApp = () => location.replace("/" + (S.store.profile?.role === "patient" ? "#reports" : "#assess"));
const say = (text, cls = "") => { const m = $("auth-msg"); m.className = "small " + cls; m.textContent = text; };
let ROLE = "doctor";

function wireRolePicker() {
  const picks = document.querySelectorAll("#role-pick .role");
  picks.forEach((b) => (b.onclick = () => {
    picks.forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    ROLE = b.dataset.r;
    $("code-row").hidden = ROLE !== "doctor";
  }));
  $("code-row").hidden = ROLE !== "doctor";
}

async function boot() {
  await S.initStore();
  if (!S.store.configured) {
    say("Sign-in is not configured on this server (missing Supabase settings).", "err");
    $("auth-go").disabled = true;
    return;
  }
  if (S.store.user) return goApp(); // already signed in: go to the app
  if (page === "signup") wireRolePicker();
  $("auth-form").addEventListener("submit", onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const go = $("auth-go");
  const email = $("a-email").value.trim();
  const password = $("a-pass").value;
  go.disabled = true; say("");
  try {
    if (page === "login") {
      await S.signIn(email, password);
      return goApp();
    }
    const name = $("a-name").value.trim();
    const code = $("a-code").value.trim();
    if (!name) throw new Error("Please enter your full name.");
    if (ROLE === "doctor" && !code) throw new Error("Doctors need the access code from the hospital admin.");
    const out = await S.signUp({ email, password, full_name: name, role: ROLE, doctor_code: code });
    if (out.confirm) {
      say("Account created. Check your email to confirm, then sign in.", "ok");
      go.disabled = false;
      return;
    }
    if (ROLE === "doctor" && S.store.profile?.role !== "doctor") {
      say("Access code not accepted, so this account was created as a patient account.", "err");
      setTimeout(goApp, 2500);
      return;
    }
    goApp();
  } catch (err) {
    say(err.message || String(err), "err");
    go.disabled = false;
  }
}

boot();
