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

  function setStatus(t, cls) { var n = $('status'); n.textContent = t; n.className = 'status' + (cls ? ' ' + cls : ''); }

  /* ---------- map ---------- */
  var map = L.map('map', { zoomControl: true, maxZoom: 21 }).setView([-31.95, 115.86], 11);
  var bases = {
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 21, maxNativeZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' })
  };
  var activeBase = bases.street.addTo(map);
  $('basemap').onchange = function () { map.removeLayer(activeBase); activeBase = bases[this.value].addTo(map); };
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
  try { worker = new Worker('worker.js'); worker.onmessage = function (e) { var w = waiting[e.data.id]; delete waiting[e.data.id]; if (w) e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.result); }; worker.onerror = function () { worker = null; }; } catch (e) { worker = null; }
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

  /* ---------- selection ---------- */
  function select(id) {
    S.selected = id; flags.inspected = true;
    renderSelected(); highlight(); renderProfile(); renderSteps();
    Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tr[data-id]'), function (tr) { tr.classList.toggle('sel', tr.dataset.id === id); });
    if (id) $('secSelected').open = true;
    if (window.PNW3D && mounted3d) window.PNW3D.select(id);
    if (S.view === 'profile' || S.view === 'split') renderProfileView();
  }
  function tagS(t) { return '<span class="tag src">' + t + '</span>'; }
  function renderSelected() {
    var id = S.selected, p = id && merged.poles[id];
    if (!p) { $('selected').innerHTML = '<p class="status">Click a pole on the map or in the table.</p>'; return; }
    var r = built && built.rows.filter(function (x) { return x.id === id; })[0], inProf = prof().poleIds.indexOf(id) >= 0, ex = PNW.existingLength(p);
    var h = '<div class="btnrow" style="margin:0 0 8px">' + (inProf ? '<button class="btn small" id="selRemove">Remove from profile</button>' : (p.survey ? '<button class="btn small primary" id="selAdd">Add to profile</button>' : '')) + '<button class="btn small" id="selZoom">Zoom to</button></div><table class="props">';
    function row(k, v, tag) { if (v == null || v === '') return ''; h += '<tr><th>' + k + '</th><td>' + esc(v) + (tag || '') + '</td></tr>'; return ''; }
    function sec(t) { h += '<tr class="sec"><th colspan="2">' + t + '</th></tr>'; }
    sec(esc(id));
    if (p.survey) { var sk = p.survey.kind || 'LiDAR'; row('Easting', fmt(p.survey.easting), tagS(sk)); row('Northing', fmt(p.survey.northing), tagS(sk)); row('Elevation', fmt(p.survey.elevation), tagS(sk)); row('LiDAR height', p.survey.lidarHeight != null ? p.survey.lidarHeight + ' m' : ''); row('Lean', p.survey.leanDeg != null ? p.survey.leanDeg + '°' : ''); row('Bays', p.survey.bays); row('Bay angles', p.survey.bayAngles.join(', ')); row('Equipment no', p.survey.equipNo); row('Surveyed', p.survey.surveyed); row('Source', p.survey.src.file + ' row ' + p.survey.src.row); }
    else row('Survey', 'No LiDAR survey row');
    if (r) {
      sec('Ground profile');
      row('Chainage', fmt(r.chainage, 2) + ' m', '<span class="tag der">derived</span>');
      if (r.span != null) row('Span from previous', fmt(r.span, 2) + ' m', '<span class="tag der">derived</span>');
      row('Pole length', r.length != null ? r.length + ' m' : 'unknown', r.lengthSource === 'Edited' ? '<span class="tag edit">edited</span>' : r.lengthSource ? tagS(r.lengthSource) : '');
      row('Setting depth', r.sunk != null ? r.sunk + ' m' : '', '<span class="tag der">derived</span>');
      row('Height above ground', r.height != null ? r.height + ' m' : '', '<span class="tag der">derived</span>');
    } else if (ex.value != null) { sec('Pole'); row('Existing length', ex.value + ' m', tagS(ex.source)); }
    if (p.gis) { sec('GIS'); row('Description', p.gis.description); row('Length', p.gis.length != null ? p.gis.length + ' m' : ''); row('Stock', p.gis.stock); row('Species', p.gis.species); row('HV feeder', p.gis.feeder); row('Equip no', p.gis.equipNo); var ll = poleLatLng(p); if (ll && p.gis.lat != null) row('Offset from LiDAR', map.distance(ll, L.latLng(p.gis.lat, p.gis.lng)).toFixed(1) + ' m'); }
    if (p.insp) { sec('Inspections (latest)'); row('Records', p.insp.count); ['Pole Length', 'Pole Length (M)', 'Strength (kN)', 'Bay 1 Length (m)', 'Bay 2 Length (m)', 'Bay 3 Length (m)', 'Bay 1 HV Conductor Type', 'Bay 1 LV Conductor Type', 'Height Neutral Phase (m)', 'Height Running Earth (m)', 'Stay 1 Type'].forEach(function (k) { var a = p.insp.attrs[k]; if (a) row(k, a.value + (a.date ? ' (' + new Date(a.date).toLocaleDateString('en-AU') + ')' : '')); }); }
    if (p.defects.length) { sec('Defects (' + p.defects.length + ')'); p.defects.slice(0, 8).forEach(function (d) { row(d.severity || 'Defect', d.description + ' · ' + d.status); }); }
    var iss = allIssues.filter(function (i) { return i.poleId === id; });
    h += '</table>' + designPanel(id) + '<table class="props">';
    if (iss.length) { sec('Issues'); iss.forEach(function (i) { h += '<tr><td colspan="2" style="color:' + (i.level === 'error' ? 'var(--bad)' : i.level === 'warning' ? 'var(--warn)' : 'inherit') + '">' + esc(i.message) + '</td></tr>'; }); }
    $('selected').innerHTML = h + '</table>';
    if ($('selAdd')) $('selAdd').onclick = function () { var ids = prof().poleIds; ids.push(id); prof().poleIds = PNW.autoOrder(merged.poles, ids); S.generated = false; recompute(); setStatus(id + ' added and the profile re-ordered along the line. Use ↑ ↓ to adjust.', 'good'); };
    if ($('selRemove')) $('selRemove').onclick = function () { prof().poleIds = prof().poleIds.filter(function (x) { return x !== id; }); S.generated = false; recompute(); };
    $('selZoom').onclick = function () { zoomTo(id); };
  }

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
    var tr = e.target.closest('tr[data-id]'); if (tr && tr.dataset.id && tab !== 'register') { select(tr.dataset.id); zoomTo(tr.dataset.id); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  function setTab(t) { tab = t; Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.classList.toggle('on', b.dataset.tab === t); }); $('filter').hidden = t !== 'poles'; renderTable(); }
  $('search').oninput = renderTable; $('filter').onchange = renderTable;

  function renderValidation() {
    var c = function (l) { return allIssues.filter(function (i) { return i.level === l; }).length; };
    var e = c('error'), w = c('warning'), inf = c('info'), ids = Object.keys(merged.poles);
    var matched = ids.filter(function (id) { return merged.poles[id].survey; }).length;
    $('valCount').textContent = e ? e + ' errors' : w ? w + ' warnings' : ids.length ? 'OK' : '';
    $('validation').innerHTML = '<div class="tiles"><div class="tile ' + (e ? 'bad' : '') + '"><small>Errors</small><b>' + e + '</b></div><div class="tile ' + (w ? 'warn' : '') + '"><small>Warnings</small><b>' + w + '</b></div></div>' +
      '<p class="hint">' + matched + ' of ' + ids.length + ' poles have a LiDAR survey row. ' + inf + ' informational note' + (inf === 1 ? '' : 's') + '.</p><div class="btnrow"><button class="btn small" id="openIssues">Show all issues</button></div>';
    $('openIssues').onclick = function () { setTab('issues'); $('tableWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
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
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); flags.exported = true; renderSteps(); }
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
    var cond = project && project.conductors.filter(function (c) { return String(c.Code).toUpperCase() === String(seg.Conductor).toUpperCase(); })[0];
    var name = cond ? (String(cond.Name2 || '').split(/[\s-]/)[0] || '').toUpperCase() : '', pct = seg.TensionUnits === '%CBL' ? Number(seg.Tension) : NaN;
    return tables.filter(function (t) { return !t.legacy && name.length > 2 && t.title.toUpperCase().indexOf(name) >= 0 && new RegExp('\\b' + pct + '\\s*%').test(t.title.replace(/(\d) (\d)/, '$1$2')); });
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
        '<td>' + (d ? esc(d.part.split(' ').slice(0, 2).join(' ') + ' · ' + d.drawing + ' rev ' + d.revision + (d.page ? ' · p' + d.page : '')) + '<br><small>' + esc(d.title) + '</small>' : '<span class="muted">not linked</span>') + '</td>' +
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
  var secForm = { tension: 7, units: '%CBL' };
  function conductorOptions(cur) {
    var list = {}; (lib ? lib.conductors : []).forEach(function (c) { list[c.code] = c.name + (c.name2 ? ' · ' + c.name2 : ''); });
    (project ? project.conductors : []).forEach(function (c) { if (!(c.Code in list)) list[c.Code] = (c.Name1 || '') + ' (this project)'; });
    if (cur && !(cur in list)) list[cur] = '';
    return '<option value="">Choose a conductor…</option>' + Object.keys(list).sort().map(function (k) { return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(k) + (list[k] ? ' · ' + esc(list[k]) : '') + '</option>'; }).join('');
  }
  // A library conductor, or one already in the project (Table4) turned into the same shape.
  function conductorFor(code) {
    var c = lib && lib.conductors.filter(function (x) { return x.code === code; })[0];
    if (c) return c;
    var r = project && project.conductors.filter(function (x) { return x.Code === code; })[0];
    return r ? { code: r.Code, name: r.Name1 } : null;
  }
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
  function renderSections() {
    if (!project) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">Link a PNW project, or start a design from the ground profile (select a pole), to string conductors.</p>'; return; }
    var tables = stringing(), h = '<table class="grid"><thead><tr><th>Section</th><th>Conductor</th><th>Tension</th><th>Units</th><th>Wires</th><th>Poles and constructions</th><th>Ruling span</th><th>DCSH sag table</th><th></th></tr></thead><tbody>';
    project.segments.forEach(function (sg) {
      var n = sg.StrainSect, mem = project.segPoles.filter(function (x) { return x.strsection === n; }), sp = [];
      for (var i = 1; i < mem.length; i++) { var A = project.poles.filter(function (r) { return r.ID === mem[i - 1].id; })[0], B = project.poles.filter(function (r) { return r.ID === mem[i].id; })[0]; if (A && B) sp.push(Math.hypot(PNW.num(B.Easting) - PNW.num(A.Easting), PNW.num(B.Northing) - PNW.num(A.Northing))); }
      var pick = (S.design.tables || {})[n] || '', sug = suggestTable(sg)[0];
      h += '<tr><td><b>' + esc(n) + '</b>' + (sg.New === 'True' ? ' <span class="pill info">New</span>' : '') + '</td>' +
        '<td><select data-seccond="' + esc(n) + '" style="max-width:220px">' + conductorOptions(sg.Conductor) + '</select></td>' +
        '<td><input data-secten="' + esc(n) + '" value="' + esc(sg.Tension) + '" inputmode="decimal" style="width:70px"></td>' +
        '<td><select data-secunits="' + esc(n) + '"><option' + (sg.TensionUnits === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (sg.TensionUnits === 'kN' ? ' selected' : '') + '>kN</option></select></td>' +
        '<td class="num">' + esc(sg.numconds) + '</td><td style="white-space:normal">' + mem.map(function (x) { return esc(x.id) + ' <small>' + esc(x.constr) + '</small>'; }).join(' → ') + '</td>' +
        '<td class="num">' + (sp.length ? M.rulingSpan(sp).toFixed(1) + ' m' : '') + '</td>' +
        '<td><select data-secsag="' + esc(n) + '" style="max-width:240px"><option value="">' + (sug ? 'Matched: ' + esc(sug.title) : 'None matched') + '</option>' + tables.filter(function (t) { return !t.legacy; }).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === pick ? ' selected' : '') + '>' + esc(t.title) + ' (p' + t.page + ')</option>'; }).join('') + '</select></td>' +
        '<td><button class="btn small" data-secdel="' + esc(n) + '">Remove</button></td></tr>';
    });
    if (!project.segments.length) h += '<tr><td colspan="9" class="muted">No strain sections yet.</td></tr>';
    h += '</tbody></table>';
    var f = secForm, ids = project.poles.map(function (r) { return r.ID; });
    if (ids.indexOf(f.from) < 0) f.from = ids[0]; if (ids.indexOf(f.to) < 0) f.to = ids[ids.length - 1];
    var levels = []; project.constructions.forEach(function (c) { var l = levelOf(c.code); if (l && levels.indexOf(l) < 0 && (c.pole === f.from || c.pole === f.to)) levels.push(l); });
    if (levels.indexOf(f.level) < 0) f.level = levels[0] || '';
    var mem = sectionMembers(f), missing = mem.filter(function (m) { return !m.c; });
    var poleSel = function (key, cur) { return '<select data-secf="' + key + '">' + ids.map(function (i) { return '<option' + (i === cur ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') + '</select>'; };
    h += '<div class="con add" style="margin:10px 8px"><div class="con-title">String conductors (new strain section)</div><div class="secform">' +
      '<div class="field"><label>From pole</label>' + poleSel('from', f.from) + '</div><div class="field"><label>To pole</label>' + poleSel('to', f.to) + '</div>' +
      '<div class="field"><label>Circuit (construction codes)</label><select data-secf="level">' + (levels.length ? levels.map(function (l) { return '<option' + (l === f.level ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') : '<option value="">Add constructions first</option>') + '</select></div>' +
      '<div class="field"><label>Conductor</label><select data-secf="cond">' + conductorOptions(f.cond) + '</select></div>' +
      '<div class="field"><label>Tension</label><input data-secf="tension" value="' + esc(f.tension) + '" inputmode="decimal"></div>' +
      '<div class="field"><label>Units</label><select data-secf="units"><option' + (f.units === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (f.units === 'kN' ? ' selected' : '') + '>kN</option></select></div></div>';
    h += mem.length ? '<p class="meta">' + mem.map(function (m) { return '<b>' + esc(m.id) + '</b> ' + (m.options.length > 1 ? '<select data-secpick="' + esc(m.id) + '">' + m.options.map(function (c) { return '<option value="' + esc(c.unique) + '"' + (c === m.c ? ' selected' : '') + '>' + esc(c.descr) + '</option>'; }).join('') + '</select>' : m.c ? esc(m.c.descr) : '<span class="pill bad">no ' + esc(f.level || '') + ' construction</span>'); }).join(' → ') + '</p>' : '<p class="hint">Choose two different poles.</p>';
    h += '<div class="btnrow"><button class="btn small primary" id="secAdd"' + (missing.length || mem.length < 2 ? ' disabled' : '') + '>Add strain section</button></div>' +
      '<p class="hint">Each pole in between is included in line order. Conductors attach to the chosen construction\'s attachment points; the number of wires is the smallest number of attachment points along the section. The conductor is copied from the PNW library into the project. Load conditions are copied from an existing section, or Hot 75 °C, standard 15 °C, Uplift 0 °C and Warm 40 °C. PNW works out the sags and tiploads when you open the file.</p></div>';
    $('tableWrap').innerHTML = h;
  }
  $('tableWrap').addEventListener('change', function (e) {
    var t = e.target, d = t.dataset;
    if (d.secf) { secForm[d.secf] = t.value; if (d.secf === 'from' || d.secf === 'to' || d.secf === 'level') secForm.pick = {}; renderSections(); return; }
    if (d.secpick) { (secForm.pick = secForm.pick || {})[d.secpick] = t.value; renderSections(); return; }
    if (d.secsag != null) { var tb = S.design.tables = S.design.tables || {}, before = tb[d.secsag] || 'matched'; if (t.value) tb[d.secsag] = t.value; else delete tb[d.secsag]; S.design.log = liveLog().concat([logEntry('', d.secsag, 'DCSH sag table', before, t.value || 'matched', 'manual')]); recompute(); return; }
    if (d.seccond != null) {
      var c = conductorFor(t.value); if (!c) return;
      commit(function (p) { var sg = p.segments.filter(function (x) { return x.StrainSect === d.seccond; })[0], from = sg.Conductor; M.updateSection(p, d.seccond, { conductor: c }); return [logEntry('', d.seccond, 'Conductor', from, c.code, 'manual', lib && lib.conductors.indexOf(c) >= 0 ? 'PNW library ' + c.code : '')]; });
      return;
    }
    if (d.secten != null || d.secunits != null) {
      var n = d.secten || d.secunits;
      commit(function (p) { var sg = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = sg.Tension + ' ' + sg.TensionUnits; M.updateSection(p, n, d.secten != null ? { tension: PNW.num(t.value) } : { units: t.value }); return [logEntry('', n, 'Tension', from, sg.Tension + ' ' + sg.TensionUnits, 'manual')]; });
    }
  });
  $('tableWrap').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || tab !== 'sections') return;
    if (b.dataset.secdel != null) { var n = b.dataset.secdel; commit(function (p) { M.removeSection(p, n); return [logEntry('', n, 'Strain section', n, 'removed', 'manual')]; }); return; }
    if (b.id === 'secAdd') {
      var f = secForm, c = conductorFor(f.cond), mem = sectionMembers(f);
      if (!c) { setStatus('Choose the conductor for the new strain section.', 'bad'); return; }
      commit(function (p) {
        var name = M.addSection(p, { conductor: c, tension: PNW.num(f.tension), units: f.units, poles: mem.map(function (m) { return { id: m.id, unique: m.c.unique }; }) });
        setStatus('Added strain section ' + name + '.', 'good');
        return [logEntry(mem[0].id + '→' + mem[mem.length - 1].id, name, 'Strain section', '', c.code + ' at ' + f.tension + ' ' + f.units + ' on ' + mem.map(function (m) { return m.id + ' ' + m.c.descr; }).join(', '), 'manual', lib && lib.conductors.indexOf(c) >= 0 ? 'PNW library ' + c.code : '')];
      });
    }
  });
  function renderLog() {
    var l = liveLog();
    if (!l.length) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">No design changes yet. Changes you make to constructions and register approvals are recorded here.</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Time</th><th>Pole</th><th>Construction</th><th>Field</th><th>Original</th><th>Proposed</th><th>Approved value</th><th>Source</th><th>Reference</th><th>By</th></tr></thead><tbody>' +
      l.slice().reverse().map(function (x) { return '<tr data-id="' + esc(x.pole) + '"><td>' + esc(new Date(x.t).toLocaleString('en-AU')) + '</td><td>' + esc(x.pole) + '</td><td>' + esc(x.construction) + '</td><td>' + esc(x.field) + '</td><td>' + esc(x.from) + '</td><td>' + esc(x.proposed) + '</td><td><b>' + esc(x.to) + '</b></td><td><span class="tag ' + (x.source === 'manual' ? 'edit' : x.source === 'AI suggestion' ? 'ai' : 'der') + '">' + esc(x.source) + '</span></td><td style="white-space:normal">' + esc(x.reference) + '</td><td>' + esc(x.by) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* selected pole: constructions from the linked project, editable */
  function codeOptions(cur) {
    var codes = {}; (lib ? lib.constructions : []).forEach(function (c) { codes[c.code] = c.description; });
    registerRows().forEach(function (r) { if (r.code && !(r.code in codes)) codes[r.code] = ''; });
    if (cur && !(cur in codes)) codes[cur] = '';
    return Object.keys(codes).sort().map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + (codes[c] ? ' · ' + esc(codes[c]) : '') + '</option>'; }).join('');
  }
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
  function sectionsOnPole(id) {
    var names = []; project.segPoles.forEach(function (s) { if (s.id === id && names.indexOf(s.strsection) < 0) names.push(s.strsection); });
    var h = '<div class="con"><div class="con-h"><b>Conductors</b></div>';
    h += names.length ? names.map(function (n) { var sg = project.segments.filter(function (x) { return x.StrainSect === n; })[0] || {}, at = project.segPoles.filter(function (x) { return x.strsection === n && x.id === id; })[0]; return '<p class="meta"><b>' + esc(n) + '</b> · ' + esc(sg.Conductor) + ' at ' + esc(sg.Tension) + ' ' + esc(sg.TensionUnits) + ' · ' + esc(sg.numconds) + ' wires on ' + esc(at ? at.constr : '') + '</p>'; }).join('') : '<p class="hint">No conductors attached to this pole.</p>';
    return h + '<div class="btnrow"><button class="btn small" data-gotab="sections">Strain sections…</button></div></div>';
  }
  function designPanel(id) {
    if (!project) return '<div class="con-wrap"><p class="hint">Drop a saved PNW project (.pnwx) to edit its design, or start a new design from this ground profile.</p>' + (built && built.rows.length > 1 ? '<div class="btnrow"><button class="btn small primary" id="designStart">Start a design from this ground profile</button></div>' : '') + '</div>';
    var row = project.poles.filter(function (r) { return r.ID === id; })[0];
    if (!row) return '<p class="hint">' + esc(id) + ' is not in the linked PNW project ' + esc(linked.name) + '.</p>';
    var hag = PNW.num(row.HeightAG), cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
    var pt = (dm && dm.allPoles.filter(function (p) { return p.id === id; })[0]) || {};
    var h = '<div class="con-wrap"><div class="con-title">Design <span class="pill info">' + esc(linked.name) + '</span></div>' + poleBlock(id, row, pt) + '<div class="con-title" style="margin-top:10px">Constructions</div>';
    cons.forEach(function (c, i) {
      var r = regFor(c), st = statusOf(r), lc = M.libraryConstruction(lib, c.code), above = i > 0 ? cons[i - 1].kingbolt : null, def = M.defaultKingbolt(lib, c.code, hag, above);
      var carries = project.segPoles.filter(function (s) { return s.id === id && s.constr === c.descr; }).map(function (s) { return s.strsection; });
      var src = lastSource(id, c.descr, 'King bolt height'), d = M.dcshFor(dcshReg(), c.code)[0], cmp = d ? M.compareDcsh(d, c, i === 0 ? hag : null) : null;
      h += '<div class="con" data-u="' + esc(c.unique) + '"><div class="con-h"><b>' + esc(c.descr || '(blank construction)') + '</b>' + (lc ? '<small>' + esc(lc.description) + '</small>' : '') + '<span class="pill ' + st.cls + '">' + esc(st.text) + '</span></div>' +
        '<div class="row2"><div class="field"><label>Code</label><select data-ccode="' + esc(c.unique) + '">' + codeOptions(c.code) + '</select></div>' +
        '<div class="field"><label>King bolt above ground (m) <span class="tag ' + (src === 'manual' ? 'edit' : src === 'imported' ? 'src' : 'der') + '">' + esc(src) + '</span></label><input data-ckb="' + esc(c.unique) + '" value="' + fmt(c.kingbolt) + '" inputmode="decimal"></div></div>';
      if (def && c.kingbolt != null && Math.abs(def.value - c.kingbolt) > 0.0005) h += '<p class="hint">' + esc(def.source) + ': <b>' + def.value + ' m</b> (' + def.below + ' m). <button class="btn small" data-cdef="' + esc(c.unique) + '" data-v="' + def.value + '" data-ref="' + esc(def.source) + '">Use default</button></p>';
      if (cmp && cmp.notes.length) h += '<p class="hint warn">' + esc(cmp.notes.join(' ')) + '</p>';
      var u = esc(c.unique);
      h += c.attachments.length ? '<table class="att"><tr><th>#</th><th>x</th><th>y</th><th>Height AG</th><th></th></tr>' + c.attachments.map(function (a, k) { return '<tr><td>' + a.order + '</td><td><input data-ax="' + u + '|' + k + '" value="' + fmt(a.x) + '" inputmode="decimal"></td><td><input data-ay="' + u + '|' + k + '" value="' + fmt(a.y) + '" inputmode="decimal"></td><td>' + (c.kingbolt != null ? fmt(Math.round((c.kingbolt + a.y) * 1000) / 1000) : '') + '</td><td>' + (carries.length ? '' : '<button class="btn small" data-arm="' + u + '|' + k + '" aria-label="Remove point ' + a.order + '">×</button>') + '</td></tr>'; }).join('') + '</table>' : '<p class="hint warn">No attachment points yet, so no conductors can be drawn. Add them from the DCSH drawing' + (d && d.attachments ? ' (' + esc(d.drawing) + ': x ' + d.attachments.map(function (a) { return a.x; }).join(' / ') + (d.attachments.some(function (a) { return a.y == null; }) ? ', heights not dimensioned' : '') + ')' : '') + '. Needs engineering review.</p>';
      if (!carries.length) h += '<div class="btnrow"><button class="btn small" data-aadd="' + u + '">Add attachment point</button></div>';
      h += '<div class="btnrow">' + (carries.length ? '<span class="meta">Carries ' + esc(carries.join(', ')) + '</span>' : '<button class="btn small" data-cdel="' + esc(c.unique) + '">Remove</button>') + '</div></div>';
    });
    h += sectionsOnPole(id);
    h += aiPanel(id, cons);
    var lowest = cons.length ? cons[cons.length - 1].kingbolt : null;
    h += '<div class="con add"><div class="row2"><div class="field"><label>Add construction</label><select id="conAddCode"><option value="">Choose a code…</option>' + codeOptions('') + '</select></div><div class="field"><label>King bolt (m)</label><input id="conAddKb" inputmode="decimal" placeholder="library default"></div></div>' +
      '<div class="btnrow"><button class="btn small primary" id="conAdd" data-pole="' + esc(id) + '" data-lowest="' + (lowest == null ? '' : lowest) + '" data-hag="' + hag + '">Add to ' + esc(id) + '</button></div><p class="hint">The king bolt starts at the PNW library default. Attachment offsets are copied from a DCSH drawing or one of your projects when one exists for the code; otherwise the construction is added without attachment points and flagged for engineering review. Attach it to conductors in the Strain sections tab.</p></div></div>';
    return h;
  }
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
      var v = PNW.num(t.value);
      if (!(v >= 0) || v > 60) { setStatus('"' + t.value + '" is not a valid value in metres.', 'bad'); renderSelected(); return; }
      commit(function (p) {
        var r = p.poles.filter(function (x) { return x.ID === id; })[0], f = {}, field = t.dataset.pfield === 'length' ? 'Length' : 'Sunk', from = r[field];
        f[t.dataset.pfield] = v; var res = M.updatePole(p, id, f);
        if (S.design.poleTypes) delete S.design.poleTypes[id];
        return [logEntry(id, '', field === 'Length' ? 'Pole length' : 'Setting depth', from, String(v), 'manual', 'Height above ground ' + res.heightAG + ' m' + (res.shift ? '; constructions moved ' + res.shift + ' m with the tip' : ''))];
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
    if (t.id === 'conAddCode') { var lo = PNW.num($('conAdd').dataset.lowest), d = M.defaultKingbolt(lib, t.value, PNW.num($('conAdd').dataset.hag), lo); $('conAddKb').value = d ? d.value : ''; $('conAddKb').title = d ? d.source : 'No library default: type the king bolt height'; return; }
    if (t.dataset.ckb != null) {
      var v = PNW.num(t.value);
      if (!(v > 0) || v > 60) { setStatus('"' + t.value + '" is not a valid king bolt height in metres.', 'bad'); renderSelected(); return; }
      commit(function (p) { var r = p.constructions.filter(function (x) { return x.unique === t.dataset.ckb; })[0], from = r.attht; M.updateConstruction(p, r.unique, { kingbolt: v }); return [logEntry(id, r.descr, 'King bolt height', from, String(v), 'manual')]; });
    }
    if (t.dataset.ccode != null) changeCode(id, t.dataset.ccode, t.value, 'manual', '');
  });
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
    if (b.dataset.gotab) { setTab(b.dataset.gotab); return; }
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
      var code = $('conAddCode').value, kb = PNW.num($('conAddKb').value);
      if (!code) { setStatus('Choose a construction code to add.', 'bad'); return; }
      if (!(kb > 0)) { setStatus('Type the king bolt height for ' + code + ' (there is no library default).', 'bad'); return; }
      var lay = knownLayout(code), lc = M.libraryConstruction(lib, code);
      commit(function (p) {
        var row = M.addConstruction(p, b.dataset.pole, { code: code, kingbolt: kb, voltage: lc && lc.voltageLL != null ? lc.voltageLL : 0, attachments: lay ? lay.attachments : [], isNew: true });
        return [logEntry(id, row.descr, 'Construction', '', 'added at ' + kb + ' m', 'manual', (lay ? 'Offsets from ' + lay.source : 'No attachment offsets known') + (lc ? '; PNW library ' + lc.code : ''))];
      });
    }
  });

  /* pole photo: AI identifies hardware and ranks PNW codes; nothing changes until the designer approves */
  var AI_URL = 'https://hszkloepnewfkzdegfhl.supabase.co/functions/v1/pnw-pole-photo-ai', AI_KEY = 'sb_publishable_Avjn-CGtbEdeLaxSWCwQDw_36mgImSu', aiResults = {};
  function aiPanel(id, cons) {
    var r = aiResults[id] || {}, h = '<div class="con ai"><div class="con-title">Pole photo · AI suggestion</div>';
    h += '<label class="btn small"><input type="file" id="aiPhoto" accept="image/jpeg,image/png,image/webp" hidden>' + (r.photo ? 'Another photo…' : 'Choose a photo…') + '</label>';
    if (r.thumb) h += '<img class="ai-thumb" src="' + r.thumb + '" alt="Photo of ' + esc(id) + '">';
    if (r.loading) h += '<p class="status">Looking at ' + esc(r.photo) + '…</p>';
    if (r.error) h += '<p class="hint warn">' + esc(r.error) + '</p>';
    if (r.resp) {
      var x = r.resp;
      if (x.photo_quality) h += '<p class="meta">Photo: ' + esc(x.photo_quality) + '</p>';
      if (x.components.length) h += '<p class="meta"><b>Seen:</b> ' + x.components.map(function (c) { return esc(c.name) + (c.count ? ' ×' + c.count : '') + ' (' + esc(c.level) + ', ' + Math.round(c.confidence * 100) + '%)'; }).join(' · ') + '</p>';
      // default target: the construction on the same circuit level (HV / LV / RE prefix), else add new
      var optsFor = function (m) {
        var pre = (String(m.code).match(/^[A-Z]{2}/i) || [''])[0].toUpperCase(), hit = cons.filter(function (c) { return String(c.code).toUpperCase().indexOf(pre) === 0; })[0];
        return cons.map(function (c) { return '<option value="' + esc(c.unique) + '"' + (c === hit ? ' selected' : '') + '>Replace ' + esc(c.descr || '(blank)') + '</option>'; }).join('') + '<option value="new"' + (hit ? '' : ' selected') + '>Add as a new construction</option>';
      };
      x.matches.slice().sort(function (a, b) { return a.rank - b.rank || b.confidence - a.confidence; }).forEach(function (m, i) {
        var opts = optsFor(m), lc = M.libraryConstruction(lib, m.code), d = M.dcshFor(dcshReg(), m.code)[0];
        h += '<div class="ai-m"><div><b>' + esc(m.code) + '</b> <span class="pill ' + (m.confidence >= 0.7 ? 'ok' : m.confidence >= 0.5 ? 'warn' : 'bad') + '">' + Math.round(m.confidence * 100) + '%</span> <small>' + esc(m.level) + (lc ? ' · ' + esc(lc.description) : '') + (d ? ' · DCSH ' + esc(d.drawing) : '') + '</small></div>' +
          (m.reasons.length ? '<small class="muted">' + esc(m.reasons.join(' ')) + '</small>' : '') +
          '<div class="btnrow"><select data-aitarget="' + i + '">' + opts + '</select><button class="btn small primary" data-aiok="' + i + '">Approve</button></div></div>';
      });
      if (!x.matches.length) h += '<p class="hint">No code from your PNW library fits what the AI could see.</p>';
      if (x.cautions.length) h += '<p class="hint warn">' + esc(x.cautions.join(' ')) + '</p>';
    }
    return h + '<p class="hint">The photo is resized in your browser and sent once to EVE\'s AI service (Google Gemini, through Supabase). It is not stored. Suggestions change nothing until you approve one, and each approval goes into the change log as an AI suggestion.</p></div>';
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
      return { data: c.toDataURL('image/jpeg', 0.85).split(',')[1], thumb: t.toDataURL('image/jpeg', 0.7) };
    });
  }
  function runAi(id, file) {
    var r = aiResults[id] = { photo: file.name, loading: true }; renderSelected();
    shrink(file).then(function (img) {
      r.thumb = img.thumb; renderSelected();
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
    var id = S.selected, r = aiResults[id], m = r.resp.matches.slice().sort(function (a, c) { return a.rank - c.rank || c.confidence - a.confidence; })[+b.dataset.aiok];
    var target = document.querySelector('[data-aitarget="' + b.dataset.aiok + '"]').value, ref = 'Photo ' + r.photo + ', ' + m.level + ' rank ' + m.rank + ', ' + Math.round(m.confidence * 100) + '% (' + r.resp.model + ')';
    if (target !== 'new') { changeCode(id, target, m.code, 'AI suggestion', ref); return; }
    var cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, c) { return (c.kingbolt || 0) - (a.kingbolt || 0); }), row = project.poles.filter(function (x) { return x.ID === id; })[0];
    var d = M.defaultKingbolt(lib, m.code, PNW.num(row.HeightAG), cons.length ? cons[cons.length - 1].kingbolt : null);
    if (!d) { setStatus('No library default height for ' + m.code + '. Add it with the form below and type the king bolt height.', 'bad'); return; }
    var lay = knownLayout(m.code), lc = M.libraryConstruction(lib, m.code);
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
    window.PNW3D.mount($('v3host'), function (id) { select(id); });
    mounted3d = true; update3d(); window.PNW3D.select(S.selected);
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
  $('v3fit').onclick = function () { if (window.PNW3D && mounted3d) window.PNW3D.fit(); };
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
      buffers = {}; undoStack = []; redoStack = []; lastSnap = null; recompute(); fit(); setView(S.view, true);
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
  $('pickBtn').onclick = $('tbUpload').onclick = $('tbImport').onclick = function () { replaceIdx = null; $('fileInput').click(); };
  $('fileInput').onchange = function () {
    var fl = this.files;
    if (replaceIdx != null && fl.length === 1 && S.files[replaceIdx]) {
      var old = S.files[replaceIdx].name; S.files.splice(replaceIdx, 1); delete buffers[old]; setStatus('Replacing ' + old + '…');
    }
    replaceIdx = null; addFiles(fl); this.value = '';
  };
  $('tbFit').onclick = fit;
  $('tbSelect').onclick = function () { setStatus('Select mode: click any pole on the map to inspect it.'); };
  $('tbLayers').onclick = function () { $('secLayers').open = true; $('secLayers').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  $('tbLabels').onclick = function () { S.labels = !S.labels; this.classList.toggle('on', S.labels); this.setAttribute('aria-pressed', S.labels); renderMap(); save(); };
  $('tbIssues').onclick = function () { setTab('issues'); $('secValidation').open = true; $('tableWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  $('tbGenerate').onclick = generate;
  $('tbExport').onclick = function () { recompute(); openReview(); };
  $('tbSide').onclick = function () { $('workspace').classList.toggle('collapsed'); setTimeout(function () { map.invalidateSize(); }, 50); };
  $('tbReset').onclick = function () {
    if (!S.files.length && !prof().poleIds.length) return;
    if (!confirm('Start a new project? This removes the imported data and profiles saved in this browser.')) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    S = blank(); buffers = {}; flags = {}; undoStack = []; redoStack = []; recompute(); setStatus('New project. Saved data removed from this browser.', 'good');
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
  $('zone').value = S.zone; $('createdBy').value = S.settings.createdBy; $('optionSet').value = S.settings.optionSet; $('clr1').value = S.settings.clr1; $('clr2').value = S.settings.clr2;
  $('tbLabels').classList.toggle('on', S.labels);
  recompute();
  if (S.files.length) { fit(); setStatus('Restored your saved project. ' + summaryText()); }
  setTimeout(function () { map.invalidateSize(); }, 200);
})();
