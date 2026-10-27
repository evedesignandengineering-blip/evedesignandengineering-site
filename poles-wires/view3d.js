/* 3D view of the line: poles rise from the surveyed ground, constructions and per-phase conductors at their
   calculated attachment points. Rendering only: every number shown comes from app.js / pnw-model.js. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const COLORS = { hv: 0xc2410c, lv: 0x2f6ea4, earth: 0x64748b, other: 0x0f766e, pole: 0x8b6b4a, embed: 0x5b4636, sel: 0xf59e0b, arm: 0x6b7280 };
let host, renderer, labels, scene, camera, controls, group, poleMeshes = {}, onSelect = () => {}, selected = null, origin = null, lastData = null, raf = 0;

function kind(w) {
  if (/^RE/i.test(w.code || '')) return 'earth';
  if (w.voltage == null) return 'other';
  return w.voltage > 1 ? 'hv' : 'lv';
}
// Local frame: x = east, y = up (elevation), z = south, metres from the first pole.
function P(e, n, z) { return new THREE.Vector3(e - origin.e, z - origin.z, -(n - origin.n)); }

function mount(el, cb) {
  host = el; onSelect = cb || onSelect;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0xeef3f7);
  host.appendChild(renderer.domElement);
  labels = new CSS2DRenderer(); labels.domElement.className = 'labels3d'; host.appendChild(labels.domElement);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa7b4, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(60, 120, 40); scene.add(sun);
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  controls = new OrbitControls(camera, labels.domElement);
  controls.enableDamping = true; controls.screenSpacePanning = true;
  group = new THREE.Group(); scene.add(group);
  const ray = new THREE.Raycaster(), m = new THREE.Vector2();
  let down = null;
  labels.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  labels.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    m.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(Object.values(poleMeshes).flat(), false)[0];
    onSelect(hit ? hit.object.userData.pole : null);
  });
  new ResizeObserver(resize).observe(host);
  resize(); loop();
}
function resize() {
  if (!host) return;
  const w = host.clientWidth || 1, h = host.clientHeight || 1;
  renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function loop() { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); labels.render(scene, camera); }

function clear() {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.element) o.element.remove(); });
  group.clear(); poleMeshes = {};
}
function label(text, pos, cls) {
  const d = document.createElement('div'); d.className = cls || 'l3d'; d.textContent = text;
  const o = new CSS2DObject(d); o.position.copy(pos); group.add(o); return o;
}

// data: {poles:[{id,easting,northing,ground,height,sunk,diamTip,diamGL,diamSource}], axes:[{right}], constructions:[{pole,code,kingbolt,attachments,voltage}],
//        points:[...], wires:[{from,to,code,voltage,sag}], showLabels}
function update(data) {
  lastData = data; if (!scene) return;
  clear();
  const poles = data.poles.filter((p) => isFinite(p.easting) && isFinite(p.northing) && isFinite(p.ground));
  if (!poles.length) return;
  const keep = origin && data.keepView;
  origin = { e: poles[0].easting, n: poles[0].northing, z: Math.min(...poles.map((p) => p.ground - (p.sunk || 0))) };

  // Ground ribbon through the surveyed pole base levels (known only at the poles; straight between them).
  if (poles.length > 1) {
    const pos = [];
    poles.forEach((p, i) => {
      const r = data.axes[i] ? data.axes[i].right : [1, 0];
      [-12, 12].forEach((w) => { const v = P(p.easting + r[0] * w, p.northing + r[1] * w, p.ground); pos.push(v.x, v.y, v.z); });
    });
    const idx = [];
    for (let i = 0; i < poles.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb9c8a6, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false })));
  }

  poles.forEach((p, i) => {
    const base = P(p.easting, p.northing, p.ground);
    const rTop = (p.diamTip || 300) / 2000, rGL = (p.diamGL || p.diamTip || 300) / 2000;
    const parts = [];
    if (p.height > 0) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rGL, p.height, 16), new THREE.MeshStandardMaterial({ color: COLORS.pole, roughness: 0.9 }));
      m.position.copy(base).add(new THREE.Vector3(0, p.height / 2, 0)); m.userData.pole = p.id; group.add(m); parts.push(m);
    }
    if (p.sunk > 0) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rGL, rGL, p.sunk, 16), new THREE.MeshStandardMaterial({ color: COLORS.embed, transparent: true, opacity: 0.45 }));
      m.position.copy(base).add(new THREE.Vector3(0, -p.sunk / 2, 0)); m.userData.pole = p.id; group.add(m); parts.push(m);
    }
    poleMeshes[p.id] = parts;
    if (data.showLabels !== false) label(p.id, base.clone().add(new THREE.Vector3(0, (p.height || 0) + 1.2, 0)));
  });

  // Crossarms: a bar across the attachment points of each construction, at the king bolt.
  const axisOf = {}; poles.forEach((p, i) => { axisOf[p.id] = data.axes[i] ? data.axes[i].right : [1, 0]; });
  const byPole = {}; poles.forEach((p) => { byPole[p.id] = p; });
  (data.constructions || []).forEach((c) => {
    const p = byPole[c.pole]; if (!p || c.kingbolt == null) return;
    const xs = c.attachments.map((a) => a.x), r = axisOf[c.pole];
    const lo = Math.min(0, ...xs), hi = Math.max(0, ...xs);
    if (hi - lo > 0.05) {
      const a = P(p.easting + r[0] * lo, p.northing + r[1] * lo, p.ground + c.kingbolt), b = P(p.easting + r[0] * hi, p.northing + r[1] * hi, p.ground + c.kingbolt);
      const len = a.distanceTo(b), bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.09), new THREE.MeshStandardMaterial({ color: COLORS.arm }));
      bar.position.copy(a).add(b).multiplyScalar(0.5); bar.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); group.add(bar);
    }
  });
  (data.points || []).forEach((q) => {
    const v = P(q.easting, q.northing, q.elevation);
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0xd4d4d8 }));
    ins.position.copy(v).add(new THREE.Vector3(0, -0.09, 0)); group.add(ins);
  });

  // Conductors: one line per phase, between matching attachment points, with sag only when it was calculated.
  (data.wires || []).forEach((w) => {
    const a = P(w.from.easting, w.from.northing, w.from.elevation), b = P(w.to.easting, w.to.northing, w.to.elevation), pts = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24, v = a.clone().lerp(b, t); if (w.sag) v.y -= 4 * w.sag * t * (1 - t); pts.push(v); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS[kind(w)], linewidth: 2 }));
    group.add(line);
  });

  // Reference grid on the lowest pole base.
  const ext = poles.reduce((m, p) => Math.max(m, Math.abs(p.easting - origin.e), Math.abs(p.northing - origin.n)), 20);
  const grid = new THREE.GridHelper(Math.ceil(ext * 2.4 / 10) * 10, Math.ceil(ext * 2.4 / 10), 0xc5d0db, 0xdde4ea); grid.position.y = -0.02; group.add(grid);
  setSelected(selected);
  if (!keep) fit();
}
function fit() {
  if (!group || !group.children.length) return;
  const box = new THREE.Box3();
  Object.values(poleMeshes).flat().forEach((m) => box.expandByObject(m));
  if (box.isEmpty()) return;
  // Frame the bounding sphere of the poles in whichever of the vertical / horizontal field of view is narrower.
  const sphere = box.getBoundingSphere(new THREE.Sphere()), r = Math.max(sphere.radius, 8), c = sphere.center;
  const v = THREE.MathUtils.degToRad(camera.fov / 2), h = Math.atan(Math.tan(v) * camera.aspect), d = r / Math.sin(Math.min(v, h)) * 0.85;
  // look at the line from the side (perpendicular to first -> last pole), slightly from above and along it
  const ps = (lastData && lastData.poles) || [], a = ps[0], b = ps[ps.length - 1];
  let ax = 1, az = 0;
  if (a && b && (a.easting !== b.easting || a.northing !== b.northing)) { const L = Math.hypot(b.easting - a.easting, b.northing - a.northing); ax = (b.easting - a.easting) / L; az = -(b.northing - a.northing) / L; }
  const dir = new THREE.Vector3(-az * 0.85 + ax * 0.3, 0.42, ax * 0.85 + az * 0.3).normalize();
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, d); camera.near = 0.1; camera.far = d * 40; camera.updateProjectionMatrix();
}
function setSelected(id) {
  selected = id;
  Object.entries(poleMeshes).forEach(([pid, parts]) => parts.forEach((m, i) => { if (m.material.emissive) m.material.emissive.setHex(pid === id && i === 0 ? 0x7a4a00 : 0x000000); }));
}
function focus(id) {
  const parts = poleMeshes[id]; if (!parts || !parts[0]) return;
  const v = parts[0].position.clone(), off = camera.position.clone().sub(controls.target);
  controls.target.copy(v); camera.position.copy(v).add(off);
}
function snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }

window.PNW3D = { mount, update, fit, select: setSelected, focus, resize, snapshot, colors: COLORS };
window.dispatchEvent(new Event('pnw3d-ready'));
