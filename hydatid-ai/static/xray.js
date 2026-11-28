// X-ray / hologram rendering: fresnel glow material + a translucent human body
// showing where the cyst sits (liver, lung or other organ).
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/OrbitControls.js";

export const PHASE_HEX = { CL: 0x94a3b8, CE1: 0xff5a4e, CE2: 0xff5a4e, CE3a: 0xffa630, CE3b: 0xffa630, CE4: 0x4f8dff, CE5: 0x4f8dff };

const VERT = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const FRAG = `uniform vec3 color; uniform float power; uniform float intensity; uniform float base;
varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power); float a = clamp(f*intensity + base, 0.0, 1.0); gl_FragColor = vec4(color * (f*intensity + base), a); }`;

export function xrayMat(color, { power = 2.2, intensity = 1.0, base = 0.03 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: power }, intensity: { value: intensity }, base: { value: base } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/* convert any normal three.js model into its X-ray version (in place) */
export function toXray(group, tint = 0x7dd3fc) {
  group.traverse((o) => {
    if (o.isPoints) { o.material = new THREE.PointsMaterial({ color: 0xe0f7ff, size: 0.04, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }); return; }
    if (!o.isMesh) return;
    const old = o.material, col = old.color ? old.color.clone() : new THREE.Color(tint);
    // keep each part's own hue, push it towards the cyan X-ray palette
    const c = col.lerp(new THREE.Color(tint), 0.35);
    const solid = old.opacity === undefined || old.opacity > 0.55;
    o.material = xrayMat(c, { power: solid ? 1.6 : 2.4, intensity: solid ? 1.25 : 1.05, base: solid ? 0.07 : 0.02 });
  });
}

/* ---------------- body ---------------- */
function lumpy(geo, amp, seed) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 5 + seed) * Math.cos(v.y * 4 + seed * 2) * Math.sin(v.z * 6 + seed * 3);
    v.multiplyScalar(1 + amp * n); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals(); return geo;
}

function buildBody() {
  const body = new THREE.Group();
  const skin = xrayMat(0x38bdf8, { power: 2.6, intensity: 0.9, base: 0.0 });
  // torso from a lathe profile (y up), flattened front-to-back
  const prof = [[0.0, -1.55], [0.62, -1.5], [0.7, -1.2], [0.62, -0.75], [0.58, -0.3], [0.66, 0.2], [0.74, 0.7], [0.82, 1.0], [0.78, 1.18], [0.42, 1.32], [0.2, 1.38], [0.0, 1.4]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), skin);
  torso.scale.set(1, 1, 0.55); body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 32, 1, true), skin); neck.position.y = 1.52; body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 48, 32), skin); head.scale.set(0.88, 1.08, 0.95); head.position.y = 1.95; body.add(head);
  [-1, 1].forEach((s) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1.05, 8, 24), skin);
    arm.position.set(s * 0.97, 0.55, 0); arm.rotation.z = s * 0.18; body.add(arm);
  });
  // skeleton
  const bone = xrayMat(0xe0f2fe, { power: 1.8, intensity: 0.85, base: 0.03 });
  for (let i = 0; i < 17; i++) {
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 16), bone);
    v.position.set(0, 1.25 - i * 0.155, -0.24); body.add(v);
  }
  for (let i = 0; i < 9; i++) {
    const y = 1.08 - i * 0.12, w = 0.5 + Math.sin(((i + 1) / 10) * Math.PI) * 0.18;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1, 0.016, 8, 64, Math.PI * 1.62), bone);
    rib.rotation.x = Math.PI / 2; rib.scale.set(w, 0.36, 1);
    const holder = new THREE.Group(); holder.add(rib);
    holder.rotation.y = 0.98; holder.rotation.x = -0.18; holder.position.set(0, y, -0.02);
    // wrapper keeps the open end of each rib at the spine, then a tilt makes them slope down
    const tilt = new THREE.Group(); tilt.add(holder); body.add(tilt);
  }
  const pelvis = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 12, 48, Math.PI), bone);
  pelvis.position.set(0, -1.15, -0.05); pelvis.rotation.x = Math.PI / 2.4; pelvis.rotation.z = Math.PI; body.add(pelvis);
  [-1, 1].forEach((s) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), bone); c.rotation.z = Math.PI / 2 + s * 0.12; c.position.set(s * 0.33, 1.16, 0.12); body.add(c); });

  // organs (patient's right = viewer's left, the camera looks at the front)
  const organs = {};
  const lungMat = () => xrayMat(0x93c5fd, { power: 2.0, intensity: 0.7, base: 0.02 });
  organs.lungR = new THREE.Mesh(lumpy(new THREE.SphereGeometry(0.27, 48, 32), 0.05, 1), lungMat());
  organs.lungR.scale.set(1, 1.75, 0.95); organs.lungR.position.set(-0.3, 0.72, 0.02);
  organs.lungL = new THREE.Mesh(lumpy(new THREE.SphereGeometry(0.25, 48, 32), 0.05, 2), lungMat());
  organs.lungL.scale.set(1, 1.7, 0.95); organs.lungL.position.set(0.32, 0.7, 0.02);
  organs.heart = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 24), xrayMat(0xfb7185, { power: 1.8, intensity: 0.8 }));
  organs.heart.scale.set(1, 1.2, 0.9); organs.heart.position.set(0.08, 0.5, 0.12);
  const liverGeo = lumpy(new THREE.SphereGeometry(0.5, 64, 48), 0.06, 3);
  organs.liver = new THREE.Mesh(liverGeo, xrayMat(0xf59e0b, { power: 1.7, intensity: 0.8, base: 0.02 }));
  organs.liver.scale.set(1.15, 0.5, 0.62); organs.liver.rotation.z = -0.32; organs.liver.position.set(-0.2, 0.0, 0.04);
  organs.spleen = new THREE.Mesh(lumpy(new THREE.SphereGeometry(0.16, 32, 24), 0.08, 4), xrayMat(0xa78bfa, { power: 1.8, intensity: 0.7 }));
  organs.spleen.scale.set(0.8, 1.3, 0.8); organs.spleen.position.set(0.5, 0.05, -0.05);
  organs.kidneyR = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.12, 8, 16), xrayMat(0xc084fc, { power: 1.8, intensity: 0.6 })); organs.kidneyR.position.set(-0.27, -0.38, -0.18);
  organs.kidneyL = organs.kidneyR.clone(); organs.kidneyL.position.x = 0.27;
  const gut = new THREE.Mesh(new THREE.TorusKnotGeometry(0.22, 0.045, 120, 12, 3, 5), xrayMat(0x5eead4, { power: 2.0, intensity: 0.45 }));
  gut.scale.set(1.1, 0.8, 0.5); gut.position.set(0.02, -0.68, 0.05); body.add(gut);
  Object.values(organs).forEach((o) => body.add(o));
  return { body, organs };
}

const SITES = {
  liver: { organ: "liver", pos: new THREE.Vector3(-0.32, 0.03, 0.12), label: "Liver" },
  lung: { organ: "lungR", pos: new THREE.Vector3(-0.3, 0.78, 0.06), label: "Right lung" },
  other: { organ: "spleen", pos: new THREE.Vector3(0.5, 0.05, 0.0), label: "Other organ (e.g. spleen)" },
};

export function createBodyViewer(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const overlay = document.createElement("div"); overlay.className = "c3d-notes"; el.appendChild(overlay);
  const tag = document.createElement("div"); tag.className = "c3d-note xr-tag"; overlay.appendChild(tag);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0.35, opts.distance || 6.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.25, 0);
  controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 9;
  controls.autoRotate = opts.autoRotate !== false; controls.autoRotateSpeed = 1.1;

  const { body, organs } = buildBody(); scene.add(body);

  // scanner beam sweeping up and down
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.012, 64, 1, true), xrayMat(0x22d3ee, { power: 0.6, intensity: 1.1, base: 0.1 }));
  scene.add(beam);
  const floor = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.93, 96), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; scene.add(floor);
  const floor2 = floor.clone(); floor2.material = floor.material.clone(); floor2.scale.setScalar(1.35); floor2.material.opacity = 0.2; scene.add(floor2);

  // the cyst
  const cyst = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), xrayMat(0xffffff, { power: 1.4, intensity: 1.8, base: 0.12 }));
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 24), xrayMat(0xffffff, { power: 3.5, intensity: 0.9, base: 0.0 }));
  cyst.add(shell, core, halo); scene.add(cyst);

  let state = { stage: "CE1", size: 6, organ: "liver" }, rTarget = 0.2, rNow = 0.001, site = SITES.liver;
  const target = site.pos.clone();

  function set({ stage, size, organ } = {}) {
    if (stage) state.stage = stage;
    if (size !== undefined) state.size = size || 6;
    if (organ) state.organ = ["liver", "lung", "other"].includes(organ) ? organ : "liver";
    site = SITES[state.organ]; target.copy(site.pos);
    rTarget = Math.min(0.32, Math.max(0.05, state.size * 0.034));
    const col = new THREE.Color(PHASE_HEX[state.stage] || 0xffffff);
    [shell, halo].forEach((m) => m.material.uniforms.color.value.copy(col)); core.material.color.copy(col);
    Object.entries(organs).forEach(([k, o]) => { const on = k === site.organ; o.material.uniforms.intensity.value = on ? 1.5 : 0.55; });
    tag.innerHTML = `<b>${state.stage}</b> · ${state.size ? state.size + " cm" : "size n/a"} · ${site.label}`;
  }
  set(opts);

  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el); resize();
  let visible = true; new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(el);
  const clock = new THREE.Clock(), v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (!visible || !el.offsetParent) return;
    const t = clock.getElapsedTime();
    controls.update();
    beam.position.y = 0.2 + Math.sin(t * 0.9) * 1.75;
    floor2.material.opacity = 0.12 + 0.1 * Math.sin(t * 2);
    cyst.position.lerp(target, 0.08);
    rNow += (rTarget - rNow) * 0.08;
    const pulse = 1 + 0.06 * Math.sin(t * 3.2);
    cyst.scale.setScalar(rNow * pulse);
    halo.material.uniforms.intensity.value = 0.7 + 0.35 * Math.sin(t * 3.2);
    v.copy(cyst.position); v.x += rNow * 1.2; v.project(camera);
    tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * el.clientWidth}px, ${(-v.y * 0.5 + 0.5) * el.clientHeight}px)`;
    renderer.render(scene, camera);
  });
  return { set, controls };
}

/* ---------------- liver segments (Couinaud, schematic) ---------------- */
// viewer faces the patient: patient's right lobe appears on the viewer's left
const SEGMENTS = {
  VII: { p: [-0.98, 0.26, -0.22], s: [0.36, 0.28, 0.3] }, VIII: { p: [-0.48, 0.3, 0.06], s: [0.36, 0.3, 0.32] },
  IVa: { p: [0.02, 0.24, 0.08], s: [0.26, 0.24, 0.28] }, II: { p: [0.52, 0.2, 0.0], s: [0.3, 0.2, 0.24] },
  VI: { p: [-0.98, -0.16, -0.16], s: [0.34, 0.26, 0.28] }, V: { p: [-0.48, -0.16, 0.1], s: [0.34, 0.27, 0.3] },
  IVb: { p: [0.02, -0.14, 0.12], s: [0.24, 0.22, 0.26] }, III: { p: [0.54, -0.1, 0.06], s: [0.28, 0.18, 0.22] },
  I: { p: [-0.2, 0.04, -0.34], s: [0.16, 0.18, 0.14] },
};
const LOBES = { "right lobe": ["V", "VI", "VII", "VIII"], "left lobe": ["II", "III", "IVa", "IVb"] };

export function createLiverViewer(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const overlay = document.createElement("div"); overlay.className = "c3d-notes"; el.appendChild(overlay);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50); camera.position.set(0, 0.5, 4.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 7;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.8; controls.minAzimuthAngle = -1.1; controls.maxAzimuthAngle = 1.1;

  const liver = new THREE.Group(); scene.add(liver);
  const segs = {};
  Object.entries(SEGMENTS).forEach(([name, d], i) => {
    const g = lumpy(new THREE.SphereGeometry(1, 40, 28), 0.05, i + 3);
    const m = new THREE.Mesh(g, xrayMat(0xf59e0b, { power: 1.8, intensity: 0.75, base: 0.03 }));
    m.position.set(...d.p); m.scale.set(...d.s); liver.add(m);
    const note = document.createElement("div"); note.className = "seg-label"; note.textContent = name; overlay.appendChild(note);
    segs[name] = { mesh: m, note };
  });
  // gallbladder + vessels for orientation
  const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.18, 8, 16), xrayMat(0x34d399, { power: 1.6, intensity: 0.8 }));
  gb.position.set(-0.22, -0.36, 0.22); gb.rotation.z = 0.5; liver.add(gb);
  const ivc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 16), xrayMat(0x60a5fa, { power: 1.4, intensity: 0.7 }));
  ivc.position.set(-0.18, 0.05, -0.42); liver.add(ivc);
  const pv = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 48, Math.PI), xrayMat(0xa78bfa, { power: 1.4, intensity: 0.7 }));
  pv.position.set(-0.2, -0.05, 0.0); pv.rotation.x = Math.PI / 2; liver.add(pv);

  const cyst = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), xrayMat(0xffffff, { power: 1.3, intensity: 1.9, base: 0.15 }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 24), xrayMat(0xffffff, { power: 3.2, intensity: 0.9 }));
  cyst.add(shell, halo); liver.add(cyst);
  const tag = document.createElement("div"); tag.className = "c3d-note xr-tag"; overlay.appendChild(tag);

  let target = new THREE.Vector3(-0.48, 0.05, 0.1), rT = 0.15, rNow = 0.001, hot = [];
  function set({ stage = "CE1", size = 6, segment = null } = {}) {
    const col = new THREE.Color(PHASE_HEX[stage] || 0xffffff);
    [shell, halo].forEach((m) => m.material.uniforms.color.value.copy(col));
    hot = segment ? (LOBES[segment] || (SEGMENTS[segment] ? [segment] : [])) : [];
    Object.entries(segs).forEach(([n, s]) => {
      const on = hot.includes(n);
      s.mesh.material.uniforms.intensity.value = on ? 1.7 : 0.55;
      s.mesh.material.uniforms.color.value.setHex(on ? 0xfde68a : 0xf59e0b);
      s.note.classList.toggle("on", on);
    });
    if (hot.length) {
      const c = new THREE.Vector3(); hot.forEach((n) => c.add(new THREE.Vector3(...SEGMENTS[n].p))); c.divideScalar(hot.length);
      c.z += 0.08; target = c;
    } else target = new THREE.Vector3(-0.48, 0.05, 0.12);
    rT = Math.min(0.3, Math.max(0.07, (size || 6) * 0.026));
    const where = segment ? (LOBES[segment] ? segment : "segment " + segment) : "segment not reported";
    tag.innerHTML = `<b>${stage}</b> · ${size ? size + " cm" : "size n/a"} · ${where}`;
  }
  set(opts);

  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el); resize();
  let visible = true; new IntersectionObserver((e) => (visible = e[0].isIntersecting)).observe(el);
  const clock = new THREE.Clock(), v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    if (!visible || !el.offsetParent) return;
    const t = clock.getElapsedTime(); controls.update();
    cyst.position.lerp(target, 0.08); rNow += (rT - rNow) * 0.08;
    cyst.scale.setScalar(rNow * (1 + 0.07 * Math.sin(t * 3.2)));
    halo.material.uniforms.intensity.value = 0.7 + 0.35 * Math.sin(t * 3.2);
    hot.forEach((n) => (segs[n].mesh.material.uniforms.base.value = 0.05 + 0.04 * (1 + Math.sin(t * 2.4))));
    const w = el.clientWidth, h = el.clientHeight;
    Object.entries(segs).forEach(([n, s]) => {
      v.copy(s.mesh.position).applyMatrix4(liver.matrixWorld).project(camera);
      s.note.style.transform = `translate(${(v.x * 0.5 + 0.5) * w - 12}px, ${(-v.y * 0.5 + 0.5) * h - 10}px)`;
    });
    v.copy(cyst.position).applyMatrix4(liver.matrixWorld); v.x += rNow; v.project(camera);
    tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    renderer.render(scene, camera);
  });
  return { set };
}
