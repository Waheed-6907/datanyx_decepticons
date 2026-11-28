// Anatomical 3D view: a sculpted liver (Couinaud segments) and lungs (five lobes) with the cyst placed
// where the doctor or the report says it is. Click any part of the organ to mark the location.
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/OrbitControls.js";

// Couinaud segment seeds in the liver's own frame (patient's right = negative x, as seen by the viewer)
export const SEG_SEEDS = {
  I: [-0.2, 0.05, -0.36], II: [0.52, 0.18, 0.02], III: [0.56, -0.12, 0.06], IVa: [0.02, 0.22, 0.1], IVb: [0.0, -0.14, 0.16],
  V: [-0.5, -0.18, 0.2], VI: [-0.86, -0.22, -0.06], VII: [-0.82, 0.22, -0.24], VIII: [-0.48, 0.3, 0.08],
};
export const LOBE_SEEDS = {
  RUL: [-0.5, 0.5, 0.02], RML: [-0.58, 0.04, 0.14], RLL: [-0.46, -0.42, -0.06], LUL: [0.46, 0.48, 0.0], LLL: [0.5, -0.36, -0.04],
};
export const SEG_NAME = { I: "Segment I (caudate)", II: "Segment II", III: "Segment III", IVa: "Segment IVa", IVb: "Segment IVb",
  V: "Segment V", VI: "Segment VI", VII: "Segment VII", VIII: "Segment VIII" };
export const LOBE_NAME = { RUL: "Right upper lobe", RML: "Right middle lobe", RLL: "Right lower lobe", LUL: "Left upper lobe", LLL: "Left lower lobe" };
const SEG_BASE = ["#8f3d2f", "#93432f", "#8a3a2c", "#944031", "#8c3d30", "#8e3b2d", "#913f2f", "#88392b", "#923e30"];

const PHASE_COL = { CL: 0xcbd5e1, CE1: 0xfb7185, CE2: 0xf97316, CE3a: 0xfbbf24, CE3b: 0xf59e0b, CE4: 0x94a3b8, CE5: 0xe2e8f0 };

// smooth pseudo-noise (no texture needed)
function n3(x, y, z, s) {
  return Math.sin(x * 2.1 + s) * Math.cos(y * 2.7 + s * 1.3) * Math.sin(z * 2.3 + s * 0.7) * 0.6
    + Math.sin(x * 5.3 - z * 4.1 + s) * 0.25 + Math.cos(y * 6.1 + x * 2.2) * 0.15;
}
function sculpt(geo, fn, amp, seed) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const q = fn(v.clone());
    const k = amp * n3(q.x, q.y, q.z, seed);
    q.addScaledVector(q.clone().normalize(), k);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  geo.computeVertexNormals();
  return geo;
}
// a soft fibrous surface bump, shared by the organs
function bumpTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"), img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const x = (i / 4) % 256, y = Math.floor(i / 4 / 256);
    const v = 128 + 40 * Math.sin(x * 0.35) * Math.cos(y * 0.27) + 26 * Math.sin((x + y) * 0.9) + (Math.random() - 0.5) * 36;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
}
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.25, "rgba(255,240,200,0.45)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// liver: one sculpted mesh; right lobe larger, left lobe thinner, sagging at the front
const liverFn = (v) => {
  const x = v.x < 0 ? v.x * 1.14 : v.x * 0.74;
  return new THREE.Vector3(x, v.y * 0.5 * (1 - 0.12 * Math.abs(x)), v.z * 0.6 + 0.04 * x);
};
function buildLiver(bump) {
  const geo = sculpt(new THREE.SphereGeometry(1, 120, 80), liverFn, 0.035, 3);
  const pos = geo.attributes.position, n = pos.count;
  const segId = new Float32Array(n), keys = Object.keys(SEG_SEEDS), colors = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    let best = 0, bd = 1e9;
    keys.forEach((k, j) => { const s = SEG_SEEDS[k], d = (v.x - s[0]) ** 2 + (v.y - s[1]) ** 2 + (v.z - s[2]) ** 2; if (d < bd) { bd = d; best = j; } });
    segId[i] = best;
  }
  geo.setAttribute("segId", new THREE.BufferAttribute(segId, 1));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.32,
    sheen: 0.35, sheenColor: new THREE.Color("#f0a08c"), sheenRoughness: 0.5, bumpMap: bump, bumpScale: 0.6, transparent: true, opacity: 0.66, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.kind = "liver";
  return { mesh, keys, segId };
}

function buildLungs(bump) {
  const group = new THREE.Group();
  const lobes = {};
  const dims = { RUL: [0.42, 0.34, 0.36], RML: [0.3, 0.2, 0.3], RLL: [0.4, 0.42, 0.38], LUL: [0.36, 0.42, 0.36], LLL: [0.38, 0.4, 0.38] };
  Object.entries(dims).forEach(([k, [rx, ry, rz]], i) => {
    const right = k.startsWith("R");
    const fn = (v) => {
      let x = v.x * rx, y = v.y * ry, z = v.z * rz;
      if (right ? x > 0 : x < 0) x *= 0.82; // flatter on the side facing the heart
      return new THREE.Vector3(x, y, z);
    };
    const geo = sculpt(new THREE.SphereGeometry(1, 96, 64), fn, 0.04, 5 + i);
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#e89c93"), roughness: 0.62, sheen: 0.5,
      sheenColor: new THREE.Color("#ffd3cc"), sheenRoughness: 0.6, bumpMap: bump, bumpScale: 0.8, clearcoat: 0.15, transparent: true, opacity: 0.6, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...LOBE_SEEDS[k]);
    m.castShadow = m.receiveShadow = true;
    m.userData.kind = "lobe"; m.userData.lobe = k;
    group.add(m); lobes[k] = m;
  });
  // airways: trachea and main bronchi
  const air = new THREE.MeshStandardMaterial({ color: 0xf1e6dc, roughness: 0.7 });
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, r, 14), air);
  group.add(tube([[0, 1.1, -0.04], [0, 0.7, -0.04], [0, 0.62, -0.05]], 0.06));
  group.add(tube([[0, 0.62, -0.05], [-0.3, 0.46, -0.03], [-0.44, 0.0, -0.04]], 0.04));
  group.add(tube([[0, 0.62, -0.05], [0.3, 0.42, -0.03], [0.46, 0.05, -0.04]], 0.04));
  return { group, lobes };
}

function buildTorso() {
  const prof = [[0.0, -1.6], [0.62, -1.55], [0.7, -1.22], [0.62, -0.75], [0.58, -0.3], [0.66, 0.2], [0.74, 0.7], [0.82, 1.0], [0.78, 1.18], [0.42, 1.32], [0.2, 1.38], [0.0, 1.4]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(prof, 72);
  geo.scale(1, 1, 0.55);
  const shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.18 }));
  const g = new THREE.Group(); g.add(shell, edges); return g;
}

// the cyst: looks different at each WHO stage, scaled to its size
function rngOf(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function buildCyst(stage, r, seed) {
  const g = new THREE.Group(), rnd = rngOf(seed);
  const fluid = new THREE.MeshPhysicalMaterial({ color: 0xdff6ff, transmission: 0.9, roughness: 0.06, thickness: r, ior: 1.33, transparent: true, opacity: 0.95 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, transparent: true, opacity: 0.9 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf1e7c8, roughness: 0.55, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const solid = new THREE.MeshStandardMaterial({ color: 0xe9dfc2, roughness: 0.6 });
  const calc = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.4, metalness: 0.02 });
  const add = (geo, mat, p = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.castShadow = true; g.add(m); return m; };
  const blob = (rad, amp, s) => sculpt(new THREE.SphereGeometry(rad, 48, 32), (v) => v, amp, s);
  const inside = (count, rad, spread) => { for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    add(new THREE.SphereGeometry(rad * (0.8 + rnd() * 0.4), 20, 14), cream, [Math.cos(a) * rr * spread, u * spread, Math.sin(a) * rr * spread]); } };

  if (stage === "CL") {
    add(new THREE.SphereGeometry(r, 64, 48), fluid);
  } else if (stage === "CE1") {
    add(new THREE.SphereGeometry(r, 64, 48), fluid);
    add(new THREE.SphereGeometry(r * 1.01, 64, 48), wall).material.side = THREE.BackSide;
    inside(7, r * 0.2, r * 0.55);                              // daughter vesicles
  } else if (stage === "CE2") {
    add(new THREE.SphereGeometry(r, 64, 48), fluid);
    inside(46, r * 0.17, r * 0.72);                            // honeycomb
  } else if (stage === "CE3a") {
    add(new THREE.SphereGeometry(r, 64, 48), fluid);
    add(new THREE.SphereGeometry(r * 1.01, 64, 48), wall).material.side = THREE.BackSide;
    add(blob(r * 0.78, 0.18, 9), cream, [0, r * 0.22, 0]);      // detached membrane floating up (water-lily sign)
  } else if (stage === "CE3b") {
    add(new THREE.SphereGeometry(r, 64, 48), fluid);
    add(blob(r * 0.7, 0.2, 4), cream, [r * 0.1, -r * 0.15, 0]);
    add(blob(r * 0.55, 0.22, 11), cream, [-r * 0.15, r * 0.3, r * 0.1]);
  } else if (stage === "CE4") {
    add(blob(r, 0.1, 13), solid);
    add(blob(r * 0.6, 0.15, 17), cream, [0, 0, 0]);
  } else { // CE5: calcified
    add(blob(r, 0.14, 21), calc);
  }
  return g;
}

export function createAnatomyViewer(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement);
  const overlay = document.createElement("div"); overlay.className = "anat-labels"; el.appendChild(overlay);
  const tag = document.createElement("div"); tag.className = "anat-tag"; overlay.appendChild(tag);
  const hint = document.createElement("div"); hint.className = "anat-hint"; hint.textContent = "Drag to turn · click the organ to mark where the cyst is"; el.appendChild(hint);

  const scene = new THREE.Scene();
  // studio lighting from a generated environment map (realistic reflections without any external asset)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene(); env.background = new THREE.Color(0x0b1220);
  env.add(new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshBasicMaterial({ color: 0x1b2a40, side: THREE.BackSide })));
  [[0, 6, 5, 6, 3], [-7, 2, -1, 3, 4], [6, -1, 2, 2, 5]].forEach(([x, y, z, w, h]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xfff4e6, side: THREE.DoubleSide }));
    p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p);
  });
  scene.environment = pmrem.fromScene(env, 0.035).texture;
  scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x0b1220, 0.35));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.6); key.position.set(3, 4.5, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5; key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5; key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9bd3ff, 0.45); fill.position.set(-4, 2, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x67e8f9, 1.1); rim.position.set(0, 3, -5); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.7; floor.receiveShadow = true; scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  camera.position.set(0, 0.25, opts.distance || 3.7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-0.12, 0.03, 0); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2.2; controls.maxDistance = 8; controls.autoRotate = true; controls.autoRotateSpeed = 0.6;
  let idleAt = 0; controls.addEventListener("start", () => { controls.autoRotate = false; idleAt = performance.now(); });

  const bump = bumpTexture();
  const torso = buildTorso(); scene.add(torso);
  const liverPack = buildLiver(bump); const liver = new THREE.Group(); liver.add(liverPack.mesh);
  // gall bladder and vessels, for orientation
  const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 10, 20), new THREE.MeshPhysicalMaterial({ color: 0x4d6b2e, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 0.92 }));
  gb.position.set(-0.22, -0.4, 0.2); gb.rotation.z = 0.5; liver.add(gb);
  const vein = (pts, r, col) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 40, r, 14),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.05 }));
  liver.add(vein([[-0.25, 0.55, -0.42], [-0.22, 0.0, -0.45], [-0.25, -0.5, -0.4]], 0.07, 0x3b5bdb));  // IVC
  liver.add(vein([[0.05, -0.2, 0.08], [-0.25, 0.02, 0.0], [-0.6, 0.06, -0.05]], 0.05, 0x7c3aed));     // portal branches
  scene.add(liver);
  const lungs = buildLungs(bump); scene.add(lungs.group);
  lungs.group.visible = false;

  const cystRoot = new THREE.Group(); scene.add(cystRoot);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1c2, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(glow);

  // label pills for every region
  const labels = {};
  const mkLabel = (text) => { const d = document.createElement("div"); d.className = "anat-pill"; d.textContent = text; overlay.appendChild(d); return d; };
  Object.keys(SEG_SEEDS).forEach((k) => (labels["seg:" + k] = mkLabel(k)));
  Object.keys(LOBE_SEEDS).forEach((k) => (labels["lobe:" + k] = mkLabel(k)));

  // centroids of each liver segment (from the actual sculpted surface)
  const segCentre = {};
  { const pos = liverPack.mesh.geometry.attributes.position, acc = {};
    for (let i = 0; i < pos.count; i++) { const s = liverPack.keys[liverPack.segId[i]]; const a = acc[s] || (acc[s] = [0, 0, 0, 0]);
      a[0] += pos.getX(i); a[1] += pos.getY(i); a[2] += pos.getZ(i); a[3]++; }
    Object.entries(acc).forEach(([s, a]) => (segCentre[s] = new THREE.Vector3(a[0] / a[3], a[1] / a[3], a[2] / a[3]))); }
  const lobeCentre = (k) => new THREE.Vector3(...LOBE_SEEDS[k]);

  // colour the liver by segment; highlight the ones the doctor picked
  const segBase = liverPack.keys.map((k, j) => new THREE.Color(SEG_BASE[j % SEG_BASE.length]));
  const hotCol = new THREE.Color("#ffb36b");
  let hotSeg = [];
  function paintLiver() {
    const col = liverPack.mesh.geometry.attributes.color, sid = liverPack.segId, c = new THREE.Color();
    for (let i = 0; i < sid.length; i++) {
      const j = sid[i], k = liverPack.keys[j];
      c.copy(segBase[j]);
      if (hotSeg.includes(k)) c.lerp(hotCol, 0.5);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
  let hotLobe = null;
  function paintLungs() {
    Object.entries(lungs.lobes).forEach(([k, m]) => {
      const on = k === hotLobe;
      m.material.color.set(on ? "#ffb9a8" : "#e89c93");
      m.material.emissive = new THREE.Color(on ? "#3a1410" : "#000000");
    });
  }

  paintLiver(); paintLungs();
  let organ = "liver", stage = "CE1", size = 5, cystR = 0.2, target = new THREE.Vector3(-0.5, 0.05, 0.1), locName = "location not stated";
  let cyst = null, cystStage = null, cystRadius = 0;
  function rebuildCyst() {
    cystRoot.clear();
    cyst = buildCyst(stage, cystR, 7);
    cystRoot.add(cyst);
    cystStage = stage; cystRadius = cystR;
  }
  const radiusFor = (cm) => Math.min(0.42, Math.max(0.09, (cm || 5) * 0.06));

  function set({ organ: o = "liver", stage: st = "CE1", size: sz = 5, segment = null, lobe = null, depth = "central" } = {}) {
    organ = o === "lung" ? "lung" : "liver";
    stage = st; size = sz || 5; cystR = radiusFor(size);
    liver.visible = organ === "liver"; lungs.group.visible = organ === "lung";
    hotSeg = segment && SEG_SEEDS[segment] ? [segment] : [];
    hotLobe = lobe && LOBE_SEEDS[lobe] ? lobe : null;
    paintLiver(); paintLungs();
    let p;
    if (organ === "liver") p = hotSeg.length ? segCentre[hotSeg[0]].clone() : new THREE.Vector3(-0.2, 0.0, 0.1);
    else p = hotLobe ? lobeCentre(hotLobe) : new THREE.Vector3(-0.45, 0.0, 0.0);
    // depth: near the surface or deep in the organ, measured from the organ centre
    const outward = p.clone().normalize().multiplyScalar(depth === "superficial" ? 0.13 : depth === "deep" ? -0.12 : 0);
    target = p.add(outward);
    locName = organ === "liver"
      ? (hotSeg.length ? SEG_NAME[hotSeg[0]] : (segment ? "Liver (" + segment + ")" : "segment not stated"))
      : (hotLobe ? LOBE_NAME[hotLobe] : "lobe not stated");
    if (!cyst || cystStage !== stage || Math.abs(cystRadius - cystR) > 0.01) rebuildCyst();
    tag.innerHTML = `<b style="color:${"#" + (PHASE_COL[stage] || 0xffffff).toString(16).padStart(6, "0")}">${stage}</b> · ${size ? size + " cm" : "size not stated"} · ${locName}`;
    if (!segment && organ === "liver" || (!lobe && organ === "lung")) tag.innerHTML += ` <span class="anat-approx">· approximate position</span>`;
  }

  // click to mark the location
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const objs = organ === "liver" ? [liverPack.mesh] : Object.values(lungs.lobes);
    const hit = ray.intersectObjects(objs, false)[0];
    if (!hit || !opts.onPick) return;
    if (hit.object.userData.kind === "lobe") return opts.onPick({ organ: "lung", lobe: hit.object.userData.lobe });
    const local = liver.worldToLocal(hit.point.clone());
    let best = null, bd = 1e9;
    Object.entries(SEG_SEEDS).forEach(([k, s]) => { const d = (local.x - s[0]) ** 2 + (local.y - s[1]) ** 2 + (local.z - s[2]) ** 2; if (d < bd) { bd = d; best = k; } });
    opts.onPick({ organ: "liver", segment: best });
  });

  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el); resize();
  let visible = true; new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(el);
  const clock = new THREE.Clock(), v = new THREE.Vector3();
  const cystPos = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (!visible || !el.offsetParent) return;
    if (!controls.autoRotate && performance.now() - idleAt > 7000) controls.autoRotate = true;
    const t = clock.getElapsedTime(); controls.update();
    cystPos.lerp(target, 0.12); cystRoot.position.copy(cystPos);
    const s = 1 + 0.03 * Math.sin(t * 2.2);
    cystRoot.scale.setScalar(s);
    glow.position.copy(cystPos); glow.scale.setScalar(cystR * 4.2 * (1 + 0.08 * Math.sin(t * 3)));
    glow.material.opacity = 0.35 + 0.15 * Math.sin(t * 3);
    const w = el.clientWidth, h = el.clientHeight;
    // labels follow the organ
    const showLabels = (list, prefix, centres) => list.forEach((k) => {
      const d = labels[prefix + k]; const c = centres(k);
      d.style.display = (prefix === "seg:") === (organ === "liver") ? "" : "none";
      const sel = prefix === "seg:" ? hotSeg.includes(k) : hotLobe === k;
      d.classList.toggle("on", sel);
      v.copy(c).applyMatrix4(prefix === "seg:" ? liver.matrixWorld : scene.matrixWorld).project(camera);
      d.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    });
    showLabels(Object.keys(SEG_SEEDS), "seg:", (k) => segCentre[k] || new THREE.Vector3(...SEG_SEEDS[k]));
    showLabels(Object.keys(LOBE_SEEDS), "lobe:", (k) => lobeCentre(k));
    v.copy(cystPos).project(camera);
    tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h - 16}px) translate(-50%, -100%)`;
    renderer.render(scene, camera);
  });
  return { set, destroy: () => { renderer.setAnimationLoop(null); renderer.dispose(); el.innerHTML = ""; } };
}

// what each WHO stage looks like inside, for the patient and the doctor
export const STAGE_DETAIL = {
  CL: { title: "Simple cystic lesion", inside: "Clear fluid. No wall or daughter cysts seen yet.", note: "Could be hydatid or another cyst, so it needs confirmation." },
  CE1: { title: "Unilocular cyst with daughter vesicles", inside: "A fluid-filled cyst with a thick wall and small daughter vesicles inside.", note: "Active stage." },
  CE2: { title: "Multivesicular (honeycomb) cyst", inside: "Many small cysts packed together inside, like a honeycomb.", note: "Active stage." },
  CE3a: { title: "Detached membrane (water-lily sign)", inside: "The inner membrane has peeled away and floats in the fluid.", note: "Transitional stage: the cyst is starting to fail." },
  CE3b: { title: "Multiple detached membranes", inside: "Several torn membranes float in the fluid, with some solid material.", note: "Transitional stage." },
  CE4: { title: "Solid, inactive cyst", inside: "Mostly solid tissue. The fluid has been replaced.", note: "Inactive stage." },
  CE5: { title: "Calcified, dead cyst", inside: "The wall and contents have calcified.", note: "Inactive stage: usually no active treatment is needed." },
};
