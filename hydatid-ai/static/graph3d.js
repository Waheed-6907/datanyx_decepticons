// 3D knowledge graph: ultrasound signs -> stages -> phase -> management.
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/OrbitControls.js";

const COLORS = { sign: 0x8b5cf6, stage: 0x0f766e, phase: 0xd97706, mgmt: 0x2563eb };
const STAGE_COL = { CL: 0x64748b, CE1: 0xdc4b3e, CE2: 0xdc4b3e, CE3a: 0xd97706, CE3b: 0xd97706, CE4: 0x2563eb, CE5: 0x2563eb };
const COLX = { sign: -8.5, stage: -2.6, phase: 2.6, mgmt: 8.5 };

function label(text, color = "#0f172a", bg = "rgba(255,255,255,0.92)") {
  const c = document.createElement("canvas"), x = c.getContext("2d");
  const fs = 44; x.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(x.measureText(text).width) + 36, h = fs + 26;
  c.width = w; c.height = h;
  x.font = `600 ${fs}px Inter, system-ui, sans-serif`;
  x.fillStyle = bg; x.beginPath(); x.roundRect(0, 0, w, h, 18); x.fill();
  x.fillStyle = color; x.textBaseline = "middle"; x.fillText(text, 18, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(w / 140, h / 140, 1);
  return s;
}

export function createGraph(el, data, onSelect) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 1.5, 24);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(5, 8, 10); scene.add(dl);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.autoRotate = false; let sway = true; controls.maxPolarAngle = Math.PI * 0.62; controls.minPolarAngle = Math.PI * 0.38;
  controls.minAzimuthAngle = -0.9; controls.maxAzimuthAngle = 0.9;
  controls.minDistance = 10; controls.maxDistance = 36;

  // layout: one column per group, spread vertically, a little depth for 3D feel
  const byGroup = {};
  data.nodes.forEach((n) => (byGroup[n.group] = byGroup[n.group] || []).push(n));
  const nodes = {};
  Object.entries(byGroup).forEach(([grp, list]) => {
    list.forEach((n, i) => {
      const y = (i - (list.length - 1) / 2) * (grp === "phase" ? 2.8 : grp === "stage" ? 1.75 : grp === "mgmt" ? 1.9 : 1.45);
      const z = Math.sin(i * 1.7) * 0.7;
      const stage = n.id.startsWith("stage:") ? n.label : null;
      const col = stage ? STAGE_COL[stage] : COLORS[grp];
      const r = grp === "stage" ? 0.42 : grp === "phase" ? 0.5 : 0.3;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24),
        new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.3, clearcoat: 0.8, transparent: true, opacity: 0.95 }));
      mesh.position.set(COLX[grp], y, z);
      mesh.userData = n; scene.add(mesh);
      const lab = label(n.label, "#0f172a");
      lab.position.set(COLX[grp], y + r + 0.36, z); scene.add(lab);
      nodes[n.id] = { n, mesh, lab, links: [] };
    });
  });
  const lines = data.links.map((l) => {
    const a = nodes[l.source], b = nodes[l.target];
    if (!a || !b) return null;
    const mid = a.mesh.position.clone().lerp(b.mesh.position, 0.5); mid.z += 1.2;
    const curve = new THREE.QuadraticBezierCurve3(a.mesh.position, mid, b.mesh.position);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 }));
    scene.add(line);
    const rec = { line, a, b, kind: l.kind };
    a.links.push(rec); b.links.push(rec);
    return rec;
  }).filter(Boolean);

  // traveling pulses along links
  const pulses = lines.map((rec, i) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0x14b8a6 }));
    scene.add(p); return { p, rec, off: i * 0.13 };
  });

  let selected = null;
  function highlight(id) {
    selected = id;
    const keep = new Set();
    if (id) {
      keep.add(id);
      nodes[id].links.forEach((r) => { keep.add(r.a.n.id); keep.add(r.b.n.id); });
      // second hop from stages so a sign lights up its phase and management too
      [...keep].forEach((k) => { if (k.startsWith("stage:")) nodes[k].links.forEach((r) => { keep.add(r.a.n.id); keep.add(r.b.n.id); }); });
    }
    Object.values(nodes).forEach(({ n, mesh, lab }) => {
      const on = !id || keep.has(n.id);
      mesh.material.opacity = on ? 0.95 : 0.15; lab.material.opacity = on ? 1 : 0.15;
      mesh.scale.setScalar(n.id === id ? 1.35 : 1);
    });
    lines.forEach((r) => {
      const on = !id || (keep.has(r.a.n.id) && keep.has(r.b.n.id));
      r.line.material.opacity = on ? (id ? 0.95 : 0.45) : 0.06;
      r.line.material.color.setHex(on && id ? 0x0f766e : 0x94a3b8);
    });
    pulses.forEach((pl) => (pl.p.visible = !id || (keep.has(pl.rec.a.n.id) && keep.has(pl.rec.b.n.id))));
  }

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const meshes = Object.values(nodes).map((x) => x.mesh);
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(meshes)[0];
    const id = hit ? hit.object.userData.id : null;
    highlight(id === selected ? null : id);
    sway = !selected;
    onSelect && onSelect(selected ? nodes[selected].n : null, selected ? connected(selected) : []);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    renderer.domElement.style.cursor = ray.intersectObjects(meshes).length ? "pointer" : "grab";
  });
  function connected(id) { return nodes[id].links.map((r) => (r.a.n.id === id ? r.b.n : r.a.n)); }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el); resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (!el.offsetParent) return;
    const t = clock.getElapsedTime();
    controls.update();
    if (sway) scene.rotation.y = Math.sin(t * 0.3) * 0.28;
    pulses.forEach(({ p, rec, off }) => {
      const k = (t * 0.35 + off) % 1;
      const pos = rec.line.geometry.attributes.position, i = Math.floor(k * (pos.count - 1));
      p.position.fromBufferAttribute(pos, i);
    });
    renderer.render(scene, camera);
  });
  return { select: (id) => { highlight(id); sway = !id; onSelect && onSelect(id ? nodes[id].n : null, id ? connected(id) : []); } };
}
