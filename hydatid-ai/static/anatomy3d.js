// Anatomical 3D view: liver (Couinaud segments, fissures, vessels) and lungs (five lobes, fissures, airway tree).
// The cyst is placed where the doctor or the report says it is, and drawn as the WHO stage looks inside.
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/OrbitControls.js";
import { GLTFLoader } from "/static/vendor/GLTFLoader.js";
import { STLLoader } from "/static/vendor/STLLoader.js";

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
export const STAGE_DETAIL = {
  CL: { title: "Simple cystic lesion", inside: "Clear fluid. No wall or daughter cysts seen yet.", note: "Could be hydatid or another cyst, so it needs confirmation." },
  CE1: { title: "Unilocular cyst with daughter vesicles", inside: "A fluid-filled cyst with a thick wall and small daughter vesicles inside.", note: "Active stage." },
  CE2: { title: "Multivesicular (honeycomb) cyst", inside: "Many small cysts packed together inside, like a honeycomb.", note: "Active stage." },
  CE3a: { title: "Detached membrane (water-lily sign)", inside: "The inner membrane has peeled away and floats in the fluid.", note: "Transitional stage: the cyst is starting to fail." },
  CE3b: { title: "Multiple detached membranes", inside: "Several torn membranes float in the fluid, with some solid material.", note: "Transitional stage." },
  CE4: { title: "Solid, inactive cyst", inside: "Mostly solid tissue. The fluid has been replaced.", note: "Inactive stage." },
  CE5: { title: "Calcified, dead cyst", inside: "The wall and contents have calcified.", note: "Inactive stage: usually no active treatment is needed." },
};

/* ---------- procedural detail: smooth value noise, fractal sums, deterministic randomness ---------- */
function hash(i, j, k, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041) + Math.imul(s, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm(x, y, z, s, oct = 4) {
  let a = 0.5, f = 1, sum = 0;
  for (let o = 0; o < oct; o++) { sum += a * (vnoise(x * f, y * f, z * f, s + o * 7) * 2 - 1); f *= 2.03; a *= 0.5; }
  return sum;
}
function rngOf(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967295); }

// displace a sphere-like geometry with fractal noise along its normals (organ surfaces, membranes, calcification)
function sculpt(geo, shape, amp, seed, detail = 1) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const q = shape(v.clone());
    const n = fbm(q.x * 2.2 * detail, q.y * 2.2 * detail, q.z * 2.2 * detail, seed, 4);
    q.addScaledVector(q.clone().normalize(), amp * n);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  geo.computeVertexNormals();
  return geo;
}
// tissue texture for bump maps: fibrous streaks plus fine grain
function tissueTexture(kind = "liver") {
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S), rnd = rngOf(kind === "lung" ? 11 : 3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = x / S * 6, ny = y / S * 6;
    const streak = fbm(nx * 1.5, ny * 9, 0.5, kind === "lung" ? 5 : 2, 3);
    const grain = (rnd() - 0.5) * (kind === "lung" ? 0.5 : 0.22);
    const v = 128 + 70 * (streak + grain);
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)"); grd.addColorStop(0.25, "rgba(255,240,200,0.45)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
// a thin cylinder between two points
function limb(p0, p1, r0, r1, mat) {
  const d = new THREE.Vector3().subVectors(p1, p0), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 14, 1), mat);
  m.position.copy(p0).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; return m;
}

/* ---------- liver: wedge-shaped right lobe, thinner left lobe, falciform notch, Glisson capsule ---------- */
const liverShape = (v) => {
  const x = v.x * (v.x < 0 ? 1.18 : 0.74);
  const y = v.y * (0.46 + 0.09 * Math.max(0, -x) - 0.05 * Math.max(0, x));   // thick on the right, thin on the left
  let z = v.z * (0.58 + 0.06 * Math.max(0, -x));
  z -= 0.1 * Math.exp(-Math.pow(x - 0.12, 2) / 0.012) * (v.z > 0 ? 1 : 0);      // falciform ligament notch on the front
  return new THREE.Vector3(x, y, z);
};
// fissure grooves: the Cantlie line, the ligamentum teres fissure and the gall bladder fossa
const grooveAt = (q) => {
  const cantlie = Math.exp(-Math.pow((q.x + 0.1 - 0.35 * q.y) / 0.035, 2)) * (q.z > -0.1 ? 1 : 0);
  const teres = Math.exp(-Math.pow((q.x - 0.12) / 0.03, 2)) * (q.z > 0.1 ? 0.7 : 0);
  const fossa = Math.exp(-(Math.pow(q.x + 0.28, 2) + Math.pow(q.z - 0.12, 2)) / 0.02);
  return Math.min(1, cantlie + teres + fossa);
};

function buildLiver() {
  const geo = sculpt(new THREE.SphereGeometry(1, 120, 84), liverShape, 0.045, 3);
  const pos = geo.attributes.position, n = pos.count;
  const segId = new Float32Array(n), keys = Object.keys(SEG_SEEDS), colors = new Float32Array(n * 3);
  const v = new THREE.Vector3(), c = new THREE.Color(), rnd = rngOf(17);
  const base = new THREE.Color("#7a2f25"), dark = new THREE.Color("#3a1210"), warm = new THREE.Color("#a84d3c");
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    let best = 0, bd = 1e9;
    keys.forEach((k, j) => { const s = SEG_SEEDS[k], d = (v.x - s[0]) ** 2 + (v.y - s[1]) ** 2 + (v.z - s[2]) ** 2; if (d < bd) { bd = d; best = j; } });
    segId[i] = best;
    // natural mottling, warmer near the surface, darker in the fissures
    const mot = 0.5 + 0.5 * fbm(v.x * 3, v.y * 3, v.z * 3, 9, 3);
    c.copy(base).lerp(warm, Math.max(0, mot - 0.5) * 0.8).lerp(dark, grooveAt(v) * 0.55 + (rnd() - 0.5) * 0.02);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("segId", new THREE.BufferAttribute(segId, 1));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.18,
    sheen: 0.6, sheenColor: new THREE.Color("#ff9d88"), sheenRoughness: 0.35, bumpMap: tissueTexture("liver"), bumpScale: 0.9,
    transparent: true, opacity: 0.74, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.kind = "liver";
  const group = new THREE.Group(); group.add(mesh);
  return { group, mesh, keys, segId, orig: Float32Array.from(colors) };
}

/* ---------- lungs: five lobes with fissures, lobulated surfaces, and a branching airway tree ---------- */
function buildLungs() {
  const group = new THREE.Group(), lobes = {};
  const dims = { RUL: [0.42, 0.34, 0.36], RML: [0.3, 0.2, 0.3], RLL: [0.4, 0.42, 0.38], LUL: [0.36, 0.42, 0.36], LLL: [0.38, 0.4, 0.38] };
  const tex = tissueTexture("lung");
  Object.entries(dims).forEach(([k, [rx, ry, rz]], i) => {
    const right = k.startsWith("R");
    const shape = (v) => {
      let x = v.x * rx, y = v.y * ry, z = v.z * rz;
      if (right ? x > 0 : x < 0) x *= 0.8;                                     // flatter on the side facing the heart
      if (y < 0) x *= 0.92;                                                     // lower lobes taper
      return new THREE.Vector3(x, y, z);
    };
    const geo = sculpt(new THREE.SphereGeometry(1, 112, 80), shape, 0.05, 5 + i, 1.4);
    const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), v = new THREE.Vector3(), c = new THREE.Color();
    const base = new THREE.Color("#e9a196");
    for (let j = 0; j < pos.count; j++) {
      v.fromBufferAttribute(pos, j);
      const crease = Math.exp(-Math.pow((v.x * 0.8 + v.y * 0.5) / 0.05, 2)) * (v.z > 0 ? 0.6 : 0.2);
      const mot = 0.5 + 0.5 * fbm(v.x * 4, v.y * 4, v.z * 4, 21 + i, 3);
      c.copy(base).multiplyScalar(0.94 + 0.12 * mot).lerp(new THREE.Color("#7c3b36"), Math.min(0.6, crease));
      colors[j * 3] = c.r; colors[j * 3 + 1] = c.g; colors[j * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, sheen: 0.7, sheenColor: new THREE.Color("#ffd6cf"), sheenRoughness: 0.5,
      bumpMap: tex, bumpScale: 1.2, clearcoat: 0.2, transparent: true, opacity: 0.6, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...LOBE_SEEDS[k]);
    m.castShadow = m.receiveShadow = true;
    m.userData.kind = "lobe"; m.userData.lobe = k;
    group.add(m); lobes[k] = m;
  });
  // airway tree: trachea, then branches that get thinner, like the real bronchi
  const air = new THREE.MeshPhysicalMaterial({ color: 0xf1e6dc, roughness: 0.55, clearcoat: 0.3, transparent: true, opacity: 0.92 });
  const rnd = rngOf(42);
  const branch = (p0, dir, len, rad, depth) => {
    const p1 = p0.clone().addScaledVector(dir, len);
    group.add(limb(p0, p1, rad * 0.85, rad, air));
    if (depth <= 0) return;
    [-1, 1].forEach((side) => {
      const nd = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), side * (0.45 + rnd() * 0.25)).applyAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 0.6).normalize();
      branch(p1, nd, len * 0.74, rad * 0.72, depth - 1);
    });
  };
  group.add(limb(new THREE.Vector3(0, 1.12, -0.04), new THREE.Vector3(0, 0.62, -0.05), 0.065, 0.075, air));
  branch(new THREE.Vector3(0, 0.62, -0.05), new THREE.Vector3(-0.6, -0.5, 0).normalize(), 0.42, 0.045, 3);
  branch(new THREE.Vector3(0, 0.62, -0.05), new THREE.Vector3(0.6, -0.55, 0).normalize(), 0.4, 0.042, 3);
  return { group, lobes };
}

function buildTorso() {
  const prof = [[0.0, -1.6], [0.62, -1.55], [0.7, -1.22], [0.62, -0.75], [0.58, -0.3], [0.66, 0.2], [0.74, 0.7], [0.82, 1.0], [0.78, 1.18], [0.42, 1.32], [0.2, 1.38], [0.0, 1.4]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(prof, 72); geo.scale(1, 1, 0.55);
  const shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.16 }));
  const g = new THREE.Group(); g.add(shell, edges); return g;
}

/* ---------- the cyst: each WHO stage drawn as it looks inside ---------- */
function buildCyst(stage, r, seed) {
  const g = new THREE.Group(), rnd = rngOf(seed);
  const fluid = new THREE.MeshPhysicalMaterial({ color: 0xeaf7ff, transmission: 0.92, roughness: 0.03, thickness: r * 2, ior: 1.36,
    attenuationColor: new THREE.Color("#f3e7b0"), attenuationDistance: r * 3, specularIntensity: 1, clearcoat: 1,
    emissive: new THREE.Color("#4a6b7a"), emissiveIntensity: 0.55 });
  const wall = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ea, roughness: 0.55, emissive: new THREE.Color("#3a4a50"), emissiveIntensity: 0.35, bumpMap: tissueTexture("lung"), bumpScale: 1.5,
    transparent: true, opacity: 0.92, sheen: 0.5, sheenColor: new THREE.Color("#ffffff") });
  const cream = new THREE.MeshPhysicalMaterial({ color: 0xf2e6c6, roughness: 0.6, transparent: true, opacity: 0.92, side: THREE.DoubleSide, sheen: 0.4 });
  const membrane = new THREE.MeshPhysicalMaterial({ color: 0xf7f1dc, roughness: 0.82, transparent: true, opacity: 0.72, side: THREE.DoubleSide, sheen: 0.8, sheenColor: new THREE.Color("#fffbe8") });
  const solid = new THREE.MeshPhysicalMaterial({ color: 0xdcc9a0, roughness: 0.7, bumpMap: tissueTexture("lung"), bumpScale: 2, sheen: 0.4 });
  const calc = new THREE.MeshPhysicalMaterial({ color: 0xf2eee2, roughness: 0.38, bumpMap: tissueTexture("lung"), bumpScale: 2.5, clearcoat: 0.3 });
  const add = (geo, mat, p = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.castShadow = true; g.add(m); return m; };
  const sphere = (rad, seg = 56) => new THREE.SphereGeometry(rad, seg, Math.round(seg * 0.7));
  // soft rim so the edge of every cyst reads clearly against the tissue
  add(new THREE.SphereGeometry(r * 1.015, 64, 48), new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.3, side: THREE.BackSide, depthWrite: false }));
  // random points inside a ball, kept apart so vesicles do not overlap
  const pack = (count, rad, spread, tries = 400) => {
    const pts = [];
    for (let t = 0; t < tries && pts.length < count; t++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      const d = spread * Math.cbrt(rnd());
      const p = new THREE.Vector3(Math.cos(a) * rr * d, u * d, Math.sin(a) * rr * d);
      const s = rad * (0.55 + rnd() * 0.7);
      if (pts.every((q) => q.p.distanceTo(p) > (q.s + s) * 1.05)) pts.push({ p, s });
    }
    return pts;
  };
  const vesicles = (count, rad, spread, mat) => pack(count, rad, spread).forEach(({ p, s }) => add(sphere(s, 28), mat, p.toArray()));

  if (stage === "CL") {
    add(sphere(r, 96), fluid);
    add(sphere(r * 1.005, 96), wall).material.side = THREE.BackSide;   // very thin wall
  } else if (stage === "CE1") {
    add(sphere(r, 96), fluid);
    add(sculpt(sphere(r * 1.02, 96), (v) => v, 0.012, 3), wall).material.side = THREE.BackSide;   // thick, uneven wall
    vesicles(9, r * 0.2, r * 0.62, cream);                                 // daughter vesicles along the wall
  } else if (stage === "CE2") {
    add(sphere(r, 96), fluid);
    vesicles(70, r * 0.13, r * 0.8, cream);                                // honeycomb of small cysts
  } else if (stage === "CE3a") {
    add(sphere(r, 96), fluid);
    add(sculpt(sphere(r * 1.02, 96), (v) => v, 0.01, 4), wall).material.side = THREE.BackSide;
    add(sculpt(sphere(r * 0.8, 120), (v) => v, 0.22, 9, 2.2), membrane, [0, r * 0.25, 0]);   // detached membrane, crumpled
  } else if (stage === "CE3b") {
    add(sphere(r, 96), fluid);
    add(sculpt(sphere(r * 0.72, 120), (v) => v, 0.24, 4, 2.2), membrane, [r * 0.1, -r * 0.18, 0]);
    add(sculpt(sphere(r * 0.55, 120), (v) => v, 0.26, 11, 2.4), membrane, [-r * 0.2, r * 0.32, r * 0.12]);
    vesicles(4, r * 0.14, r * 0.5, cream);
  } else if (stage === "CE4") {
    add(sculpt(sphere(r, 120), (v) => v, 0.13, 13, 1.6), solid);
    add(sculpt(sphere(r * 0.6, 100), (v) => v, 0.16, 17, 2), cream, [r * 0.05, 0, 0]);
  } else { // CE5: calcified
    add(sculpt(sphere(r, 120), (v) => v, 0.16, 21, 1.8), calc);
  }
  return g;
}

export function createAnatomyViewer(el, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  el.appendChild(renderer.domElement);
  const overlay = document.createElement("div"); overlay.className = "anat-labels"; el.appendChild(overlay);
  const tag = document.createElement("div"); tag.className = "anat-tag"; overlay.appendChild(tag);
  const hint = document.createElement("div"); hint.className = "anat-hint"; hint.textContent = "Drag to turn · click the organ to mark where the cyst is"; el.appendChild(hint);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene(); env.background = new THREE.Color(0x0b1220);
  env.add(new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), new THREE.MeshBasicMaterial({ color: 0x1b2a40, side: THREE.BackSide })));
  [[0, 6, 5, 6, 3], [-7, 2, -1, 3, 4], [6, -1, 2, 2, 5], [0, -4, 6, 8, 2]].forEach(([x, y, z, w, h]) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xfff4e6, side: THREE.DoubleSide }));
    p.position.set(x, y, z); p.lookAt(0, 0, 0); env.add(p);
  });
  scene.environment = pmrem.fromScene(env, 0.03).texture;
  scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x0b1220, 0.3));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.7); key.position.set(3, 4.5, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -2.5; key.shadow.camera.right = 2.5; key.shadow.camera.top = 2.5; key.shadow.camera.bottom = -2.5; key.shadow.bias = -0.0004; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9bd3ff, 0.45); fill.position.set(-4, 2, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x67e8f9, 1.1); rim.position.set(0, 3, -5); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.7; floor.receiveShadow = true; scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  camera.position.set(0, 0.25, opts.distance || 4.4);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-0.12, 0.03, 0); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2.2; controls.maxDistance = 8; controls.autoRotate = true; controls.autoRotateSpeed = 0.6;
  let idleAt = 0; controls.addEventListener("start", () => { controls.autoRotate = false; idleAt = performance.now(); });

  scene.add(buildTorso());
  const liverPack = buildLiver(); const liver = new THREE.Group(); liver.add(liverPack.group);
  // gall bladder with a glossy bile surface, and the big vessels
  const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 12, 24), new THREE.MeshPhysicalMaterial({ color: 0x3f5a22, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.9, sheen: 0.3 }));
  gb.position.set(-0.22, -0.4, 0.2); gb.rotation.z = 0.5; liver.add(gb);
  const vessel = (pts, r, col) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 60, r, 16), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.35, clearcoat: 0.6 }));
  };
  liver.add(vessel([[-0.25, 0.55, -0.42], [-0.22, 0.0, -0.45], [-0.25, -0.5, -0.4]], 0.07, 0x3b5bdb));   // IVC
  liver.add(vessel([[0.05, -0.2, 0.08], [-0.25, 0.02, 0.0], [-0.6, 0.06, -0.05], [-0.8, 0.1, -0.1]], 0.05, 0x7c3aed)); // portal branches
  liver.add(vessel([[-0.45, 0.1, 0.05], [-0.22, 0.25, 0.0], [0.0, 0.3, -0.05]], 0.035, 0x1d4ed8));       // hepatic veins
  scene.add(liver);
  const lungs = buildLungs(); scene.add(lungs.group); lungs.group.visible = false;
  // real liver shape (NIH 3D Liver, Male, Visible Human; STL mesh). Replaces the built-in liver when it loads.
  new STLLoader().load("/static/models/liver-male-nih.stl", (geo) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    // long axis -> x (patient's right is negative x), middle -> z, short -> y, then fit to the built-in liver's frame
    const order = [0, 1, 2].sort((a, b) => [size.x, size.y, size.z][b] - [size.x, size.y, size.z][a]);
    const k = 1.9 / size.x;
    const p = geo.attributes.position, n = p.count, v = new THREE.Vector3(), out = new Float32Array(n * 3);
    const sub = [c.x, c.y, c.z];
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i);
      const src = [v.x - sub[0], v.y - sub[1], v.z - sub[2]];
      out[i * 3] = src[order[0]] * k * -1; out[i * 3 + 1] = src[order[2]] * k; out[i * 3 + 2] = src[order[1]] * k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(out, 3));
    g.computeVertexNormals();
    const segId = new Float32Array(n), keys = liverPack.keys, colors = new Float32Array(n * 3), q = new THREE.Vector3(), col = new THREE.Color();
    const base = new THREE.Color("#7a2f25"), dark = new THREE.Color("#3a1210"), warm = new THREE.Color("#a84d3c");
    for (let i = 0; i < n; i++) {
      q.fromArray(out, i * 3);
      let best = 0, bd = 1e9;
      keys.forEach((kk, j) => { const sd = SEG_SEEDS[kk], dd = (q.x - sd[0]) ** 2 + (q.y - sd[1]) ** 2 + (q.z - sd[2]) ** 2; if (dd < bd) { bd = dd; best = j; } });
      segId[i] = best;
      const mot = 0.5 + 0.5 * fbm(q.x * 3, q.y * 3, q.z * 3, 9, 3);
      col.copy(base).lerp(warm, Math.max(0, mot - 0.5) * 0.8).lerp(dark, grooveAt(q) * 0.55);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    g.setAttribute("segId", new THREE.BufferAttribute(segId, 1));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    liverPack.mesh.geometry.dispose();
    liverPack.mesh.geometry = g;
    liverPack.segId = segId; liverPack.orig = Float32Array.from(colors);
    liver.children.forEach((ch) => { if (ch !== liverPack.group) ch.visible = false; });
    Object.keys(segCentre).forEach((kk) => delete segCentre[kk]);
    Object.keys(SEG_SEEDS).forEach((kk) => {
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let i = 0; i < n; i++) if (keys[segId[i]] === kk) { sx += out[i * 3]; sy += out[i * 3 + 1]; sz += out[i * 3 + 2]; cnt++; }
      if (cnt) segCentre[kk] = new THREE.Vector3(sx / cnt, sy / cnt, sz / cnt);
    });
    paintLiver();
    if (lastArgs) set(lastArgs);
  }, undefined, (e) => console.warn("liver model did not load; using the built-in liver", e));
  const glbLobes = {}; let glbRoot = null, glbReady = false, lastArgs = null;

  const cystRoot = new THREE.Group(); scene.add(cystRoot);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff1c2, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(glow);

  const labels = {};
  const mkLabel = (text) => { const d = document.createElement("div"); d.className = "anat-pill"; d.textContent = text; overlay.appendChild(d); return d; };
  Object.keys(SEG_SEEDS).forEach((k) => (labels["seg:" + k] = mkLabel(k)));
  Object.keys(LOBE_SEEDS).forEach((k) => (labels["lobe:" + k] = mkLabel(k)));

  const segCentre = {};
  { const pos = liverPack.mesh.geometry.attributes.position, acc = {};
    for (let i = 0; i < pos.count; i++) { const s = liverPack.keys[liverPack.segId[i]]; const a = acc[s] || (acc[s] = [0, 0, 0, 0]);
      a[0] += pos.getX(i); a[1] += pos.getY(i); a[2] += pos.getZ(i); a[3]++; }
    Object.entries(acc).forEach(([s, a]) => (segCentre[s] = new THREE.Vector3(a[0] / a[3], a[1] / a[3], a[2] / a[3]))); }
  const lobeCentre = (k) => (glbLobes[k] ? glbLobes[k].centre.clone() : new THREE.Vector3(...LOBE_SEEDS[k]));

  // real lung anatomy (Visible Human female lobes, from NIH 3D, HRA reference organ) when the model loads
  const LOBE_NODE = { RUL: "VH_F_R_lung_upper_lobe", RML: "VH_F_R_lung_middle_lobe", RLL: "VH_F_R_lung_lower_lobe", LUL: "VH_F_L_lung_upper_lobe", LLL: "VH_F_L_lung_lower_lobe" };
  const lobeMat = (k, on) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(on ? "#ffb9a8" : "#e6a197"), roughness: 0.55, sheen: 0.6,
    sheenColor: new THREE.Color("#ffd6cf"), sheenRoughness: 0.5, clearcoat: 0.2, transparent: true, opacity: on ? 0.2 : 0.36, depthWrite: false,
    emissive: new THREE.Color(on ? "#4a1a14" : "#000000") });
  new GLTFLoader().load("/static/models/lung-male-nih.glb", (gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1.55 / Math.max(size.x, size.y, size.z);
    root.scale.setScalar(s); root.position.copy(c).multiplyScalar(-s);
    root.updateMatrixWorld(true);
    Object.entries(LOBE_NODE).forEach(([k, name]) => {
      const node = root.getObjectByName(name); if (!node) return;
      const meshes = [];
      node.traverse((o) => { if (o.isMesh) { o.material = lobeMat(k, false); o.castShadow = o.receiveShadow = true; o.userData.kind = "lobe"; o.userData.lobe = k; meshes.push(o); } });
      glbLobes[k] = { meshes, centre: new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()) };
    });
    // the airways (trachea and bronchi) keep the model's own materials
    root.traverse((o) => { if (o.isMesh && !o.userData.kind && o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.9; o.material.depthWrite = false; } });
    glbRoot = root; glbRoot.visible = false; scene.add(glbRoot);
    glbReady = true; lungs.group.visible = false;
    if (lastArgs) set(lastArgs);
  }, undefined, (e) => console.warn("lung model did not load; using the built-in lungs", e));

  const hotCol = new THREE.Color("#ffb36b");
  let hotSeg = [];
  // the chosen segment is lifted in colour; the rest keep their natural tone
  function paintLiver() {
    const col = liverPack.mesh.geometry.attributes.color, sid = liverPack.segId, orig = liverPack.orig;
    for (let i = 0; i < sid.length; i++) {
      const on = hotSeg.includes(liverPack.keys[sid[i]]);
      const r = orig[i * 3], g = orig[i * 3 + 1], b = orig[i * 3 + 2];
      if (on) col.setXYZ(i, r + (hotCol.r - r) * 0.5, g + (hotCol.g - g) * 0.5, b + (hotCol.b - b) * 0.5);
      else col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
  }
  let hotLobe = null;
  function paintLungs() {
    if (glbReady) {
      Object.entries(glbLobes).forEach(([k, d]) => d.meshes.forEach((m) => { m.material.dispose(); m.material = lobeMat(k, k === hotLobe); }));
      return;
    }
    Object.entries(lungs.lobes).forEach(([k, m]) => {
      const on = k === hotLobe;
      m.material.emissive = new THREE.Color(on ? "#4a1a14" : "#000000");
      m.material.opacity = on ? 0.72 : 0.6;
    });
  }
  paintLiver(); paintLungs();

  let organ = "liver", stage = "CE1", size = 5, cystR = 0.2, target = new THREE.Vector3(-0.5, 0.05, 0.1), locName = "location not stated";
  let cyst = null, cystStage = null, cystRadius = 0;
  function rebuildCyst() {
    cystRoot.clear();
    cyst = buildCyst(stage, cystR, 7);
    // drawn on top of the translucent lungs, so the cyst reads clearly inside the lobe
    cyst.traverse((o) => { if (o.isMesh) { o.renderOrder = 10; o.material.depthTest = false; o.material.needsUpdate = true; } });
    cystRoot.add(cyst);
    cystStage = stage; cystRadius = cystR;
  }
  const radiusFor = (cm) => Math.min(0.36, Math.max(0.08, (cm || 5) * 0.05));

  function set({ organ: o = "liver", stage: st = "CE1", size: sz = 5, segment = null, lobe = null, depth = "central" } = {}) {
    lastArgs = { organ: o, stage: st, size: sz, segment, lobe, depth };
    organ = o === "lung" ? "lung" : "liver";
    stage = st; size = sz || 5; cystR = radiusFor(size);
    liver.visible = organ === "liver"; lungs.group.visible = organ === "lung" && !glbReady;
    if (glbRoot) glbRoot.visible = organ === "lung";
    hotSeg = segment && SEG_SEEDS[segment] ? [segment] : [];
    hotLobe = lobe && LOBE_SEEDS[lobe] ? lobe : null;
    paintLiver(); paintLungs();
    let p;
    if (organ === "liver") p = hotSeg.length ? segCentre[hotSeg[0]].clone() : new THREE.Vector3(-0.2, 0.0, 0.1);
    else p = hotLobe ? lobeCentre(hotLobe) : new THREE.Vector3(-0.45, 0.0, 0.0);
    // a named region sits a little inside the organ, so the cyst stays within the tissue rather than poking out
    if (hotSeg.length || hotLobe) p.multiplyScalar(0.84);
    const outward = p.clone().normalize().multiplyScalar(depth === "superficial" ? 0.13 : depth === "deep" ? -0.12 : 0);
    target = p.add(outward);
    locName = organ === "liver"
      ? (hotSeg.length ? SEG_NAME[hotSeg[0]] : (segment ? "Liver (" + segment + ")" : "segment not stated"))
      : (hotLobe ? LOBE_NAME[hotLobe] : "lobe not stated");
    if (!cyst || cystStage !== stage || Math.abs(cystRadius - cystR) > 0.01) rebuildCyst();
    const col = { CL: "#cbd5e1", CE1: "#fb7185", CE2: "#f97316", CE3a: "#fbbf24", CE3b: "#f59e0b", CE4: "#94a3b8", CE5: "#e2e8f0" }[stage] || "#ffffff";
    tag.innerHTML = `<b style="color:${col}">${stage}</b> · ${size ? size + " cm" : "size not stated"} · ${locName}`;
    if ((!segment && organ === "liver") || (!lobe && organ === "lung")) tag.innerHTML += ` <span class="anat-approx">· approximate position</span>`;
  }

  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const objs = organ === "liver" ? [liverPack.mesh] : (glbReady ? Object.values(glbLobes).flatMap((d) => d.meshes) : Object.values(lungs.lobes));
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
    cystRoot.scale.setScalar(1 + 0.02 * Math.sin(t * 2.2));
    glow.position.copy(cystPos); glow.scale.setScalar(cystR * 4.2 * (1 + 0.06 * Math.sin(t * 3)));
    glow.material.opacity = 0.5 + 0.2 * Math.sin(t * 3);
    const w = el.clientWidth, h = el.clientHeight;
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
