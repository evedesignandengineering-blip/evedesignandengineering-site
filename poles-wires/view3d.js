/* 3D view of the line: poles rise from the surveyed ground, constructions and per-phase conductors at their
   calculated attachment points. Rendering only: every number shown comes from app.js / pnw-model.js.

   Camera notes (why it is built this way):
   - The local origin is fixed for a site and only re-based when a different site is loaded, so edits never shift the model.
   - Fit frames the true bounding box of everything that belongs to the line (poles, crossarms, insulators, wires),
     solved exactly per box corner against both fields of view, from the current or a preset direction.
   - Wheel zoom goes towards the point under the cursor (zoomToCursor) and the near / far planes follow the camera
     distance every frame, so zooming in close never clips the pole and zooming out never loses the line.
   - Frames are drawn only when something changed (camera moved, data updated, resize). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const COLORS = { hv: 0xc2410c, lv: 0x2f6ea4, earth: 0x64748b, other: 0x0f766e, pole: 0x8b6b4a, embed: 0x5b4636, sel: 0xf59e0b, arm: 0x6b7280 };
const WIRE_PX = 2.5, WIRE_SEL_PX = 5;
let host, renderer, labels, scene, camera, controls, group, compass, onSelect = () => {};
let poleMeshes = {}, poleParts = {}, wireLines = [], fitObjects = [], lineMats = [];
let selected = null, selectedSection = null, origin = null, lastData = null, poleKey = '', viewName = 'iso';
let scaleEl = null, dirty = true, pendingFit = null, tween = null, renders = 0, sceneRadius = 50;

function kind(w) {
  if (/^RE/i.test(w.code || '')) return 'earth';
  if (w.voltage == null) return 'other';
  return w.voltage > 1 ? 'hv' : 'lv';
}
// Local frame: x = east, y = up (elevation), z = south, metres from the site origin.
function P(e, n, z) { return new THREE.Vector3(e - origin.e, z - origin.z, -(n - origin.n)); }
function visible() { return host && host.clientWidth > 0 && host.clientHeight > 0; }
function invalidate() { dirty = true; }

function mount(el, cb) {
  host = el; onSelect = cb || onSelect;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0xeef3f7);
  host.appendChild(renderer.domElement);
  labels = new CSS2DRenderer(); labels.domElement.className = 'labels3d'; host.appendChild(labels.domElement);
  labels.domElement.style.touchAction = 'none';
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f9aa6, 1.25));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(80, 140, 60); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-60, 40, -80); scene.add(fill);
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 5000);
  camera.position.set(30, 20, 30);
  controls = new OrbitControls(camera, labels.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
  controls.zoomToCursor = true; controls.minDistance = 0.4; controls.maxDistance = 20000;
  controls.zoomSpeed = 1.1; controls.rotateSpeed = 0.8;
  // Middle button (wheel pressed) pans like the right button; stop the browser's middle-click autoscroll.
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  host.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', () => { tween = null; });
  group = new THREE.Group(); scene.add(group);

  compass = document.createElement('div'); compass.className = 'v3compass'; compass.title = 'North arrow and current view';
  compass.innerHTML = '<svg viewBox="-20 -20 40 40" width="44" height="44" aria-hidden="true"><circle r="18" fill="rgba(255,255,255,.85)" stroke="#9aa9b8"/><g class="needle"><path d="M0 -15 L5 0 L0 -3 L-5 0Z" fill="#b42318"/><path d="M0 15 L5 0 L0 3 L-5 0Z" fill="#64748b"/><text y="-6" x="0" font-size="7" text-anchor="middle" fill="#fff" font-weight="700">N</text></g></svg><span class="v3viewname"></span>';
  host.appendChild(compass);
  scaleEl = document.createElement('div'); scaleEl.className = 'v3scale'; scaleEl.title = 'Scale at the orbit point and camera distance';
  scaleEl.innerHTML = '<div class="bar"></div><span class="txt"></span>';
  host.appendChild(scaleEl);
  // Wheel zoom: OrbitControls divides the wheel delta by (devicePixelRatio | 0), which is 0 below 100% browser zoom
  // (Infinity: the camera jumps straight to min / max distance) and takes trackpad / line deltas unscaled. Handle the
  // wheel here instead: about 10% per mouse notch, capped per event, pivoting on the model point under the cursor.
  host.addEventListener('wheel', onWheel, { capture: true, passive: false });

  const ray = new THREE.Raycaster(), m = new THREE.Vector2();
  ray.params.Line2 = { threshold: 6 };
  let down = null;
  labels.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  labels.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    m.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(Object.values(poleMeshes).flat().concat(wireLines), false)[0];
    if (!hit) return onSelect(null);
    const u = hit.object.userData;
    onSelect(u.pole, u.segment ? { segment: u.segment } : undefined);
  });
  labels.domElement.addEventListener('dblclick', (e) => { e.preventDefault(); if (selected) focus(selected); else fit(); });
  host.tabIndex = 0;
  host.addEventListener('keydown', (e) => {
    if (e.target !== host) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { fit(); e.preventDefault(); } else if (k === 'r') { reset(); e.preventDefault(); }
    else if (k === 'z' && selected) { focus(selected); e.preventDefault(); }
  });
  new ResizeObserver(resize).observe(host);
  resize(); loop();
}
function resize() {
  if (!host || !renderer) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  lineMats.forEach((mt) => mt.resolution.set(w, h));
  if (pendingFit) { const p = pendingFit; pendingFit = null; frame(p.box, p.dir, false); }
  invalidate();
}
function clipPlanes() {
  const d = camera.position.distanceTo(controls.target);
  camera.near = Math.max(0.01, Math.min(d * 0.01, 1));
  camera.far = Math.max(1000, d + sceneRadius * 6);
  camera.updateProjectionMatrix();
}
function loop() {
  requestAnimationFrame(loop);
  if (!visible()) return;
  if (tween) {
    const t = Math.min(1, (performance.now() - tween.t0) / tween.ms), s = t * t * (3 - 2 * t);
    camera.position.lerpVectors(tween.p0, tween.p1, s); controls.target.lerpVectors(tween.c0, tween.c1, s);
    if (t >= 1) tween = null;
    dirty = true;
  }
  if (controls.update()) dirty = true;
  if (!dirty) return;
  dirty = false; clipPlanes();
  renderer.render(scene, camera); labels.render(scene, camera); renders++;
  updateCompass();
}
function onWheel(e) {
  e.preventDefault(); e.stopPropagation();
  if (!camera || !controls) return;
  tween = null;
  const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const notches = Math.max(-1.5, Math.min(1.5, px / 100));
  if (!notches) return;
  const k = Math.pow(1.1, notches); // > 1 zooms out
  const r = renderer.domElement.getBoundingClientRect(), m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(m, camera);
  const hit = ray.intersectObjects(Object.values(poleMeshes).flat(), false)[0];
  let pivot = hit && hit.point;
  if (!pivot) { // the point under the cursor at the depth of the orbit target
    const n = camera.getWorldDirection(new THREE.Vector3()), plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, controls.target);
    pivot = ray.ray.intersectPlane(plane, new THREE.Vector3()) || controls.target.clone();
  }
  const d = camera.position.distanceTo(controls.target), nd = Math.max(controls.minDistance, Math.min(controls.maxDistance, d * k)), f = nd / d;
  if (Math.abs(f - 1) < 1e-6) return;
  camera.position.sub(pivot).multiplyScalar(f).add(pivot);
  controls.target.sub(pivot).multiplyScalar(f).add(pivot);
  viewName = 'custom'; invalidate();
}
function niceLen(m) { const p = Math.pow(10, Math.floor(Math.log10(m))), x = m / p; return (x >= 5 ? 5 : x >= 2 ? 2 : 1) * p; }
function fmtLen(v) { return v >= 1000 ? (v / 1000) + ' km' : v >= 1 ? v + ' m' : Math.round(v * 1000) + ' mm'; }
function updateScale() {
  if (!scaleEl || !host.clientHeight) return;
  const d = camera.position.distanceTo(controls.target), mpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / host.clientHeight;
  const len = niceLen(mpp * 110), w = len / mpp;
  scaleEl.querySelector('.bar').style.width = w.toFixed(0) + 'px';
  scaleEl.querySelector('.txt').textContent = fmtLen(len) + ' at the orbit point · camera ' + (d >= 100 ? Math.round(d) : d.toFixed(1)) + ' m away';
  scaleEl.dataset.len = len; scaleEl.dataset.px = w.toFixed(1);
}
function updateCompass() {
  updateScale();
  if (!compass) return;
  // Screen direction of north (-z): project a point north of the target and read the angle on screen.
  const c = controls.target.clone(), a = c.clone().project(camera), b = c.clone().add(new THREE.Vector3(0, 0, -1)).project(camera);
  const ang = Math.atan2(b.x - a.x, (b.y - a.y) / camera.aspect) * 180 / Math.PI;
  compass.querySelector('.needle').setAttribute('transform', 'rotate(' + (isFinite(ang) ? ang.toFixed(1) : 0) + ')');
  compass.querySelector('.v3viewname').textContent = viewName === 'custom' ? '' : viewName.charAt(0).toUpperCase() + viewName.slice(1);
}

function clear() {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); if (o.element) o.element.remove(); });
  group.clear(); poleMeshes = {}; poleParts = {}; wireLines = []; fitObjects = []; lineMats = [];
}
function label(text, pos, cls) {
  const d = document.createElement('div'); d.className = cls || 'l3d'; d.textContent = text;
  const o = new CSS2DObject(d); o.position.copy(pos); group.add(o); return o;
}
function part(obj, pole) { group.add(obj); fitObjects.push(obj); if (pole) (poleParts[pole] = poleParts[pole] || []).push(obj); return obj; }

// data: {poles:[{id,easting,northing,ground,height,sunk,diamTip,diamGL}], axes:[{right}], constructions:[{pole,code,kingbolt,attachments,voltage}],
//        points:[...], wires:[{segment,from,to,code,voltage,sag}], showLabels}
function update(data) {
  lastData = data; if (!scene) return;
  clear();
  const poles = data.poles.filter((p) => isFinite(p.easting) && isFinite(p.northing) && isFinite(p.ground));
  if (!poles.length) { poleKey = ''; invalidate(); return; }
  // Keep the origin for the same site so edits never move the model; re-base only for a different site (> 2 km away).
  const base = Math.min(...poles.map((p) => p.ground - (p.sunk || 0)));
  const newSite = !origin || Math.hypot(poles[0].easting - origin.e, poles[0].northing - origin.n) > 2000;
  if (newSite) origin = { e: poles[0].easting, n: poles[0].northing, z: base };

  // Ground ribbon through the surveyed pole base levels (known only at the poles; straight between them).
  // One ribbon per line (data.ribbons when intersecting lines are drawn, else the poles in order).
  const ribbons = data.ribbons || [poles.map((p, i) => ({ easting: p.easting, northing: p.northing, ground: p.ground, right: data.axes[i] ? data.axes[i].right : [1, 0] }))];
  ribbons.forEach((rb) => {
    rb = rb.filter((p) => isFinite(p.easting) && isFinite(p.northing) && isFinite(p.ground));
    if (rb.length < 2) return;
    const pos = [];
    rb.forEach((p) => {
      const r = p.right;
      [-12, 12].forEach((w) => { const v = P(p.easting + r[0] * w, p.northing + r[1] * w, p.ground); pos.push(v.x, v.y, v.z); });
    });
    const idx = [];
    for (let i = 0; i < rb.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const ribbon = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb9c8a6, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    ribbon.renderOrder = -1; group.add(ribbon);
  });

  poles.forEach((p) => {
    const b = P(p.easting, p.northing, p.ground);
    const rTop = (p.diamTip || 300) / 2000, rGL = (p.diamGL || p.diamTip || 300) / 2000;
    const parts = [];
    if (p.height > 0) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rGL, p.height, 20), new THREE.MeshStandardMaterial({ color: COLORS.pole, roughness: 0.85 }));
      m.position.copy(b).add(new THREE.Vector3(0, p.height / 2, 0)); m.userData.pole = p.id; part(m, p.id); parts.push(m);
    }
    if (p.sunk > 0) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rGL, rGL, p.sunk, 20), new THREE.MeshStandardMaterial({ color: COLORS.embed, transparent: true, opacity: 0.45, depthWrite: false }));
      m.position.copy(b).add(new THREE.Vector3(0, -p.sunk / 2, 0)); m.userData.pole = p.id; part(m, p.id); parts.push(m);
    }
    poleMeshes[p.id] = parts;
    if (data.showLabels !== false) label(p.id, b.clone().add(new THREE.Vector3(0, (p.height || 0) + 1.2, 0)));
  });

  // Crossarms: a bar across the attachment points of each construction, at the king bolt.
  const axisOf = {}; poles.forEach((p, i) => { axisOf[p.id] = data.axes[i] ? data.axes[i].right : [1, 0]; });
  const byPole = {}; poles.forEach((p) => { byPole[p.id] = p; });
  (data.constructions || []).forEach((c) => {
    const p = byPole[c.pole]; if (!p || c.kingbolt == null) return;
    const xs = c.attachments.map((a) => a.x), r = c.axis || axisOf[c.pole];
    const lo = Math.min(0, ...xs), hi = Math.max(0, ...xs);
    if (hi - lo > 0.05) {
      const a = P(p.easting + r[0] * lo, p.northing + r[1] * lo, p.ground + c.kingbolt), b = P(p.easting + r[0] * hi, p.northing + r[1] * hi, p.ground + c.kingbolt);
      const len = a.distanceTo(b), bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: COLORS.arm, roughness: 0.6 }));
      bar.position.copy(a).add(b).multiplyScalar(0.5); bar.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x); part(bar, c.pole);
    }
  });
  (data.points || []).forEach((q) => {
    const v = P(q.easting, q.northing, q.elevation);
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 10), new THREE.MeshStandardMaterial({ color: 0xd4d4d8 }));
    ins.position.copy(v).add(new THREE.Vector3(0, -0.09, 0)); part(ins, q.pole);
  });

  // Conductors: one line per phase, between matching attachment points, with sag only when it was calculated.
  const w0 = host.clientWidth || 1, h0 = host.clientHeight || 1;
  (data.wires || []).forEach((w) => {
    const a = P(w.from.easting, w.from.northing, w.from.elevation), b = P(w.to.easting, w.to.northing, w.to.elevation), pts = [];
    const vs = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24, v = a.clone().lerp(b, t); if (w.sag) v.y -= 4 * w.sag * t * (1 - t); pts.push(v.x, v.y, v.z); vs.push(v); }
    const g = new LineGeometry(); g.setPositions(pts);
    const mt = new LineMaterial({ color: COLORS[kind(w)], linewidth: WIRE_PX, worldUnits: false });
    mt.resolution.set(w0, h0); lineMats.push(mt);
    const line = new Line2(g, mt); line.computeLineDistances();
    line.userData = { segment: w.segment, pole: w.from.pole, color: COLORS[kind(w)], pts: vs };
    group.add(line); wireLines.push(line); fitObjects.push(line);
    if (data.showLabels !== false && w.sag && w.phase === 1) label('sag ' + w.sag.toFixed(2) + ' m', vs[12].clone().add(new THREE.Vector3(0, -0.6, 0)), 'l3d sag');
  });

  // Reference grid on the lowest pole base (not part of the fit).
  const ext = poles.reduce((m, p) => Math.max(m, Math.abs(p.easting - origin.e), Math.abs(p.northing - origin.n)), 20);
  const grid = new THREE.GridHelper(Math.ceil(ext * 2.4 / 10) * 10, Math.ceil(ext * 2.4 / 10), 0xc5d0db, 0xdde4ea);
  grid.position.y = Math.min(...poles.map((p) => p.ground)) - origin.z - 0.02; grid.material.depthWrite = false; grid.renderOrder = -2; group.add(grid);

  const box = bounds(fitObjects); sceneRadius = Math.max(10, box.getBoundingSphere(new THREE.Sphere()).radius);
  controls.maxDistance = Math.max(200, sceneRadius * 12);
  setSelected(selected); selectSection(selectedSection);
  // Re-fit when a different set of poles is shown (new site, poles added or removed) and the line has left the view.
  const key = poles.map((p) => p.id).join('|');
  if (newSite || !poleKey) fit(newSite ? 'iso' : undefined, { instant: true });
  else if (key !== poleKey && !inView(fitPoints(fitObjects))) fit(undefined, {});
  poleKey = key; invalidate();
}

function bounds(list) {
  const box = new THREE.Box3();
  list.forEach((o) => {
    if (o.isLine2) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); box.union(b); }
    else box.expandByObject(o);
  });
  return box;
}
// The points the camera has to keep in view: the corners of each pole, crossarm and insulator, and the vertices of each
// wire. Framing these (not one axis-aligned box round the whole line) fits a diagonal line tightly.
function fitPoints(list) {
  const out = [], b = new THREE.Box3();
  list.forEach((o) => {
    if (o.isLine2) { (o.userData.pts || []).forEach((v) => out.push(v)); return; }
    b.makeEmpty().expandByObject(o); if (!b.isEmpty()) corners(b).forEach((v) => out.push(v));
  });
  return out;
}
function corners(box) {
  const a = box.min, b = box.max, out = [];
  for (let i = 0; i < 8; i++) out.push(new THREE.Vector3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z));
  return out;
}
function inView(pts) {
  camera.updateMatrixWorld();
  return pts.every((c) => { const v = c.clone().project(camera); return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1; });
}
function lineDir() {
  const ps = (lastData && lastData.poles || []).filter((p) => isFinite(p.easting) && isFinite(p.northing));
  const a = ps[0], b = ps[ps.length - 1];
  if (a && b && (a.easting !== b.easting || a.northing !== b.northing)) {
    const L = Math.hypot(b.easting - a.easting, b.northing - a.northing);
    return new THREE.Vector3((b.easting - a.easting) / L, 0, -(b.northing - a.northing) / L);
  }
  return new THREE.Vector3(1, 0, 0);
}
// Direction from the target to the camera for the named views, worked out from the line direction.
function viewDir(name) {
  const along = lineDir(), side = new THREE.Vector3(-along.z, 0, along.x), up = new THREE.Vector3(0, 1, 0);
  if (name === 'side') return side.clone().addScaledVector(up, 0.06).normalize();
  if (name === 'front') return along.clone().negate().addScaledVector(up, 0.08).normalize();
  if (name === 'top') return up.clone().addScaledVector(side, 0.002).normalize();
  if (name === 'iso') return side.clone().multiplyScalar(0.8).addScaledVector(along, 0.32).addScaledVector(up, 0.5).normalize();
  return camera.position.clone().sub(controls.target).normalize();
}
// Exact framing: for each point, the camera distance that keeps it inside both the vertical and horizontal field of view.
function frame(ks, dir, animate) {
  if (!ks || !ks.length) return false;
  if (!visible()) { pendingFit = { box: ks, dir: dir.clone() }; return false; }
  const c = new THREE.Box3().setFromPoints(ks).getCenter(new THREE.Vector3());
  const fwd = dir.clone().negate(), right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), th = tv * camera.aspect, margin = 1.15;
  let d = 0;
  ks.forEach((k) => {
    const r = k.clone().sub(c), x = Math.abs(r.dot(right)) * margin, y = Math.abs(r.dot(up)) * margin, z = r.dot(fwd);
    d = Math.max(d, x / th - z, y / tv - z);
  });
  // That distance keeps every corner in view about the box centre; perspective then leaves the box off-centre, so
  // re-centre the projected box and tighten the distance against the real projection a few times.
  for (let it = 0; it < 6; it++) {
    const p = c.clone().addScaledVector(dir, d);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zx0 = d, zx1 = d, zy0 = d, zy1 = d, behind = false;
    ks.forEach((k) => {
      const r = k.clone().sub(p), z = r.dot(fwd);
      if (z <= 1e-3) { behind = true; return; }
      const x = r.dot(right) / (z * th), y = r.dot(up) / (z * tv);
      if (x < x0) { x0 = x; zx0 = z; } if (x > x1) { x1 = x; zx1 = z; } if (y < y0) { y0 = y; zy0 = z; } if (y > y1) { y1 = y; zy1 = z; }
    });
    if (behind) { d *= 1.5; continue; }
    // Moving the view sideways by s shifts a point at depth z by s / (z tan): solve for the shift that balances the two extremes.
    c.addScaledVector(right, (x0 + x1) / (1 / (zx0 * th) + 1 / (zx1 * th))).addScaledVector(up, (y0 + y1) / (1 / (zy0 * tv) + 1 / (zy1 * tv)));
    d *= Math.max(0.5, Math.min(2, Math.max((x1 - x0) / 2, (y1 - y0) / 2) * margin));
  }
  d = Math.max(d, controls.minDistance * 2, 2);
  const p1 = c.clone().addScaledVector(dir, d);
  if (animate) tween = { t0: performance.now(), ms: 380, p0: camera.position.clone(), p1: p1, c0: controls.target.clone(), c1: c };
  else { tween = null; camera.position.copy(p1); controls.target.copy(c); }
  // Clear damping momentum so the camera does not keep drifting after the fit.
  const damp = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damp;
  invalidate(); return true;
}
function fit(name, opt) {
  if (!controls) return false;
  opt = opt || {};
  if (name) viewName = name;
  return frame(fitPoints(fitObjects), viewDir(name), !opt.instant);
}
function view(name) { return fit(name || 'iso'); }
function reset() { return fit('iso'); }
function focus(id) {
  const list = poleParts[id]; if (!list || !list.length) return false;
  // The pole with its crossarms and insulators, at least 4 m wide so a bare pole is not framed edge to edge.
  const box = bounds(list), s = box.getSize(new THREE.Vector3());
  box.expandByVector(new THREE.Vector3(Math.max(0, 4 - s.x) / 2, 0.5, Math.max(0, 4 - s.z) / 2));
  return frame(corners(box), viewDir(), true);
}
function setSelected(id) {
  selected = id;
  Object.entries(poleMeshes).forEach(([pid, parts]) => parts.forEach((m, i) => { if (m.material.emissive) m.material.emissive.setHex(pid === id && i === 0 ? 0x7a4a00 : 0x000000); }));
  invalidate();
}
function selectSection(name) {
  selectedSection = name || null;
  wireLines.forEach((l) => {
    const on = selectedSection && l.userData.segment === selectedSection;
    l.material.linewidth = on ? WIRE_SEL_PX : WIRE_PX; l.material.color.setHex(on ? COLORS.sel : l.userData.color);
  });
  invalidate();
}
function snapshot() { clipPlanes(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }
// For tests: camera state and where the fitted box lands on screen (NDC, -1..1).
function state() {
  camera.updateMatrixWorld();
  const pts = fitPoints(fitObjects), ndc = pts.length ? pts.map((c) => c.clone().project(camera)) : null;
  return {
    view: viewName, near: camera.near, far: camera.far, renders: renders, distance: camera.position.distanceTo(controls.target),
    target: controls.target.toArray(), position: camera.position.toArray(), selectedSection: selectedSection,
    screen: ndc && { minX: Math.min(...ndc.map((v) => v.x)), maxX: Math.max(...ndc.map((v) => v.x)), minY: Math.min(...ndc.map((v) => v.y)), maxY: Math.max(...ndc.map((v) => v.y)) },
    wires: wireLines.length, poles: Object.keys(poleMeshes).length, tweening: !!tween, scale: scaleEl && { len: +scaleEl.dataset.len, px: +scaleEl.dataset.px, text: scaleEl.querySelector('.txt').textContent },
    // screen position (CSS px in the host) of the middle of the first wire, so tests can click it
    wireAt: wireLines.length ? (() => { const l = wireLines[0], v = l.userData.pts[12].clone().project(camera); return { segment: l.userData.segment, x: (v.x + 1) / 2 * host.clientWidth, y: (1 - v.y) / 2 * host.clientHeight }; })() : null
  };
}

window.PNW3D = { mount, update, fit, view, reset, select: setSelected, selectSection, focus, resize, snapshot, state, colors: COLORS };
window.dispatchEvent(new Event('pnw3d-ready'));
