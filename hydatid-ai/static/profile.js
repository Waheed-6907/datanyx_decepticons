// Doctor's own contact details for patients (kept off the dashboard, on their own page).
import * as S from "/static/store.js";
import { renderContact } from "/static/dashboard.js";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const root = document.getElementById("profile-root");
(async () => {
  await S.initStore();
  if (!S.store.configured) { root.innerHTML = '<div class="card"><p>Sign-in is not set up on this server.</p></div>'; return; }
  if (!S.store.user) { location.replace("/doctor?next=/profile"); return; }
  if (S.store.profile?.role !== "doctor") { root.innerHTML = '<div class="card"><p>This page is for clinicians. Patients: see your care team on your dashboard.</p></div>'; return; }
  root.innerHTML = "";
  await renderContact(root, { esc, profile: S.store.profile }, 0);
})();
