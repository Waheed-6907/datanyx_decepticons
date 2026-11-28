// Procedural 3D hydatid cyst models, one per WHO-IWGE stage (three.js).
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/OrbitControls.js";
import { toXray } from "/static/xray.js";

const PHASE_COLOR = { CL: 0x64748b, CE1: 0xdc4b3e, CE2: 0xdc4b3e, CE3a: 0xd97706, CE3b: 0xd97706, CE4: 0x2563eb, CE5: 0x2563eb };

// deterministic random so every viewer draws the same cyst
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function shell(r, color, opacity, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity, roughness: opts.rough ?? 0.25, metalness: 0,
    clearcoat: 0.6, side: opts.side ?? THREE.DoubleSide, depthWrite: opacity > 0.6, flatShading: !!opts.flat,
  });
  const g = opts.geo || new THREE.SphereGeometry(r, 64, 48);
  return new THREE.Mesh(g, m);
}

function daughters(group, n, rMin, rMax, spread, color, opacity, seed) {
  const R = rng(seed), placed = [];
  let tries = 0;
  while (placed.length < n && tries++ < 800) {
    const r = rMin + R() * (rMax - rMin);
    const v = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1);
    if (v.length() > 1) continue;
    v.multiplyScalar(spread - r);
    if (placed.some((p) => p.v.distanceTo(v) < (p.r + r) * 0.92)) continue;
    placed.push({ v, r });
    const s = shell(r, color, opacity, { rough: 0.15 });
    s.position.copy(v);
    group.add(s);
  }
  return placed;
}

function lumpy(r, amp, seed, detail = 5) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const R = rng(seed), p = g.attributes.position, v = new THREE.Vector3();
  const f = [R() * 5, R() * 5, R() * 5];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 6 + f[0]) * Math.cos(v.y * 5 + f[1]) * Math.sin(v.z * 7 + f[2]);
    v.multiplyScalar(1 + amp * n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildStage(stage) {
  const g = new THREE.Group();
  const notes = []; // {pos: Vector3, label}
  const anim = [];  // per-frame callbacks (t) => {}
  const fluid = 0x7dd3fc;

  if (stage === "CL") {
    g.add(shell(1, fluid, 0.28));
    notes.push({ pos: new THREE.Vector3(0.75, 0.6, 0.3), label: "Uniform fluid, no visible wall" });
  }

  if (stage === "CE1") {
    g.add(shell(1, 0xf1f5f9, 0.22));
    g.add(shell(0.93, fluid, 0.3));
    const R = rng(11), pts = [];
    for (let i = 0; i < 420; i++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.72;
      pts.push(Math.cos(a) * rr, -0.82 + R() * 0.25 + rr * rr * 0.35, Math.sin(a) * rr);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const sand = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfefce8, size: 0.035, transparent: true, opacity: 0.95 }));
    g.add(sand);
    anim.push((t) => { sand.position.y = Math.sin(t * 1.4) * 0.03; sand.rotation.y = t * 0.15; });
    notes.push({ pos: new THREE.Vector3(0.98, 0.25, 0.2), label: "Double-line wall" });
    notes.push({ pos: new THREE.Vector3(0.2, -0.75, 0.35), label: "Hydatid sand (snowflake sign)" });
  }

  if (stage === "CE2") {
    g.add(shell(1, 0xf1f5f9, 0.2));
    const d = daughters(g, 16, 0.17, 0.3, 0.95, 0x93c5fd, 0.55, 7);
    anim.push((t) => g.children.slice(1).forEach((m, i) => m.scale.setScalar(1 + 0.025 * Math.sin(t * 2 + i))));
    notes.push({ pos: d[0].v.clone(), label: "Daughter cysts" });
    notes.push({ pos: new THREE.Vector3(-0.7, 0.65, 0.2), label: "Honeycomb / septations" });
  }

  if (stage === "CE3a") {
    g.add(shell(1, 0xf1f5f9, 0.2));
    g.add(shell(0.96, fluid, 0.18));
    const geo = new THREE.CircleGeometry(0.78, 72, 0, Math.PI * 2);
    const base = geo.attributes.position.array.slice();
    const mem = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfde68a, side: THREE.DoubleSide, roughness: 0.6, transparent: true, opacity: 0.92 }));
    mem.rotation.x = -Math.PI / 2.6;
    g.add(mem);
    anim.push((t) => {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        p.setZ(i, 0.16 * Math.sin(x * 5 + t * 1.6) * Math.cos(y * 4 + t * 1.1) + 0.08 * Math.sin((x + y) * 9 + t * 2));
      }
      p.needsUpdate = true; geo.computeVertexNormals();
    });
    notes.push({ pos: new THREE.Vector3(0.45, 0.15, 0.35), label: "Detached membrane (water-lily sign)" });
  }

  if (stage === "CE3b") {
    g.add(shell(1, 0xf1f5f9, 0.2));
    const matrix = shell(0.94, 0xe7d3a8, 0.62, { geo: lumpy(0.9, 0.04, 5, 4), rough: 0.8 });
    g.add(matrix);
    const d = daughters(g, 9, 0.16, 0.27, 0.92, 0x7dd3fc, 0.75, 21);
    notes.push({ pos: d[0].v.clone(), label: "Daughter cysts" });
    notes.push({ pos: new THREE.Vector3(-0.6, -0.5, 0.45), label: "Solid matrix" });
  }

  if (stage === "CE4") {
    g.add(shell(1, 0xf1f5f9, 0.18));
    g.add(shell(0.93, 0xe9dcc0, 0.5, { geo: lumpy(0.9, 0.05, 9, 4), rough: 0.9 }));
    const R = rng(33), wool = new THREE.Group();
    for (let k = 0; k < 7; k++) {
      const pts = [];
      for (let j = 0; j < 9; j++) pts.push(new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).multiplyScalar(0.62));
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.03, 8, true);
      wool.add(new THREE.Mesh(tube, new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 })));
    }
    g.add(wool);
    anim.push((t) => { wool.rotation.y = t * 0.12; wool.rotation.x = Math.sin(t * 0.3) * 0.2; });
    notes.push({ pos: new THREE.Vector3(0.3, 0.35, 0.4), label: "Ball-of-wool content" });
    notes.push({ pos: new THREE.Vector3(-0.8, -0.3, 0.3), label: "No daughter cysts" });
  }

  if (stage === "CE5") {
    const calc = shell(1, 0xf5f5f4, 1, { geo: lumpy(1, 0.06, 4, 5), rough: 0.95, flat: true, side: THREE.FrontSide });
    calc.material.transparent = false;
    calc.material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.25)];
    g.add(calc);
    const inner = new THREE.Mesh(lumpy(0.86, 0.05, 8, 4), new THREE.MeshStandardMaterial({ color: 0xc8b89a, roughness: 1, clippingPlanes: calc.material.clippingPlanes }));
    g.add(inner);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }));
    rim.position.z = 0.25; g.add(rim);
    notes.push({ pos: new THREE.Vector3(0.8, 0.55, 0.25), label: "Egg-shell calcified wall" });
    notes.push({ pos: new THREE.Vector3(-0.2, -0.2, 0.3), label: "Solid inactive content (cut-away)" });
  }
  return { group: g, notes, anim };
}

const sizeScale = (cm) => (cm ? Math.min(1.35, Math.max(0.65, 0.6 + cm * 0.06)) : 1);

export function createCystViewer(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  el.appendChild(renderer.domElement);
  const overlay = document.createElement("div");
  overlay.className = "c3d-notes";
  el.appendChild(overlay);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  camera.position.set(0, 0.6, opts.distance || 4.2);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 5); scene.add(key);
  const back = new THREE.DirectionalLight(0x99f6e4, 1.2); back.position.set(-4, -1, -3); scene.add(back);

  const glow = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.55 }));
  glow.rotation.x = Math.PI / 2; glow.position.y = -1.08; scene.add(glow);
  const glow2 = glow.clone(); glow2.material = glow.material.clone(); glow2.material.opacity = 0.25; glow2.scale.setScalar(1.12); scene.add(glow2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2.4; controls.maxDistance = 7;
  controls.autoRotate = opts.autoRotate !== false; controls.autoRotateSpeed = 1.4;
  if (opts.interactive === false) { controls.enabled = false; }

  let cur = null, curStage = null, target = 1, scaleNow = 0.001, swap = null, showNotes = opts.notes !== false, xray = !!opts.xray, lastSize = null;
  el.classList.toggle("xray", xray);
  const clock = new THREE.Clock();

  function setStage(stage, sizeCm) {
    target = sizeScale(sizeCm); lastSize = sizeCm;
    if (stage === curStage) return;
    curStage = stage;
    swap = buildStage(stage);
    if (xray) toXray(swap.group);
    glow.material.color.setHex(PHASE_COLOR[stage]); glow2.material.color.setHex(PHASE_COLOR[stage]);
    if (!cur) { cur = swap; swap = null; cur.group.scale.setScalar(0.001); cur.group.position.x = 0; scene.add(cur.group); renderNotes(); }
  }
  function setSize(cm) { target = sizeScale(cm); lastSize = cm; }
  function setXray(on) {
    if (on === xray) return;
    xray = on; el.classList.toggle("xray", on);
    const s = curStage; curStage = null;
    if (s) setStage(s, lastSize);
  }
  function setNotes(on) { showNotes = on; renderNotes(); }

  function renderNotes() {
    overlay.innerHTML = "";
    if (!cur || !showNotes) return;
    cur.notes.forEach((n) => { const d = document.createElement("div"); d.className = "c3d-note"; d.textContent = n.label; overlay.appendChild(d); n.el = d; });
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight || w;
    if (!w) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el); resize();

  let visible = true;
  new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(el);
  const v = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    if (!visible || !el.offsetParent) return;
    const t = clock.getElapsedTime();
    controls.update();
    glow.rotation.z = t * 0.3; glow2.material.opacity = 0.18 + 0.12 * Math.sin(t * 2);
    if (swap && cur) {
      // slide old model out to the left while shrinking, then bring the new one in from the right
      cur.group.position.x -= 0.18; cur.group.scale.multiplyScalar(0.86);
      if (cur.group.scale.x < 0.05) {
        scene.remove(cur.group); cur = swap; swap = null;
        cur.group.scale.setScalar(0.001); cur.group.position.x = 2.4; scene.add(cur.group); renderNotes();
      }
    } else if (cur) {
      cur.group.position.x += (0 - cur.group.position.x) * 0.12;
      scaleNow = cur.group.scale.x + (target - cur.group.scale.x) * 0.1;
      cur.group.scale.setScalar(scaleNow);
      cur.anim.forEach((f) => f(t));
      cur.group.position.y = Math.sin(t * 1.2) * 0.04;
      if (showNotes) {
        const w = el.clientWidth, h = el.clientHeight;
        cur.notes.forEach((n) => {
          if (!n.el) return;
          v.copy(n.pos).multiplyScalar(cur.group.scale.x).add(cur.group.position).project(camera);
          const behind = v.z > 1;
          const nx = (v.x * 0.5 + 0.5) * w, ny = (-v.y * 0.5 + 0.5) * h, flip = nx > w * 0.58;
          n.el.classList.toggle("flip", flip);
          n.el.style.transform = `translate(${flip ? nx - n.el.offsetWidth - 20 : nx}px, ${ny}px)`;
          n.el.style.opacity = behind || Math.abs(cur.group.position.x) > 0.1 ? 0 : 1;
        });
      }
    }
    renderer.render(scene, camera);
  });
  return { setStage, setSize, setNotes, setXray, controls };
}
