/* Poles & Wires Ground Profile: UI. All processing is in the browser; the engineering rules live in pnw-core.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (v, dp) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '' : (dp == null ? String(v) : Number(v).toFixed(dp)); };
  var KEY = 'eve-poles-wires-project-v1', MAX_BYTES = 50 * 1024 * 1024;
  var DEFAULT_SETTINGS = { createdBy: '', optionSet: 'v7 REGION AM-SL1', clr1: 5.8, clr2: 7 }; // values from Ishan's saved MP219050.pnwx

  /* ---------- state ---------- */
  var S = blank(), buffers = {}, merged = { poles: {}, issues: [] }, built = null, allIssues = [], flags = {};
  var M = window.PNWModel, lib = null, project = null, linked = null, dm = null, undoStack = [], redoStack = [];
  var sortCol = 'order', sortDesc = false, tab = 'poles';
  function blank() { return { zone: 50, settings: Object.assign({}, DEFAULT_SETTINGS), files: [], profiles: [newProfile('Profile 1')], active: 0, selected: null, labels: true, generated: false, view: 'plan', sag: false, design: blankDesign() }; }
  function blankDesign() { return { link: null, xml: null, register: {}, log: [] }; }
  function newProfile(name) { return { name: name, poleIds: [], lengths: {}, comments: {}, segments: [] }; }
  function prof() { return S.profiles[S.active]; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { setStatus('Could not save the project in this browser (' + e.message + '). Your work stays until you close the page.', 'bad'); }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY); if (!raw) return;
      var s = JSON.parse(raw, function (k, v) { return k === 'date' && typeof v === 'string' ? new Date(v) : v; });
      if (s && Array.isArray(s.files) && Array.isArray(s.profiles) && s.profiles.length) { S = Object.assign(blank(), s); S.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings); S.design = Object.assign(blankDesign(), s.design); }
    } catch (e) { /* storage unavailable or corrupt: start clean */ }
  }

  var IN_CLAUDE = !!window.PNW_ARTIFACT;
  function setStatus(t, cls) { var n = $('status'); n.textContent = t; n.className = 'status' + (cls ? ' ' + cls : ''); }

  /* ---------- layout: project panel | viewport + table dock | inspector, each resizable and collapsible ---------- */
  var UI_KEY = 'eve-poles-wires-ui-v1', U = { lw: Math.round(Math.min(300, window.innerWidth * 0.2)), rw: Math.round(Math.min(390, window.innerWidth * 0.27)), dh: Math.round(Math.min(250, window.innerHeight * 0.28)), left: true, right: true, dock: true, dockMin: false, insTab: 'pole', tab: 'poles' };
  try { Object.assign(U, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* storage blocked: defaults */ }
  function saveUi() { try { localStorage.setItem(UI_KEY, JSON.stringify(U)); } catch (e) { /* ignore */ } }
  var LIMITS = { lw: [220, 560], rw: [300, 680], dh: [120, 2000] };
  function clampUi() {
    var W = window.innerWidth, H = $('center') ? $('center').clientHeight : 600;
    U.lw = Math.max(LIMITS.lw[0], Math.min(LIMITS.lw[1], U.lw, W * 0.32));
    U.rw = Math.max(LIMITS.rw[0], Math.min(LIMITS.rw[1], U.rw, W * 0.4));
    U.dh = Math.max(LIMITS.dh[0], Math.min(U.dh, Math.max(LIMITS.dh[0], H - 220)));
  }
  function applyLayout() {
    var ws = $('workspace'), c = $('center');
    // The workspace fills the window below the toolbar; the page itself never scrolls sideways.
    var top = ws.getBoundingClientRect().top + window.scrollY;
    ws.style.setProperty('--wsh', Math.max(540, window.innerHeight - top - 10) + 'px');
    clampUi();
    ws.style.setProperty('--lw', U.lw + 'px'); ws.style.setProperty('--rw', U.rw + 'px'); c.style.setProperty('--dh', U.dh + 'px');
    ws.classList.toggle('no-left', !U.left); ws.classList.toggle('no-right', !U.right);
    $('dock').hidden = !U.dock; c.classList.toggle('dock-min', U.dock && U.dockMin);
    c.style.gridTemplateRows = U.dock ? '' : 'minmax(0,1fr) 0 0';
    document.querySelector('.gutter.gh').hidden = !U.dock || U.dockMin;
    $('dockMin').textContent = U.dockMin ? '▴' : '▾';
    [['tbSide', U.left], ['tbInspector', U.right], ['tbDock', U.dock && !U.dockMin]].forEach(function (x) { $(x[0]).classList.toggle('on', x[1]); $(x[0]).setAttribute('aria-pressed', x[1]); });
    saveUi();
    if (map && map.invalidateSize) setTimeout(function () { map.invalidateSize(); }, 30);
  }
  // Dragging (or arrow keys on) a gutter resizes the panel next to it.
  Array.prototype.forEach.call(document.querySelectorAll('.gutter'), function (g) {
    var k = g.dataset.resize, start = null;
    function set(v) { if (k === 'left') U.lw = v; else if (k === 'right') U.rw = v; else U.dh = v; applyLayout(); }
    function cur() { return k === 'left' ? U.lw : k === 'right' ? U.rw : U.dh; }
    g.addEventListener('pointerdown', function (e) { start = { x: e.clientX, y: e.clientY, v: cur() }; g.setPointerCapture(e.pointerId); g.classList.add('drag'); e.preventDefault(); });
    g.addEventListener('pointermove', function (e) { if (!start) return; var d = k === 'dock' ? start.y - e.clientY : k === 'left' ? e.clientX - start.x : start.x - e.clientX; set(start.v + d); });
    g.addEventListener('pointerup', function () { start = null; g.classList.remove('drag'); });
    g.addEventListener('dblclick', function () { set(k === 'left' ? 300 : k === 'right' ? 390 : 250); });
    g.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 60 : 20, d = 0;
      if (k === 'dock') d = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
      else d = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      if (k === 'right') d = -d;
      if (d) { e.preventDefault(); set(cur() + d); }
    });
  });
  window.addEventListener('resize', applyLayout);
  // Project settings inputs follow the state (after start-up, opening a project file or starting a new project).
  function syncInputs() {
    $('zone').value = S.zone; $('createdBy').value = S.settings.createdBy || ''; $('optionSet').value = S.settings.optionSet || ''; $('clr1').value = S.settings.clr1 == null ? '' : S.settings.clr1; $('clr2').value = S.settings.clr2 == null ? '' : S.settings.clr2;
    $('tbLabels').classList.toggle('on', S.labels); $('tbLabels').setAttribute('aria-pressed', S.labels);
  }

  /* ---------- map ---------- */
  // Default wheel zoom is a whole level (2×) per notch; quarter levels make one notch about 1.4×.
  var map = L.map('map', { zoomControl: true, maxZoom: 21, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 200, wheelDebounceTime: 60 }).setView([-31.95, 115.86], 11);
  L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 140 }).addTo(map);
  var bases = {
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 21, maxNativeZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' })
  };
  // Inside Claude (window.PNW_ARTIFACT) the page cannot load map tiles from other hosts, so there is no basemap there.
  var activeBase = IN_CLAUDE ? null : bases.street.addTo(map);
  $('basemap').onchange = function () { if (activeBase) map.removeLayer(activeBase); activeBase = bases[this.value] ? bases[this.value].addTo(map) : null; };
  var lyGis = L.layerGroup().addTo(map), lyAlign = L.layerGroup().addTo(map), lySpan = L.layerGroup().addTo(map), lySurvey = L.layerGroup().addTo(map), lyExtent = L.layerGroup(), lySel = L.layerGroup().addTo(map);
  var markers = {};
  map.on('click', function () { select(null); });

  function toLatLng(e, n) {
    if (e == null || n == null || !isFinite(e) || !isFinite(n)) return null;
    var def = '+proj=utm +zone=' + S.zone + ' +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    try { var ll = proj4(def, 'EPSG:4326', [e, n]); return isFinite(ll[0]) && isFinite(ll[1]) ? L.latLng(ll[1], ll[0]) : null; } catch (x) { return null; }
  }
  function poleLatLng(p) { return p.survey ? toLatLng(p.survey.easting, p.survey.northing) : null; }
  function levelFor(id) { var l = null; allIssues.forEach(function (i) { if (i.poleId === id) { if (i.level === 'error') l = 'error'; else if (i.level === 'warning' && l !== 'error') l = 'warning'; } }); return l; }

  function renderMap() {
    [lyGis, lyAlign, lySpan, lySurvey, lyExtent, lySel].forEach(function (l) { l.clearLayers(); });
    markers = {};
    var inProf = {}; prof().poleIds.forEach(function (id) { inProf[id] = 1; });
    var ids = Object.keys(merged.poles), pts = [];
    ids.forEach(function (id) {
      var p = merged.poles[id], ll = poleLatLng(p), lvl = levelFor(id);
      if (p.gis && p.gis.lat != null) {
        var g = L.latLng(p.gis.lat, p.gis.lng);
        L.marker(g, { icon: L.divIcon({ className: '', html: '<div style="width:12px;height:12px;border:2px dashed #7a8a9c;border-radius:2px"></div>', iconSize: [12, 12] }), keyboard: false })
          .bindTooltip(esc(id) + ' · GIS position (approximate)').on('click', function (e) { L.DomEvent.stopPropagation(e); select(id); }).addTo(lyGis);
        if (ll) L.polyline([g, ll], { color: '#7a8a9c', weight: 1, dashArray: '3 3' }).addTo(lyGis);
        if (!ll) pts.push(g);
      }
      if (!ll) return;
      pts.push(ll);
      var m = L.circleMarker(ll, { radius: 7, weight: 3, color: lvl === 'error' ? '#b42318' : '#2f6ea4', fillColor: inProf[id] ? '#2f6ea4' : '#fff', fillOpacity: 1 })
        .on('click', function (e) { L.DomEvent.stopPropagation(e); select(id); }).addTo(lySurvey);
      if (S.labels) m.bindTooltip(esc(id), { permanent: true, direction: 'right', offset: [8, 0], className: 'pole-label' });
      else m.bindTooltip(esc(id));
      markers[id] = m;
    });
    if (built) {
      var line = built.rows.map(function (r) { return toLatLng(r.easting, r.northing); });
      for (var i = 1; i < line.length; i++) {
        if (!line[i - 1] || !line[i]) continue;
        var seg = L.polyline([line[i - 1], line[i]], { color: '#0f766e', weight: 3, opacity: .85 }).addTo(lyAlign);
        seg.bindTooltip('Span ' + esc(built.rows[i - 1].id) + ' → ' + esc(built.rows[i].id) + ': ' + fmt(built.rows[i].span, 2) + ' m (derived from survey E/N)');
        L.tooltip({ permanent: true, direction: 'center', className: 'span-label' }).setLatLng(L.latLng((line[i - 1].lat + line[i].lat) / 2, (line[i - 1].lng + line[i].lng) / 2)).setContent(fmt(built.rows[i].span, 2) + ' m').addTo(lySpan);
      }
    }
    if (pts.length) L.rectangle(L.latLngBounds(pts).pad(0.15), { color: '#64748b', weight: 1, dashArray: '6 4', fill: false }).addTo(lyExtent);
    $('emptyMap').hidden = ids.length > 0;
    highlight();
  }
  function bounds() {
    var b = L.latLngBounds([]);
    lySurvey.eachLayer(function (l) { b.extend(l.getLatLng()); });
    if (!b.isValid()) lyGis.eachLayer(function (l) { if (l.getLatLng) b.extend(l.getLatLng()); });
    return b;
  }
  function fit() { var b = bounds(); if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 19 }); }
  function highlight() {
    lySel.clearLayers();
    var id = S.selected; if (!id || !merged.poles[id]) return;
    var p = merged.poles[id], ll = poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null);
    if (ll) L.circleMarker(ll, { radius: 14, weight: 3, color: '#f59e0b', fill: false, interactive: false }).addTo(lySel);
    if (built) {
      var k = built.rows.findIndex(function (r) { return r.id === id; });
      [k - 1, k + 1].forEach(function (j) {
        if (k < 0 || j < 0 || j >= built.rows.length) return;
        var a = toLatLng(built.rows[k].easting, built.rows[k].northing), b = toLatLng(built.rows[j].easting, built.rows[j].northing);
        if (a && b) L.polyline([a, b], { color: '#f59e0b', weight: 6, opacity: .6, interactive: false }).addTo(lySel);
      });
    }
  }
  function zoomTo(id) { var p = merged.poles[id]; if (!p) return; var ll = poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null); if (ll) map.setView(ll, Math.max(map.getZoom(), 19)); else setStatus(id + ' has no location to zoom to.', 'bad'); }

  /* ---------- import ---------- */
  var worker = null, wid = 0, waiting = {};
  try { if (IN_CLAUDE) throw new Error('parse on the main thread inside Claude'); worker = new Worker('worker.js'); worker.onmessage = function (e) { var w = waiting[e.data.id]; delete waiting[e.data.id]; if (w) e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.result); }; worker.onerror = function () { worker = null; }; } catch (e) { worker = null; }
  function parse(name, buf, role) {
    if (worker) return new Promise(function (resolve, reject) { var id = ++wid; waiting[id] = { resolve: resolve, reject: reject }; worker.postMessage({ id: id, name: name, buffer: buf.slice(0), role: role }); })
      .catch(function (e) { if (/importScripts|NetworkError|Failed to execute/i.test(e.message)) { worker = null; return PNW.importFile(XLSX, name, buf, role); } throw e; });
    return Promise.resolve().then(function () { return PNW.importFile(XLSX, name, buf, role); });
  }

  function addFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    var pj = arr.filter(function (f) { return /\.pwproj\.json$/i.test(f.name); });
    if (pj.length) { openProjectFile(pj[0]); arr = arr.filter(function (f) { return pj.indexOf(f) < 0; }); }
    if (!arr.length) return;
    var existed = {}; S.files.forEach(function (f) { existed[f.name] = 1; });
    var jobs = arr.map(function (f) {
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['xlsx', 'xls', 'csv', 'xlsm', 'pnwx', 'txt', 'json'].indexOf(ext) < 0) return Promise.resolve({ name: f.name, size: f.size, role: 'unknown', status: 'error', items: [], sheets: [], issues: [{ level: 'error', code: 'file-type', message: f.name + ': only .xlsx, .xls, .csv, .pnwx, PNW library or DCSH .txt and DCSH register .json files can be imported.', file: f.name }] });
      if (f.size > MAX_BYTES) return Promise.resolve({ name: f.name, size: f.size, role: 'unknown', status: 'error', items: [], sheets: [], issues: [{ level: 'error', code: 'file-size', message: f.name + ' is larger than 50 MB.', file: f.name }] });
      upsertFile({ name: f.name, size: f.size, role: '…', status: 'reading', items: [], sheets: [], issues: [] });
      return f.arrayBuffer().then(function (buf) {
        buffers[f.name] = buf;
        if (ext === 'pnwx' || ext === 'txt' || ext === 'json') return importText(f.name, new TextDecoder('utf-8').decode(buf));
        return parse(f.name, buf, null);
      }).then(function (res) { res.size = f.size; res.status = 'ok'; return res; })
        .catch(function (e) { return { name: f.name, size: f.size, role: 'unknown', status: 'error', items: [], sheets: [], issues: [{ level: 'error', code: 'parse', message: f.name + ' could not be read: ' + e.message, file: f.name }] }; });
    });
    setStatus('Reading ' + arr.length + ' file' + (arr.length > 1 ? 's' : '') + '…');
    Promise.all(jobs).then(function (results) {
      var replaced = 0;
      results.forEach(function (r) { upsertFile(r); if (existed[r.name]) replaced++; });
      var hadPoles = prof().poleIds.length > 0;
      recompute();
      if (!hadPoles) { if (project) useProject(true); else seedProfile(); }
      recompute(); fit();
      setStatus('Imported ' + results.length + ' file' + (results.length > 1 ? 's' : '') + (replaced ? ' (' + replaced + ' replaced)' : '') + '. ' + summaryText(), 'good');
    });
  }
  function upsertFile(r) {
    var i = S.files.findIndex(function (f) { return f.name === r.name; });
    if (i >= 0) { S.files[i] = r; renderFiles(); return true; }
    S.files.push(r); renderFiles(); return false;
  }
  function seedProfile() {
    var ids = Object.keys(merged.poles).filter(function (id) { return merged.poles[id].survey; });
    if (ids.length) prof().poleIds = PNW.autoOrder(merged.poles, ids);
  }
  function summaryText() {
    var e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length;
    return Object.keys(merged.poles).length + ' poles, ' + e + ' error' + (e === 1 ? '' : 's') + ', ' + w + ' warning' + (w === 1 ? '' : 's') + '.';
  }

  function reassign(name, role) {
    var buf = buffers[name];
    if (!buf) { setStatus('Drop ' + name + ' again to change its role (the original file is not kept after a page reload).', 'bad'); renderFiles(); return; }
    parse(name, buf, role).then(function (res) { res.size = buf.byteLength; res.status = 'ok'; upsertFile(res); recompute(); setStatus(name + ' is now treated as ' + PNW.ROLES[role] + '.', 'good'); })
      .catch(function (e) { setStatus(name + ': ' + e.message, 'bad'); });
  }

  /* ---------- recompute and render ---------- */
  function recompute() {
    syncDesign();
    var ok = S.files.filter(function (f) { return f.status === 'ok' && !TEXT_ROLES[f.role]; });
    merged = PNW.buildPoles(ok.concat(projectSurvey(ok)));
    var p = prof();
    built = p.poleIds.length ? PNW.buildProfile(merged.poles, p) : null;
    buildDesignModel();
    var seen = {};
    allIssues = [].concat.apply([], S.files.map(function (f) { return f.issues || []; })).concat(merged.issues, built ? built.issues : [], dm ? dm.issues : []).filter(function (i) { var k = i.level + i.message; if (seen[k]) return false; seen[k] = 1; return true; });
    trackHistory(); renderAll(); save();
  }
  function renderAll() { renderFiles(); renderProfile(); renderSegments(); renderMap(); renderTable(); renderSelected(); renderValidation(); renderSteps(); renderViews(); renderHistory(); }

  function renderSteps() {
    var hasFiles = S.files.length > 0, done = [hasFiles, hasFiles, !!S.selected || (built && built.rows.length > 1), S.generated, !!flags.reviewed, !!flags.exported];
    var now = done.indexOf(false);
    Array.prototype.forEach.call($('steps').children, function (li, i) { li.className = done[i] ? 'done' : (i === now ? 'now' : ''); });
    var e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length;
    $('issueCount').textContent = e + w; $('issueCount').className = 'pill ' + (e ? 'bad' : w ? 'warn' : 'mute');
  }

  function renderFiles() {
    $('fileCount').textContent = S.files.length ? S.files.length + ' file' + (S.files.length > 1 ? 's' : '') : '';
    $('files').innerHTML = S.files.map(function (f, i) {
      var errs = (f.issues || []).filter(function (x) { return x.level === 'error'; }).length, warns = (f.issues || []).filter(function (x) { return x.level === 'warning'; }).length;
      var st = f.status === 'reading' ? '<span class="pill info">Reading…</span>' : f.status === 'error' ? '<span class="pill bad">Failed</span>' : errs ? '<span class="pill bad">' + errs + ' error' + (errs > 1 ? 's' : '') + '</span>' : warns ? '<span class="pill warn">' + warns + ' warning' + (warns > 1 ? 's' : '') + '</span>' : f.role === 'unknown' ? '<span class="pill warn">Choose role</span>' : '<span class="pill ok">OK</span>';
      var count = f.summary || (f.role === 'inspections' ? (f.items || []).length + ' poles' : (f.items || []).length + ' records');
      var opts = Object.keys(PNW.ROLES).map(function (r) { return '<option value="' + r + '"' + (r === f.role ? ' selected' : '') + '>' + PNW.ROLES[r] + '</option>'; }).join('');
      var conf = f.confidence === 'manual' ? 'set by you' : f.confidence === 'high' ? 'detected from headers' : f.confidence === 'medium' ? 'guessed, please check' : '';
      var heads = (f.sheets || []).map(function (s) { return '<div><b>' + esc(s.name) + '</b> · ' + s.rows + ' rows<br>' + esc(s.headers.join(' | ')) + '</div>'; }).join('');
      return '<div class="file"><div class="fn">' + esc(f.name) + '</div><div class="meta">' + (f.name.split('.').pop() || '').toUpperCase() + ' · ' + (f.size / 1024).toFixed(1) + ' KB · ' + count + (f.sheetUsed ? ' · sheet ' + esc(f.sheetUsed) + ', header row ' + f.headerRow : '') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">' + st + '<span class="meta">' + conf + '</span></div>' +
        (TEXT_ROLES[f.role] ? '<div class="meta"><b>' + TEXT_ROLES[f.role] + '</b>' + (f.role === 'pnwx' && f.kind === 'profile' ? (S.design.link === f.name ? ' · <span class="pill info">linked design</span>' : ' · <button class="btn small" data-link="' + i + '">Use as design</button>') : '') + '</div>' :
        '<select data-role="' + i + '" aria-label="Role of ' + esc(f.name) + '">' + opts + '</select>') +
        '<details><summary>Sheets and headers</summary><div class="heads">' + heads + '</div></details>' +
        '<div class="acts"><button class="btn small" data-replace="' + i + '">Replace…</button><button class="btn small" data-remove="' + i + '">Remove</button></div></div>';
    }).join('') + builtinNote();
  }
  function builtinNote() {
    var roles = Object.keys(BUILTIN); if (!roles.length) return '';
    return '<p class="hint">Built in: ' + roles.map(function (r) { var used = filesOf(r)[0] === BUILTIN[r]; return esc(BUILTIN[r].name) + (used ? '' : ' <small>(replaced by your file)</small>'); }).join(' · ') + '. Drop your own file to use a newer copy.</p>';
  }
  $('files').addEventListener('change', function (e) { var i = e.target.dataset.role; if (i != null) reassign(S.files[+i].name, e.target.value); });
  var replaceIdx = null;
  $('files').addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.dataset.remove != null) { var f = S.files.splice(+t.dataset.remove, 1)[0]; delete buffers[f.name]; recompute(); setStatus('Removed ' + f.name + '.'); }
    if (t.dataset.replace != null) { replaceIdx = +t.dataset.replace; $('fileInput').click(); }
    if (t.dataset.link != null) { linkDesign(S.files[+t.dataset.link].name); }
  });

  /* ---------- profile alignment ---------- */
  function renderProfile() {
    $('profileSel').innerHTML = S.profiles.map(function (p, i) { return '<option value="' + i + '"' + (i === S.active ? ' selected' : '') + '>' + esc(p.name || 'Profile ' + (i + 1)) + '</option>'; }).join('');
    var p = prof(); $('profileName').value = p.name || '';
    $('alignCount').textContent = p.poleIds.length ? p.poleIds.length + ' poles' : '';
    $('useRef').hidden = !S.files.some(function (f) { return f.role === 'groundProfile' && f.items.length; });
    var rows = built ? built.rows : [];
    $('alignList').innerHTML = p.poleIds.map(function (id, i) {
      var r = rows.filter(function (x) { return x.id === id; })[0] || {}, pole = merged.poles[id], ex = pole ? PNW.existingLength(pole) : { value: null };
      var edited = p.lengths[id] != null, lvl = levelFor(id);
      var sub = r.chainage != null ? 'ch ' + fmt(r.chainage, 2) + ' m' + (r.span != null ? ' · span ' + fmt(r.span, 2) : '') : (pole && pole.survey ? '' : 'not surveyed');
      return '<li class="' + (S.selected === id ? 'sel' : '') + '"><span class="n">' + (i + 1) + '</span><span class="id" data-pick="' + esc(id) + '">' + esc(id) + (lvl ? ' <span class="pill ' + (lvl === 'error' ? 'bad' : 'warn') + '">' + lvl + '</span>' : '') + '<small>' + sub + '</small></span>' +
        '<input data-len="' + esc(id) + '" class="' + (edited ? 'edited' : '') + '" value="' + fmt(edited ? p.lengths[id] : ex.value) + '" inputmode="decimal" aria-label="Pole length for ' + esc(id) + ' in metres" title="' + (edited ? 'Edited. Existing: ' + fmt(ex.value) + ' m (' + (ex.source || 'none') + '). Clear to revert.' : 'Existing length from ' + (ex.source || 'no source') + '. Type to change.') + '">' +
        '<span class="mini"><button data-up="' + i + '" title="Move up" aria-label="Move up">↑</button><button data-down="' + i + '" title="Move down" aria-label="Move down">↓</button><button data-del="' + i + '" title="Remove from profile" aria-label="Remove">✕</button></span></li>';
    }).join('');
  }
  $('alignList').addEventListener('click', function (e) {
    var t = e.target.closest('[data-up],[data-down],[data-del],[data-pick]'); if (!t) return;
    var ids = prof().poleIds;
    if (t.dataset.pick) { select(t.dataset.pick); zoomTo(t.dataset.pick); return; }
    if (t.dataset.del != null) ids.splice(+t.dataset.del, 1);
    if (t.dataset.up != null && +t.dataset.up > 0) { var i = +t.dataset.up; ids.splice(i - 1, 0, ids.splice(i, 1)[0]); }
    if (t.dataset.down != null && +t.dataset.down < ids.length - 1) { var j = +t.dataset.down; ids.splice(j + 1, 0, ids.splice(j, 1)[0]); }
    S.generated = false; recompute();
  });
  $('alignList').addEventListener('change', function (e) {
    var id = e.target.dataset.len; if (!id) return;
    var v = e.target.value.trim(), p = prof(), ex = merged.poles[id] ? PNW.existingLength(merged.poles[id]).value : null;
    if (v === '') delete p.lengths[id];
    else { var n = PNW.num(v); if (!(n > 0) || n > 60) { setStatus(id + ': "' + v + '" is not a valid pole length in metres.', 'bad'); renderProfile(); return; } if (n === ex) delete p.lengths[id]; else p.lengths[id] = n; }
    S.generated = false; recompute();
  });
  $('profileSel').onchange = function () { S.active = +this.value; S.generated = false; recompute(); };
  $('profileName').onchange = function () { prof().name = this.value.trim(); recompute(); };
  $('newProfile').onclick = function () { S.profiles.push(newProfile('Profile ' + (S.profiles.length + 1))); S.active = S.profiles.length - 1; S.generated = false; recompute(); setStatus('New empty profile. Add poles from the map.'); };
  $('delProfile').onclick = function () { if (S.profiles.length < 2) { S.profiles[0] = newProfile('Profile 1'); } else { S.profiles.splice(S.active, 1); S.active = 0; } S.generated = false; recompute(); };
  $('allPoles').onclick = function () { seedProfile(); S.generated = false; recompute(); };
  $('autoOrder').onclick = function () { prof().poleIds = PNW.autoOrder(merged.poles, prof().poleIds); S.generated = false; recompute(); };
  $('reverse').onclick = function () { prof().poleIds.reverse(); S.generated = false; recompute(); };
  $('useRef').onclick = function () {
    var ref = S.files.filter(function (f) { return f.role === 'groundProfile'; })[0]; if (!ref) return;
    var p = prof(); p.poleIds = []; p.lengths = {}; p.comments = {};
    ref.items.filter(function (x) { return x.id; }).forEach(function (x) {
      p.poleIds.push(x.id);
      var ex = merged.poles[x.id] ? PNW.existingLength(merged.poles[x.id]).value : null;
      if (x.length != null && x.length !== ex) p.lengths[x.id] = x.length;
    });
    if (!p.name || /^Profile \d+$/.test(p.name)) p.name = ref.name.replace(/^Ground Profile - /i, '').replace(/\.[^.]+$/, '');
    S.generated = false; recompute(); setStatus('Took pole order and lengths from ' + ref.name + '.', 'good');
  };

  /* ---------- circuit segments ---------- */
  function renderSegments() {
    var p = prof(); $('segCount').textContent = p.segments.length ? p.segments.length : '';
    $('segments').innerHTML = p.segments.map(function (s, i) {
      var poles = p.poleIds.map(function (id) { var a = (s.poles || []).filter(function (x) { return x.id === id; })[0]; return '<tr><td><label><input type="checkbox" data-sp="' + i + '" value="' + esc(id) + '"' + (a ? ' checked' : '') + '> ' + esc(id) + '</label></td><td><input data-sh="' + i + '" data-pole="' + esc(id) + '" value="' + (a ? fmt(a.attachHt) : '') + '" inputmode="decimal" placeholder="att ht m" style="width:80px"' + (a ? '' : ' disabled') + '></td></tr>'; }).join('');
      return '<div class="file" style="margin-bottom:8px"><div class="row2"><div class="field"><label>Conductor code</label><input data-sf="' + i + '" data-k="conductor" value="' + esc(s.conductor) + '"></div><div class="field"><label>Num conds</label><input data-sf="' + i + '" data-k="numConds" value="' + esc(s.numConds) + '" inputmode="numeric"></div></div>' +
        '<div class="row2"><div class="field"><label>%CBL</label><input data-sf="' + i + '" data-k="cbl" value="' + esc(s.cbl) + '"></div><div class="field"><label>Std tension kN</label><input data-sf="' + i + '" data-k="kN" value="' + esc(s.kN) + '"></div></div>' +
        '<div class="row2"><div class="field"><label>Table</label><input data-sf="' + i + '" data-k="table" value="' + esc(s.table) + '"></div><div class="field"><label>Temperatures (e.g. 5,65)</label><input data-sf="' + i + '" data-k="temps" value="' + esc(s.temps) + '"></div></div>' +
        '<table class="props">' + poles + '</table><div class="acts"><button class="btn small" data-segdel="' + i + '">Remove segment</button></div></div>';
    }).join('');
  }
  $('addSeg').onclick = function () { prof().segments.push({ conductor: '', numConds: '', cbl: '', kN: '', table: '', temps: '', poles: [] }); recompute(); };
  $('segments').addEventListener('change', function (e) {
    var t = e.target, p = prof(), s;
    if (t.dataset.sf != null) { s = p.segments[+t.dataset.sf]; s[t.dataset.k] = t.value.trim(); }
    if (t.dataset.sp != null) { s = p.segments[+t.dataset.sp]; s.poles = (s.poles || []).filter(function (x) { return x.id !== t.value; }); if (t.checked) s.poles.push({ id: t.value, attachHt: '' }); s.poles.sort(function (a, b) { return p.poleIds.indexOf(a.id) - p.poleIds.indexOf(b.id); }); }
    if (t.dataset.sh != null) { s = p.segments[+t.dataset.sh]; (s.poles || []).forEach(function (x) { if (x.id === t.dataset.pole) x.attachHt = t.value.trim(); }); }
    S.generated = false; recompute();
  });
  $('segments').addEventListener('click', function (e) { var t = e.target.closest('[data-segdel]'); if (t) { prof().segments.splice(+t.dataset.segdel, 1); recompute(); } });

  /* ---------- selection and inspector ---------- */
  // info.segment: a wire was clicked in 3D (or a row in the conductor schedule), so its strain section is selected too.
  function select(id, info) {
    S.selected = id; flags.inspected = true;
    if (info && info.segment !== undefined) { S.selSection = info.segment || null; if (info.segment) U.insTab = 'conductors'; }
    else if (!id) S.selSection = null;
    if (id && !U.right) { U.right = true; applyLayout(); }
    renderSelected(); highlight(); renderProfile(); renderSteps();
    Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tr[data-id]'), function (tr) { tr.classList.toggle('sel', !!id && tr.dataset.id === id); });
    Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tr[data-sec]'), function (tr) { tr.classList.toggle('sel', tr.dataset.sec === S.selSection); });
    if (window.PNW3D && mounted3d) { window.PNW3D.select(id); window.PNW3D.selectSection(S.selSection); }
    if (S.view === 'profile' || S.view === 'split') renderProfileView();
  }
  // Shows a pole in whatever view is open: the map pans to it, the 3D camera frames it.
  function showPole(id) {
    if (!id) return;
    if ((S.view === '3d' || S.view === 'split') && window.PNW3D && mounted3d) { if (!window.PNW3D.focus(id)) setStatus(id + ' is not drawn in 3D (no coordinates or ground level).', 'bad'); }
    else if (S.view === 'plan') zoomTo(id);
  }
  function tagS(t) { return '<span class="tag src">' + t + '</span>'; }
  function fact(k, v, cls, title) { return '<div class="fact ' + (cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><small>' + k + '</small><b>' + (v == null || v === '' ? '<span class="muted">–</span>' : esc(v)) + '</b></div>'; }
  var INS_TABS = [['pole', 'Pole'], ['design', 'Constructions'], ['conductors', 'Conductors'], ['photo', '✨ AI photo'], ['checks', 'Checks']];
  function renderSelected() {
    var id = S.selected, p = id && merged.poles[id];
    $('insTitle').textContent = p ? 'Pole ' + id : 'Project summary';
    $('insZoom').hidden = $('insClear').hidden = !p;
    if (!p) { if (id) S.selected = null; $('selected').innerHTML = projectSummary(); return; }
    var r = built && built.rows.filter(function (x) { return x.id === id; })[0], inProf = prof().poleIds.indexOf(id) >= 0, ex = PNW.existingLength(p);
    var prow = project && project.poles.filter(function (x) { return x.ID === id; })[0];
    var iss = allIssues.filter(function (i) { return i.poleId === id; }), ne = iss.filter(function (i) { return i.level === 'error'; }).length, nw = iss.filter(function (i) { return i.level === 'warning'; }).length;
    var cons = (dm && dm.byPole[id]) || [], secs = project ? project.segPoles.filter(function (s) { return s.id === id; }).map(function (s) { return s.strsection; }).filter(function (v, i, a) { return a.indexOf(v) === i; }) : [];
    var L = prow ? PNW.num(prow.Length) : r ? r.length : ex.value, hag = prow ? PNW.num(prow.HeightAG) : r ? r.height : null, sunk = prow ? PNW.num(prow.Sunk) : r ? r.sunk : null;
    var ch = prow ? PNW.num(prow.Distance) : r ? r.chainage : null, gl = p.survey ? p.survey.elevation : null;
    var h = '<div class="inspane" style="padding-bottom:0"><div class="ins-title"><b>' + esc(id) + '</b>' + (inProf ? '<span class="pill info">In profile #' + (prof().poleIds.indexOf(id) + 1) + '</span>' : '<span class="pill mute">Not in profile</span>') + (prow ? (prow.New === 'True' ? '<span class="pill info">New pole</span>' : '<span class="pill mute">Existing pole</span>') : '') + (ne ? '<span class="pill bad">' + ne + ' error' + (ne > 1 ? 's' : '') + '</span>' : nw ? '<span class="pill warn">' + nw + ' warning' + (nw > 1 ? 's' : '') + '</span>' : '<span class="pill ok">No errors or warnings</span>') + '</div>' +
      '<div class="facts">' + fact('Chainage (m)', fmt(ch, 2)) + fact('Pole length (m)', fmt(L), L == null ? 'warn' : '', L == null ? 'No pole length from any source' : '') + fact('Above ground (m)', fmt(hag)) +
      fact('Setting depth (m)', fmt(sunk)) + fact('Ground level (m)', fmt(gl, 2), gl == null ? 'warn' : '', gl == null ? 'No LiDAR elevation' : 'LiDAR') + fact('Span back (m)', r && r.span != null ? fmt(r.span, 2) : '') +
      (project ? fact('Constructions', cons.length, prow && !cons.length ? 'warn' : '') + fact('Strain sections', secs.length) + fact('Attachment points', cons.reduce(function (n, c) { return n + c.attachments.length; }, 0)) : '') + '</div></div>';
    var tab = U.insTab || 'pole';
    h += '<div class="instabs" role="tablist" aria-label="Pole details">' + INS_TABS.map(function (t) {
      var badge = t[0] === 'checks' && (ne || nw) ? ' <span class="pill ' + (ne ? 'bad' : 'warn') + '">' + (ne + nw) + '</span>' : t[0] === 'design' && project ? ' <span class="pill mute">' + cons.length + '</span>' : t[0] === 'conductors' && project ? ' <span class="pill mute">' + secs.length + '</span>' : '';
      return '<button role="tab" data-instab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + badge + '</button>';
    }).join('') + '</div><div class="inspane" role="tabpanel">';
    if (tab === 'pole') h += polePane(id, p, r, inProf, ex);
    else if (tab === 'design') h += designPanel(id);
    else if (tab === 'conductors') h += project ? (prow ? sectionsOnPole(id) : '<p class="hint">' + esc(id) + ' is not in the linked PNW project.</p>') : startDesignHint();
    else if (tab === 'photo') h += project && prow ? aiPanel(id, cons.slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); })) : '<p class="hint"><b>AI photo match</b> looks at a photo of the pole and ranks the PNW library constructions (with their DCSH drawings) that fit. ' + (project ? esc(id) + ' is not in the linked PNW project; pick a pole that is.' : 'It works on a design, so link a PNW project first.') + '</p>' + (project ? '' : startDesignHint());
    else h += iss.length ? '<ul class="msgs">' + iss.map(function (i) { return '<li class="' + i.level + '">' + esc(i.message) + '</li>'; }).join('') + '</ul>' : '<ul class="msgs"><li class="ok">No issues recorded for ' + esc(id) + '.</li></ul>';
    $('selected').innerHTML = h + '</div>';
    if ($('selAdd')) $('selAdd').onclick = function () { var ids = prof().poleIds; ids.push(id); prof().poleIds = PNW.autoOrder(merged.poles, ids); S.generated = false; recompute(); setStatus(id + ' added and the profile re-ordered along the line. Use ↑ ↓ to adjust.', 'good'); };
    if ($('selRemove')) $('selRemove').onclick = function () { prof().poleIds = prof().poleIds.filter(function (x) { return x !== id; }); S.generated = false; recompute(); };
  }
  function polePane(id, p, r, inProf, ex) {
    var h = '<div class="btnrow" style="margin:0 0 8px">' + (inProf ? '<button class="btn small" id="selRemove" title="Take this pole out of the ground profile">Remove from profile</button>' : (p.survey ? '<button class="btn small primary" id="selAdd">Add to profile</button>' : '<span class="meta">No LiDAR row, so it cannot go in the profile.</span>')) + '<button class="btn small" data-instab="photo" title="Rank the PNW constructions and DCSH drawings that match a photo of this pole">✨ AI photo match</button></div><table class="props">';
    function row(k, v, tag) { if (v == null || v === '') return ''; h += '<tr><th>' + k + '</th><td>' + esc(v) + (tag || '') + '</td></tr>'; return ''; }
    function sec(t) { h += '<tr class="sec"><th colspan="2">' + t + '</th></tr>'; }
    if (p.survey) { var sk = p.survey.kind || 'LiDAR'; sec('Survey'); row('Easting', fmt(p.survey.easting), tagS(sk)); row('Northing', fmt(p.survey.northing), tagS(sk)); row('Elevation', fmt(p.survey.elevation), tagS(sk)); row('LiDAR height', p.survey.lidarHeight != null ? p.survey.lidarHeight + ' m' : ''); row('Lean', p.survey.leanDeg != null ? p.survey.leanDeg + '°' : ''); row('Bays', p.survey.bays); row('Bay angles', p.survey.bayAngles.join(', ')); row('Equipment no', p.survey.equipNo); row('Surveyed', p.survey.surveyed); row('Source', p.survey.src.file + ' row ' + p.survey.src.row); }
    else { sec('Survey'); row('Survey', 'No LiDAR survey row'); }
    if (r) {
      sec('Ground profile');
      row('Chainage', fmt(r.chainage, 2) + ' m', '<span class="tag der">derived</span>');
      if (r.span != null) row('Span from previous', fmt(r.span, 2) + ' m', '<span class="tag der">derived</span>');
      row('Pole length', r.length != null ? r.length + ' m' : 'unknown', r.lengthSource === 'Edited' ? '<span class="tag edit">edited</span>' : r.lengthSource ? tagS(r.lengthSource) : '');
      row('Setting depth', r.sunk != null ? r.sunk + ' m' : '', '<span class="tag der">derived</span>');
      row('Height above ground', r.height != null ? r.height + ' m' : '', '<span class="tag der">derived</span>');
    } else if (ex.value != null) { sec('Pole'); row('Existing length', ex.value + ' m', tagS(ex.source)); }
    if (p.gis) { sec('GIS'); row('Description', p.gis.description); row('Length', p.gis.length != null ? p.gis.length + ' m' : ''); row('Stock', p.gis.stock); row('Species', p.gis.species); row('HV feeder', p.gis.feeder); row('LV feeder', p.gis.lvFeeder); row('Equip no', p.gis.equipNo); var ll = poleLatLng(p); if (ll && p.gis.lat != null) row('Offset from LiDAR', map.distance(ll, L.latLng(p.gis.lat, p.gis.lng)).toFixed(1) + ' m'); }
    ['HV', 'LV'].forEach(function (l) { gisConductorsAt(id, l).forEach(function (t, k) { if (!k) sec('GIS ' + l + ' conductor (by feeder)'); row(t.description, gisText(t).slice(t.description.length + 4)); }); });
    if (p.insp) { sec('Inspections (latest)'); row('Records', p.insp.count); ['Pole Length', 'Pole Length (M)', 'Strength (kN)', 'Bay 1 Length (m)', 'Bay 2 Length (m)', 'Bay 3 Length (m)', 'Bay 1 HV Conductor Type', 'Bay 1 LV Conductor Type', 'Height Neutral Phase (m)', 'Height Running Earth (m)', 'Stay 1 Type'].forEach(function (k) { var a = p.insp.attrs[k]; if (a) row(k, a.value + (a.date ? ' (' + new Date(a.date).toLocaleDateString('en-AU') + ')' : '')); }); }
    if (p.defects.length) { sec('Defects (' + p.defects.length + ')'); p.defects.slice(0, 8).forEach(function (d) { row(d.severity || 'Defect', d.description + ' · ' + d.status); }); }
    return h + '</table>';
  }
  function startDesignHint() {
    return '<p class="hint">Drop a saved PNW project (.pnwx) to edit its design, or start a new design from this ground profile.</p>' + (built && built.rows.length > 1 ? '<div class="btnrow"><button class="btn small primary" id="designStart">Start a design from this ground profile</button></div>' : '<p class="hint">Build a ground profile with at least two poles first.</p>');
  }
  // Empty state of the inspector: where the project stands and the next step.
  function projectSummary() {
    var ids = Object.keys(merged.poles), e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length;
    var steps = [
      [S.files.length > 0, 'Import the survey', S.files.length ? S.files.length + ' file' + (S.files.length > 1 ? 's' : '') + ' imported, ' + ids.length + ' poles' : 'Drop the QLINK LiDAR export and the GIS exports.', S.files.length ? '' : '<button class="btn small primary" data-act="import">Import files…</button>'],
      [!!(built && built.rows.length > 1), 'Build the ground profile', built ? built.rows.length + ' poles in ' + esc(prof().name || 'the profile') + ', ' + fmt(built.rows.length ? built.rows[built.rows.length - 1].chainage : 0, 1) + ' m' : 'Order the surveyed poles in the Project panel.', ''],
      [!!project, 'Link or start a design', project ? esc(linked.name) : 'Drop a .pnwx project, or start one from the profile.', !project && built && built.rows.length > 1 ? '<button class="btn small" id="designStart">Start a design</button>' : ''],
      [!!(project && project.constructions.length), 'Add constructions', project ? project.constructions.length + ' constructions on ' + project.poles.length + ' poles' : 'Select a pole, then add constructions in the inspector.', ''],
      [!!(project && project.segments.length), 'String conductors', project ? project.segments.length + ' strain section' + (project.segments.length === 1 ? '' : 's') : 'Use the Conductor schedule tab.', project ? '<button class="btn small" data-gotab="sections">Conductor schedule</button>' : ''],
      [!!flags.exported, 'Review and export', e ? e + ' error' + (e > 1 ? 's' : '') + ' to fix first' : 'Workbook, .pnwx and change log.', '<button class="btn small" data-act="export">Review…</button>']
    ];
    var now = steps.map(function (s) { return s[0]; }).indexOf(false);
    return '<div class="inspane"><div class="facts">' + fact('Poles', ids.length) + fact('In profile', built ? built.rows.length : 0) + fact('Errors', e, e ? 'bad' : '') + fact('Warnings', w, w ? 'warn' : '') + fact('Constructions', project ? project.constructions.length : '') + fact('Strain sections', project ? project.segments.length : '') + '</div>' +
      '<ul class="summary-list">' + steps.map(function (s, i) { return '<li class="' + (s[0] ? 'done' : i === now ? 'now' : '') + '"><span class="ix">' + (s[0] ? '✓' : i + 1) + '</span><div><b>' + s[1] + '</b><div class="meta">' + s[2] + '</div>' + (s[3] ? '<div class="btnrow" style="margin-top:4px">' + s[3] + '</div>' : '') + '</div></li>'; }).join('') + '</ul>' +
      '<p class="hint">Select a pole on the map, in 3D, in the profile or in the Poles table to inspect and edit it. Click a conductor in 3D to select its strain section.</p></div>';
  }
  $('selected').addEventListener('click', function (e) {
    var t = e.target.closest('[data-instab],[data-act]'); if (!t) return;
    if (t.dataset.instab) { U.insTab = t.dataset.instab; saveUi(); renderSelected(); return; }
    if (t.dataset.act === 'import') $('fileInput').click();
    if (t.dataset.act === 'export') { recompute(); openReview(); }
  });
  $('insZoom').onclick = function () { showPole(S.selected); };
  $('insClear').onclick = function () { select(null); };

  /* ---------- table ---------- */
  var COLS = [
    ['order', 'Pole', function (p) { return p.id; }],
    ['inProf', 'In profile', function (p) { var i = prof().poleIds.indexOf(p.id); return i < 0 ? '' : '#' + (i + 1); }],
    ['easting', 'Easting', function (p) { return p.survey ? p.survey.easting : null; }, 1],
    ['northing', 'Northing', function (p) { return p.survey ? p.survey.northing : null; }, 1],
    ['elevation', 'Elevation', function (p) { return p.survey ? p.survey.elevation : null; }, 1],
    ['exLen', 'Existing length', function (p) { var e = PNW.existingLength(p); return e.value == null ? null : e.value + ' (' + e.source + ')'; }],
    ['len', 'Profile length', function (p) { var r = built && built.rows.filter(function (x) { return x.id === p.id; })[0]; return r ? r.length : null; }, 1],
    ['chain', 'Chainage', function (p) { var r = built && built.rows.filter(function (x) { return x.id === p.id; })[0]; return r ? r.chainage : null; }, 1],
    ['desc', 'Description', function (p) { return (p.gis && p.gis.description) || (p.insp && p.insp.description) || ''; }],
    ['files', 'Found in', function (p) { return [p.survey && 'LiDAR', p.gis && 'GIS', p.insp && 'Inspections', p.defects.length && 'Defects', p.inList && 'Pole list'].filter(Boolean).join(', '); }],
    ['defects', 'Defects', function (p) { return p.defects.length || ''; }, 1],
    ['status', 'Status', function (p) { return levelFor(p.id) || 'ok'; }]
  ];
  function renderTable() {
    if (tab === 'issues') return renderIssueTable();
    if (tab === 'register') return renderRegister();
    if (tab === 'log') return renderLog();
    if (tab === 'sections') return renderSections();
    if (tab === 'heights') return renderHeights();
    var q = $('search').value.trim().toLowerCase(), f = $('filter').value;
    var list = Object.keys(merged.poles).map(function (id) { return merged.poles[id]; }).filter(function (p) {
      if (q && (p.id + ' ' + (p.survey ? p.survey.equipNo : '') + ' ' + (p.gis ? p.gis.equipNo + ' ' + p.gis.description : '')).toLowerCase().indexOf(q) < 0) return false;
      if (f === 'profile') return prof().poleIds.indexOf(p.id) >= 0;
      if (f === 'error' || f === 'warning') return levelFor(p.id) === f;
      if (f === 'unmatched') return !p.survey || (S.files.some(function (x) { return x.role === 'gisPoles'; }) && !p.gis);
      return true;
    });
    var col = COLS.filter(function (c) { return c[0] === sortCol; })[0] || COLS[0];
    list.sort(function (a, b) { var x = sortCol === 'order' ? a.order : col[2](a), y = sortCol === 'order' ? b.order : col[2](b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * (sortDesc ? -1 : 1); });
    if (!list.length) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">' + (Object.keys(merged.poles).length ? 'No poles match the search or filter.' : 'Imported records appear here.') + '</p>'; return; }
    var h = '<table class="grid"><thead><tr>' + COLS.map(function (c) { return '<th data-sort="' + c[0] + '" class="' + (c[0] === sortCol ? 'sorted' + (sortDesc ? ' desc' : '') : '') + '">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>';
    list.forEach(function (p) {
      h += '<tr data-id="' + esc(p.id) + '" class="' + (S.selected === p.id ? 'sel' : '') + '">' + COLS.map(function (c) {
        var v = c[2](p), miss = (c[0] === 'easting' || c[0] === 'northing' || c[0] === 'elevation') && (v == null || isNaN(v));
        if (c[0] === 'status') return '<td><span class="pill ' + (v === 'error' ? 'bad' : v === 'warning' ? 'warn' : 'ok') + '">' + v + '</span></td>';
        return '<td class="' + (c[3] ? 'num' : '') + (miss ? ' miss' : '') + '">' + (miss ? 'missing' : esc(fmt(v))) + '</td>';
      }).join('') + '</tr>';
    });
    $('tableWrap').innerHTML = h + '</tbody></table>';
  }
  function renderIssueTable() {
    var q = $('search').value.trim().toLowerCase();
    var list = allIssues.filter(function (i) { return !q || (i.message + ' ' + (i.poleId || '') + ' ' + (i.file || '')).toLowerCase().indexOf(q) >= 0; });
    var rank = { error: 0, warning: 1, info: 2 }; list.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    if (!list.length) { $('tableWrap').innerHTML = '<p class="status good" style="padding:14px">No issues found.</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Level</th><th>Pole</th><th>Issue</th><th>File</th></tr></thead><tbody>' + list.map(function (i) {
      return '<tr data-id="' + esc(i.poleId || '') + '"><td><span class="pill ' + (i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'info') + '">' + i.level + '</span></td><td>' + esc(i.poleId || '') + '</td><td style="white-space:normal">' + esc(i.message) + '</td><td>' + esc(i.file ? i.file + (i.row ? ' row ' + i.row : '') : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  $('tableWrap').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]'); if (th) { if (sortCol === th.dataset.sort) sortDesc = !sortDesc; else { sortCol = th.dataset.sort; sortDesc = false; } renderTable(); return; }
    var tr = e.target.closest('tr[data-id]'); if (tr && tr.dataset.id && tab !== 'register' && tab !== 'sections' && !e.target.closest('input,select,button,.combo')) { select(tr.dataset.id); showPole(tr.dataset.id); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  var SEARCH_HINT = { poles: 'Search pole, equipment no…', sections: 'Search section, pole, conductor…', heights: 'Search pole or construction…', register: 'Search code, description, DCSH…', issues: 'Search issues…', log: 'Search…' };
  function setTab(t) {
    tab = t; U.tab = t; saveUi();
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { var on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('filter').hidden = t !== 'poles'; $('search').placeholder = SEARCH_HINT[t] || 'Search…'; renderTable();
  }
  // Opens a table tab and makes sure the dock is showing.
  function openTab(t) { if (!U.dock || U.dockMin) { U.dock = true; U.dockMin = false; applyLayout(); } setTab(t); }
  $('search').oninput = renderTable; $('filter').onchange = renderTable;

  function renderValidation() {
    var c = function (l) { return allIssues.filter(function (i) { return i.level === l; }).length; };
    var e = c('error'), w = c('warning'), inf = c('info'), ids = Object.keys(merged.poles);
    var matched = ids.filter(function (id) { return merged.poles[id].survey; }).length;
    $('valCount').textContent = e ? e + ' errors' : w ? w + ' warnings' : ids.length ? 'OK' : '';
    $('validation').innerHTML = '<div class="tiles"><div class="tile ' + (e ? 'bad' : '') + '"><small>Errors</small><b>' + e + '</b></div><div class="tile ' + (w ? 'warn' : '') + '"><small>Warnings</small><b>' + w + '</b></div></div>' +
      '<p class="hint">' + matched + ' of ' + ids.length + ' poles have a LiDAR survey row. ' + inf + ' informational note' + (inf === 1 ? '' : 's') + '.</p><div class="btnrow"><button class="btn small" id="openIssues">Show all issues</button></div>';
    $('openIssues').onclick = function () { openTab('issues'); };
  }

  /* ---------- review ---------- */
  function generate() {
    recompute();
    if (!built) { setStatus('Add at least two poles to the profile first.', 'bad'); return; }
    S.generated = true; save(); openReview();
  }
  function openReview() {
    if (!built) { setStatus('Nothing to review yet. Import files and build a profile.', 'bad'); return; }
    flags.reviewed = true; renderSteps();
    var p = prof(), errs = built.issues.filter(function (i) { return i.level === 'error'; }), warns = allIssues.filter(function (i) { return i.level === 'warning'; });
    var ids = Object.keys(merged.poles), roles = {};
    S.files.forEach(function (f) { roles[f.role] = (roles[f.role] || 0) + 1; });
    var h = '<div class="tiles">' +
      tile('Profile poles', built.rows.length) + tile('Total length', fmt(built.rows.length ? built.rows[built.rows.length - 1].chainage : 0, 2) + ' m') +
      tile('Imported poles', ids.length) + tile('Matched to survey', ids.filter(function (id) { return merged.poles[id].survey; }).length) +
      tile('Not matched', ids.filter(function (id) { return !merged.poles[id].survey; }).length, ids.some(function (id) { return !merged.poles[id].survey; }) ? 'warn' : '') +
      tile('Profile errors', errs.length, errs.length ? 'bad' : '') + tile('Warnings', warns.length, warns.length ? 'warn' : '') + '</div>';
    h += '<p class="hint"><b>Inputs:</b> ' + S.files.map(function (f) { return esc(f.name) + ' (' + esc(PNW.ROLES[f.role] || f.role) + ', ' + (f.items || []).length + ')'; }).join(' · ') + '</p>';
    if (errs.length) h += '<div><h3 class="sub">Fix these before exporting</h3><ul class="issues-list">' + errs.map(function (i) { return '<li class="error">' + esc(i.message) + '</li>'; }).join('') + '</ul></div>';
    h += '<div><h3 class="sub">Profile along the alignment</h3>' + chart() + '</div>';
    h += '<div><h3 class="sub">Groundline sheet preview (exactly what is written)</h3><div class="tablewrap" style="max-height:300px;border:1px solid var(--line);border-radius:10px"><table class="grid"><thead><tr>' + PNW.GROUNDLINE_HEADERS.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      PNW.groundlineAoa(built).slice(1).map(function (r, i) { var src = built.rows[i]; return '<tr>' + r.map(function (v, c) { var t = c === 5 && src.lengthSource === 'Edited' ? ' <span class="tag edit">edited</span>' : ''; return '<td class="' + (typeof v === 'number' ? 'num' : '') + (v == null && c < 7 ? ' miss' : '') + '">' + (v == null ? (c < 7 ? 'missing' : '') : esc(v)) + t + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="hint">Easting, Northing and Eleveation are copied from the LiDAR survey. Height above Ground and Setting Depth are derived from the pole length. Chainage and spans are shown for checking but are not written to the workbook, the same as your existing files. Segments sheet: ' + (p.segments.length ? p.segments.length + ' segment(s).' : 'headers only, as in your MP219050 workbooks.') + '</p></div>';
    var ref = S.files.filter(function (f) { return f.role === 'groundProfile' && f.items.length; });
    ref.forEach(function (f) {
      var d = PNW.compareWithReference(built, f);
      h += '<div><h3 class="sub">Compared with ' + esc(f.name) + '</h3>' + (d.length ? '<ul class="issues-list">' + d.map(function (x) { return '<li class="warning">' + esc(x.message) + '</li>'; }).join('') + '</ul>' : '<p class="status good">Every pole, value and the row order match this reference.</p>') + '</div>';
    });
    h += '<div><h3 class="sub">Export</h3><div class="exports">' +
      exp('expXlsx', 'Ground profile (.xlsx)', 'The PNW Profiler Easting/Northing/Elevation import (manual §10.1). Checked cell for cell against your MP219050, Across North St and MP221715 workbooks.', !built.ok) +
      exp('expPnwx', 'PNW Profile project (.pnwx)', 'Ground line and poles in PNW 7.18 project XML. The ground and pole tables match your saved MP219050 projects, but this file has not yet been opened in PNW. Treat it as a beta.', !built.ok) +
      exp('expAll', 'Both files (.zip)', 'The workbook and the .pnwx together. Tipload is then built in PNW from the imported profile, as you do now.', !built.ok) +
      (project ? exp('expDesign', 'Updated design project (.pnwx)', 'Your linked project ' + esc(linked.name) + ' with ' + liveLog().length + ' recorded change' + (liveLog().length === 1 ? '' : 's') + '. Only the edited values change; every other byte is kept (round-trip checked on your four saved projects). Not yet reopened in PNW.', false) +
        exp('expLog', 'Change log (.csv)', 'Every construction change with the original value, the new value, where it came from (manual, library default or AI suggestion) and who approved it.', !liveLog().length) : '') + '</div></div>';
    $('reviewBody').innerHTML = h;
    $('review').hidden = false; $('closeReview').focus();
    bindChart();
    $('expXlsx').onclick = exportXlsx; $('expPnwx').onclick = exportPnwx; $('expAll').onclick = exportAll;
    if ($('expDesign')) { $('expDesign').onclick = exportDesign; $('expLog').onclick = exportLog; }
  }
  function tile(k, v, cls) { return '<div class="tile ' + (cls || '') + '"><small>' + k + '</small><b>' + esc(v) + '</b></div>'; }
  function exp(id, t, d, dis) { return '<div class="exp"><b>' + t + '</b><p>' + d + '</p><button class="btn ' + (dis ? '' : 'primary') + '" id="' + id + '"' + (dis ? ' disabled' : '') + '>Download</button></div>'; }
  $('closeReview').onclick = function () { $('review').hidden = true; };
  $('review').addEventListener('keydown', function (e) { if (e.key === 'Escape') $('review').hidden = true; });

  /* profile chart: surveyed ground level at each pole vs derived pole top */
  function chart() {
    var rows = built.rows.filter(function (r) { return r.chainage != null && r.elevation != null && isFinite(r.elevation); });
    if (rows.length < 2) return '<p class="status">Not enough surveyed points with chainage and elevation to draw a profile.</p>';
    var W = 1100, H = 300, m = { l: 56, r: 44, t: 18, b: 40 };
    var xs = rows.map(function (r) { return r.chainage; }), tops = rows.map(function (r) { return r.height != null ? r.elevation + r.height : r.elevation; });
    var x0 = 0, x1 = Math.max.apply(null, xs) || 1, y0 = Math.floor(Math.min.apply(null, rows.map(function (r) { return r.elevation; })) - 1), y1 = Math.ceil(Math.max.apply(null, tops) + 1);
    var X = function (v) { return m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r); }, Y = function (v) { return H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
    var g = '', step = niceStep(y1 - y0, 6), xstep = niceStep(x1, 8);
    for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#e6ebf0"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end" font-size="11" fill="#64748b">' + +v.toFixed(2) + '</text>';
    for (var c = 0; c <= x1 + 1e-9; c += xstep) g += '<text x="' + X(c) + '" y="' + (H - m.b + 15) + '" text-anchor="middle" font-size="11" fill="#64748b">' + +c.toFixed(2) + '</text>';
    g += '<text x="' + ((W + m.l) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11.5" fill="#43566d">Chainage (m, from survey easting/northing)</text>';
    g += '<text transform="translate(14 ' + ((H - m.b + m.t) / 2) + ') rotate(-90)" text-anchor="middle" font-size="11.5" fill="#43566d">Elevation (m, Z_COORD_BASE)</text>';
    var poles = rows.map(function (r, i) { return r.height == null ? '' : '<line x1="' + X(r.chainage) + '" x2="' + X(r.chainage) + '" y1="' + Y(r.elevation) + '" y2="' + Y(tops[i]) + '" stroke="var(--pole)" stroke-width="2" stroke-dasharray="5 3"/><text x="' + X(r.chainage) + '" y="' + (Y(tops[i]) - 5) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#172638">' + esc(r.id) + '</text>'; }).join('');
    var path = rows.map(function (r, i) { return (i ? 'L' : 'M') + X(r.chainage).toFixed(1) + ' ' + Y(r.elevation).toFixed(1); }).join(' ');
    var dots = rows.map(function (r, i) { return '<circle cx="' + X(r.chainage) + '" cy="' + Y(r.elevation) + '" r="4.5" fill="var(--ground)" stroke="#fff" stroke-width="2"/><rect class="hit" data-i="' + i + '" x="' + (X(r.chainage) - 14) + '" y="' + m.t + '" width="28" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; }).join('');
    window.__pnwChartRows = rows;
    return '<div class="chart" id="chart"><div class="chart-legend"><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--ground)" stroke-width="2"/></svg>Ground level at poles (LiDAR)</span><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="var(--pole)" stroke-width="2" stroke-dasharray="5 3"/></svg>Pole height above ground (derived from length)</span></div><p class="chart-note">Ground is only known at the poles; straight lines join them. Vertical scale exaggerated.</p>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Ground profile chart">' + g + '<path d="' + path + '" fill="none" stroke="var(--ground)" stroke-width="2"/>' + poles + dots + '</svg><div class="tt" id="tt" hidden></div></div>';
  }
  function niceStep(range, n) { var raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function bindChart() {
    var ch = $('chart'); if (!ch) return;
    ch.addEventListener('mousemove', function (e) {
      var t = e.target.closest('.hit'), tt = $('tt'); if (!t) { tt.hidden = true; return; }
      var r = window.__pnwChartRows[+t.dataset.i], b = ch.getBoundingClientRect();
      tt.innerHTML = '<b>' + esc(r.id) + '</b><br>Chainage ' + fmt(r.chainage, 2) + ' m<br>Ground ' + fmt(r.elevation, 2) + ' m (LiDAR)<br>' + (r.length != null ? 'Pole ' + r.length + ' m, ' + r.height + ' m above ground' : 'Pole length unknown');
      tt.hidden = false; tt.style.left = Math.min(e.clientX - b.left + 12, b.width - 190) + 'px'; tt.style.top = (e.clientY - b.top + 12) + 'px';
    });
    ch.addEventListener('mouseleave', function () { $('tt').hidden = true; });
  }

  /* ---------- exports ---------- */
  function baseName() { return (prof().name || 'Profile').replace(/[\\/:*?"<>|]+/g, '-'); }
  // Inside Claude files are offered through the viewer's save prompt; .pnwx is not an allowed type there, so it goes in a .zip.
  var dlP = IN_CLAUDE && window.claude && window.claude.use ? window.claude.use('downloads') : null;
  function download(blob, name) {
    if (!IN_CLAUDE) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); flags.exported = true; renderSteps(); return; }
    var go = /\.pnwx$/i.test(name) ? new JSZip().file(name, blob).generateAsync({ type: 'blob' }).then(function (z) { name = name + '.zip'; return z; }) : Promise.resolve(blob);
    Promise.all([dlP || Promise.resolve(null), go]).then(function (r) {
      if (!r[0]) { setStatus('Saving files is not available in this view of the page.', 'bad'); return; }
      return r[0].save({ filename: name, data: r[1] }).then(function () { flags.exported = true; renderSteps(); setStatus('Saved ' + name + '.', 'good'); });
    }).catch(function (e) { setStatus(e && e.code === 'declined' ? 'Save cancelled.' : 'Could not save ' + name + ': ' + ((e && (e.message || e.code)) || e), 'bad'); });
  }
  function xlsxBytes(wb) { return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); }
  function guard() { recompute(); if (!built || !built.ok) { setStatus('Export blocked: fix the profile errors first.', 'bad'); openReview(); return false; } return true; }
  function gpBlob() { return new Blob([xlsxBytes(PNW.groundProfileWorkbook(XLSX, built, prof().segments))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
  function pnwxText() { return PNW.profilePnwx(built, { title: 'Ground Profile - ' + baseName(), createdBy: S.settings.createdBy, option: S.settings.optionSet, clearance1: PNW.num(S.settings.clr1), clearance2: PNW.num(S.settings.clr2) }); }
  function exportDesign() { download(new Blob([projectXml()], { type: 'application/xml' }), linked.name.replace(/\.pnwx$/i, '') + (liveLog().length ? ' (edited)' : '') + '.pnwx'); setStatus('Downloaded the updated PNW project.', 'good'); }
  function exportLog() {
    var rows = [['Time', 'Pole', 'Construction', 'Field', 'Original', 'Proposed', 'Approved value', 'Source', 'Reference', 'Approved by']].concat(liveLog().map(function (l) { return [l.t, l.pole, l.construction, l.field, l.from, l.proposed, l.to, l.source, l.reference, l.by]; }));
    download(new Blob([rows.map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n')], { type: 'text/csv' }), 'Change log - ' + (linked ? linked.name.replace(/\.pnwx$/i, '') : baseName()) + '.csv');
  }
  function exportXlsx() { if (!guard()) return; download(gpBlob(), 'Ground Profile - ' + baseName() + '.xlsx'); setStatus('Downloaded the ground profile workbook.', 'good'); }
  function exportPnwx() { if (!guard()) return; download(new Blob([pnwxText()], { type: 'application/xml' }), 'Ground Profile - ' + baseName() + '.pnwx'); setStatus('Downloaded the .pnwx profile (beta, not yet opened in PNW).', 'good'); }
  function exportAll() {
    if (!guard()) return;
    var z = new JSZip(); z.file('Ground Profile - ' + baseName() + '.xlsx', gpBlob()); z.file('Ground Profile - ' + baseName() + '.pnwx', pnwxText());
    z.generateAsync({ type: 'blob' }).then(function (b) { download(b, 'PNW - ' + baseName() + '.zip'); setStatus('Downloaded all PNW files.', 'good'); });
  }

  /* ---------- design: PNW project, library, DCSH register and stringing tables ---------- */
  var TEXT_ROLES = { pnwx: 'PNW project (.pnwx)', library: 'PNW library tables', dcsh: 'DCSH standards register', stringing: 'DCSH Part 10 stringing tables' };
  var textCache = {}, regCache = null, mounted3d = false, lastSnap = null, restoring = false;
  function cached(f, fn) { var k = f.name + '|' + f.text.length; return textCache[k] || (textCache[k] = fn(f.text)); }
  function txtIssue(name, level, message) { return { level: level, code: 'text', message: name + ': ' + message, file: name }; }

  // .pnwx projects, PNW library tables (.txt), the DCSH register (.json) and the Part 10 text are read as text, never executed.
  function importText(name, text) {
    var ext = (name.split('.').pop() || '').toLowerCase(), base = { name: name, status: 'ok', items: [], sheets: [], issues: [], text: text, confidence: 'high' };
    if (ext === 'pnwx' || /^\s*<(profile_project|tipload_project)[\s>]/.test(text)) {
      var p = M.readPnwx(text);
      return Object.assign(base, { role: 'pnwx', kind: p.kind, summary: p.kind === 'profile' ? p.poles.length + ' poles, ' + p.constructions.length + ' constructions, ' + p.segments.length + ' strain sections' : 'tipload project (' + (p.attrs.poletype || 'pole') + ')' });
    }
    if (ext === 'json') {
      var r = M.parseDcshRegister(text);
      return Object.assign(base, { role: 'dcsh', summary: r.entries.length + ' DCSH entries', issues: r.issues.map(function (m) { return txtIssue(name, 'warning', m); }) });
    }
    var lb = M.parseLibrary(text);
    if (lb.constructions.length || lb.poles.length || lb.conductors.length)
      return Object.assign(base, { role: 'library', summary: lb.constructions.length + ' constructions, ' + lb.conductors.length + ' conductors, ' + lb.poles.length + ' pole types', issues: lb.issues.map(function (m) { return txtIssue(name, 'warning', m); }) });
    var st = M.parseStringingTables(text);
    if (st.tables.length)
      return Object.assign(base, { role: 'stringing', summary: st.tables.length + ' stringing tables read' + (st.issues.length ? ', ' + st.issues.length + ' not readable' : ''), issues: st.issues.map(function (m) { return txtIssue(name, 'info', m); }) });
    throw new Error('not a PNW project, PNW library tables, DCSH register or DCSH Part 10 text.');
  }
  // Reference data built into a private copy of the page (window.PNW_BUILTIN); a file the user drops replaces it.
  var BUILTIN = {};
  Object.keys(window.PNW_BUILTIN || {}).forEach(function (r) { var b = window.PNW_BUILTIN[r]; if (!TEXT_ROLES[r]) return; BUILTIN[r] = { name: b.name, text: b.text, role: r, status: 'ok', builtin: true }; });
  function filesOf(role) { var l = S.files.filter(function (f) { return f.role === role && f.status === 'ok' && f.text; }); return l.length || !BUILTIN[role] ? l : [BUILTIN[role]]; }
  function dcshReg() { var f = filesOf('dcsh').slice(-1)[0]; return f ? cached(f, M.parseDcshRegister) : null; }
  function stringing() { var f = filesOf('stringing').slice(-1)[0]; return f ? cached(f, M.parseStringingTables).tables : []; }

  function syncDesign() {
    regCache = null;
    var lf = filesOf('library').slice(-1)[0]; lib = lf ? cached(lf, M.parseLibrary) : null;
    var profiles = filesOf('pnwx').filter(function (f) { return f.kind === 'profile'; });
    if (S.design.link && !profiles.some(function (f) { return f.name === S.design.link; })) S.design = Object.assign(blankDesign(), { register: S.design.register });
    if (!S.design.link && profiles.length) S.design.link = profiles[0].name;
    linked = profiles.filter(function (f) { return f.name === S.design.link; })[0] || null;
    project = null;
    if (linked) { try { project = M.readPnwx(projectXml()); } catch (e) { setStatus('The linked project could not be read: ' + e.message, 'bad'); } }
    $('useProj').hidden = !project;
  }
  function projectXml() { return S.design.xml || (linked ? linked.text : ''); }
  function linkDesign(name) { S.design = Object.assign(blankDesign(), { register: S.design.register, link: name }); recompute(); useProject(false); }
  // Poles of the linked project that have no LiDAR row still appear, using the project's own coordinates and ground levels.
  function projectSurvey(ok) {
    if (!project) return [];
    var have = {}; ok.forEach(function (f) { if (f.role === 'survey') f.items.forEach(function (s) { have[s.id] = 1; }); });
    var items = project.poles.filter(function (r) { return !have[r.ID]; }).map(function (r, i) {
      return { id: r.ID, easting: PNW.num(r.Easting), northing: PNW.num(r.Northing), elevation: M.groundAt(project, PNW.num(r.Distance)), kind: 'PNW project', bayAngles: [], src: { file: linked.name, row: 'pole ' + (i + 1) } };
    });
    return items.length ? [{ name: linked.name, role: 'survey', status: 'ok', items: items, issues: [] }] : [];
  }
  function useProject(quiet) {
    if (!project) return;
    var p = prof(); p.poleIds = []; p.lengths = {};
    project.poles.forEach(function (r) {
      if (!merged.poles[r.ID]) return;
      p.poleIds.push(r.ID);
      var ex = PNW.existingLength(merged.poles[r.ID]).value, L = PNW.num(r.Length);
      if (L != null && L !== ex) p.lengths[r.ID] = L;
    });
    if (!p.name || /^Profile \d+$/.test(p.name)) p.name = (project.attrs.title || linked.name).replace(/^Ground Profile - /i, '').replace(/\.pnwx$/i, '');
    S.generated = false; recompute();
    if (!quiet) setStatus('Took pole order and lengths from ' + linked.name + '.', 'good');
  }
  function poleTypeFor(id, len) {
    if (!lib) return null;
    var t = (S.design.poleTypes || {})[id] || (project && project.tiploads[id] && project.tiploads[id].attrs.poletype);
    if (t) { var hit = lib.poles.filter(function (x) { return x.code === t; })[0]; if (hit) return hit; }
    var g = merged.poles[id] && merged.poles[id].gis, m = M.matchPoleType(lib, g && g.stock, len);
    return m.length ? m[0].pole : null;
  }

  // Sag: none, DCSH Part 10 table (per strain section, chosen or matched), or illustrative w·L²/8T.
  function tableFor(seg) {
    var tables = stringing(), pick = S.design.tables && S.design.tables[seg.StrainSect];
    if (pick) return tables.filter(function (t) { return t.id === pick; })[0] || null;
    return suggestTable(seg)[0] || null;
  }
  function suggestTable(seg) {
    var tables = stringing(); if (!tables.length || !seg) return [];
    // A table drawn for this conductor at the section's %CBL tension (same rules as the tension suggestions).
    var pct = seg.TensionUnits === '%CBL' ? Number(seg.Tension) : NaN;
    return M.tablesForConductor(tables, conductorFor(seg.Conductor)).filter(function (x) { return x.pct === pct; }).map(function (x) { return x.table; });
  }
  function applySag() {
    if (!dm) return;
    var mode = S.sagMode || 'none', bySeg = {};
    dm.wires.forEach(function (w) { if (w.phase === 1) (bySeg[w.segment] = bySeg[w.segment] || []).push(w.span); });
    dm.sagNotes = {};
    dm.wires.forEach(function (w) {
      w.sag = null; w.sagSource = 'not shown';
      if (mode === 'illustrative') {
        var cond = project.conductors.filter(function (c) { return String(c.Code).toUpperCase() === String(w.conductor).toUpperCase(); })[0], seg = project.segments.filter(function (s) { return s.StrainSect === w.segment; })[0];
        w.sag = M.illustrativeSag(w.span, cond, seg); w.sagSource = w.sag != null ? 'illustrative w·L²/8T at stringing tension' : 'no conductor mass or tension';
      } else if (mode === 'dcsh') {
        var sg = project.segments.filter(function (s) { return s.StrainSect === w.segment; })[0], t = tableFor(sg || {}), rs = M.rulingSpan(bySeg[w.segment] || []);
        if (!t) { dm.sagNotes[w.segment] = 'No DCSH stringing table chosen or matched for ' + w.segment + ' (' + (sg ? sg.Conductor + ' at ' + sg.Tension + ' ' + sg.TensionUnits : '?') + ').'; return; }
        var r = M.tableSag(t, 'final', Number(S.sagTemp || 15), w.span, rs);
        w.sag = r.value; w.sagSource = r.value != null ? t.title + ' (DCSH Part 10 p' + t.page + '), existing/final ' + (S.sagTemp || 15) + ' °C, ruling span ' + rs.toFixed(1) + ' m' : r.reason;
        dm.sagNotes[w.segment] = w.segment + ': ' + (r.value != null ? t.title + ', p' + t.page + ', ruling span ' + rs.toFixed(1) + ' m' : r.reason);
      }
    });
  }
  function buildDesignModel() {
    dm = project ? M.designModel(project, { file: linked.name, poleType: poleTypeFor }) : null;
    applySag();
  }

  /* undo / redo: every change to profiles or the design is a snapshot */
  function snapState() { return JSON.stringify({ profiles: S.profiles, active: S.active, design: S.design }); }
  function trackHistory() {
    var now = snapState();
    if (lastSnap != null && now !== lastSnap && !restoring) { undoStack.push(lastSnap); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
    lastSnap = now;
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snapState());
    var s = JSON.parse(from.pop()); S.profiles = s.profiles; S.active = s.active; S.design = s.design;
    restoring = true; S.generated = false; recompute(); restoring = false; lastSnap = snapState();
  }
  function renderHistory() { $('tbUndo').disabled = !undoStack.length; $('tbRedo').disabled = !redoStack.length; }

  function liveLog() { return S.design.log || []; }
  function logEntry(pole, construction, field, from, to, source, reference, proposed) {
    return { t: new Date().toISOString(), pole: pole, construction: construction, field: field, from: from, proposed: proposed != null ? proposed : to, to: to, source: source, reference: reference || '', by: S.settings.createdBy || 'designer' };
  }
  // Applies a change to the linked project; entries go to the change log with original, proposed and approved values.
  function commit(mutate) {
    if (!linked) return false;
    var p = M.readPnwx(projectXml()), entries;
    try { entries = mutate(p) || []; } catch (e) { setStatus(e.message, 'bad'); return false; }
    S.design.xml = M.writePnwx(p); S.design.log = liveLog().concat(entries);
    recompute(); return true;
  }

  /* construction register: every code in the imported projects, the library and the DCSH register */
  function registerRows() {
    if (regCache) return regCache;
    var files = filesOf('pnwx').filter(function (f) { return f.kind === 'profile'; }).map(function (f) { return { file: f.name, project: linked && f.name === linked.name && project ? project : M.readPnwx(f.text) }; });
    var reg = M.buildRegister(files), seen = {}, dc = dcshReg();
    reg.forEach(function (r) { seen[r.code.toUpperCase()] = 1; });
    (lib ? lib.constructions : []).forEach(function (c) {
      if (seen[String(c.code).toUpperCase()]) return; seen[String(c.code).toUpperCase()] = 1;
      reg.push({ id: c.code + '|library', code: c.code, attachments: [], phases: 0, sources: [], observedBelowTip: [], fromLibrary: true, status: 'Library entry only: no attachment offsets available, needs engineering review' });
    });
    reg.forEach(function (r) {
      r.lib = M.libraryConstruction(lib, r.code); r.dcsh = M.dcshFor(dc, r.code)[0] || null; r.user = (S.design.register || {})[r.id] || {};
      r.check = r.dcsh && r.attachments.length ? M.compareDcsh(r.dcsh, { attachments: r.attachments, kingbolt: null }, null) : null;
    });
    return (regCache = reg);
  }
  function regFor(c) { var k = c.code + '|' + JSON.stringify(c.attachments); return registerRows().filter(function (r) { return r.id === k; })[0] || null; }
  // Engineering status of a register row: the engineer's approval wins; otherwise what the DCSH comparison shows.
  function statusOf(r) {
    if (!r) return { cls: 'warn', text: 'Needs engineering review' };
    if (r.user.status === 'approved') return { cls: 'ok', text: 'Approved by ' + (r.user.by || 'engineer') + (r.user.drawing || (r.dcsh && r.dcsh.drawing) ? ' · DCSH ' + (r.user.drawing || r.dcsh.drawing) : '') };
    if (r.user.status === 'unsupported') return { cls: 'bad', text: 'Marked unsupported' };
    if (!r.code) return { cls: 'warn', text: 'Blank construction, needs engineering review' };
    if (r.dcsh && r.check && r.check.offsets === true) return { cls: 'info', text: 'Matches DCSH ' + r.dcsh.drawing + ', awaiting engineer approval' };
    if (r.dcsh && r.check && r.check.offsets === 'x') return { cls: 'warn', text: 'Spacing matches DCSH ' + r.dcsh.drawing + ', heights not dimensioned, needs engineering review' };
    if (r.dcsh && r.check && r.check.offsets === false) return { cls: 'bad', text: 'Differs from DCSH ' + r.dcsh.drawing + ', needs engineering review' };
    if (r.dcsh) return { cls: 'warn', text: (M.DCSH_STATUS[r.dcsh.status] || r.dcsh.status) + ' (' + r.dcsh.drawing + '), needs engineering review' };
    return { cls: 'warn', text: 'No DCSH reference linked, needs engineering review' };
  }
  function renderRegister() {
    var q = $('search').value.trim().toLowerCase(), rows = registerRows().filter(function (r) { return !q || (r.code + ' ' + (r.lib ? r.lib.description : '') + ' ' + (r.dcsh ? r.dcsh.drawing + ' ' + r.dcsh.title : '')).toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">' + (registerRows().length ? 'No constructions match the search.' : 'Import a PNW project (.pnwx) or the PNW library tables to see the construction register.') + '</p>'; return; }
    var h = '<table class="grid reg"><thead><tr><th>Code</th><th>Description (PNW library)</th><th>Below tip</th><th>Below supercct</th><th>Attachments x, y (m from king bolt)</th><th>Seen on</th><th>DCSH drawing</th><th>DCSH conditions</th><th>Status</th><th>Engineer</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var st = statusOf(r), d = r.dcsh;
      h += '<tr><td><b>' + esc(r.code || '(blank)') + '</b>' + (r.conflict ? ' <span class="pill warn" title="' + esc(r.conflict) + '">2 layouts</span>' : '') + '</td><td>' + esc(r.lib ? r.lib.description : '') + '</td>' +
        '<td class="num">' + fmt(r.lib && r.lib.belowTip) + '</td><td class="num">' + fmt(r.lib && r.lib.belowSupercct) + '</td>' +
        '<td>' + (r.attachments.length ? r.attachments.map(function (a) { return fmt(a.x) + ', ' + fmt(a.y); }).join(' · ') : '<span class="muted">none</span>') + '</td>' +
        '<td title="' + esc(r.sources.join('\n')) + '">' + (r.sources.length ? r.sources.length + ' in your projects' : 'library only') + '</td>' +
        '<td>' + (d ? dcshThumb(d.drawing) + esc(d.part.split(' ').slice(0, 2).join(' ') + ' · ' + d.drawing + ' rev ' + d.revision + (d.page ? ' · p' + d.page : '')) + '<br><small>' + esc(d.title) + '</small>' : '<span class="muted">not linked</span>') + '</td>' +
        '<td class="wrap"><small>' + esc(d ? [d.conditions, d.statusText].filter(Boolean).join(' ') : '') + (r.check && r.check.notes.length ? ' ' + esc(r.check.notes.join(' ')) : '') + '</small></td>' +
        '<td><span class="pill ' + st.cls + '">' + esc(st.text) + '</span></td>' +
        '<td><select data-regst="' + esc(r.id) + '" aria-label="Engineer status for ' + esc(r.code) + '"><option value="">Needs review</option><option value="approved"' + (r.user.status === 'approved' ? ' selected' : '') + '>Approved</option><option value="unsupported"' + (r.user.status === 'unsupported' ? ' selected' : '') + '>Unsupported</option></select></td></tr>';
    });
    $('tableWrap').innerHTML = h + '</tbody></table><p class="hint" style="margin:8px">Attachment offsets come from your saved PNW projects; the DCSH column comes from the DCSH register file you imported. A construction is only "Approved" when an engineer sets it here; the tool never approves anything itself.</p>';
  }
  $('tableWrap').addEventListener('change', function (e) {
    var id = e.target.dataset.regst; if (id == null) return;
    var r = registerRows().filter(function (x) { return x.id === id; })[0], v = e.target.value, reg = S.design.register = S.design.register || {};
    var before = (reg[id] && reg[id].status) || 'review';
    reg[id] = v ? { status: v, by: S.settings.createdBy || 'engineer', at: new Date().toISOString(), drawing: r && r.dcsh ? r.dcsh.drawing : '' } : {};
    S.design.log = liveLog().concat([logEntry('', r ? r.code : id, 'Register status', before, v || 'review', 'manual', r && r.dcsh ? 'DCSH ' + r.dcsh.drawing : '')]);
    recompute();
  });
  /* strain sections: conductors strung between constructions, edited in the linked project (Table3, Table4, Table6, Table7) */
  function startDesign() {
    if (!built || built.rows.length < 2) { setStatus('Build a ground profile with at least two poles first.', 'bad'); return; }
    var name = 'Ground Profile - ' + baseName() + ' (design).pnwx', text = pnwxText(), r = importText(name, text);
    r.size = text.length; r.status = 'ok'; upsertFile(r);
    S.design = Object.assign(blankDesign(), { register: S.design.register, link: name });
    recompute(); setStatus('Started a design from the ground profile. Add constructions to each pole, then string conductors in the Strain sections tab.', 'good');
  }
  var secForm = { tension: '', units: '%CBL' };
  // A library conductor, or one already in the project (Table4) turned into the same shape.
  function conductorFor(code) {
    var c = lib && lib.conductors.filter(function (x) { return x.code === code; })[0];
    if (c) return c;
    var r = project && project.conductors.filter(function (x) { return x.Code === code; })[0];
    return r ? { code: r.Code, name: r.Name1 || '', name2: r.Name2 || '', material: r.Material || '' } : null;
  }
  // GIS conductor runs on a pole's feeders. The export has no line coordinates, so runs are tied to poles by feeder only:
  // HV runs by the pole's HV feeder, LV runs by its LV feeder.
  function gisRuns() { return [].concat.apply([], S.files.filter(function (f) { return f.role === 'gisConductors' && f.status === 'ok'; }).map(function (f) { return f.items; })); }
  function libConductorNamed(name) {
    var k = String(name || '').replace(/\s+/g, '').toUpperCase();
    return (lib ? lib.conductors : []).filter(function (c) { return String(c.name).replace(/\s+/g, '').toUpperCase() === k; })[0] || null;
  }
  function gisConductorsAt(id, level) {
    var p = merged.poles[id], g = p && p.gis; if (!g) return [];
    var feeder = level === 'HV' ? g.feeder : g.lvFeeder; if (!feeder) return [];
    var by = {};
    gisRuns().forEach(function (r) {
      if (r.level !== level || (r.feeder !== feeder && r.feeder2 !== feeder)) return;
      var t = by[r.description] || (by[r.description] = { description: r.description, conductor: r.conductor, wires: r.wires, feeder: feeder, runs: [], length: 0, lib: libConductorNamed(r.conductor) });
      t.runs.push(r.id); t.length += r.length || 0;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function circuitOf(prefix) { return /^H/.test(prefix) ? 'HV' : /^(L|AB)/.test(prefix) ? 'LV' : null; }
  function gisText(t) { return t.description + ' on ' + t.feeder + ' (' + t.runs.length + ' run' + (t.runs.length > 1 ? 's' : '') + ', ' + Math.round(t.length) + ' m)' + (t.lib ? ' = library ' + t.lib.code : ', not in the PNW library'); }
  function levelOf(code) { return (String(code || '').match(/^[A-Z]+/i) || [''])[0].toUpperCase(); }
  // Poles from one pole to another in line order, each with its construction on the chosen circuit level.
  function sectionMembers(f) {
    if (!project) return [];
    var ids = project.poles.map(function (r) { return r.ID; }), a = ids.indexOf(f.from), b = ids.indexOf(f.to);
    if (a < 0 || b < 0 || a === b) return [];
    var run = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    if (a > b) run.reverse();
    return run.map(function (id) {
      var cs = project.constructions.filter(function (c) { return c.pole === id && levelOf(c.code) === f.level; }).sort(function (x, y) { return PNW.num(y.attht) - PNW.num(x.attht); });
      var pick = (f.pick && f.pick[id] && cs.filter(function (c) { return c.unique === f.pick[id]; })[0]) || cs[0] || null;
      return { id: id, options: cs, c: pick };
    });
  }
  // Conductor schedule: every strain section of the linked project, editable, plus the form to string a new one.
  function spansOf(ids) {
    var out = [];
    for (var i = 1; i < ids.length; i++) { var A = project.poles.filter(function (r) { return r.ID === ids[i - 1]; })[0], B = project.poles.filter(function (r) { return r.ID === ids[i]; })[0]; if (A && B) out.push(Math.hypot(PNW.num(B.Easting) - PNW.num(A.Easting), PNW.num(B.Northing) - PNW.num(A.Northing))); }
    return out;
  }
  function parsedCon(id, unique) { return ((dm && dm.byPole[id]) || []).filter(function (c) { return c.unique === unique; })[0] || null; }
  function renderSections() {
    if (!project) { $('tableWrap').innerHTML = '<div style="padding:14px">' + startDesignHint() + '<p class="hint">The conductor schedule lists the strain sections of the linked PNW project.</p></div>'; return; }
    var tables = stringing(), q = $('search').value.trim().toLowerCase();
    var h = '<table class="grid"><thead><tr><th>Section</th><th>Poles</th><th>Conductor</th><th>Tension</th><th>Units</th><th class="num">Wires</th><th class="num">Spans</th><th class="num">Length</th><th class="num">Ruling span</th><th>DCSH sag table</th><th></th></tr></thead><tbody>';
    var shown = 0;
    project.segments.forEach(function (sg) {
      var n = sg.StrainSect, mem = project.segPoles.filter(function (x) { return x.strsection === n; }), sp = spansOf(mem.map(function (x) { return x.id; }));
      if (q && (n + ' ' + sg.Conductor + ' ' + mem.map(function (x) { return x.id + ' ' + x.constr; }).join(' ')).toLowerCase().indexOf(q) < 0) return;
      shown++;
      var pick = (S.design.tables || {})[n] || '', sug = suggestTable(sg)[0], c = conductorFor(sg.Conductor), lvl = mem[0] ? levelOf(mem[0].constr) : '';
      h += '<tr data-sec="' + esc(n) + '" class="' + (S.selSection === n ? 'sel' : '') + '"><td><b>' + esc(n) + '</b>' + (sg.New === 'True' ? ' <span class="pill info">New</span>' : '') + '</td>' +
        '<td style="white-space:normal;min-width:180px">' + mem.map(function (x) { return esc(x.id) + ' <small class="muted">' + esc(x.constr) + '</small>'; }).join(' → ') + '</td>' +
        '<td style="min-width:200px">' + combo('seccond|' + n, { value: sg.Conductor, placeholder: 'Search conductor…', aria: 'Conductor of ' + n, groups: function () { return conductorGroups(mem[0] && mem[0].id, lvl); }, onPick: function (v) {
          var cc = conductorFor(v); if (!cc) { setStatus(v + ' is not in the PNW library or this project.', 'bad'); renderTable(); return; }
          commit(function (p) { var s0 = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = s0.Conductor; M.updateSection(p, n, { conductor: cc }); return [logEntry('', n, 'Conductor', from, cc.code, 'manual', lib && lib.conductors.indexOf(cc) >= 0 ? 'PNW library ' + cc.code : '')]; });
        } }) + (c && c.name ? '<small class="muted">' + esc(c.name) + '</small>' : '') + '</td>' +
        '<td><input data-secten="' + esc(n) + '" value="' + esc(sg.Tension) + '" inputmode="decimal" style="width:64px" aria-label="Tension of ' + esc(n) + '"></td>' +
        '<td><select data-secunits="' + esc(n) + '" aria-label="Tension units of ' + esc(n) + '"><option' + (sg.TensionUnits === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (sg.TensionUnits === 'kN' ? ' selected' : '') + '>kN</option></select></td>' +
        '<td class="num">' + esc(sg.numconds) + '</td><td class="num">' + sp.length + '</td><td class="num">' + (sp.length ? sp.reduce(function (a, b) { return a + b; }, 0).toFixed(1) + ' m' : '') + '</td>' +
        '<td class="num">' + (sp.length ? M.rulingSpan(sp).toFixed(1) + ' m' : '') + '</td>' +
        '<td><select data-secsag="' + esc(n) + '" aria-label="DCSH sag table for ' + esc(n) + '"><option value="">' + (sug ? 'Matched: ' + esc(sug.title) : 'None matched') + '</option>' + tables.filter(function (t) { return !t.legacy; }).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === pick ? ' selected' : '') + '>' + esc(t.title) + ' (p' + t.page + ')</option>'; }).join('') + '</select></td>' +
        '<td><button class="btn small danger" data-secdel="' + esc(n) + '" title="Remove this strain section">Remove</button></td></tr>';
    });
    if (!project.segments.length) h += '<tr><td colspan="11" class="muted">No strain sections yet. String the first one with the form below.</td></tr>';
    else if (!shown) h += '<tr><td colspan="11" class="muted">No strain section matches the search.</td></tr>';
    h += '</tbody></table>';
    $('tableWrap').innerHTML = h + '<div class="con add" style="margin:10px 8px" id="secFormBox">' + secFormHtml() + '</div>';
  }
  function secFormHtml() {
    var f = secForm, ids = project.poles.map(function (r) { return r.ID; });
    if (!ids.length) return '<p class="hint">The linked project has no poles.</p>';
    if (ids.indexOf(f.from) < 0) f.from = ids[0]; if (ids.indexOf(f.to) < 0) f.to = ids[ids.length - 1];
    var a = ids.indexOf(f.from), b = ids.indexOf(f.to), run = ids.slice(Math.min(a, b), Math.max(a, b) + 1), counts = {};
    project.constructions.forEach(function (c) { var l = levelOf(c.code); if (l && run.indexOf(c.pole) >= 0) (counts[l] = counts[l] || {})[c.pole] = 1; });
    var levels = Object.keys(counts).sort(function (x, y) { return Object.keys(counts[y]).length - Object.keys(counts[x]).length; });
    if (levels.indexOf(f.level) < 0) f.level = levels[0] || '';
    var gis = circuitOf(f.level) ? gisConductorsAt(f.from, circuitOf(f.level)) : [];
    if (!f.condUser) { f.cond = gis.length === 1 && gis[0].lib ? gis[0].lib.code : ''; f.gis = f.cond ? gis[0] : null; }
    var ts = f.cond ? tensionSuggestions(f.cond) : [];
    if (!f.tensionUser && f.cond && f.autoFor !== f.cond) { f.autoFor = f.cond; if (ts.length === 1) { f.tension = String(ts[0].value); f.units = ts[0].units; f.table = ts[0].table || ''; f.tsrc = ts[0].note; } else { f.tension = ''; f.table = ''; f.tsrc = ''; } }
    var mem = sectionMembers(f), c = conductorFor(f.cond), ck = secChecks(f, mem, c, gis, ts);
    var poleSel = function (key, cur, label) { return '<select data-secf="' + key + '" aria-label="' + label + '">' + ids.map(function (i) { return '<option' + (i === cur ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') + '</select>'; };
    var h = '<div class="con-title">String conductors (new strain section)</div><div class="secform">' +
      '<div class="field"><label>From pole</label>' + poleSel('from', f.from, 'From pole') + '</div><div class="field"><label>To pole</label>' + poleSel('to', f.to, 'To pole') + '</div>' +
      '<div class="field"><label title="Construction code prefix that carries the circuit, with how many poles in the range have it">Circuit (constructions)</label><select data-secf="level" aria-label="Circuit">' + (levels.length ? levels.map(function (l) { return '<option value="' + esc(l) + '"' + (l === f.level ? ' selected' : '') + '>' + esc(l) + ' · ' + Object.keys(counts[l]).length + ' of ' + run.length + ' poles</option>'; }).join('') : '<option value="">Add constructions first</option>') + '</select></div>' +
      '<div class="field" style="grid-column:span 2"><label>Conductor</label>' + chipRow('cmat', condFilter, COND_MAT) + combo('secNewCond', { value: f.cond, placeholder: 'Search code, name or stranding…', aria: 'Conductor for the new strain section', groups: function () { return conductorGroups(f.from, f.level); }, emptyText: 'import the PNW library tables or link a project with conductors.', onPick: function (v) { f.cond = v; f.condUser = true; f.gis = null; refreshSecForm(); } }) + '</div>' +
      '<div class="field"><label>Tension</label><input data-secf="tension" value="' + esc(f.tension) + '" inputmode="decimal" placeholder="from the design"' + (ck.bad.tension ? ' class="invalid"' : '') + '></div>' +
      '<div class="field"><label>Units</label><select data-secf="units"><option' + (f.units === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (f.units === 'kN' ? ' selected' : '') + '>kN</option></select></div></div>';
    if (c) h += '<p class="meta"><b>' + esc(c.code) + '</b> ' + esc(c.name || '') + (c.name2 ? ' · ' + esc(c.name2) : '') + (c.material ? ' · ' + esc(c.material) : '') + (c.cbl != null ? ' · CBL ' + c.cbl + ' kN' : '') + (c.mass != null ? ' · ' + c.mass + ' kg/m' : '') + '</p>';
    if (ts.length) h += '<div class="meta">Tension suggestions: ' + ts.map(function (t, i) { return '<button class="btn small' + (String(t.value) === String(f.tension) && t.units === f.units && (t.table || '') === (f.table || '') ? ' on' : '') + '" data-tpick="' + i + '" title="' + esc(t.note) + '">' + esc(t.label) + ' · ' + esc(t.note) + '</button>'; }).join(' ') + '</div>';
    h += mem.length ? '<p class="meta">' + mem.map(function (m) { var pc = m.c ? parsedCon(m.id, m.c.unique) : null; return '<b>' + esc(m.id) + '</b> ' + (m.options.length > 1 ? '<select data-secpick="' + esc(m.id) + '" aria-label="Construction on ' + esc(m.id) + '">' + m.options.map(function (o) { return '<option value="' + esc(o.unique) + '"' + (o === m.c ? ' selected' : '') + '>' + esc(o.descr) + '</option>'; }).join('') + '</select>' : m.c ? esc(m.c.descr) : '<span class="pill bad">no ' + esc(f.level || '') + ' construction</span>') + (pc ? ' <small class="muted">' + pc.attachments.length + ' pts</small>' : ''); }).join(' → ') + '</p>' : '';
    if (ck.preview) h += '<p class="meta">' + ck.preview + '</p>';
    h += '<ul class="msgs">' + ck.msgs.map(function (m) { return '<li class="' + m.level + '">' + m.text + '</li>'; }).join('') + '</ul>';
    h += '<div class="btnrow"><button class="btn small primary" id="secAdd"' + (ck.ok ? '' : ' disabled') + '>Add strain section</button></div>' +
      '<p class="hint">Each pole in between is included in line order. Conductors attach to the chosen construction\'s attachment points; the number of wires is the smallest number of attachment points along the section. The conductor is copied from the PNW library into the project. Load conditions are copied from an existing section, or Hot 75 °C, standard 15 °C, Uplift 0 °C and Warm 40 °C. PNW works out the sags and tiploads when you open the file.</p>';
    return h;
  }
  // Checks on the new strain section before it can be added: errors block it, warnings and notes are shown.
  function secChecks(f, mem, c, gis, ts) {
    var msgs = [], bad = {}, E = function (t, k) { msgs.push({ level: 'error', text: t }); if (k) bad[k] = 1; }, W = function (t) { msgs.push({ level: 'warning', text: t }); }, I = function (t) { msgs.push({ level: 'info', text: t }); };
    if (mem.length < 2) E('Choose two different poles.');
    if (!f.level) E('There are no constructions on these poles yet. Add them in the inspector (Constructions tab) first.');
    var missing = mem.filter(function (m) { return !m.c; });
    if (f.level && missing.length) E('No ' + esc(f.level) + ' construction on ' + esc(missing.map(function (m) { return m.id; }).join(', ')) + '. Add one in the inspector, or choose a shorter range.');
    var pts = mem.filter(function (m) { return m.c; }).map(function (m) { var pc = parsedCon(m.id, m.c.unique); return { id: m.id, descr: m.c.descr, n: pc ? pc.attachments.length : 0 }; });
    var none = pts.filter(function (x) { return !x.n; });
    if (none.length) E(esc(none.map(function (x) { return x.id + ' ' + x.descr; }).join(', ')) + ' ' + (none.length > 1 ? 'have' : 'has') + ' no attachment points, so no wire can be strung. Add them in the inspector.');
    var ns = pts.map(function (x) { return x.n; }).filter(Boolean), nmin = ns.length ? Math.min.apply(null, ns) : 0;
    if (ns.length && Math.max.apply(null, ns) !== nmin) W('Attachment points differ along the section (' + esc(pts.map(function (x) { return x.id + ' ' + x.n; }).join(', ')) + '), so ' + nmin + ' wire' + (nmin === 1 ? '' : 's') + ' will be strung.');
    pts.forEach(function (x) { var used = project.segPoles.filter(function (s) { return s.id === x.id && s.constr === x.descr; }).map(function (s) { return s.strsection; }); if (used.length) W(esc(x.id + ' ' + x.descr) + ' already carries ' + esc(used.join(', ')) + '.'); });
    if (!f.cond) E('Choose the conductor.', 'cond');
    else if (!c) E(esc(f.cond) + ' is not in the PNW library or this project.', 'cond');
    else {
      var circ = circuitOf(f.level), txt = (c.name || '') + ' ' + (c.name2 || '');
      if (circ === 'HV' && /\bLV\b|service cable/i.test(txt)) W(esc(c.code) + ' (' + esc(txt.trim()) + ') looks like an LV conductor on an HV circuit.');
      if (circ === 'LV' && /\d\s*kV/i.test(txt)) W(esc(c.code) + ' (' + esc(txt.trim()) + ') is rated for HV but the circuit is LV.');
      if (gis.length && f.condUser && !gis.some(function (t) { return t.lib && t.lib.code === c.code; })) I('GIS records ' + esc(gis.map(function (t) { return t.description; }).join(', ')) + ' on feeder ' + esc(gis[0].feeder) + '; you chose ' + esc(c.code) + '.');
    }
    if (gis.length > 1) I('GIS has more than one conductor on feeder ' + esc(gis[0].feeder) + ' (' + esc(gis.map(function (t) { return t.description; }).join(', ')) + '), so choose it yourself.');
    else if (gis.length === 1 && !gis[0].lib) I('GIS records ' + esc(gis[0].description) + ' on feeder ' + esc(gis[0].feeder) + ', which is not in the PNW library. Choose the matching library conductor.');
    else if (gis.length === 1 && f.gis && !f.condUser) I('Conductor filled in from GIS: ' + esc(gisText(gis[0])) + '.');
    else if (!gis.length && gisRuns().length && circuitOf(f.level)) I('No GIS ' + circuitOf(f.level) + ' conductor is recorded on the feeder of ' + esc(f.from) + '.');
    var t = PNW.num(f.tension);
    if (f.tension === '' || f.tension == null) E('Type the stringing tension' + (c && !ts.length ? ' (no DCSH Part 10 table matches ' + esc(c.code) + ')' : ts.length > 1 ? ' or pick one of the suggestions' : '') + '.', 'tension');
    else if (!(t > 0)) E('"' + esc(f.tension) + '" is not a valid tension.', 'tension');
    else if (f.units === '%CBL') {
      var maxPct = Math.max.apply(null, [0].concat(stringing().map(function (x) { var m = x.title.replace(/\b(\d) (\d) ?%/g, '$1$2%').match(/(\d+(?:\.\d+)?)\s*%/g) || []; return Math.max.apply(null, [0].concat(m.map(function (v) { return parseFloat(v); }))); })));
      if (t > 100) E('A tension above 100 %CBL is not possible.', 'tension');
      else if (maxPct && t > maxPct) W(t + ' %CBL is above every DCSH Part 10 stringing table (the highest is ' + maxPct + ' %).');
    } else if (c && c.cbl != null && t >= c.cbl) E(t + ' kN is at or above the conductor\'s CBL (' + c.cbl + ' kN).', 'tension');
    if (f.tsrc && !f.tensionUser) I('Tension filled in from ' + esc(f.tsrc) + '.');
    var sp = mem.length > 1 ? spansOf(mem.map(function (m) { return m.id; })) : [];
    return { msgs: msgs, bad: bad, ok: !msgs.some(function (m) { return m.level === 'error'; }), preview: sp.length ? sp.length + ' span' + (sp.length === 1 ? '' : 's') + ', ' + sp.reduce(function (a, b) { return a + b; }, 0).toFixed(1) + ' m, ruling span ' + M.rulingSpan(sp).toFixed(1) + ' m' + (nmin ? ', ' + nmin + ' wire' + (nmin === 1 ? '' : 's') : '') : '' };
  }
  // Attachments & heights: every attachment point of every construction, by pole.
  function renderHeights() {
    if (!project || !dm) { $('tableWrap').innerHTML = '<div style="padding:14px">' + startDesignHint() + '</div>'; return; }
    var q = $('search').value.trim().toLowerCase(), carry = {}, h = '';
    project.segPoles.forEach(function (s) { var k = s.id + '|' + s.constr; (carry[k] = carry[k] || []).push(s.strsection); });
    var segCond = {}; project.segments.forEach(function (s) { segCond[s.StrainSect] = s.Conductor; });
    var n = 0;
    project.poles.forEach(function (r) {
      var id = r.ID, cons = ((dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
      if (q && (id + ' ' + cons.map(function (c) { return c.descr + ' ' + c.code; }).join(' ')).toLowerCase().indexOf(q) < 0) return;
      h += '<tr class="group" data-id="' + esc(id) + '"><td colspan="12">' + esc(id) + ' <small class="muted">ch ' + esc(r.Distance) + ' m · ' + esc(r.Length) + ' m pole · ' + esc(r.HeightAG) + ' m above ground' + (cons.length ? '' : ' · no constructions') + '</small></td></tr>';
      cons.forEach(function (c) {
        var secs = carry[id + '|' + c.descr] || [], conds = secs.map(function (s) { return s + ' ' + (segCond[s] || ''); }).join(', ');
        var over = c.kingbolt != null && PNW.num(r.HeightAG) != null && c.kingbolt > PNW.num(r.HeightAG);
        if (!c.attachments.length) { n++; h += '<tr data-id="' + esc(id) + '"><td></td><td>' + esc(c.descr) + '</td><td>' + esc(c.code) + '</td><td class="num' + (over ? ' miss' : '') + '">' + fmt(c.kingbolt) + '</td><td colspan="5" class="miss">no attachment points</td><td>' + esc(conds) + '</td><td>' + esc(c.source ? c.source.kind : '') + '</td><td></td></tr>'; return; }
        c.attachments.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (a) {
          n++;
          var hag = c.kingbolt != null ? Math.round((c.kingbolt + a.y) * 1000) / 1000 : null, pt = (dm.points || []).filter(function (p) { return p.pole === id && p.construction === (c.descr || c.code) && p.order === a.order; })[0];
          h += '<tr data-id="' + esc(id) + '"><td></td><td>' + esc(c.descr) + '</td><td>' + esc(c.code) + '</td><td class="num' + (over ? ' miss' : '') + '">' + fmt(c.kingbolt) + '</td><td class="num">' + a.order + '</td><td class="num">' + fmt(a.x) + '</td><td class="num">' + fmt(a.y) + '</td><td class="num"><b>' + fmt(hag, 3) + '</b></td><td class="num">' + (pt ? fmt(pt.elevation, 3) : '') + '</td><td>' + esc(conds) + '</td><td>' + esc(c.source ? c.source.kind : '') + '</td><td>' + (over ? '<span class="pill bad">above tip</span>' : '') + '</td></tr>';
        });
      });
    });
    if (!n && !h) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">' + (q ? 'Nothing matches the search.' : 'No constructions in the linked project yet.') + '</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Pole</th><th>Construction</th><th>Code</th><th class="num">King bolt AG (m)</th><th class="num">#</th><th class="num">x (m)</th><th class="num">y (m)</th><th class="num">Height AG (m)</th><th class="num">Elevation (m)</th><th>Carries</th><th>King bolt source</th><th></th></tr></thead><tbody>' + h + '</tbody></table><p class="hint" style="margin:8px">Height above ground = king bolt + attachment y (PNW manual §7.9.3); elevation = ground level at the pole + height. Values are shown as stored in the project, not rounded for calculation.</p>';
  }
  $('tableWrap').addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (d.secf) {
      var v = t.value.trim();
      if (d.secf === 'tension') { secForm.tension = v; secForm.tensionUser = v !== ''; secForm.table = ''; secForm.tsrc = ''; }
      else secForm[d.secf] = v;
      if (d.secf === 'from' || d.secf === 'to' || d.secf === 'level') secForm.pick = {};
      if (d.secf === 'units') secForm.table = '';
      refreshSecForm(); return;
    }
    if (d.secpick) { (secForm.pick = secForm.pick || {})[d.secpick] = t.value; refreshSecForm(); return; }
    if (d.secsag != null) { var tb = S.design.tables = S.design.tables || {}, before = tb[d.secsag] || 'matched'; if (t.value) tb[d.secsag] = t.value; else delete tb[d.secsag]; S.design.log = liveLog().concat([logEntry('', d.secsag, 'DCSH sag table', before, t.value || 'matched', 'manual')]); recompute(); return; }
    if (d.secten != null || d.secunits != null) {
      var n = d.secten || d.secunits, tv = PNW.num(t.value);
      if (d.secten != null && !(tv > 0)) { setStatus('"' + t.value + '" is not a valid tension for ' + n + '.', 'bad'); renderTable(); return; }
      commit(function (p) { var sg = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = sg.Tension + ' ' + sg.TensionUnits; M.updateSection(p, n, d.secten != null ? { tension: tv } : { units: t.value }); return [logEntry('', n, 'Tension', from, sg.Tension + ' ' + sg.TensionUnits, 'manual')]; });
    }
  });
  function refreshSecForm() { var box = $('secFormBox'); if (box && project) box.innerHTML = secFormHtml(); }
  $('tableWrap').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b && tab === 'sections') { var tr = e.target.closest('tr[data-sec]'); if (tr && !e.target.closest('input,select,.combo')) { var mem0 = project.segPoles.filter(function (x) { return x.strsection === tr.dataset.sec; })[0]; select(S.selected || (mem0 && mem0.id) || null, { segment: S.selSection === tr.dataset.sec ? '' : tr.dataset.sec }); } return; }
    if (!b || tab !== 'sections') return;
    if (b.dataset.chip) { condFilter = b.dataset.chip.split(':')[1]; refreshSecForm(); return; }
    if (b.dataset.tpick != null) { var ts = tensionSuggestions(secForm.cond)[+b.dataset.tpick]; if (ts) { secForm.tension = String(ts.value); secForm.units = ts.units; secForm.table = ts.table || ''; secForm.tsrc = ts.note; secForm.tensionUser = true; } refreshSecForm(); return; }
    if (b.dataset.secdel != null) { var n = b.dataset.secdel; if (S.selSection === n) S.selSection = null; commit(function (p) { M.removeSection(p, n); return [logEntry('', n, 'Strain section', n, 'removed', 'manual')]; }); return; }
    if (b.id === 'secAdd') {
      var f = secForm, c = conductorFor(f.cond), mem = sectionMembers(f), gis = circuitOf(f.level) ? gisConductorsAt(f.from, circuitOf(f.level)) : [], ck = secChecks(f, mem, c, gis, c ? tensionSuggestions(f.cond) : []);
      if (!ck.ok) { setStatus(ck.msgs.filter(function (m) { return m.level === 'error'; })[0].text.replace(/<[^>]+>/g, ''), 'bad'); refreshSecForm(); return; }
      var added = null;
      commit(function (p) {
        var name = added = M.addSection(p, { conductor: c, tension: PNW.num(f.tension), units: f.units, poles: mem.map(function (m) { return { id: m.id, unique: m.c.unique }; }) });
        if (f.table) (S.design.tables = S.design.tables || {})[name] = f.table;
        return [logEntry(mem[0].id + '→' + mem[mem.length - 1].id, name, 'Strain section', '', c.code + ' at ' + f.tension + ' ' + f.units + ' on ' + mem.map(function (m) { return m.id + ' ' + m.c.descr; }).join(', '), f.gis && !f.condUser ? 'calculated' : 'manual', [lib && lib.conductors.indexOf(c) >= 0 ? 'PNW library ' + c.code : '', f.gis && !f.condUser ? 'GIS ' + f.gis.description + ' on feeder ' + f.gis.feeder + ' (' + f.gis.runs.join(', ') + ')' : '', f.tsrc ? 'tension from ' + f.tsrc : ''].filter(Boolean).join('; '))];
      });
      if (added) { secForm = { tension: '', units: f.units, from: f.from, to: f.to, level: f.level }; select(S.selected, { segment: added }); setStatus('Added strain section ' + added + '.', 'good'); }
    }
  });
  function renderLog() {
    var l = liveLog();
    if (!l.length) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">No design changes yet. Changes you make to constructions and register approvals are recorded here.</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Time</th><th>Pole</th><th>Construction</th><th>Field</th><th>Original</th><th>Proposed</th><th>Approved value</th><th>Source</th><th>Reference</th><th>By</th></tr></thead><tbody>' +
      l.slice().reverse().map(function (x) { return '<tr data-id="' + esc(x.pole) + '"><td>' + esc(new Date(x.t).toLocaleString('en-AU')) + '</td><td>' + esc(x.pole) + '</td><td>' + esc(x.construction) + '</td><td>' + esc(x.field) + '</td><td>' + esc(x.from) + '</td><td>' + esc(x.proposed) + '</td><td><b>' + esc(x.to) + '</b></td><td><span class="tag ' + (x.source === 'manual' ? 'edit' : x.source === 'AI suggestion' ? 'ai' : 'der') + '">' + esc(x.source) + '</span></td><td style="white-space:normal">' + esc(x.reference) + '</td><td>' + esc(x.by) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* selected pole: constructions from the linked project, editable */
  /* ---------- suggestions: construction codes and conductors from the PNW library, your projects, GIS and DCSH ---------- */
  var CLASS_LABEL = { hv: 'HV', lv: 'LV', earth: 'Earth', comms: 'Comms', other: 'Other' };
  // Circuit of a construction code: the library line-line voltage when it has one, else the code prefix.
  function circuitClass(code) {
    var c = String(code || ''), lc = M.libraryConstruction(lib, c);
    if (/^RE/i.test(c)) return 'earth';
    if (/^(ADSS|PIL|OPGW)/i.test(c)) return 'comms';
    if (lc && lc.voltageLL != null) return lc.voltageLL > 1 ? 'hv' : 'lv';
    return /^H/i.test(c) ? 'hv' : /^(L|AB)/i.test(c) ? 'lv' : 'other';
  }
  // Arrangement read from the words of the library description (filter only; nothing is assumed from it).
  var ARR = [['termination', /termination/i, 'Termination'], ['tee-off', /tee.?off/i, 'Tee-off'], ['strain', /strain|angle|in-line/i, 'Strain / angle'], ['intermediate', /intermediate/i, 'Intermediate']];
  function arrangementOf(desc) { for (var i = 0; i < ARR.length; i++) if (ARR[i][1].test(desc || '')) return ARR[i][0]; return 'other'; }
  function arrLabel(a) { var x = ARR.filter(function (r) { return r[0] === a; })[0]; return x ? x[2] : 'Other'; }
  var conFilter = { cls: 'all', arr: 'all' };
  function constructionItem(code, note) {
    var lc = M.libraryConstruction(lib, code), lay = knownLayout(code), d = M.dcshFor(dcshReg(), code)[0], cls = circuitClass(code);
    return { value: code, label: lc ? lc.description : '', cls: cls, arr: lc ? arrangementOf(lc.description) : 'other',
      note: [CLASS_LABEL[cls], lc ? arrLabel(arrangementOf(lc.description)) : 'not in the PNW library', lay ? lay.attachments.length + ' attachment point' + (lay.attachments.length === 1 ? '' : 's') + ' from ' + lay.source : 'no attachment offsets known', d ? 'DCSH ' + d.drawing + ' (' + (M.DCSH_STATUS[d.status] || d.status) + ')' : '', note].filter(Boolean).join(' · ') };
  }
  // Groups for the construction code box: what the neighbouring poles use, codes in your projects, then the PNW library.
  function constructionGroups(id, filt) {
    filt = filt || { cls: 'all', arr: 'all' };
    var seen = {}, groups = [], keep = function (it) { return (filt.cls === 'all' || it.cls === filt.cls) && (filt.arr === 'all' || it.arr === filt.arr); };
    function add(label, items) { items = items.filter(function (it) { var k = String(it.value).toUpperCase(); if (seen[k] || !keep(it)) return false; seen[k] = 1; return true; }); if (items.length) groups.push({ label: label, items: items }); }
    if (project) {
      var ids = project.poles.map(function (r) { return r.ID; }), k = ids.indexOf(id), near = {};
      [k - 1, k + 1, k - 2, k + 2].forEach(function (j) { if (k < 0 || j < 0 || j >= ids.length) return; project.constructions.forEach(function (c) { if (c.pole === ids[j] && c.code) (near[c.code] = near[c.code] || []).indexOf(ids[j]) < 0 && near[c.code].push(ids[j]); }); });
      add('On neighbouring poles', Object.keys(near).map(function (c) { return constructionItem(c, 'on ' + near[c].join(', ')); }));
    }
    add('Used in your PNW projects', registerRows().filter(function (r) { return r.code && r.sources.length; }).map(function (r) { return constructionItem(r.code, 'seen on ' + r.sources.length + ' pole' + (r.sources.length === 1 ? '' : 's')); }));
    add('PNW library', (lib ? lib.constructions : []).map(function (c) { return constructionItem(c.code); }).sort(function (a, b) { return a.value < b.value ? -1 : 1; }));
    return groups;
  }
  function chipRow(kind, cur, opts) { return '<div class="chips" role="group">' + opts.map(function (o) { return '<button type="button" data-chip="' + kind + ':' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
  function conFilterChips() {
    return chipRow('cls', conFilter.cls, [['all', 'Any circuit'], ['hv', 'HV'], ['lv', 'LV'], ['earth', 'Earth'], ['comms', 'Comms']]) +
      chipRow('arr', conFilter.arr, [['all', 'Any arrangement'], ['intermediate', 'Intermediate'], ['strain', 'Strain / angle'], ['termination', 'Termination'], ['tee-off', 'Tee-off']]);
  }

  // Conductors: on this feeder in GIS, already in the project, then the PNW library.
  var condFilter = 'all';
  var COND_MAT = [['all', 'Any'], ['AAC', 'AAC'], ['AAAC', 'AAAC'], ['ACSR', 'ACSR'], ['Copper', 'Copper'], ['Steel', 'Steel'], ['insulated', 'Insulated']];
  function condMatch(c) { return condFilter === 'all' || (condFilter === 'insulated' ? c.insulation && !/^(none|)$/i.test(c.insulation) : c.material === condFilter); }
  function conductorItem(c, note) { return { value: c.code, label: c.name + (c.name2 ? ' · ' + c.name2 : ''), note: [c.material, c.cbl != null ? 'CBL ' + c.cbl + ' kN' : '', c.insulation && !/^none$/i.test(c.insulation) ? c.insulation + ' insulated' : '', note].filter(Boolean).join(' · ') }; }
  function conductorGroups(fromId, level) {
    var seen = {}, groups = [];
    function add(label, items) { items = items.filter(function (it) { if (seen[it.value]) return false; seen[it.value] = 1; return true; }); if (items.length) groups.push({ label: label, items: items }); }
    var circuit = circuitOf(level || ''), gis = circuit && fromId ? gisConductorsAt(fromId, circuit) : [];
    add('On this feeder in GIS', gis.filter(function (t) { return t.lib; }).map(function (t) { return conductorItem(t.lib, 'GIS ' + t.description + ' on ' + t.feeder); }));
    if (project) add('Already in this project', project.conductors.map(function (r) {
      var c = conductorFor(r.Code) || { code: r.Code, name: r.Name1 || '' }, used = project.segments.filter(function (s) { return s.Conductor === r.Code; }).map(function (s) { return s.StrainSect; });
      return conductorItem(c, used.length ? 'used on ' + used.join(', ') : 'not used yet');
    }));
    add('PNW library', (lib ? lib.conductors : []).filter(condMatch).map(function (c) { return conductorItem(c); }).sort(function (a, b) { return a.value.toLowerCase() < b.value.toLowerCase() ? -1 : 1; }));
    return groups;
  }
  function tablesFor(c) { return M.tablesForConductor(stringing(), c); }
  // Tension suggestions: what this project already uses for the conductor, and the DCSH Part 10 table tensions for it.
  function tensionSuggestions(code) {
    var out = [], seen = {}, c = conductorFor(code);
    function add(o) { var k = o.value + o.units + (o.table || ''); if (seen[k]) return; seen[k] = 1; out.push(o); }
    (project ? project.segments : []).forEach(function (s) { if (s.Conductor === code && PNW.num(s.Tension) > 0) add({ value: PNW.num(s.Tension), units: s.TensionUnits, label: s.Tension + ' ' + s.TensionUnits, note: 'as ' + s.StrainSect + ' in this project' }); });
    tablesFor(c).forEach(function (x) { add({ value: x.pct, units: '%CBL', table: x.table.id, label: x.pct + ' %CBL', note: x.table.title + ' (DCSH Part 10 p' + x.table.page + ')' }); });
    return out;
  }

  // Searchable combo box: an input with grouped suggestions, used for construction codes and conductors.
  // o: { value, placeholder, aria, groups(): [{label, items:[{value,label,note}]}], onPick(value, item), free: typed values allowed }
  var combos = {}, comboKey = null, comboAct = -1, comboShown = [];
  function combo(key, o) {
    combos[key] = o;
    return '<div class="combo" data-combo="' + esc(key) + '"><input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="comboList" autocomplete="off" spellcheck="false" value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || 'Search…') + '"' + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + (o.invalid ? ' class="invalid"' : '') + '><button type="button" class="ctog" tabindex="-1" aria-label="Show suggestions">▼</button></div>';
  }
  var comboList = document.createElement('div'); comboList.className = 'combo-list'; comboList.id = 'comboList'; comboList.setAttribute('role', 'listbox'); comboList.hidden = true; document.body.appendChild(comboList);
  function comboInput(key) { var el = document.querySelector('.combo[data-combo="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"] input'); return el; }
  function comboOpen(key, q) {
    var o = combos[key], inp = comboInput(key); if (!o || !inp) return;
    comboKey = key; comboAct = -1; comboShown = [];
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean), h = '';
    o.groups().forEach(function (g) {
      var items = g.items.filter(function (it) { var s = (it.value + ' ' + (it.label || '') + ' ' + (it.note || '')).toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); }).slice(0, 80);
      if (!items.length) return;
      h += '<div class="cg">' + esc(g.label) + '</div>' + items.map(function (it) { comboShown.push(it); return '<div class="ci" role="option" data-ci="' + (comboShown.length - 1) + '"><b>' + esc(it.value) + '</b><span>' + esc(it.label || '') + '</span>' + (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</div>'; }).join('');
    });
    if (!comboShown.length) h = '<div class="none">' + (words.length ? 'Nothing matches "' + esc(q) + '".' + (o.free ? ' Press Enter to use it as typed (it will be flagged for review).' : '') : 'No suggestions available: ' + esc(o.emptyText || 'import the PNW library tables.')) + '</div>';
    comboList.innerHTML = h; comboList.hidden = false; inp.setAttribute('aria-expanded', 'true');
    var r = inp.getBoundingClientRect(), below = window.innerHeight - r.bottom;
    comboList.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 384)) + 'px'; comboList.style.width = Math.max(r.width, 380) + 'px';
    comboList.style.maxHeight = Math.max(160, Math.min(340, below > 220 ? below - 12 : r.top - 12)) + 'px';
    if (below > 220 || below > r.top) { comboList.style.top = (r.bottom + 3) + 'px'; comboList.style.bottom = ''; } else { comboList.style.top = ''; comboList.style.bottom = (window.innerHeight - r.top + 3) + 'px'; }
  }
  function comboClose(restore) {
    if (comboKey == null) return;
    var inp = comboInput(comboKey), o = combos[comboKey];
    if (inp) { inp.setAttribute('aria-expanded', 'false'); if (restore && o) inp.value = o.value || ''; }
    comboList.hidden = true; comboKey = null; comboShown = [];
  }
  function comboPick(it, typed) {
    var key = comboKey, o = combos[key], inp = comboInput(key); if (!o) return;
    var v = it ? it.value : typed;
    if (inp) inp.value = v;
    comboClose(false);
    if (v !== (o.value || '')) { o.value = v; o.onPick(v, it || null); }
  }
  function comboMark(i) { comboAct = Math.max(0, Math.min(comboShown.length - 1, i)); Array.prototype.forEach.call(comboList.querySelectorAll('.ci'), function (el) { el.classList.toggle('act', +el.dataset.ci === comboAct); if (+el.dataset.ci === comboAct) el.scrollIntoView({ block: 'nearest' }); }); }
  document.addEventListener('focusin', function (e) { var c = e.target.closest && e.target.closest('.combo'); if (c && e.target.tagName === 'INPUT') { e.target.select(); comboOpen(c.dataset.combo, ''); } });
  document.addEventListener('input', function (e) { var c = e.target.closest && e.target.closest('.combo'); if (c) comboOpen(c.dataset.combo, e.target.value); });
  document.addEventListener('keydown', function (e) {
    var c = e.target.closest && e.target.closest('.combo'); if (!c) return;
    if (comboKey !== c.dataset.combo && /Arrow|Enter/.test(e.key)) comboOpen(c.dataset.combo, '');
    if (e.key === 'ArrowDown') { e.preventDefault(); comboMark(comboAct + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); comboMark(comboAct - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var typed = e.target.value.trim(), o = combos[c.dataset.combo], exact = comboShown.filter(function (it) { return String(it.value).toUpperCase() === typed.toUpperCase(); })[0];
      if (comboAct >= 0) comboPick(comboShown[comboAct]); else if (exact) comboPick(exact); else if (o && o.free && typed) comboPick(null, typed); else if (comboShown.length === 1) comboPick(comboShown[0]);
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); comboClose(true); }
  });
  document.addEventListener('focusout', function (e) {
    var c = e.target.closest && e.target.closest('.combo'); if (!c) return;
    setTimeout(function () {
      if (comboKey !== c.dataset.combo || (document.activeElement && document.activeElement.closest && document.activeElement.closest('.combo') === c)) return;
      var typed = e.target.value.trim(), o = combos[c.dataset.combo], exact = comboShown.filter(function (it) { return String(it.value).toUpperCase() === typed.toUpperCase(); })[0];
      if (o && typed !== (o.value || '') && exact) comboPick(exact); else if (o && o.free && typed && typed !== (o.value || '')) comboPick(null, typed); else comboClose(true);
    }, 120);
  });
  comboList.addEventListener('mousedown', function (e) { var el = e.target.closest('.ci'); e.preventDefault(); if (el) comboPick(comboShown[+el.dataset.ci]); });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('.combo .ctog'); if (b) { var inp = b.parentNode.querySelector('input'); if (comboKey === b.parentNode.dataset.combo) comboClose(true); else { inp.focus(); comboOpen(b.parentNode.dataset.combo, ''); } } });
  document.addEventListener('scroll', function (e) { if (comboKey != null && !comboList.contains(e.target)) comboClose(true); }, true);
  window.addEventListener('resize', function () { comboClose(true); });
  function lastSource(pole, descr, field) { var l = liveLog().filter(function (x) { return x.pole === pole && x.construction === descr && (x.field === field || x.field === 'Construction'); }).slice(-1)[0]; return l ? l.source : 'imported'; }
  // Attachment layout for a code: a fully dimensioned DCSH drawing, else one of the imported projects, else a layout built into
  // the private copy from Ishan's saved projects (window.PNW_BUILTIN.layouts).
  function knownLayout(code) {
    var d = M.dcshFor(dcshReg(), code)[0];
    if (d && d.attachments && d.attachments.every(function (a) { return a.y != null; })) return { attachments: d.attachments, source: 'DCSH ' + d.drawing };
    var r = registerRows().filter(function (x) { return x.code === code && x.attachments.length; });
    if (r.length) return { attachments: r[0].attachments, source: 'your project ' + r[0].sources[0] };
    var b = ((window.PNW_BUILTIN || {}).layouts || []).filter(function (x) { return x.code === code; })[0];
    return b ? { attachments: b.attachments, source: b.source } : null;
  }
  function poleTypeOptions(cur, keepLabel) {
    return '<option value="">' + keepLabel + '</option>' + (lib ? lib.poles : []).map(function (t) { return '<option value="' + esc(t.code) + '"' + (t.code === cur ? ' selected' : '') + '>' + esc(t.code) + (t.description ? ' · ' + esc(t.description) : '') + '</option>'; }).join('');
  }
  // Setting depth rule from the ground profile: 10% of the pole length + 0.6 m.
  function defaultSunk(L) { return Math.round((L * 0.1 + 0.6) * 100) / 100; }
  function poleBlock(id, row, pt) {
    var inSec = project.segPoles.some(function (s) { return s.id === id; }), next = project.poles[project.poles.indexOf(row) + 1];
    var gap = next ? Math.round((PNW.num(next.Distance) - PNW.num(row.Distance)) / 2 * 100) / 100 : 20;
    var h = '<div class="con"><div class="con-h"><b>Pole ' + esc(id) + '</b>' + (row.New === 'True' ? '<span class="pill info">New</span>' : '') + (pt.poleType ? '<small>' + esc(pt.poleType) + (pt.diamTip ? ' · tip ' + pt.diamTip + ' mm' : '') + '</small>' : '') + '</div>' +
      '<div class="field"><label>Pole type (PNW library)</label><select data-ptype="' + esc(id) + '">' + poleTypeOptions((S.design.poleTypes || {})[id] || '', 'Not set (length and depth as typed)') + '</select></div>' +
      '<div class="row2"><div class="field"><label>Length (m)</label><input data-pfield="length" value="' + esc(row.Length) + '" inputmode="decimal"></div><div class="field"><label>Setting depth (m)</label><input data-pfield="sunk" value="' + esc(row.Sunk) + '" inputmode="decimal"></div></div>' +
      '<p class="meta">' + esc(row.HeightAG) + ' m above ground · chainage ' + esc(row.Distance) + ' m · <label><input type="checkbox" data-pnew' + (row.New === 'True' ? ' checked' : '') + '> new pole</label></p>' +
      '<div class="btnrow">' + (inSec ? '<span class="meta">In a strain section, so it cannot be removed here.</span>' : '<button class="btn small" data-pdel="' + esc(id) + '">Remove pole from design</button>') + '</div>' +
      '<details class="addpole"><summary>Add a new pole near ' + esc(id) + '</summary><div class="row2"><div class="field"><label>New pole ID</label><input id="poleAddId" placeholder="e.g. P1"></div><div class="field"><label>Distance from ' + esc(id) + ' (m)</label><input id="poleAddDist" value="' + gap + '" inputmode="decimal" title="Positive is towards the next pole, negative towards the previous one"></div></div>' +
      '<div class="field"><label>Pole type</label><select id="poleAddType">' + poleTypeOptions('', 'Type the length') + '</select></div>' +
      '<div class="row2"><div class="field"><label>Length (m)</label><input id="poleAddLen" value="' + esc(row.Length) + '" inputmode="decimal"></div><div class="field"><label>Setting depth (m)</label><input id="poleAddSunk" placeholder="10% + 0.6 m" inputmode="decimal"></div></div>' +
      '<div class="btnrow"><button class="btn small primary" id="poleAdd" data-from="' + esc(id) + '">Add pole</button></div><p class="hint">The new pole goes on the ground line at that distance (positive is towards the next pole), with the ground level read from the profile.</p></details></div>';
    return h;
  }
  // Strain sections and attachment heights at one pole (inspector Conductors tab).
  function sectionsOnPole(id) {
    var names = []; project.segPoles.forEach(function (s) { if (s.id === id && names.indexOf(s.strsection) < 0) names.push(s.strsection); });
    var h = '<div class="con-title">Strain sections at ' + esc(id) + '</div>';
    h += names.length ? names.map(function (n) {
      var sg = project.segments.filter(function (x) { return x.StrainSect === n; })[0] || {}, at = project.segPoles.filter(function (x) { return x.strsection === n && x.id === id; })[0], mem = project.segPoles.filter(function (x) { return x.strsection === n; });
      var c = conductorFor(sg.Conductor);
      return '<div class="con' + (S.selSection === n ? ' sel' : '') + '"><div class="con-h"><b>' + esc(n) + '</b><small>' + esc(mem[0] ? mem[0].id : '') + ' → ' + esc(mem.length ? mem[mem.length - 1].id : '') + ' · ' + mem.length + ' poles</small></div>' +
        '<p class="meta"><b>' + esc(sg.Conductor) + '</b>' + (c && c.name ? ' (' + esc(c.name) + ')' : '') + ' at ' + esc(sg.Tension) + ' ' + esc(sg.TensionUnits) + ' · ' + esc(sg.numconds) + ' wires on ' + esc(at ? at.constr : '') + '</p>' +
        '<div class="btnrow"><button class="btn small" data-secshow="' + esc(n) + '"' + (S.selSection === n ? ' disabled' : '') + '>' + (S.selSection === n ? 'Highlighted in 3D' : 'Highlight in 3D') + '</button><button class="btn small" data-gotab="sections">Edit in the schedule</button></div></div>';
    }).join('') : '<p class="hint">No conductors attached to ' + esc(id) + ' yet. String them in the Conductor schedule.</p>';
    var gis = [];
    ['HV', 'LV'].forEach(function (l) { gisConductorsAt(id, l).forEach(function (t) { gis.push('<li class="info"><span class="tag src">GIS</span> ' + l + ': ' + esc(gisText(t)) + '</li>'); }); });
    if (gis.length) h += '<ul class="msgs">' + gis.join('') + '</ul>';
    var pts = ((dm && dm.points) || []).filter(function (q) { return q.pole === id; });
    h += '<div class="con-title" style="margin-top:12px">Attachment heights</div>';
    if (!pts.length) h += '<p class="hint">No attachment points on ' + esc(id) + '.</p>';
    else {
      var carry = {}; project.segPoles.forEach(function (s) { if (s.id === id) (carry[s.constr] = carry[s.constr] || []).push(s.strsection); });
      h += '<table class="att"><tr><th>Construction</th><th>#</th><th class="num">x</th><th class="num">y</th><th class="num">King bolt</th><th class="num">Height AG</th><th>Carries</th></tr>' + pts.slice().sort(function (a, b) { return b.heightAG - a.heightAG; }).map(function (q) {
        return '<tr><td>' + esc(q.construction) + '</td><td>' + q.order + '</td><td class="num">' + fmt(q.provenance.x) + '</td><td class="num">' + fmt(q.provenance.y) + '</td><td class="num">' + fmt(q.provenance.kingbolt) + '</td><td class="num"><b>' + fmt(q.heightAG, 3) + '</b></td><td>' + esc((carry[q.construction] || []).join(', ')) + '</td></tr>';
      }).join('') + '</table><p class="hint">Height above ground = king bolt + attachment y (PNW manual §7.9.3). All poles are listed in the Heights table.</p>';
    }
    return h;
  }
  function designPanel(id) {
    if (!project) return startDesignHint();
    var row = project.poles.filter(function (r) { return r.ID === id; })[0];
    if (!row) return '<p class="hint">' + esc(id) + ' is not in the linked PNW project ' + esc(linked.name) + '.</p>';
    var hag = PNW.num(row.HeightAG), cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
    var pt = (dm && dm.allPoles.filter(function (p) { return p.id === id; })[0]) || {};
    var h = '<div class="con-title">Design <span class="pill info">' + esc(linked.name) + '</span></div>' + poleBlock(id, row, pt) + '<div class="con-title" style="margin-top:10px">Constructions (' + cons.length + ')</div>';
    if (!cons.length) h += '<p class="hint">No constructions on ' + esc(id) + ' yet. Add one below.</p>';
    cons.forEach(function (c, i) {
      var r = regFor(c), st = statusOf(r), lc = M.libraryConstruction(lib, c.code), above = i > 0 ? cons[i - 1].kingbolt : null, def = M.defaultKingbolt(lib, c.code, hag, above);
      var carries = project.segPoles.filter(function (s) { return s.id === id && s.constr === c.descr; }).map(function (s) { return s.strsection; });
      var src = lastSource(id, c.descr, 'King bolt height'), d = M.dcshFor(dcshReg(), c.code)[0], cmp = d ? M.compareDcsh(d, c, i === 0 ? hag : null) : null;
      var u = esc(c.unique);
      h += '<div class="con" data-u="' + u + '"><div class="con-h"><b>' + esc(c.descr || '(blank construction)') + '</b><span class="pill mute">' + CLASS_LABEL[circuitClass(c.code)] + '</span>' + (lc ? '<small>' + esc(lc.description) + '</small>' : c.code ? '<span class="pill warn" title="This code is not in the PNW library tables">not in library</span>' : '') + '<span class="pill ' + st.cls + '">' + esc(st.text) + '</span></div>' +
        '<div class="row2"><div class="field"><label>Code</label>' + combo('ccode|' + c.unique, { value: c.code, placeholder: 'Search code…', aria: 'Construction code of ' + (c.descr || 'construction'), free: true, groups: function () { return constructionGroups(id); }, onPick: function (v) { changeCode(id, c.unique, v, 'manual', ''); if (!M.libraryConstruction(lib, v) && !knownLayout(v)) setStatus(v + ' is not in the PNW library or your projects: no defaults or offsets are known, so it needs engineering review.', 'bad'); } }) + '</div>' +
        '<div class="field"><label title="Height of the king bolt above ground, in metres">King bolt above ground (m) <span class="tag ' + (src === 'manual' ? 'edit' : src === 'imported' ? 'src' : 'der') + '">' + esc(src) + '</span></label><input data-ckb="' + u + '" value="' + fmt(c.kingbolt) + '" inputmode="decimal"' + (c.kingbolt != null && hag != null && c.kingbolt > hag ? ' class="invalid" title="Above the pole tip (' + hag + ' m above ground)"' : '') + '></div></div>';
      if (c.kingbolt != null && hag != null && c.kingbolt > hag) h += '<p class="hint bad">The king bolt is ' + fmt(Math.round((c.kingbolt - hag) * 1000) / 1000) + ' m above the pole tip (' + hag + ' m above ground).</p>';
      if (def && c.kingbolt != null && Math.abs(def.value - c.kingbolt) > 0.0005) h += '<p class="hint">' + esc(def.source) + ': <b>' + def.value + ' m</b> (' + def.below + ' m). <button class="btn small" data-cdef="' + u + '" data-v="' + def.value + '" data-ref="' + esc(def.source) + '">Use default</button></p>';
      if (cmp && cmp.notes.length) h += '<p class="hint warn">' + esc(cmp.notes.join(' ')) + '</p>';
      h += c.attachments.length ? '<table class="att"><tr><th>#</th><th>x (m)</th><th>y (m)</th><th class="num">Height AG</th><th></th></tr>' + c.attachments.map(function (a, k) { return '<tr><td>' + a.order + '</td><td><input data-ax="' + u + '|' + k + '" value="' + fmt(a.x) + '" inputmode="decimal" aria-label="Attachment ' + a.order + ' x"></td><td><input data-ay="' + u + '|' + k + '" value="' + fmt(a.y) + '" inputmode="decimal" aria-label="Attachment ' + a.order + ' y"></td><td class="num">' + (c.kingbolt != null ? fmt(Math.round((c.kingbolt + a.y) * 1000) / 1000) : '') + '</td><td>' + (carries.length ? '' : '<button class="btn small" data-arm="' + u + '|' + k + '" aria-label="Remove point ' + a.order + '" title="Remove this attachment point">×</button>') + '</td></tr>'; }).join('') + '</table>' : '<p class="hint warn">No attachment points yet, so no conductors can be drawn. Add them from the DCSH drawing' + (d && d.attachments ? ' (' + esc(d.drawing) + ': x ' + d.attachments.map(function (a) { return a.x; }).join(' / ') + (d.attachments.some(function (a) { return a.y == null; }) ? ', heights not dimensioned' : '') + ')' : '') + '. Needs engineering review.</p>';
      h += '<div class="btnrow">' + (carries.length ? '<span class="meta">Carries ' + esc(carries.join(', ')) + ', so points and the construction cannot be removed here.</span>' : '<button class="btn small" data-aadd="' + u + '">Add attachment point</button><button class="btn small danger" data-cdel="' + u + '">Remove construction</button>') + '</div></div>';
    });
    h += '<div class="con add" id="conAddBox">' + conAddHtml(id) + '</div>';
    return h;
  }
  // Add-construction form: searchable code, filters, preview of what will be copied and checks before adding.
  var conDraft = { pole: null, code: '', kb: '', kbUser: false };
  function conContext(id) {
    var row = project.poles.filter(function (r) { return r.ID === id; })[0], cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
    return { row: row, hag: row ? PNW.num(row.HeightAG) : null, cons: cons, lowest: cons.length ? cons[cons.length - 1].kingbolt : null };
  }
  function conChecks(id, d) {
    var x = conContext(id), out = { msgs: [], ok: false, def: null, lay: null, lc: null, dc: null };
    if (!d.code) { out.msgs.push({ level: 'info', text: 'Choose a construction code. Codes on the neighbouring poles are listed first.' }); return out; }
    out.lc = M.libraryConstruction(lib, d.code); out.lay = knownLayout(d.code); out.dc = M.dcshFor(dcshReg(), d.code)[0] || null;
    out.def = M.defaultKingbolt(lib, d.code, x.hag, x.lowest);
    if (!out.lc) out.msgs.push({ level: 'warning', text: esc(d.code) + ' is not in the PNW library tables, so there is no default height or voltage. Check the code.' });
    if (!out.lay) out.msgs.push({ level: 'warning', text: 'No attachment offsets are known for ' + esc(d.code) + ' (no dimensioned DCSH drawing and not in your projects). It will be added without attachment points and needs engineering review.' });
    var kb = PNW.num(d.kb);
    if (d.kb === '' || d.kb == null) out.msgs.push({ level: 'error', text: 'Type the king bolt height' + (out.def ? '' : ' (there is no library default for ' + esc(d.code) + ')') + '.' });
    else if (!(kb > 0) || kb > 60) out.msgs.push({ level: 'error', text: '"' + esc(d.kb) + '" is not a valid king bolt height in metres.' });
    else {
      if (x.hag != null && kb > x.hag) out.msgs.push({ level: 'error', text: 'The king bolt is above the pole tip (' + x.hag + ' m above ground).' });
      x.cons.forEach(function (c) { if (c.kingbolt != null && Math.abs(c.kingbolt - kb) < 0.1) out.msgs.push({ level: 'warning', text: 'Within 0.1 m of ' + esc(c.descr || c.code) + ' at ' + c.kingbolt + ' m.' }); });
    }
    var same = x.cons.filter(function (c) { return circuitClass(c.code) === circuitClass(d.code); });
    if (same.length) out.msgs.push({ level: 'info', text: esc(id) + ' already has ' + esc(same.map(function (c) { return c.descr || c.code; }).join(', ')) + ' on the ' + CLASS_LABEL[circuitClass(d.code)] + ' circuit.' });
    out.ok = !out.msgs.some(function (m) { return m.level === 'error'; });
    return out;
  }
  function conPreview(id) {
    var d = conDraft, ck = conChecks(id, d), h = '';
    if (d.code) {
      h += '<div class="preview"><dl><dt>Library</dt><dd>' + (ck.lc ? esc(ck.lc.description) + (ck.lc.voltageLL != null ? ' · ' + ck.lc.voltageLL + ' kV' : '') : '<span class="muted">not in the library</span>') + '</dd>' +
        '<dt>King bolt</dt><dd>' + (ck.def ? 'default ' + ck.def.value + ' m (' + esc(ck.def.source) + ')' : '<span class="muted">no library default</span>') + '</dd>' +
        '<dt>Attachments</dt><dd>' + (ck.lay ? esc(ck.lay.attachments.map(function (a) { return '(' + a.x + ', ' + a.y + ')'; }).join(' ')) + ' from ' + esc(ck.lay.source) : '<span class="muted">none known</span>') + '</dd>' +
        '<dt>DCSH</dt><dd>' + (ck.dc ? esc(ck.dc.drawing + ' rev ' + ck.dc.revision + ' · ' + (M.DCSH_STATUS[ck.dc.status] || ck.dc.status)) + dcshThumb(ck.dc.drawing) : '<span class="muted">not linked</span>') + '</dd></dl></div>';
    }
    h += '<ul class="msgs">' + ck.msgs.map(function (m) { return '<li class="' + m.level + '">' + m.text + '</li>'; }).join('') + '</ul>';
    return { html: h, ok: ck.ok };
  }
  function conAddHtml(id) {
    if (conDraft.pole !== id) conDraft = { pole: id, code: '', kb: '', kbUser: false };
    var pv = conPreview(id);
    return '<div class="con-title">Add a construction to ' + esc(id) + '</div>' + conFilterChips() +
      '<div class="row2"><div class="field"><label>Construction code</label>' + combo('conAdd', { value: conDraft.code, placeholder: 'Search code or description…', aria: 'Construction code to add', free: true, groups: function () { return constructionGroups(id, conFilter); }, onPick: function (v) {
        conDraft.code = v;
        if (!conDraft.kbUser) { var x = conContext(id), df = M.defaultKingbolt(lib, v, x.hag, x.lowest); conDraft.kb = df ? String(df.value) : ''; }
        refreshConAdd();
      } }) + '</div>' +
      '<div class="field"><label for="conAddKb">King bolt above ground (m)</label><input id="conAddKb" inputmode="decimal" value="' + esc(conDraft.kb) + '" placeholder="library default"></div></div>' +
      '<div id="conAddPrev">' + pv.html + '</div>' +
      '<div class="btnrow"><button class="btn small primary" id="conAdd" data-pole="' + esc(id) + '"' + (pv.ok ? '' : ' disabled') + '>Add to ' + esc(id) + '</button>' + '<button class="btn small" id="conKbDefault" title="Go back to the library default height"' + (conDraft.kbUser ? '' : ' hidden') + '>Use default height</button>' + '</div>' +
      '<p class="hint">The king bolt starts at the PNW library default (below the tip, or below the construction above). Offsets are copied from a dimensioned DCSH drawing or one of your projects; nothing is made up. Attach the construction to conductors in the Conductor schedule.</p>';
  }
  function refreshConAdd() { var box = $('conAddBox'); if (box && S.selected) box.innerHTML = conAddHtml(S.selected); }
  function refreshConPreview() { var id = S.selected, el = $('conAddPrev'); if (!el || !id) return; var pv = conPreview(id); el.innerHTML = pv.html; if ($('conAdd')) $('conAdd').disabled = !pv.ok; if ($('conKbDefault')) $('conKbDefault').hidden = !conDraft.kbUser; }
  $('selected').addEventListener('change', function (e) {
    var t = e.target, id = S.selected;
    if (t.id === 'poleAddType') { var pt = lib && lib.poles.filter(function (x) { return x.code === t.value; })[0]; if (pt) { $('poleAddLen').value = pt.length; $('poleAddSunk').value = pt.sinking != null ? pt.sinking : ''; } return; }
    if (t.dataset.ptype != null) {
      var ty = lib && lib.poles.filter(function (x) { return x.code === t.value; })[0], types = S.design.poleTypes = S.design.poleTypes || {}, before = types[id] || '';
      if (!ty) { delete types[id]; S.design.log = liveLog().concat([logEntry(id, '', 'Pole type', before, 'not set', 'manual')]); recompute(); return; }
      commit(function (p) {
        var r = p.poles.filter(function (x) { return x.ID === id; })[0], from = r.Length + ' m / ' + r.Sunk + ' m', res = M.updatePole(p, id, { length: ty.length, sunk: ty.sinking != null ? ty.sinking : defaultSunk(ty.length) });
        types[id] = ty.code;
        return [logEntry(id, '', 'Pole type', before || from, ty.code + ' (' + ty.length + ' m, sunk ' + PNW.num(r.Sunk) + ' m)', 'manual', 'PNW library ' + ty.code + (res.shift ? '; constructions moved ' + res.shift + ' m with the tip' : ''))];
      });
      return;
    }
    if (t.dataset.pfield != null) {
      var v = PNW.num(t.value), isLen = t.dataset.pfield === 'length', cur = project.poles.filter(function (x) { return x.ID === id; })[0];
      if (!(v >= 0) || v > 60 || (isLen && !(v > 0))) { setStatus('"' + t.value + '" is not a valid value in metres.', 'bad'); renderSelected(); return; }
      var oldL = PNW.num(cur.Length), oldS = PNW.num(cur.Sunk);
      if (isLen ? v <= oldS : v >= oldL) { setStatus('The setting depth has to be less than the pole length (' + (isLen ? v + ' m long, ' + oldS + ' m deep' : oldL + ' m long, ' + v + ' m deep') + ').', 'bad'); renderSelected(); return; }
      commit(function (p) {
        var r = p.poles.filter(function (x) { return x.ID === id; })[0], f = {}, field = isLen ? 'Length' : 'Sunk', from = r[field];
        f[t.dataset.pfield] = v;
        // A setting depth that followed the 10% + 0.6 m rule keeps following it when the length changes; a typed depth is kept.
        var follow = isLen && oldL > 0 && oldS != null && Math.abs(defaultSunk(oldL) - oldS) < 0.005;
        if (follow) f.sunk = defaultSunk(v);
        var res = M.updatePole(p, id, f);
        if (S.design.poleTypes) delete S.design.poleTypes[id];
        return [logEntry(id, '', isLen ? 'Pole length' : 'Setting depth', from, String(v), 'manual', (follow ? 'setting depth ' + oldS + ' -> ' + f.sunk + ' m (10% of length + 0.6 m); ' : '') + 'Height above ground ' + res.heightAG + ' m' + (res.shift ? '; constructions moved ' + res.shift + ' m with the tip' : ''))];
      });
      return;
    }
    if (t.dataset.ax != null || t.dataset.ay != null) {
      var key = (t.dataset.ax || t.dataset.ay).split('|'), axis = t.dataset.ax != null ? 'x' : 'y', nv = PNW.num(t.value);
      if (nv == null || !isFinite(nv) || Math.abs(nv) > 10) { setStatus('"' + t.value + '" is not a valid offset in metres.', 'bad'); renderSelected(); return; }
      editAttachments(id, key[0], function (list) { var a = list[+key[1]], from = a[axis]; a[axis] = nv; return ['Attachment ' + a.order + ' ' + axis, from, nv]; });
      return;
    }
    if (t.dataset.pnew != null) { commit(function (p) { M.updatePole(p, id, { isNew: t.checked }); return [logEntry(id, '', 'New pole', t.checked ? 'False' : 'True', t.checked ? 'True' : 'False', 'manual')]; }); return; }
    if (t.dataset.ckb != null) {
      var v = PNW.num(t.value);
      if (!(v > 0) || v > 60) { setStatus('"' + t.value + '" is not a valid king bolt height in metres.', 'bad'); renderSelected(); return; }
      commit(function (p) { var r = p.constructions.filter(function (x) { return x.unique === t.dataset.ckb; })[0], from = r.attht; M.updateConstruction(p, r.unique, { kingbolt: v }); return [logEntry(id, r.descr, 'King bolt height', from, String(v), 'manual')]; });
    }
  });
  $('selected').addEventListener('input', function (e) { if (e.target.id === 'conAddKb') { conDraft.kb = e.target.value.trim(); conDraft.kbUser = true; refreshConPreview(); } });
  // Attachment offsets typed by the designer: always logged as manual and left for engineering review.
  function editAttachments(id, unique, change) {
    commit(function (p) {
      var r = p.constructions.filter(function (x) { return x.unique === unique; })[0], list = M.constructionFrom(r).attachments, ch = change(list);
      M.updateConstruction(p, unique, { attachments: list });
      return [logEntry(id, r.descr, ch[0], String(ch[1]), String(ch[2]), 'manual')];
    });
  }
  // Changes a construction's code; offsets come from a DCSH drawing or your projects when one fits, else they are kept and flagged.
  function changeCode(id, unique, code, source, reference) {
    return commit(function (p) {
      var r = p.constructions.filter(function (x) { return x.unique === unique; })[0], from = r.descr, fromCode = r.code, lay = knownLayout(code), cur = M.constructionFrom(r).attachments, out = [];
      var f = { code: code }, lc = M.libraryConstruction(lib, code);
      if (lay && (lay.attachments.length === cur.length || !cur.length)) { f.attachments = lay.attachments; out.push(logEntry(id, code + ' (' + r.unique + ')', 'Attachment offsets', cur.map(function (a) { return a.x + ',' + a.y; }).join(' '), lay.attachments.map(function (a) { return a.x + ',' + a.y; }).join(' '), 'calculated', 'Copied from ' + lay.source)); }
      else out.push(logEntry(id, code + ' (' + r.unique + ')', 'Attachment offsets', 'kept', 'kept', source, 'No layout with ' + cur.length + ' points known for ' + code + '; offsets of ' + from + ' kept, needs engineering review'));
      if (lc && lc.voltageLL != null) f.voltage = lc.voltageLL;
      M.updateConstruction(p, r.unique, f);
      return [logEntry(id, from, 'Code', fromCode, code, source, [reference, lc ? 'PNW library ' + lc.code : ''].filter(Boolean).join('; '))].concat(out);
    });
  }
  $('selected').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var id = S.selected;
    if (b.id === 'designStart') { startDesign(); return; }
    if (b.dataset.aadd != null) { editAttachments(id, b.dataset.aadd, function (list) { var n = list.reduce(function (m, a) { return Math.max(m, a.order); }, 0) + 1; list.push({ x: 0, y: 0, order: n }); return ['Attachment ' + n, '', 'added at 0, 0']; }); return; }
    if (b.dataset.arm != null) { var ak = b.dataset.arm.split('|'); editAttachments(id, ak[0], function (list) { var a = list.splice(+ak[1], 1)[0]; return ['Attachment ' + a.order, a.x + ', ' + a.y, 'removed']; }); return; }
    if (b.dataset.gotab) { openTab(b.dataset.gotab); return; }
    if (b.dataset.chip) { var cp = b.dataset.chip.split(':'); conFilter[cp[0]] = cp[1]; refreshConAdd(); return; }
    if (b.id === 'conKbDefault') { var cx = conContext(id), df = M.defaultKingbolt(lib, conDraft.code, cx.hag, cx.lowest); conDraft.kb = df ? String(df.value) : ''; conDraft.kbUser = false; refreshConAdd(); return; }
    if (b.dataset.secshow) { select(id, { segment: b.dataset.secshow }); return; }
    if (b.dataset.pdel != null) { commit(function (p) { M.removePole(p, b.dataset.pdel); return [logEntry(b.dataset.pdel, '', 'Pole', b.dataset.pdel, 'removed', 'manual')]; }); return; }
    if (b.id === 'poleAdd') {
      var nid = $('poleAddId').value.trim(), dist = PNW.num($('poleAddDist').value), L = PNW.num($('poleAddLen').value), sk = $('poleAddSunk').value.trim() === '' ? defaultSunk(L) : PNW.num($('poleAddSunk').value), ty = $('poleAddType').value;
      if (!(dist != null) || !isFinite(dist)) { setStatus('Type the distance from ' + b.dataset.from + ' in metres.', 'bad'); return; }
      var ok = commit(function (p) {
        var from = p.poles.filter(function (x) { return x.ID === b.dataset.from; })[0], r = M.addPole(p, { id: nid, chainage: PNW.num(from.Distance) + dist, length: L, sunk: sk, isNew: true });
        if (ty) (S.design.poleTypes = S.design.poleTypes || {})[nid] = ty;
        return [logEntry(nid, '', 'Pole', '', 'added at chainage ' + r.Distance + ' m, ' + L + ' m long, sunk ' + sk + ' m', 'manual', (ty ? 'PNW library ' + ty + '; ' : '') + 'ground level from the profile')];
      });
      if (ok) { select(nid); setStatus('Added pole ' + nid + '.', 'good'); }
      return;
    }
    if (b.dataset.cdef != null) commit(function (p) { var r = p.constructions.filter(function (x) { return x.unique === b.dataset.cdef; })[0], from = r.attht; M.updateConstruction(p, r.unique, { kingbolt: Number(b.dataset.v) }); return [logEntry(id, r.descr, 'King bolt height', from, b.dataset.v, 'calculated', b.dataset.ref)]; });
    if (b.dataset.cdel != null) commit(function (p) { var r = p.constructions.filter(function (x) { return x.unique === b.dataset.cdel; })[0]; M.removeConstruction(p, r.unique); return [logEntry(id, r.descr, 'Construction', r.descr, 'removed', 'manual')]; });
    if (b.id === 'conAdd') {
      var code = conDraft.code, kb = PNW.num(conDraft.kb), ck = conChecks(id, conDraft);
      if (!ck.ok) { setStatus(ck.msgs.filter(function (m) { return m.level === 'error'; }).map(function (m) { return m.text; }).join(' ') || 'Choose a construction code to add.', 'bad'); refreshConPreview(); return; }
      var lay = knownLayout(code), lc = M.libraryConstruction(lib, code), defKb = ck.def && Math.abs(ck.def.value - kb) < 0.0005;
      conDraft = { pole: id, code: '', kb: '', kbUser: false };
      commit(function (p) {
        var row = M.addConstruction(p, b.dataset.pole, { code: code, kingbolt: kb, voltage: lc && lc.voltageLL != null ? lc.voltageLL : 0, attachments: lay ? lay.attachments : [], isNew: true });
        return [logEntry(id, row.descr, 'Construction', '', 'added at ' + kb + ' m', 'manual', (lay ? 'Offsets from ' + lay.source : 'No attachment offsets known') + (lc ? '; PNW library ' + lc.code : '') + (defKb ? '; king bolt from ' + ck.def.source : '; king bolt typed'))];
      });
    }
  });

  /* pole photo: AI identifies hardware and ranks PNW codes; nothing changes until the designer approves */
  var AI_URL = 'https://hszkloepnewfkzdegfhl.supabase.co/functions/v1/pnw-pole-photo-ai', AI_KEY = 'sb_publishable_Avjn-CGtbEdeLaxSWCwQDw_36mgImSu', aiResults = {};
  // DCSH drawing thumbnail (private copy only: window.PNW_DCSH_IMG); hover or focus enlarges it next to the pole photo.
  function dcshThumb(drawing, photo) {
    var im = drawing && window.PNW_DCSH_IMG && window.PNW_DCSH_IMG[drawing];
    if (!im) return '';
    return '<button type="button" class="dcsh-thumb" data-dcshimg="' + esc(drawing) + '"' + (photo ? ' data-photo="1"' : '') + ' title="DCSH ' + esc(drawing) + ' · ' + esc(im.title) + ' (hover to enlarge, click to pin)"><img src="' + esc(im.src) + '" alt="DCSH drawing ' + esc(drawing) + '" loading="lazy"><span>' + esc(drawing) + '</span></button>';
  }
  // Conductors a construction carries: its attachment points (DCSH, register or layout), else the register's phase count.
  // Enlarged drawing: shown while hovering a thumbnail, pinned by a click; the pole photo sits beside it to compare.
  var dcshPin = false;
  function dcshShow(btn, pin) {
    var key = btn.dataset.dcshimg, im = window.PNW_DCSH_IMG[key], pop = $('dcshPop'), r = aiResults[S.selected], photo = btn.dataset.photo && r && r.view;
    pop.innerHTML = '<div class="dp-h"><b>DCSH ' + esc(key) + '</b> <span>' + esc(im.title + ' · ' + im.part + ', page ' + im.page) + '</span>' + (pin ? '<button class="btn small" id="dcshClose" title="Close (Esc)">✕</button>' : '<small class="muted">click the thumbnail to pin</small>') + '</div>' +
      '<div class="dp-b' + (photo ? ' two' : '') + '">' + (photo ? '<figure><img src="' + photo + '" alt="Pole photo"><figcaption>Your photo of ' + esc(S.selected) + '</figcaption></figure>' : '') + '<figure><img src="' + esc(im.src) + '" alt="DCSH drawing ' + esc(key) + '"><figcaption>DCSH ' + esc(key) + '</figcaption></figure></div>';
    pop.hidden = false; pop.classList.toggle('pinned', !!pin); dcshPin = !!pin;
  }
  function dcshHide(force) { if (dcshPin && !force) return; $('dcshPop').hidden = true; dcshPin = false; }
  document.addEventListener('mouseover', function (e) { var b = e.target.closest && e.target.closest('[data-dcshimg]'); if (b && !dcshPin) dcshShow(b, false); });
  document.addEventListener('mouseout', function (e) { var b = e.target.closest && e.target.closest('[data-dcshimg]'); if (b && !b.contains(e.relatedTarget)) dcshHide(false); });
  document.addEventListener('focusin', function (e) { var b = e.target.closest && e.target.closest('[data-dcshimg]'); if (b && !dcshPin) dcshShow(b, false); });
  document.addEventListener('focusout', function (e) { if (e.target.closest && e.target.closest('[data-dcshimg]')) dcshHide(false); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dcshimg]');
    if (b) { e.preventDefault(); dcshShow(b, true); return; }
    if (e.target.closest && e.target.closest('#dcshClose')) dcshHide(true);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('dcshPop').hidden) { dcshHide(true); e.stopPropagation(); } }, true);
  function conductorsOf(code) { var lay = knownLayout(code); if (lay && lay.attachments.length) return lay.attachments.length; var c = aiCandidates().filter(function (x) { return x.code === code; })[0]; return c && c.phases ? +c.phases || null : null; }
  // The AI is asked for one construction per circuit, but it can still list a code once per conductor it sees.
  // Group by circuit (HV / LV / earth from the code), keep each code once with its best confidence, three options per circuit.
  function aiGroups(resp) {
    var groups = {}, order = ['hv', 'lv', 'earth', 'comms', 'other'];
    resp.matches.forEach(function (m) {
      var k = circuitClass(m.code), g = groups[k] || (groups[k] = { cls: k, items: {}, seen: null });
      var o = g.items[m.code];
      if (!o || m.confidence > o.confidence) g.items[m.code] = { code: m.code, level: m.level, rank: m.rank, confidence: m.confidence, reasons: m.reasons, dup: o ? (o.dup || 1) + 1 : 1 };
      else o.dup = (o.dup || 1) + 1;
    });
    resp.components.forEach(function (c) { // conductors counted on each circuit, if the AI reported them
      if (!/conductor|wire|phase|neutral/i.test(c.name) || !c.count) return;
      var k = /hv|high/i.test(c.level) ? 'hv' : /earth/i.test(c.level) ? 'earth' : /lv|low/i.test(c.level) ? 'lv' : null;
      if (k && groups[k]) groups[k].seen = (groups[k].seen || 0) + c.count;
    });
    return order.filter(function (k) { return groups[k]; }).map(function (k) {
      var g = groups[k]; g.items = Object.keys(g.items).map(function (c) { return g.items[c]; }).sort(function (a, b) { return b.confidence - a.confidence || a.rank - b.rank; }).slice(0, 3);
      return g;
    });
  }
  function aiPanel(id, cons) {
    var r = aiResults[id] || {}, h = '<div class="con ai"><div class="con-title">✨ Analyse pole photo with AI</div><p class="hint">Upload a photo of ' + esc(id) + '. AI identifies the crossarms, insulators and conductors on each circuit and suggests one construction per circuit (one HV1 carries all three HV phases, one LV1 all four LV conductors), with its DCSH drawing to compare.</p>';
    h += '<label class="btn small"><input type="file" id="aiPhoto" accept="image/jpeg,image/png,image/webp" hidden>' + (r.photo ? 'Another photo…' : 'Choose a photo…') + '</label>';
    if (r.thumb) h += '<img class="ai-thumb" src="' + r.thumb + '" alt="Photo of ' + esc(id) + '">';
    if (r.loading) h += '<p class="status">Looking at ' + esc(r.photo) + '…</p>';
    if (r.error) h += '<p class="hint warn">' + esc(r.error) + '</p>';
    if (r.resp) {
      var x = r.resp;
      if (x.photo_quality) h += '<p class="meta">Photo: ' + esc(x.photo_quality) + '</p>';
      if (x.components.length) h += '<p class="meta"><b>Seen:</b> ' + x.components.map(function (c) { return esc(c.name) + (c.count ? ' ×' + c.count : '') + ' (' + esc(c.level) + ', ' + Math.round(c.confidence * 100) + '%)'; }).join(' · ') + '</p>';
      r.groups = aiGroups(x);
      r.groups.forEach(function (g, gi) {
        var onPole = cons.filter(function (c) { return circuitClass(c.code) === g.cls; }), done = r.approved && r.approved[g.cls];
        h += '<div class="ai-g"><div class="ai-gh"><b>' + CLASS_LABEL[g.cls] + ' circuit</b>' + (g.seen ? ' <span class="pill mute">' + g.seen + ' conductor' + (g.seen === 1 ? '' : 's') + ' seen</span>' : '') +
          (onPole.length ? ' <small class="muted">on the pole now: ' + esc(onPole.map(function (c) { return c.descr || c.code; }).join(', ')) + '</small>' : '') + '</div>';
        if (done) h += '<p class="hint ok">' + esc(done) + ' approved for this circuit.</p>';
        g.items.forEach(function (m, i) {
          var lc = M.libraryConstruction(lib, m.code), d = M.dcshFor(dcshReg(), m.code)[0], n = conductorsOf(m.code);
          var fit = g.seen && n ? (n === g.seen ? '<span class="pill ok" title="One ' + esc(m.code) + ' carries all ' + n + ' conductors seen">carries ' + n + '</span>' : '<span class="pill warn" title="' + esc(m.code) + ' carries ' + n + ' conductors; the AI counted ' + g.seen + '">carries ' + n + ', ' + g.seen + ' seen</span>') : n ? '<span class="pill mute">carries ' + n + '</span>' : '';
          var same = onPole.filter(function (c) { return String(c.code).toUpperCase() === m.code.toUpperCase(); })[0];
          var opts = onPole.map(function (c, k) { return '<option value="' + esc(c.unique) + '"' + (k === 0 ? ' selected' : '') + '>Replace ' + esc(c.descr || '(blank)') + '</option>'; }).join('') + '<option value="new"' + (onPole.length ? '' : ' selected') + '>Add as a new construction</option>';
          h += '<div class="ai-m">' + (d ? dcshThumb(d.drawing, !!r.view) : '') + '<div class="ai-mb"><div><b>' + esc(m.code) + '</b> <span class="pill ' + (m.confidence >= 0.7 ? 'ok' : m.confidence >= 0.5 ? 'warn' : 'bad') + '">' + Math.round(m.confidence * 100) + '%</span> ' + fit + (i === 0 ? ' <span class="pill info">best</span>' : '') + '</div>' +
            '<small>' + (lc ? esc(lc.description) : '<span class="muted">not in the PNW library</span>') + (d ? ' · DCSH ' + esc(d.drawing + ' ' + d.title) : ' · no DCSH drawing linked') + '</small>' +
            (m.dup > 1 ? '<small class="muted">The AI listed it ' + m.dup + ' times (once per conductor); one construction covers the circuit.</small>' : '') +
            (m.reasons.length ? '<small class="muted">' + esc(m.reasons.join(' ')) + '</small>' : '') +
            (same ? '<small class="ok">' + esc(same.descr || same.code) + ' is already on this pole; nothing to add.</small>' :
              done ? '' : '<div class="btnrow"><select data-aitarget="' + gi + '-' + i + '">' + opts + '</select><button class="btn small primary" data-aiok="' + gi + '-' + i + '">Approve</button></div>') + '</div></div>';
        });
        h += '</div>';
      });
      if (!x.matches.length) h += '<p class="hint">No code from your PNW library fits what the AI could see.</p>';
      if (x.cautions.length) h += '<p class="hint warn">' + esc(x.cautions.join(' ')) + '</p>';
    }
    return h + '<p class="hint">The photo is resized in your browser and sent once to ' + (IN_CLAUDE ? 'Claude on your account' : 'EVE\'s AI service (Google Gemini, through Supabase)') + '. It is not stored. Suggestions change nothing until you approve one, and each approval goes into the change log as an AI suggestion.</p></div>';
  }
  function aiCandidates() {
    var list = {}; (lib ? lib.constructions : []).forEach(function (c) { list[c.code] = { code: c.code, description: c.description }; });
    registerRows().forEach(function (r) { if (!r.code) return; var c = list[r.code] || (list[r.code] = { code: r.code, description: '' }); c.phases = r.phases || null; if (r.dcsh) c.dcsh = r.dcsh.drawing + ' ' + r.dcsh.title; });
    return Object.keys(list).map(function (k) { return list[k]; });
  }
  function shrink(file) {
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      var t = document.createElement('canvas'), tk = 160 / Math.max(c.width, c.height); t.width = Math.round(c.width * tk); t.height = Math.round(c.height * tk); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      return { data: c.toDataURL('image/jpeg', 0.85).split(',')[1], thumb: t.toDataURL('image/jpeg', 0.7), view: c.toDataURL('image/jpeg', 0.75) };
    });
  }
  var sampleP = IN_CLAUDE && window.claude && window.claude.use ? window.claude.use('sample') : null;
  function aiPrompt(id, existing) {
    return 'You help an Australian power distribution designer. Look at the attached photo of pole ' + id + '. Identify the overhead line hardware you can see and rank which of these Poles n Wires construction codes describe each circuit level (HV, LV, running earth).\n' +
      'A construction code covers a whole circuit, not one conductor: one HV1 carries all three HV phases and one LV1 carries all four LV conductors (R W B N). Return at most 3 alternative codes per circuit level, ranked, and never repeat a code for each conductor. In components, count the conductors on each level (name "conductors", level HV, LV or earth).\n' +
      'Rules: only use codes from the list; if nothing fits a level, return no match for it. Describe only visible hardware (crossarms, insulator type: pin, post, disc/strain, reel; conductors per level; terminations; angle or straight; stays; pole top plant). Confidence 0 to 1, below 0.5 when the photo does not show the hardware clearly. Do not estimate dimensions, heights or pole strength.\n' +
      'Constructions currently on the pole in the PNW project: ' + (existing.join(', ') || 'none') + '.\n' +
      'Candidate codes (code | description | DCSH | phases):\n' + aiCandidates().map(function (c) { return c.code + ' | ' + (c.description || '') + ' | ' + (c.dcsh || '') + ' | ' + (c.phases || ''); }).join('\n') +
      '\nReturn JSON only: {"photo_quality":string,"components":[{"name":string,"level":string,"count":number|null,"confidence":number}],"matches":[{"level":string,"code":string,"rank":number,"confidence":number,"reasons":[string]}],"cautions":[string]}';
  }
  function runAiClaude(id, file) {
    var r = aiResults[id] = { photo: file.name, loading: true }; renderSelected();
    var existing = ((dm && dm.byPole[id]) || []).map(function (c) { return c.descr; });
    Promise.all([sampleP || Promise.resolve(null), shrink(file)]).then(function (x) {
      var sample = x[0], img = x[1]; r.thumb = img.thumb; r.view = img.view; renderSelected();
      if (!sample) throw new Error('Asking Claude is not available in this view of the page.');
      var bytes = atob(img.data), arr = new Uint8Array(bytes.length); for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      return sample.json(aiPrompt(id, existing), { images: [new Blob([arr], { type: 'image/jpeg' })], modelTier: 'default' });
    }).then(function (j) {
      var valid = {}; aiCandidates().forEach(function (c) { valid[String(c.code).toUpperCase()] = c.code; });
      var conf = function (v) { return Math.max(0, Math.min(1, Number(v) || 0)); }, all = Array.isArray(j.matches) ? j.matches : [];
      var matches = all.filter(function (m) { return valid[String(m.code || '').toUpperCase()]; }).map(function (m) { return { level: String(m.level || ''), code: valid[String(m.code).toUpperCase()], rank: Number(m.rank) || 99, confidence: conf(m.confidence), reasons: (m.reasons || []).map(String).slice(0, 5) }; });
      r.resp = { model: 'Claude', photo_quality: String(j.photo_quality || ''), components: (j.components || []).map(function (c) { return { name: String(c.name || ''), level: String(c.level || ''), count: Number(c.count) || null, confidence: conf(c.confidence) }; }),
        matches: matches, cautions: (j.cautions || []).map(String).concat(all.length > matches.length ? [(all.length - matches.length) + ' suggestion(s) used codes that are not in your PNW library and were removed.'] : []) };
    }).catch(function (e) { r.error = e && e.code === 'not_granted' ? 'Claude was not allowed to look at the photo. Allow it when asked to use this.' : e && e.code === 'rate_limited' ? 'Too many requests at once. Wait a moment and try again.' : (e && e.message) || String(e); })
      .then(function () { r.loading = false; if (S.selected === id) renderSelected(); });
  }
  function runAi(id, file) {
    if (IN_CLAUDE) return runAiClaude(id, file);
    var r = aiResults[id] = { photo: file.name, loading: true }; renderSelected();
    shrink(file).then(function (img) {
      r.thumb = img.thumb; r.view = img.view; renderSelected();
      var existing = ((dm && dm.byPole[id]) || []).map(function (c) { return c.descr; });
      return fetch(AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: AI_KEY, Authorization: 'Bearer ' + AI_KEY }, body: JSON.stringify({ mime: 'image/jpeg', image: img.data, pole: id, existing: existing, candidates: aiCandidates() }) });
    }).then(function (res) {
      if (res.status === 404) throw new Error('The AI photo service is not switched on yet (the pnw-pole-photo-ai function is not deployed).');
      return res.json().then(function (j) { if (!res.ok || !j.ok) throw new Error(j.error || 'AI request failed (' + res.status + ').'); return j; });
    }).then(function (j) { r.resp = j; }).catch(function (e) { r.error = /Failed to fetch|NetworkError/i.test(e.message) ? 'Could not reach the AI service. Check the connection; the service only answers on evedesignandengineering.com.' : e.message; })
      .then(function () { r.loading = false; if (S.selected === id) renderSelected(); });
  }
  $('selected').addEventListener('change', function (e) { if (e.target.id === 'aiPhoto' && e.target.files[0]) runAi(S.selected, e.target.files[0]); });
  $('selected').addEventListener('click', function (e) {
    var b = e.target.closest('[data-aiok]'); if (!b) return;
    var id = S.selected, r = aiResults[id], gi = b.dataset.aiok.split('-'), g = r.groups[+gi[0]], m = g.items[+gi[1]];
    var target = document.querySelector('[data-aitarget="' + b.dataset.aiok + '"]').value, ref = 'Photo ' + r.photo + ', ' + m.level + ' rank ' + m.rank + ', ' + Math.round(m.confidence * 100) + '% (' + r.resp.model + ')';
    var mark = function () { (r.approved || (r.approved = {}))[g.cls] = m.code; };
    if ((((dm && dm.byPole[id]) || []).some(function (c) { return String(c.code).toUpperCase() === m.code.toUpperCase(); }))) { setStatus(m.code + ' is already on ' + id + '; one construction carries the whole circuit.', 'bad'); return; }
    if (target !== 'new') { mark(); changeCode(id, target, m.code, 'AI suggestion', ref); return; }
    var cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, c) { return (c.kingbolt || 0) - (a.kingbolt || 0); }), row = project.poles.filter(function (x) { return x.ID === id; })[0];
    var d = M.defaultKingbolt(lib, m.code, PNW.num(row.HeightAG), cons.length ? cons[cons.length - 1].kingbolt : null);
    if (!d) { setStatus('No library default height for ' + m.code + '. Add it with the form below and type the king bolt height.', 'bad'); return; }
    var lay = knownLayout(m.code), lc = M.libraryConstruction(lib, m.code);
    mark();
    commit(function (p) {
      var nr = M.addConstruction(p, id, { code: m.code, kingbolt: d.value, voltage: lc && lc.voltageLL != null ? lc.voltageLL : 0, attachments: lay ? lay.attachments : [], isNew: true });
      return [logEntry(id, nr.descr, 'Construction', '', 'added at ' + d.value + ' m', 'AI suggestion', ref + '; king bolt from ' + d.source + (lay ? '; offsets from ' + lay.source : '; no attachment offsets known'))];
    });
  });

  /* views: plan, 3D, profile, 3D + profile (shared selection) */
  function setView(v, quiet) {
    S.view = v || 'plan';
    var wrap = $('mapWrap'); wrap.className = wrap.className.replace(/\bv-\w+/g, '').trim() + ' v-' + S.view;
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) { b.classList.toggle('on', b.dataset.view === S.view); b.setAttribute('aria-pressed', b.dataset.view === S.view); });
    if (S.view === 'plan') setTimeout(function () { map.invalidateSize(); }, 30);
    if (!quiet) save();
    renderViews();
  }
  function renderViews() {
    var v = S.view;
    if (v === '3d' || v === 'split') { if (!mounted3d) mount3d(); else update3d(); }
    if (v === 'profile' || v === 'split') renderProfileView();
    var notes = [];
    if (dm) Object.keys(dm.sagNotes || {}).forEach(function (k) { notes.push(dm.sagNotes[k]); });
    $('sagMode').value = S.sagMode || 'none'; $('sagTemp').value = String(S.sagTemp || 15); $('sagTemp').hidden = S.sagMode !== 'dcsh';
    $('sagNote').textContent = S.sagMode === 'dcsh' ? (stringing().length ? notes.join(' · ') : 'Import the DCSH Part 10 text to use stringing tables.') : S.sagMode === 'illustrative' ? 'Illustrative sag w·L²/8T at the stringing tension; not PNW\'s sag.' : 'Conductors drawn as straight chords (no sag).';
  }
  function mount3d() {
    if (!window.PNW3D) {
      $('v3host').innerHTML = '<p class="v3msg">Loading the 3D viewer…</p>';
      window.addEventListener('pnw3d-ready', function () { $('v3host').innerHTML = ''; mount3d(); }, { once: true });
      setTimeout(function () { if (!window.PNW3D) $('v3host').innerHTML = '<p class="v3msg">The 3D viewer could not load (three.js from cdn.jsdelivr.net). Check the internet connection and reload.</p>'; }, 10000);
      return;
    }
    window.PNW3D.mount($('v3host'), function (id, info) { select(id, id ? info : { segment: '' }); });
    mounted3d = true; update3d(); window.PNW3D.select(S.selected); window.PNW3D.selectSection(S.selSection);
    if ($('stage').clientWidth < 820) $('v3legend').open = false;
    var fade = function () { $('v3help').classList.add('fade'); }; setTimeout(fade, 12000); $('v3host').addEventListener('pointerdown', fade, { once: true });
  }
  function data3d() {
    if (dm && dm.poles.length) return { poles: dm.poles, axes: dm.axes, constructions: dm.constructions, points: dm.points, wires: dm.wires, showLabels: S.labels, keepView: true };
    var rows = built ? built.rows.filter(function (r) { return isFinite(r.easting) && isFinite(r.northing) && isFinite(r.elevation); }) : [];
    var poles = rows.map(function (r) { var t = poleTypeFor(r.id, r.length); return { id: r.id, easting: r.easting, northing: r.northing, ground: r.elevation, height: r.height, sunk: r.sunk, diamTip: t ? t.diamTip : null, diamGL: t ? t.diamGL : null }; });
    return { poles: poles, axes: M.crossarmAxes(poles), constructions: [], points: [], wires: [], showLabels: S.labels, keepView: true };
  }
  function update3d() {
    if (!mounted3d) return;
    var d = data3d(); window.PNW3D.update(d);
    $('v3empty').hidden = d.poles.length > 0;
  }
  var WCOL = { hv: '#c2410c', lv: '#2f6ea4', earth: '#64748b', other: '#0f766e' };
  function wireKind(w) { return /^RE/i.test(w.code || '') ? 'earth' : w.voltage == null ? 'other' : w.voltage > 1 ? 'hv' : 'lv'; }
  function renderProfileView() {
    var box = $('profileView'), cs = getComputedStyle(box), W = Math.max(box.clientWidth - 16, 300), H = Math.max(box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 30, 140), m = { l: 52, r: 20, t: 14, b: 30 };
    var poles, ground, clr = [];
    if (dm && dm.allPoles.length) {
      poles = dm.allPoles.filter(function (p) { return p.chainage != null && p.ground != null; });
      ground = project.ground.map(function (g) { return { c: PNW.num(g.Chainage), z: PNW.num(g.Level), c1: PNW.num(g.Clearance1) }; }).filter(function (g) { return isFinite(g.c) && isFinite(g.z); });
      clr = ground.filter(function (g) { return g.c1 > 0; });
    } else if (built) {
      poles = built.rows.filter(function (r) { return r.chainage != null && isFinite(r.elevation); }).map(function (r) { return { id: r.id, chainage: r.chainage, ground: r.elevation, height: r.height, sunk: r.sunk }; });
      ground = poles.map(function (p) { return { c: p.chainage, z: p.ground }; });
    } else poles = [];
    if (poles.length < 2) { box.innerHTML = '<p class="v3msg">Build a profile with at least two surveyed poles, or drop a PNW project, to see the profile.</p>'; return; }
    var chainOf = {}; poles.forEach(function (p) { chainOf[p.id] = p.chainage; });
    var x1 = Math.max.apply(null, poles.map(function (p) { return p.chainage; }).concat(ground.map(function (g) { return g.c; }))) || 1;
    var lo = Math.min.apply(null, poles.map(function (p) { return p.ground - (p.sunk || 0); })), hi = Math.max.apply(null, poles.map(function (p) { return p.ground + (p.height || 0); }).concat(clr.map(function (g) { return g.z + g.c1; })));
    var y0 = Math.floor(lo - 0.5), y1 = Math.ceil(hi + 1);
    var X = function (v) { return m.l + v / x1 * (W - m.l - m.r); }, Y = function (v) { return H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
    var g = '', step = niceStep(y1 - y0, 5), xs = niceStep(x1, 8);
    for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#e6ebf0"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end" class="ax">' + +v.toFixed(2) + '</text>';
    for (var c = 0; c <= x1 + 1e-9; c += xs) g += '<text x="' + X(c) + '" y="' + (H - m.b + 14) + '" text-anchor="middle" class="ax">' + +c.toFixed(1) + '</text>';
    g += '<path d="' + ground.map(function (q, i) { return (i ? 'L' : 'M') + X(q.c).toFixed(1) + ' ' + Y(q.z).toFixed(1); }).join(' ') + '" fill="none" stroke="#2f6ea4" stroke-width="2"/>';
    if (clr.length > 1) g += '<path d="' + clr.map(function (q, i) { return (i ? 'L' : 'M') + X(q.c).toFixed(1) + ' ' + Y(q.z + q.c1).toFixed(1); }).join(' ') + '" fill="none" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="6 4"/>';
    poles.forEach(function (p) {
      var sel = p.id === S.selected, x = X(p.chainage);
      if (p.sunk) g += '<line x1="' + x + '" x2="' + x + '" y1="' + Y(p.ground) + '" y2="' + Y(p.ground - p.sunk) + '" stroke="#5b4636" stroke-width="3" stroke-dasharray="3 3" opacity=".6"/>';
      if (p.height) g += '<line x1="' + x + '" x2="' + x + '" y1="' + Y(p.ground) + '" y2="' + Y(p.ground + p.height) + '" stroke="' + (sel ? '#f59e0b' : '#8b6b4a') + '" stroke-width="' + (sel ? 5 : 3) + '"/>';
      g += '<text x="' + x + '" y="' + (Y(p.ground + (p.height || 0)) - 6) + '" text-anchor="middle" class="pl' + (sel ? ' sel' : '') + '">' + esc(p.id) + '</text>';
    });
    if (dm) {
      dm.wires.forEach(function (w) {
        var a = chainOf[w.from.pole], b = chainOf[w.to.pole]; if (a == null || b == null) return;
        var pts = []; for (var k = 0; k <= 20; k++) { var t = k / 20, z = w.from.elevation + (w.to.elevation - w.from.elevation) * t - (w.sag ? 4 * w.sag * t * (1 - t) : 0); pts.push(X(a + (b - a) * t).toFixed(1) + ' ' + Y(z).toFixed(1)); }
        g += '<path d="M' + pts.join(' L') + '" fill="none" stroke="' + WCOL[wireKind(w)] + '" stroke-width="1.4"><title>' + esc(w.segment + ' ' + w.conductor + ' phase ' + w.phase + ' · ' + w.from.pole + ' → ' + w.to.pole + ' · span ' + w.span.toFixed(2) + ' m · sag ' + (w.sag != null ? w.sag.toFixed(2) + ' m (' + w.sagSource + ')' : 'not shown')) + '</title></path>';
      });
      dm.points.forEach(function (q) { var c0 = chainOf[q.pole]; if (c0 == null) return; g += '<circle cx="' + X(c0) + '" cy="' + Y(q.elevation) + '" r="2.6" fill="#fff" stroke="#172638" stroke-width="1.2"><title>' + esc(q.pole + ' ' + q.construction + ' #' + q.order + ': ' + q.heightAG + ' m above ground (king bolt ' + q.provenance.kingbolt + ' + y ' + q.provenance.y + ')') + '</title></circle>'; });
    }
    poles.forEach(function (p) { g += '<rect class="hit" data-pick="' + esc(p.id) + '" x="' + (X(p.chainage) - 12) + '" y="' + m.t + '" width="24" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; });
    var leg = '<div class="chart-legend pv-legend"><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#2f6ea4" stroke-width="2"/></svg>Ground</span>' + (clr.length > 1 ? '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="6 4"/></svg>Clearance 1 line from the project (reference only)</span>' : '') +
      '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#5b4636" stroke-width="3" stroke-dasharray="3 3" opacity=".6"/></svg>Embedment</span>' + (dm ? '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.hv + '" stroke-width="2"/></svg>HV</span><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.lv + '" stroke-width="2"/></svg>LV</span><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.earth + '" stroke-width="2"/></svg>Running earth</span>' : '') + '<span class="muted">Chainage (m) vs elevation (m), vertical scale exaggerated</span></div>';
    box.innerHTML = leg + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Line profile">' + g + '</svg>';
  }
  $('profileView').addEventListener('click', function (e) { var t = e.target.closest('[data-pick]'); if (t) select(t.dataset.pick); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) { b.onclick = function () { setView(b.dataset.view); }; });
  function cam(fn) { if (!window.PNW3D || !mounted3d) { setStatus('Open the 3D view first.'); return false; } return fn(window.PNW3D); }
  $('v3fit').onclick = function () { cam(function (v) { v.fit(); }); };
  $('v3reset').onclick = function () { cam(function (v) { v.reset(); }); };
  $('v3focus').onclick = function () { if (!S.selected) { setStatus('Select a pole first, then Focus selected frames it.'); return; } cam(function (v) { if (!v.focus(S.selected)) setStatus(S.selected + ' is not drawn in 3D (no coordinates or ground level).', 'bad'); }); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-cam]'), function (b) { b.onclick = function () { cam(function (v) { v.view(b.dataset.cam); }); }; });
  $('sagMode').onchange = function () { S.sagMode = this.value; buildDesignModel(); save(); renderViews(); };
  $('sagTemp').onchange = function () { S.sagTemp = Number(this.value); buildDesignModel(); save(); renderViews(); };
  [5, 10, 15, 20, 25, 30, 35, 40, 45].forEach(function (t) { $('sagTemp').insertAdjacentHTML('beforeend', '<option value="' + t + '">' + t + ' °C final</option>'); });
  if (window.ResizeObserver) new ResizeObserver(function () { if (S.view === 'profile' || S.view === 'split') renderProfileView(); }).observe($('profileView'));
  $('useProj').onclick = function () { useProject(false); };

  /* project file: save and reopen everything (imported data, profiles, design and change log) */
  function saveProjectFile() {
    var blob = new Blob([JSON.stringify({ app: 'eve-poles-wires', version: 2, saved: new Date().toISOString(), state: S })], { type: 'application/json' });
    download(blob, (prof().name || 'Poles and Wires project').replace(/[\\/:*?"<>|]+/g, '-') + '.pwproj.json'); setStatus('Saved the project file. Open it here later to carry on.', 'good');
  }
  function openProjectFile(file) {
    file.text().then(function (t) {
      var j = JSON.parse(t, function (k, v) { return k === 'date' && typeof v === 'string' ? new Date(v) : v; });
      if (!j || j.app !== 'eve-poles-wires' || !j.state || !Array.isArray(j.state.files)) throw new Error('not a Poles & Wires project file');
      S = Object.assign(blank(), j.state); S.settings = Object.assign({}, DEFAULT_SETTINGS, j.state.settings); S.design = Object.assign(blankDesign(), j.state.design);
      buffers = {}; undoStack = []; redoStack = []; lastSnap = null; aiResults = {}; syncInputs(); recompute(); fit(); setView(S.view, true);
      setStatus('Opened ' + file.name + '. ' + summaryText(), 'good');
    }).catch(function (e) { setStatus(file.name + ' could not be opened: ' + e.message, 'bad'); });
  }
  $('tbSave').onclick = saveProjectFile;
  $('tbOpen').onclick = function () { $('projInput').click(); };
  $('projInput').onchange = function () { if (this.files[0]) openProjectFile(this.files[0]); this.value = ''; };
  $('tbUndo').onclick = function () { restore(undoStack, redoStack); setStatus('Undone.'); };
  $('tbRedo').onclick = function () { restore(redoStack, undoStack); setStatus('Redone.'); };
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); $('tbUndo').click(); }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); $('tbRedo').click(); }
  });

  /* ---------- toolbar and wiring ---------- */
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); drop.classList.add('over'); } }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (ev === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }); });
  document.addEventListener('drop', function (e) { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); $('secFiles').open = true; addFiles(e.dataTransfer.files); });
  $('pickBtn').onclick = $('tbUpload').onclick = function () { replaceIdx = null; $('fileInput').click(); };
  $('fileInput').onchange = function () {
    var fl = this.files;
    if (replaceIdx != null && fl.length === 1 && S.files[replaceIdx]) {
      var old = S.files[replaceIdx].name; S.files.splice(replaceIdx, 1); delete buffers[old]; setStatus('Replacing ' + old + '…');
    }
    replaceIdx = null; addFiles(fl); this.value = '';
  };
  // Fit project works in whichever view is open: the map extent, or the 3D camera on the whole line.
  $('tbFit').onclick = function () { if ((S.view === '3d' || S.view === 'split') && window.PNW3D && mounted3d) window.PNW3D.fit(); else if (S.view === 'plan') fit(); else renderProfileView(); };
  $('tbLayers').onclick = function (e) {
    var pop = $('layersPop'), open = pop.hidden; pop.hidden = !open; this.setAttribute('aria-expanded', open);
    if (open) { var r = this.getBoundingClientRect(), t = this.closest('.toolbar').getBoundingClientRect(); pop.style.left = Math.max(0, Math.min(r.left - t.left, t.width - 320)) + 'px'; pop.style.top = (r.bottom - t.top + 6) + 'px'; if (S.view !== 'plan') setStatus('Layers apply to the plan view.'); }
    e.stopPropagation();
  };
  document.addEventListener('click', function (e) { var pop = $('layersPop'); if (!pop.hidden && !pop.contains(e.target)) { pop.hidden = true; $('tbLayers').setAttribute('aria-expanded', 'false'); } });
  $('tbLabels').onclick = function () { S.labels = !S.labels; this.classList.toggle('on', S.labels); this.setAttribute('aria-pressed', S.labels); renderMap(); renderViews(); save(); };
  // AI photo match: open the inspector on the selected pole (else the first design pole) at the AI photo tab.
  $('tbAi').onclick = function () {
    var id = S.selected && merged.poles[S.selected] ? S.selected : project && project.poles.length ? project.poles[0].ID : prof().poleIds[0];
    U.insTab = 'photo'; if (!U.right) { U.right = true; applyLayout(); } saveUi();
    if (id) select(id); else renderSelected();
    if (!project) setStatus('AI photo match needs a design: link a PNW project or start a design from the ground profile.', 'bad');
  };
  $('tbIssues').onclick = function () { openTab('issues'); if (!U.left) { U.left = true; applyLayout(); } $('secValidation').open = true; };
  $('tbGenerate').onclick = generate;
  $('tbExport').onclick = function () { recompute(); openReview(); };
  $('tbSide').onclick = function () { U.left = !U.left; applyLayout(); };
  $('tbInspector').onclick = function () { U.right = !U.right; applyLayout(); };
  $('tbDock').onclick = function () { U.dock = !(U.dock && !U.dockMin); U.dockMin = false; applyLayout(); };
  $('dockMin').onclick = function () { U.dockMin = !U.dockMin; applyLayout(); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.onclick = function () { if (b.dataset.close === 'left') U.left = false; else U.right = false; applyLayout(); }; });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (!$('layersPop').hidden) { $('layersPop').hidden = true; return; }
    if (!$('review').hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (S.selected || S.selSection) select(null);
  });
  // Asks again on the button itself: browser confirm() dialogs are blocked when the page runs inside Claude.
  var resetArmed = null;
  $('tbReset').onclick = function () {
    var lbl = $('tbReset').querySelector('.lbl');
    if (!S.files.length && !prof().poleIds.length && !S.design.xml) { setStatus('Nothing to clear: this is already a new project.'); return; }
    if (!resetArmed) {
      lbl.textContent = 'Click again to clear'; $('tbReset').classList.add('danger');
      setStatus('Click "New project" again within 5 seconds to remove the imported files, profiles and design from this browser. Save first if you want to keep them.', 'bad');
      resetArmed = setTimeout(function () { resetArmed = null; lbl.textContent = 'New project'; $('tbReset').classList.remove('danger'); }, 5000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null; lbl.textContent = 'New project'; $('tbReset').classList.remove('danger');
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    S = blank(); buffers = {}; flags = {}; aiResults = {}; secForm = { tension: '', units: '%CBL' }; conDraft = { pole: null, code: '', kb: '', kbUser: false }; S.selSection = null; undoStack = []; redoStack = []; lastSnap = null;
    syncInputs(); recompute(); setView('plan', true); setStatus('New project. Saved data removed from this browser.', 'good');
  };
  [['lySurvey', lySurvey], ['lyGis', lyGis], ['lyAlign', lyAlign], ['lySpanLbl', lySpan], ['lyExtent', lyExtent]].forEach(function (x) {
    $(x[0]).onchange = function () { if (this.checked) x[1].addTo(map); else map.removeLayer(x[1]); };
  });
  for (var z = 49; z <= 56; z++) $('zone').insertAdjacentHTML('beforeend', '<option value="' + z + '">Zone ' + z + (z === 50 ? ' (Perth)' : '') + '</option>');
  $('zone').onchange = function () { S.zone = +this.value; recompute(); fit(); };
  [['createdBy', 'createdBy'], ['optionSet', 'optionSet'], ['clr1', 'clr1'], ['clr2', 'clr2']].forEach(function (x) { $(x[0]).onchange = function () { S.settings[x[1]] = this.value.trim(); save(); }; });

  /* ---------- start ---------- */
  load();
  setView(S.view, true);
  syncInputs(); applyLayout(); setTab(U.tab || 'poles');
  recompute();
  if (S.files.length) { fit(); setStatus('Restored your saved project. ' + summaryText()); }
  setTimeout(function () { map.invalidateSize(); }, 200);
})();
