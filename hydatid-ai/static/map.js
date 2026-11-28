// Street map for the patient dashboard: real OpenStreetMap streets (CARTO "Voyager" style),
// hospital pins coloured by what they offer, your location with a pulse, and a route to the chosen hospital.
// OpenStreetMap's standard street tiles: real roads, rivers, parks and place names, no API key needed
const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const KIND_COL = { emergency: "#B91C1C", hepatobiliary_surgery: "#0F766E", interventional_radiology: "#7C3AED", ct_mri: "#2563EB", medicine: "#0891B2", ultrasound: "#64748B" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function pinColour(h) {
  if (h.careTeam) return "#D97706";                                      // your doctor's hospital
  if (h.match && (h.has || []).includes("emergency")) return "#B91C1C";
  for (const c of ["hepatobiliary_surgery", "interventional_radiology", "ct_mri", "medicine", "ultrasound"]) if ((h.has || h.caps || []).includes(c)) return KIND_COL[c];
  return "#64748B";
}

// mountMap(el, { user:{lat,lng,label}, hospitals:[...], onSelect }) -> { select(id), resize(), destroy() }
export function mountMap(el, { user, hospitals, onSelect }) {
  if (!window.L) {
    el.innerHTML = `<div class="map-fallback">The street map needs an internet connection to load. The hospital list on the right still works.</div>`;
    return { select() {}, resize() {}, destroy() {} };
  }
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([user.lat, user.lng], 13);
  L.tileLayer(TILES, { subdomains: "abc", maxZoom: 19, attribution: ATTRIB }).addTo(map);

  // your location: pulsing blue dot
  L.marker([user.lat, user.lng], {
    icon: L.divIcon({ className: "you-dot", html: '<span class="you-pulse"></span><span class="you-core"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000, interactive: true,
  }).addTo(map).bindTooltip(esc(user.label || "You are here"), { direction: "top", offset: [0, -12] });

  const pins = {}, bounds = [[user.lat, user.lng]];
  hospitals.forEach((h) => {
    const col = pinColour(h);
    const icon = L.divIcon({
      className: "h-pin-wrap",
      html: `<div class="h-pin ${h.careTeam ? "care" : ""}" style="--pc:${col}"><span>${h.careTeam ? "★" : "+"}</span></div>`,
      iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36],
    });
    const m = L.marker([h.lat, h.lng], { icon, title: h.name }).addTo(map);
    const tags = (h.has || h.caps || []).slice(0, 4).map((t) => `<span class="tag">${esc(t.replace(/_/g, " "))}</span>`).join("");
    m.bindPopup(`<div class="hp">
        <div class="hp-name">${esc(h.name)}</div>
        <div class="hp-meta">${esc(h.area || "")} · ${esc(h.type || "")}${h.distance_km != null ? ` · <b>${h.distance_km} km</b>` : ""}</div>
        ${h.careTeam ? `<div class="hp-care">Your doctor works here</div>` : ""}
        <div class="hp-tags">${tags}</div>
        <div class="hp-actions"><a class="btn btn-primary" href="${esc(h.maps)}" target="_blank" rel="noopener">Directions</a>
          ${h.phone ? `<a class="btn" href="tel:${esc(h.phone)}">Call</a>` : `<span class="small muted">Phone not yet listed</span>`}</div>
      </div>`, { maxWidth: 260 });
    m.on("click", () => onSelect && onSelect(h.id));
    pins[h.id] = { marker: m, h };
    bounds.push([h.lat, h.lng]);
  });
  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });

  let route = null;
  function select(id) {
    if (route) { route.remove(); route = null; }
    const p = pins[id]; if (!p) return;
    route = L.polyline([[user.lat, user.lng], [p.h.lat, p.h.lng]], { color: "#0F766E", weight: 5, opacity: 0.85, dashArray: "1 9", lineCap: "round" }).addTo(map);
    p.marker.openPopup();
    map.fitBounds([[user.lat, user.lng], [p.h.lat, p.h.lng]], { padding: [60, 60], maxZoom: 15 });
  }
  return { select, resize: () => map.invalidateSize(), destroy: () => map.remove() };
}
