/* Poles & Wires Ground Profile: UI. All processing is in the browser; the engineering rules live in pnw-core.js. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (v, dp) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '' : (dp == null ? String(v) : Number(v).toFixed(dp)); };
  /* smart search: blind to case, spaces and punctuation; every typed word must hit a word start, the joined text, the initials,
     a common abbreviation or a near spelling (letters only, 1 typo per 4-7 letters, 2 from 8). Returns a rank, 0 = no match. */
  var SYN = { tx: 'transformer', xfmr: 'transformer', trf: 'transformer', tfr: 'transformer', sv: 'street view', ph: 'phase', cond: 'conductor', xarm: 'crossarm', ug: 'underground', oh: 'overhead', del: 'delete', rm: 'remove', pt: 'point', sel: 'select', lv: 'low voltage', hv: 'high voltage' };
  function lev(a, b, max) { if (Math.abs(a.length - b.length) > max) return max + 1; var p = [], i, j; for (j = 0; j <= b.length; j++) p[j] = j; for (i = 1; i <= a.length; i++) { var c = [i], m = i; for (j = 1; j <= b.length; j++) { c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (c[j] < m) m = c[j]; } if (m > max) return max + 1; p = c; } return p[b.length]; }
  function smartPrep(text) { var t = String(text == null ? '' : text).toLowerCase(), w = t.split(/[^a-z0-9]+/).filter(Boolean); return { w: w, flat: w.join(''), ini: w.map(function (x) { return x[0]; }).join('') }; }
  function smartTok(tok, P, deep) {
    var best = 0, i, w;
    for (i = 0; i < P.w.length; i++) { w = P.w[i]; if (w === tok) return 10; if (w.indexOf(tok) === 0) best = Math.max(best, 8); }
    if (best) return best;
    if (tok.length > 1) { var k = P.flat.indexOf(tok); if (k >= 0) return k === 0 ? 7 : 5; if (tok.length > 1 && P.ini.indexOf(tok) >= 0) return 5; }
    if (tok.length > 1 && !/\d/.test(tok)) for (i = 0; i < P.w.length; i++) { w = P.w[i]; if (w[0] === tok[0] && w.length > tok.length) { var j = 0; for (var c = 0; c < w.length && j < tok.length; c++) if (w[c] === tok[j]) j++; if (j === tok.length) return 3; } }
    if (!deep && SYN[tok]) { var s = SYN[tok].split(' '), sc = 0; for (i = 0; i < s.length; i++) { var x = smartTok(s[i], P, true); if (!x) { sc = 0; break; } sc += x; } if (sc) return Math.max(3, Math.round(sc / s.length) - 1); }
    if (tok.length >= 4 && !/\d/.test(tok)) { var mx = tok.length >= 8 ? 2 : 1; for (i = 0; i < P.w.length; i++) { w = P.w[i]; if (w.length >= 3 && (lev(tok, w, mx) <= mx || (w.length > tok.length && lev(tok, w.slice(0, tok.length), mx) <= mx))) return 2; } }
    return 0;
  }
  function smartScore(q, text) {
    var toks = String(q == null ? '' : q).toLowerCase().split(/[\s,;/]+/).map(function (x) { return x.replace(/[^a-z0-9]/g, ''); }).filter(Boolean);
    if (!toks.length) return 1;
    var P = smartPrep(text), qf = toks.join(''), tot = 0;
    for (var i = 0; i < toks.length; i++) { var s = smartTok(toks[i], P); if (!s) { if (P.flat.indexOf(qf) < 0) return 0; tot = 0; break; } tot += s; }
    if (P.flat === qf) tot += 40; else if (P.flat.indexOf(qf) === 0) tot += 20; else if (P.flat.indexOf(qf) >= 0) tot += 8;
    return tot || 6;
  }
  function smartRank(q, list, textOf) { if (!String(q || '').trim()) return list.slice(); return list.map(function (x, i) { return { x: x, s: smartScore(q, textOf(x)), i: i }; }).filter(function (o) { return o.s > 0; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; }).map(function (o) { return o.x; }); }
  var KEY = 'eve-poles-wires-project-v1', MAX_BYTES = 50 * 1024 * 1024;
  var DEFAULT_SETTINGS = { createdBy: '', optionSet: 'v7 REGION AM-SL1', clr1: 5.8, clr2: 7 }; // values from Ishan's saved MP219050.pnwx

  /* ---------- state ---------- */
  var S = blank(), buffers = {}, merged = { poles: {}, issues: [] }, built = null, allIssues = [], flags = {};
  var M = window.PNWModel, lib = null, project = null, linked = null, dm = null, undoStack = [], redoStack = [];
  var sortCol = 'order', sortDesc = false, tab = 'poles';
  function blank() { return { zone: 50, settings: Object.assign({}, DEFAULT_SETTINGS), files: [], profiles: [newProfile('Profile 1')], active: 0, selected: null, labels: true, generated: false, view: 'plan', sag: false, design: blankDesign(), tipload: null, photos: {} }; }
  function blankDesign() { return { link: null, xml: null, register: {}, log: [] }; }
  function newProfile(name) { return { name: name, poleIds: [], lengths: {}, comments: {}, segments: [] }; }
  function prof() { return S.profiles[S.active]; }

  var tipLive = null;
  function save() {
    markDirty(true);
    if (typeof renderTip === 'function' && $('tipDlg') && !$('tipDlg').hidden) { clearTimeout(tipLive); tipLive = setTimeout(function () { var b = $('tipBody'), y = b.scrollTop; try { renderTip(); } catch (e) { /* keep the last view */ } b.scrollTop = y; }, 150); }
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
  // Status message with an Undo button, for one-click removals.
  function undoStatus(t) { setStatus(t, 'good'); var b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Undo'; b.style.marginLeft = '8px'; b.onclick = function () { var u = $('tbUndo'); if (u && !u.disabled) u.click(); }; $('status').appendChild(b); }

  /* ---------- layout: project panel | viewport + table dock | inspector, each resizable and collapsible ---------- */
  var UI_KEY = 'eve-poles-wires-ui-v1', U = { lw: Math.round(Math.min(300, window.innerWidth * 0.2)), rw: Math.round(Math.min(390, window.innerWidth * 0.27)), dh: Math.round(Math.min(230, window.innerHeight * 0.23)), left: false, right: true, dock: true, dockMin: false, insTab: 'design', tab: 'spans' };
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
    ws.style.setProperty('--wsh', Math.max(540, window.innerHeight - top - 46) + 'px');
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
  // Pan the map with the middle button (wheel pressed) as well as the left button.
  (function () {
    var el = map.getContainer(), last = null;
    el.addEventListener('mousedown', function (e) { if (e.button !== 1) return; e.preventDefault(); last = [e.clientX, e.clientY]; el.classList.add('mpan'); });
    window.addEventListener('mousemove', function (e) { if (!last) return; map.panBy([last[0] - e.clientX, last[1] - e.clientY], { animate: false }); last = [e.clientX, e.clientY]; });
    window.addEventListener('mouseup', function (e) { if (e.button === 1 && last) { last = null; el.classList.remove('mpan'); } });
    el.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
  })();
  L.control.scale({ position: 'bottomright', metric: true, imperial: false, maxWidth: 140 }).addTo(map);
  var bases = {
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    esri: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri' }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 21, maxNativeZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' })
  };
  // Inside Claude (window.PNW_ARTIFACT) the page cannot load map tiles from other hosts; the PNW Maps connector supplies the basemap there.
  var activeBase = IN_CLAUDE ? null : bases.street.addTo(map);
  $('basemap').onchange = function () { if (IN_CLAUDE) { gBase.type = this.value === 'esri' ? 'satellite' : this.value === 'hybrid' ? 'hybrid' : 'roadmap'; gBase.on = this.value !== 'none'; if (!gBase.on && gBase.ov) { map.removeLayer(gBase.ov); gBase.ov = null; } gBase.err = false; gBaseRefresh(); return; } if (activeBase) map.removeLayer(activeBase); activeBase = bases[this.value] ? bases[this.value].addTo(map) : null; };
  /* PNW Maps connector (MCP proxy on Supabase that holds the Google key): inside Claude it gives the basemap
     (Google Static Maps under the plan) and Street View images, because the page itself cannot reach other hosts. */
  var MAPS_SRV = 'PNW Maps', mapsMcp = null;
  // On the website the same Street View tools come straight from the Supabase function's /web route (website origin only).
  var MAPS_WEB = 'https://hszkloepnewfkzdegfhl.supabase.co/functions/v1/pnw-maps-mcp/web', WEB_MAPS_DOWN = false, webCache = {}, webSeq = 0;
  var webMaps = { callTool: function (srv, tool, input) {
    var k = tool + JSON.stringify(input); if (webCache[k]) return webCache[k];
    var pr = fetch(MAPS_WEB, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++webSeq, method: 'tools/call', params: { name: tool, arguments: input } }) })
      .then(function (r) { if (!r.ok) { if (r.status === 403 || r.status === 404) WEB_MAPS_DOWN = true; throw { code: 'unavailable', message: 'Street View service answered ' + r.status + '.' }; } return r.json(); },
        function () { WEB_MAPS_DOWN = true; throw { code: 'unavailable', message: 'The Street View service could not be reached.' }; })
      .then(function (j) { var res = j && j.result; if (!res || res.isError) throw { message: (res && res.content && res.content[0] && res.content[0].text) || (j && j.error && j.error.message) || 'Street View request failed.' }; return res; });
    webCache[k] = pr; pr.catch(function () { delete webCache[k]; }); return pr;
  } };
  function webMapsOn() { return !IN_CLAUDE && !WEB_MAPS_DOWN; }
  function mapsReady() { if (!IN_CLAUDE) return Promise.resolve(WEB_MAPS_DOWN ? null : webMaps); if (!window.claude || !window.claude.use) return Promise.resolve(null); if (!mapsMcp) mapsMcp = Promise.resolve(window.claude.use('mcp')).catch(function () { return null; }); return mapsMcp; }
  function mapsCall(tool, input) { return mapsReady().then(function (m) { if (!m) throw { code: 'capability_disabled', message: 'Maps are not available in this view.' }; return m.callTool(MAPS_SRV, tool, input, { cache: { staleTime: 864e5, gcTime: 864e5 } }); }); }
  function mapsImg(r) { var b = ((r && r.content) || []).filter(function (c) { return c.type === 'image'; })[0]; return b ? { url: 'data:' + b.mimeType + ';base64,' + b.data, b64: b.data, type: b.mimeType } : null; }
  function mapsInfo(r) { return (r && (r.structuredContent || (typeof r.payload === 'object' ? r.payload : null))) || {}; }
  function mapsErr(e) {
    var c = e && e.code;
    return c === 'server_not_connected' || c === 'server_not_found' ? 'Add the “PNW Maps” connector in claude.ai Settings → Connectors.' : c === 'needs_reauth' ? 'Reconnect “PNW Maps” in claude.ai Settings → Connectors.' :
      c === 'not_in_manifest' || c === 'approval_required' || c === 'consent_required' ? 'Allow PNW Maps for this page to see maps and Street View.' : c === 'tool_error' ? 'PNW Maps: ' + ((e.result && e.result.content && e.result.content[0] && e.result.content[0].text) || e.message || 'the request failed') + '.' :
      c === 'capability_disabled' || c === 'not_granted' ? 'Maps need the page open in claude.ai.' : 'PNW Maps is not reachable right now.';
  }
  map.createPane('gbase').style.zIndex = 150;
  var gBase = { on: IN_CLAUDE, type: 'roadmap', ov: null, seq: 0, t: null, err: false };
  function gBaseRefresh() {
    if (!gBase.on) return; clearTimeout(gBase.t);
    gBase.t = setTimeout(function () {
      var sz = map.getSize(); if (!sz.x || !sz.y) return;
      var z = Math.max(1, Math.min(21, Math.floor(map.getZoom() - Math.log(Math.max(1, (sz.x + 64) / 640, (sz.y + 64) / 640)) / Math.LN2)));
      var p = map.project(map.getCenter(), z).divideBy(128).round().multiplyBy(128), c = map.unproject(p, z), n = ++gBase.seq;
      var bnd = L.latLngBounds(map.unproject(p.subtract([320, 320]), z), map.unproject(p.add([320, 320]), z));
      mapsCall('static_map', { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: z, width: 640, height: 640, scale: 2, maptype: gBase.type }).then(function (r) {
        if (n !== gBase.seq || !gBase.on) return; var im = mapsImg(r); if (!im) return;
        var old = gBase.ov; gBase.ov = L.imageOverlay(im.url, bnd, { pane: 'gbase', interactive: false, attribution: 'Map data &copy; Google' }).addTo(map);
        if (old) setTimeout(function () { map.removeLayer(old); }, 150);
      }, function (e) { if (n === gBase.seq && !gBase.err) { gBase.err = true; setStatus('Basemap: ' + mapsErr(e), 'bad'); } });
    }, 300);
  }
  map.on('moveend zoomend resize', gBaseRefresh);
  if (IN_CLAUDE) { var bmSel = $('basemap'); if (!bmSel.querySelector('option[value="none"]')) bmSel.insertAdjacentHTML('beforeend', '<option value="hybrid">Aerial + labels</option><option value="none">No basemap</option>'); setTimeout(gBaseRefresh, 800); }
  var lyGis = L.layerGroup().addTo(map), lyAlign = L.layerGroup().addTo(map), lySpan = L.layerGroup().addTo(map), lySurvey = L.layerGroup().addTo(map), lyExtent = L.layerGroup(), lySel = L.layerGroup().addTo(map);
  var markers = {};
  var pickMode0 = null;
  map.on('click', function (e) { if (typeof pickMode === 'function') { var cb = pickMode; pickMode = null; document.body.classList.remove('pickmode'); cb(e && e.latlng); return; } planMapClick(e && e.latlng); });

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
          .bindTooltip(esc(id) + ' · GIS position (approximate)').on('click', function (e) { plClick(id, e); }).addTo(lyGis);
        if (ll) L.polyline([g, ll], { color: '#7a8a9c', weight: 1, dashArray: '3 3' }).addTo(lyGis);
        if (!ll) pts.push(g);
      }
      if (!ll) return;
      pts.push(ll);
      var m = L.circleMarker(ll, { radius: 7, weight: 3, color: lvl === 'error' ? '#b42318' : '#2f6ea4', fillColor: inProf[id] ? '#2f6ea4' : '#fff', fillOpacity: 1 })
        .on('click', function (e) { plClick(id, e); }).addTo(lySurvey);
      if (S.labels) m.bindTooltip(esc(id), { permanent: true, direction: 'right', offset: [8, 0], className: 'pole-label' });
      else m.bindTooltip(esc(id));
      markers[id] = m;
    });
    if (built) {
      var line = built.rows.map(function (r) { return toLatLng(r.easting, r.northing); });
      for (var i = 1; i < line.length; i++) {
        if (!line[i - 1] || !line[i]) continue;
        var seg = L.polyline([line[i - 1], line[i]], { color: '#0f766e', weight: 3, opacity: .85 }).addTo(lyAlign);
        seg.bindTooltip('Span ' + esc(built.rows[i - 1].id) + ' → ' + esc(built.rows[i].id) + ': ' + fmt(built.rows[i].span, 2) + ' m (derived from survey E/N). Click to select the span.');
        (function (a, b) { seg.on('click', function (e) { plSpan(a, b, e); }); })(built.rows[i - 1].id, built.rows[i].id);
        var off = [0, 0]; try { var p1 = map.latLngToLayerPoint(line[i - 1]), p2 = map.latLngToLayerPoint(line[i]), dx = p2.x - p1.x, dy = p2.y - p1.y, ln = Math.hypot(dx, dy) || 1, nx = -dy / ln, ny = dx / ln; var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, far = function (sg) { var best = 1e9; Object.keys(markers).forEach(function (k) { var q = map.latLngToLayerPoint(markers[k].getLatLng()); best = Math.min(best, Math.hypot(q.x + 30 - (mx + sg * nx * 18), q.y - (my + sg * ny * 18))); }); return best; };
          var sg = far(-1) > far(1) ? -1 : 1; off = [Math.round(sg * nx * 18), Math.round(sg * ny * 18)]; } catch (e) { off = [0, 0]; }
        L.tooltip({ permanent: true, direction: 'center', offset: off, className: 'span-label' }).setLatLng(L.latLng((line[i - 1].lat + line[i].lat) / 2, (line[i - 1].lng + line[i].lng) / 2)).setContent(fmt(built.rows[i].span, 2) + ' m').addTo(lySpan);
      }
    }
    xLines.forEach(function (x) {
      var ll = x.dm.allPoles.map(function (p) { var m = x.common[p.id]; return m ? toLatLng(m.easting, m.northing) : toLatLng(p.easting, p.northing); });
      for (var i = 1; i < ll.length; i++) if (ll[i - 1] && ll[i]) L.polyline([ll[i - 1], ll[i]], { color: '#7c3aed', weight: 3, opacity: .85, dashArray: '8 5' }).bindTooltip(esc(x.title) + ' (intersecting line)').addTo(lyAlign);
      x.dm.allPoles.forEach(function (p, i) {
        if (!ll[i]) return; pts.push(ll[i]);
        if (x.common[p.id]) { if (markers[x.common[p.id].id]) markers[x.common[p.id].id].setStyle({ color: '#7c3aed' }); return; }
        if (merged.poles[p.id] && markers[p.id]) return;
        var m = L.circleMarker(ll[i], { radius: 7, weight: 3, color: '#7c3aed', fillColor: '#ede9fe', fillOpacity: 1 }).on('click', function (e) { plClick(p.id, e); }).addTo(lySurvey);
        m.bindTooltip(esc(p.id) + (S.labels ? '' : ' · ' + esc(x.title)), S.labels ? { permanent: true, direction: 'right', offset: [8, 0], className: 'pole-label' } : {});
        markers[p.id] = m;
      });
    });
    if (pts.length) L.rectangle(L.latLngBounds(pts).pad(0.15), { color: '#64748b', weight: 1, dashArray: '6 4', fill: false }).addTo(lyExtent);
    // Pole markers above the span lines, so a click on a pole picks the pole (and multi-select adds it) instead of the span.
    lySurvey.eachLayer(function (l) { if (l.bringToFront) l.bringToFront(); });
    $('emptyMap').hidden = ids.length > 0; if (!$('emptyImport').onclick) $('emptyImport').onclick = function () { $('tbUpload').click(); };
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
    if (S.selSpan && !S.selected) {
      var sa = poleXY(S.selSpan.a), sb = poleXY(S.selSpan.b), la = sa && toLatLng(sa.e, sa.n), lb = sb && toLatLng(sb.e, sb.n);
      if (la && lb) L.polyline([la, lb], { color: '#f59e0b', weight: 7, opacity: .7, interactive: false }).addTo(lySel);
      return;
    }
    (S.multi || []).forEach(function (k) { var q = merged.poles[k], l2 = q && (poleLatLng(q) || (q.gis && q.gis.lat != null ? L.latLng(q.gis.lat, q.gis.lng) : null)); if (l2 && k !== S.selected) L.circleMarker(l2, { radius: 12, weight: 3, color: '#f59e0b', fill: false, interactive: false }).addTo(lySel); });
    var id = S.selected; if (!id || !merged.poles[id]) return;
    var p = merged.poles[id], ll = poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null);
    if (ll) L.circleMarker(ll, { radius: 14, weight: 3, color: '#f59e0b', fill: false, interactive: false }).addTo(lySel);
    if (ll && L.divIcon && S.view === 'plan') L.marker(ll, { icon: L.divIcon({ className: 'selpop-wrap', html: '<button class="selpop" data-ctx="profile"><b>' + esc(id) + '</b>Open Profile →</button>', iconSize: [0, 0] }), interactive: true, keyboard: false, zIndexOffset: 1000 }).addTo(lySel);
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
    // Pole photos dropped together with the spreadsheets: attached after the import (matched by file name), then Auto design runs.
    var imgs = arr.filter(function (f) { return /\.(jpe?g|png|webp)$/i.test(f.name); }); arr = arr.filter(function (f) { return imgs.indexOf(f) < 0; });
    if (!arr.length) { if (imgs.length) dropPhotos(imgs); return; }
    var existed = {}; S.files.forEach(function (f) { existed[f.name] = 1; });
    var jobs = arr.map(function (f) {
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['xlsx', 'xls', 'csv', 'xlsm', 'pnwx', 'txt', 'json'].indexOf(ext) < 0) return Promise.resolve({ name: f.name, size: f.size, role: 'unknown', status: 'error', items: [], sheets: [], issues: [{ level: 'error', code: 'file-type', message: f.name + ': only .xlsx, .xls, .csv, .pnwx, PNW library or DCSH .txt and DCSH register .json files can be imported.', file: f.name }] });
      if (f.size > MAX_BYTES) return Promise.resolve({ name: f.name, size: f.size, role: 'unknown', status: 'error', items: [], sheets: [], issues: [{ level: 'error', code: 'file-size', message: f.name + ' is larger than 50 MB.', file: f.name }] });
      upsertFile({ name: f.name, size: f.size, role: '…', status: 'reading', items: [], sheets: [], issues: [] });
      return f.arrayBuffer().then(function (buf) {
        buffers[f.name] = buf;
        if (ext === 'pnwx' || ext === 'json' || (ext === 'txt' && !PNW.isFieldSurvey(PNW.decodeText(buf.slice(0, 256))))) return importText(f.name, new TextDecoder('utf-8').decode(buf));
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
      seedNote = '';
      if (!hadPoles) { if (project) useProject(true); else seedProfile(true); }
      recompute(); fit();
      if (results.some(function (r) { return r.status === 'error' || r.role === 'unknown'; })) openFilesDlg();
      setStatus('Imported ' + results.length + ' file' + (results.length > 1 ? 's' : '') + (replaced ? ' (' + replaced + ' replaced)' : '') + '. ' + summaryText() + (seedNote ? ' ' + seedNote : ''), 'good');
      dropPhotos(imgs, results.some(function (r) { return r.status === 'ok' && r.role !== 'unknown'; }));
    });
  }
  // Attach dropped photos to the poles named in their file names; then, if the poles are surveyed and the design has no
  // constructions yet, start Auto design (it reads the photos and proposes constructions, conductors and tensions for review).
  function dropPhotos(imgs, imported) {
    var miss = [];
    Promise.all((imgs || []).map(function (f) {
      var id = idFromName(f.name); if (!id || !merged.poles[id]) { miss.push(f.name); return null; }
      return shrink(f).then(function (img) { attachPhoto(id, f.name, img, { source: 'Imported photo (file name)' }); return id; }, function () { miss.push(f.name); return null; });
    })).then(function (ids) {
      var n = ids.filter(Boolean).length; if (n) { renderSelected(); renderTable(); }
      var note = (n ? n + ' photo' + (n > 1 ? 's' : '') + ' attached. ' : '') + (miss.length ? miss.length + ' photo' + (miss.length > 1 ? 's' : '') + ' not matched by file name: use Files › Pole photos. ' : '');
      var surveyed = Object.keys(merged.poles).some(function (k) { return merged.poles[k].survey; }), hasCons = project && project.constructions && project.constructions.length;
      if ((n || imported) && surveyed && !hasCons && !AD.busy && $('genDlg').hidden) { if (note) setStatus(note + 'Starting Auto design…', 'good'); autoDesign(); }
      else if (note) setStatus(note, miss.length ? 'bad' : 'good');
    });
  }
  function upsertFile(r) {
    var i = S.files.findIndex(function (f) { return f.name === r.name; });
    if (i >= 0) { S.files[i] = r; renderFiles(); return true; }
    S.files.push(r); renderFiles(); return false;
  }
  // split: where the surveyed poles branch (tee-offs, crossing streets), each line becomes its own profile.
  function seedProfile(split) {
    var ids = Object.keys(merged.poles).filter(function (id) { return merged.poles[id].survey; });
    if (!ids.length) return;
    var lines = split && PNW.splitLines ? PNW.splitLines(merged.poles, ids) : null;
    if (!lines || lines.length < 2) { prof().poleIds = PNW.autoOrder(merged.poles, ids); return; }
    prof().poleIds = lines[0];
    lines.slice(1).forEach(function (l) { var q = newProfile(uniqueProfName()); q.poleIds = l; S.profiles.push(q); });
    seedNote = 'The poles branch, so they were split into ' + lines.length + ' profiles (one per line, sharing the junction poles). Switch with the profile list.';
  }
  var seedNote = '';
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
    calcAt = new Date();
    syncDesign(); autoTensionSync();
    var ok = S.files.filter(function (f) { return f.status === 'ok' && !TEXT_ROLES[f.role]; });
    merged = PNW.buildPoles(ok.concat(projectSurvey(ok)));
    var p = prof();
    var gpts = [].concat.apply([], ok.filter(function (f) { return f.role === 'groundPoints'; }).map(function (f) { return f.items; }));
    built = p.poleIds.length ? PNW.buildProfile(merged.poles, gpts.length ? Object.assign({}, p, { groundPts: gpts }) : p) : null;
    buildDesignModel();
    var seen = {};
    allIssues = [].concat.apply([], S.files.map(function (f) { return f.issues || []; })).concat(merged.issues, built ? built.issues : [], dm ? dm.issues : [], calcIssues()).filter(function (i) { var k = i.level + i.message; if (seen[k]) return false; seen[k] = 1; return true; });
    trackHistory(); renderAll(); save();
  }
  // Calculation results that must show up in Validate, Issues, the status bar and the step list: tipload fails, assumed sag.
  function calcIssues() {
    var out = [];
    try {
      if (project && dm && tipSet().cases.length) tipPoles().filter(function (k) { return !/^tip:/.test(k); }).forEach(function (id) {
        var r = null; try { r = tipCalc(id); } catch (e) { r = null; }
        var f = r && r.results ? r.results.filter(function (x) { return x.pass === false; }) : [];
        if (f.length) { f.sort(function (a, b) { return (b.pctHor || 0) - (a.pctHor || 0); }); out.push({ level: 'error', poleId: id, message: 'Tipload fails on ' + id + ': ' + f[0].name + (f[0].pctHor != null ? ' at ' + Math.round(f[0].pctHor) + '% of pole strength' : '') + (f.length > 1 ? ' (' + f.length + ' load cases fail)' : '') + '.' }); }
      });
      if (dm) { var seen = {}; dm.wires.forEach(function (w) { if (/no DCSH table/.test(w.sagSource || '') && !seen[w.segment]) { seen[w.segment] = 1; out.push({ level: 'warning', message: 'Sag in ' + w.segment + ' is w·L²/8T at the stringing tension: no DCSH Part 10 table matched, so check the tension.' }); } }); }
    } catch (e) { /* calculation not ready */ }
    return out;
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
    $('fileCountPill').hidden = !S.files.length; $('fileCountPill').textContent = S.files.length;
    $('mImportedSub').textContent = S.files.length ? S.files.length + ' file' + (S.files.length > 1 ? 's' : '') + ' · ' + Object.keys(merged.poles || {}).length + ' poles · roles and columns' : 'Nothing imported yet';
    $('files').innerHTML = S.files.map(function (f, i) {
      var errs = (f.issues || []).filter(function (x) { return x.level === 'error'; }).length, warns = (f.issues || []).filter(function (x) { return x.level === 'warning'; }).length;
      var st = f.status === 'reading' ? '<span class="pill info">Reading…</span>' : f.status === 'error' ? '<span class="pill bad">Failed</span>' : errs ? '<span class="pill bad">' + errs + ' error' + (errs > 1 ? 's' : '') + '</span>' : warns ? '<span class="pill warn">' + warns + ' warning' + (warns > 1 ? 's' : '') + '</span>' : f.role === 'unknown' ? '<span class="pill warn">Choose role</span>' : '<span class="pill ok">OK</span>';
      var count = f.summary || (f.role === 'inspections' ? (f.items || []).length + ' poles' : (f.items || []).length + ' records');
      var opts = Object.keys(PNW.ROLES).map(function (r) { return '<option value="' + r + '"' + (r === f.role ? ' selected' : '') + '>' + PNW.ROLES[r] + '</option>'; }).join('');
      var conf = f.confidence === 'manual' ? 'set by you' : f.confidence === 'high' ? 'detected from headers' : f.confidence === 'medium' ? 'guessed, please check' : '';
      var heads = (f.sheets || []).map(function (s) { return '<div><b>' + esc(s.name) + '</b> · ' + s.rows + ' rows<br>' + esc(s.headers.join(' | ')) + '</div>'; }).join('');
      return '<div class="file"><div class="fn">' + esc(f.name) + '</div><div class="meta">' + (f.name.split('.').pop() || '').toUpperCase() + ' · ' + (f.size / 1024).toFixed(1) + ' KB · ' + count + (f.sheetUsed ? ' · sheet ' + esc(f.sheetUsed) + ', header row ' + f.headerRow : '') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">' + st + '<span class="meta">' + conf + '</span></div>' +
        (TEXT_ROLES[f.role] ? '<div class="meta"><b>' + TEXT_ROLES[f.role] + '</b>' + (f.role === 'pnwx' && f.kind === 'profile' ? (S.design.link === f.name ? ' · <span class="pill info">linked design</span>' : (xLines.some(function (x) { return x.name === f.name; }) ? ' · <span class="pill info" style="background:#ede9fe;color:#5b21b6" title="Shares ' + esc(Object.keys(xLines.filter(function (x) { return x.name === f.name; })[0].common).join(', ')) + ' with the design; drawn with it in plan and 3D">intersecting line</span>' : '') + ' · <button class="btn small" data-link="' + i + '">Use as design</button>') : '') + '</div>' :
        (f.manual ? '<div class="meta">Poles you created in <b>Design → New pole</b>. Edit or delete them from the pole\'s inspector.</div>' : '<select data-role="' + i + '" aria-label="Role of ' + esc(f.name) + '">' + opts + '</select>')) +
        ((f.issues || []).length ? '<details><summary>' + (f.issues || []).length + ' message' + ((f.issues || []).length > 1 ? 's' : '') + ' from this file</summary><ul class="msgs">' + (f.issues || []).slice(0, 8).map(function (x) { return '<li class="' + esc(x.level) + '">' + esc(x.message) + '</li>'; }).join('') + ((f.issues || []).length > 8 ? '<li class="info">…and ' + ((f.issues || []).length - 8) + ' more (see the Issues tab)</li>' : '') + '</ul></details>' : '') +
        '<details><summary>Data mapping: sheets and headers</summary><div class="heads">' + heads + '</div></details>' +
        '<div class="acts">' + (f.manual ? '' : '<button class="btn small" data-replace="' + i + '">Replace…</button>') + binBtn('data-remove="' + i + '"', 'Remove this file') + '</div></div>';
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
      var sub = r.chainage != null ? 'ch ' + fmt(r.chainage, 2) + ' m' + (r.span != null ? ' · span ' + fmt(r.span, 2) + ' m' : '') : (pole && pole.survey ? '' : 'not surveyed');
      return '<li class="' + (isSel(id) ? 'sel' : '') + '"><span class="n">' + (i + 1) + '</span><span class="id" data-pick="' + esc(id) + '">' + esc(id) + (lvl ? ' <span class="pill ' + (lvl === 'error' ? 'bad' : 'warn') + '">' + lvl + '</span>' : '') + '<small>' + sub + '</small></span>' +
        '<input data-len="' + esc(id) + '" class="' + (edited ? 'edited' : '') + '" value="' + fmt(edited ? p.lengths[id] : ex.value) + '" inputmode="decimal" aria-label="Pole length for ' + esc(id) + ' in metres" title="' + (edited ? 'Edited. Existing: ' + fmt(ex.value) + ' m (' + (ex.source || 'none') + '). Clear to revert.' : 'Existing length from ' + (ex.source || 'no source') + '. Type to change.') + '">' +
        '<span class="mini"><button data-up="' + i + '" title="Move up" aria-label="Move up">↑</button><button data-down="' + i + '" title="Move down" aria-label="Move down">↓</button><button data-del="' + i + '" title="Remove from profile" aria-label="Remove">✕</button></span></li>';
    }).join('');
  }
  $('alignList').addEventListener('click', function (e) {
    var t = e.target.closest('[data-up],[data-down],[data-del],[data-pick]'); if (!t) return;
    var ids = prof().poleIds;
    if (t.dataset.pick) { select(t.dataset.pick, addInfo(e)); zoomTo(t.dataset.pick); return; }
    var gone = t.dataset.del != null ? ids.splice(+t.dataset.del, 1)[0] : null;
    if (t.dataset.up != null && +t.dataset.up > 0) { var i = +t.dataset.up; ids.splice(i - 1, 0, ids.splice(i, 1)[0]); }
    if (t.dataset.down != null && +t.dataset.down < ids.length - 1) { var j = +t.dataset.down; ids.splice(j + 1, 0, ids.splice(j, 1)[0]); }
    S.generated = false; recompute();
    if (gone) undoStatus('Removed ' + gone + ' from the profile.');
  });
  $('alignList').addEventListener('change', function (e) {
    var id = e.target.dataset.len; if (!id) return;
    var v = e.target.value.trim(), p = prof(), ex = merged.poles[id] ? PNW.existingLength(merged.poles[id]).value : null;
    if (v === '') delete p.lengths[id];
    else { var n = PNW.num(v); if (!(n > 0) || n > 60) { setStatus(id + ': "' + v + '" is not a valid pole length in metres.', 'bad'); renderProfile(); return; } if (n === ex) delete p.lengths[id]; else p.lengths[id] = n; }
    S.generated = false; recompute();
  });
  $('profileSel').onchange = function () { switchProfile(this.value); };
  $('profileName').onchange = function () { var v = this.value.trim(); if (!v || S.profiles.some(function (q, k) { return k !== S.active && q.name === v; })) { setStatus(v ? 'Another profile is called “' + v + '”.' : 'A profile needs a name.', 'bad'); this.value = prof().name || ''; return; } prof().name = v; recompute(); };
  // One way to start a profile: the Create profile dialog (poles picked in the list or on the map), which also makes its PNW line.
  $('newProfile').onclick = function () { FN.mkProf(true); };
  $('delProfile').onclick = function () { delProfileDlg(S.active); };
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
    if (id && mpPick && !$('genDlg').hidden && $('mpSum') && mpPick(id)) return;
    if (CT.on && id && !(info && info.segment !== undefined)) { ctAdd(id); return; }
    if (info && info.add && id) { var mm = S.multi && S.multi.length > 1 ? S.multi.slice() : (S.selected ? [S.selected] : []), kx = mm.indexOf(id); if (kx >= 0) mm.splice(kx, 1); else mm.push(id); S.multi = mm.length > 1 ? mm : []; id = mm.length ? (kx >= 0 ? mm[mm.length - 1] : id) : null; S.selSpan = null; }
    else if (!(info && info.keepMulti)) S.multi = [];
    // A pole on another profile's line: switch to that profile, so the pole shows its own constructions and design.
    if (id && !(info && (info.add || info.keepMulti || info.noSwitch)) && lineIds().indexOf(id) < 0) {
      var other = S.profiles.map(function (q, k) { return { q: q, k: k }; }).filter(function (o) { return o.k !== S.active && o.q.poleIds.indexOf(id) >= 0; }).sort(function (a, b) { return (b.q.file ? 1 : 0) - (a.q.file ? 1 : 0); })[0];
      if (other) { switchProfile(other.k); S.multi = []; setStatus(id + ' is on ' + (other.q.name || 'Profile ' + (other.k + 1)) + ', so that profile is now active.', 'good'); }
    }
    S.selected = id; flags.inspected = true;
    if (!(info && info.span)) S.selSpan = null;
    if (info && info.segment !== undefined) { S.selSection = info.segment || null; if (info.segment) U.insTab = 'cond'; }
    else if (!id) S.selSection = null;
    if (id && !U.right) { U.right = true; applyLayout(); }
    renderSelected(); highlight(); renderProfile(); renderSteps();
    Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tr[data-id]'), function (tr) { tr.classList.toggle('sel', isSel(tr.dataset.id)); });
    Array.prototype.forEach.call(document.querySelectorAll('#tableWrap tr[data-sec]'), function (tr) { tr.classList.toggle('sel', tr.dataset.sec === S.selSection); });
    if (window.PNW3D && mounted3d) { window.PNW3D.select(id); window.PNW3D.selectSection(S.selSection); }
    if (S.view === 'profile' || S.view === 'split') { if (id) pvEnsure(id); renderProfileView(); }
    renderExtras(true);
    if (id) panPlanTo(poleLL(id));
  }
  // Shows a pole in whatever view is open: the map pans to it, the 3D camera frames it.
  function showPole(id) {
    if (!id) return;
    if ((S.view === '3d' || S.view === 'split') && window.PNW3D && mounted3d) { if (!window.PNW3D.focus(id)) setStatus(id + ' is not drawn in 3D (no coordinates or ground level).', 'bad'); }
    else if (S.view === 'plan') zoomTo(id);
    else if (S.view === 'profile') { pvFocus(id); renderProfileView(); }
  }
  // King bolt default: the DCSH drawing's distance below the tip for the top construction, else the PNW library default.
  function kbDefault(code, hag, above) {
    var d = M.dcshFor(dcshReg(), code)[0];
    if (above == null && d && d.kingboltBelowTip != null && hag > 0) return { value: Math.round((hag - d.kingboltBelowTip) * 1000) / 1000, below: d.kingboltBelowTip, source: 'DCSH ' + d.drawing + ' (' + d.part + ', p' + d.page + ') king bolt below tip' };
    return M.defaultKingbolt(lib, code, hag, above);
  }
  // LV under HV: the separation depends on a running earth (RE), and that rule is not in the loaded DCSH parts.
  function lvUnderHvNote(cons, i, id) {
    var c = cons[i]; if (i === 0 || circuitClass(c.code) !== 'lv' || !cons.slice(0, i).some(function (x) { return circuitClass(x.code) === 'hv'; })) return '';
    var re = cons.some(function (x) { return /^RE/i.test(x.code || ''); });
    var r = lvRule(id, cons, i); if (r && r.value != null) return '';
    return '<span class="wbub" title="' + esc((re ? 'Running earth (RE) on this pole. ' : 'No running earth (RE) on this pole. ') + ((r && r.why) || 'The HV to LV separation rule for this case is not in the loaded reference data.') + ' The LV height uses the PNW library distance below the supercircuit.') + '">!</span>';
  }
  // LV king bolt under HV from the private separation rule (window.PNW_HVLV, built only into the private page):
  // RE below the HV king bolt by the HV drawing's distance, then the LV king bolt below the RE by LV and RE conductor type.
  function reCondText(id, re) {
    if (!project || !re) return '';
    var s = project.segPoles.filter(function (x) { return x.id === id && x.constr === re.descr; })[0], sg = s && project.segments.filter(function (x) { return x.StrainSect === s.strsection; })[0], c = sg && conductorFor(sg.Conductor);
    return sg ? [sg.Conductor, c && c.name, c && c.name2, c && c.material].filter(Boolean).join(' ') : '';
  }
  function lvRule(id, cons, i) {
    var c = cons[i]; if (i === 0 || circuitClass(c.code) !== 'lv') return null;
    var hv = cons.slice(0, i).filter(function (x) { return circuitClass(x.code) === 'hv'; })[0]; if (!hv) return null;
    var re = cons.filter(function (x) { return /^RE/i.test(x.code || ''); })[0], R = hvlvRule(), out = { re: !!re };
    if (!R) { out.why = 'The HV to LV separation rule is not loaded on this page.'; return out; }
    var d = M.dcshFor(dcshReg(), hv.code)[0], rule = d && R.hvToRe[d.drawing];
    if (!rule) { out.why = 'No separation rule for ' + (d ? d.drawing : hv.code) + ' yet.'; return out; }
    if (hv.kingbolt == null) { out.why = 'The HV king bolt height is not set.'; return out; }
    var mm, parts;
    if (rule.lvKb != null) { mm = rule.lvKb; parts = [rule.ref]; }
    else if (!re) { var nr = R.noRe[d.drawing] || R.noRe['default']; mm = rule.mm + nr.mm; parts = [rule.ref, nr.ref]; }
    else if (/^AB/i.test(c.code || '')) { mm = rule.mm + R.abc.mm; parts = [rule.ref, R.abc.ref]; }
    else {
      var t = reCondText(id, re), k = Object.keys(R.bare).filter(function (x) { return new RegExp(R.bare[x].match, 'i').test(t); })[0];
      if (!k) { out.why = t ? 'Running earth conductor ' + t + ' is not one the rule covers for bare LV.' : 'String the running earth first: the bare LV distance below it depends on its conductor (SCAC/SCGZ or AAAC).'; return out; }
      mm = rule.mm + R.bare[k].mm; parts = [rule.ref, R.bare[k].ref];
    }
    out.value = Math.round((hv.kingbolt - mm / 1000) * 1000) / 1000;
    out.src = 'DCSH ' + parts.join('; ') + ': ' + mm + ' mm below the ' + hv.code + ' king bolt' + (re ? '' : ' (no RE)');
    return out;
  }
  // Default king bolt for a construction added below the ones on the pole: LV under HV follows the separation rule when it applies.
  function hvlvRule() { return window.PNW_HVLV || null; }
  // Running earth under HV: the HV drawing's distance from its reference point. With no HV there is no rule (flagged).
  function reRule(id, cons) {
    var hv = cons.filter(function (x) { return circuitClass(x.code) === 'hv'; })[0], R = hvlvRule(); if (!hv || !R || hv.kingbolt == null) return null;
    var d = M.dcshFor(dcshReg(), hv.code)[0], rule = d && R.hvToRe[d.drawing]; if (!rule) return null;
    return { value: Math.round((hv.kingbolt - rule.mm / 1000) * 1000) / 1000, src: 'DCSH ' + rule.ref + ': ' + rule.mm + ' mm below the ' + hv.code + ' king bolt' };
  }
  function kbFor(id, code, hag, cons) {
    var list = (cons || []).filter(function (c) { return c.kingbolt != null; }).sort(function (a, b) { return b.kingbolt - a.kingbolt; }), low = list.length ? list[list.length - 1].kingbolt : null;
    var r = circuitClass(code) === 'earth' ? reRule(id, list) : lvRule(id, list.concat([{ code: code, kingbolt: null }]), list.length);
    if (r && r.value != null && (low == null || r.value < low)) return { value: r.value, below: low != null ? Math.round((low - r.value) * 1000) / 1000 : null, source: r.src };
    return kbDefault(code, hag, low);
  }
  function lvRuleHint(id, cons, i, u) {
    var r = lvRule(id, cons, i), c = cons[i]; if (!r || r.value == null) return '';
    return Math.abs(r.value - (c.kingbolt || 0)) > 0.0005 ? '' : '<p class="hint ok">LV height matches ' + esc(r.src) + '.</p>'; // a different height is offered by the default hint above
  }
  function tagS(t) { return '<span class="tag src">' + t + '</span>'; }
  function fact(k, v, cls, title) { return '<div class="fact ' + (cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><small>' + k + '</small><b>' + (v == null || v === '' ? '<span class="muted">–</span>' : esc(v)) + '</b></div>'; }
  var INS_TABS = [['design', 'Constructions'], ['conductors', 'Conductors'], ['photo', '✨ AI photo'], ['checks', 'Checks'], ['pole', 'Pole details']];
  // Pole length for a pole that has no design row: a length typed or fixed here is kept in the profiles' lengths
  // (the active profile and every profile with the pole), which the ground profile build reads.
  function lenOv(id) { var qs = [prof()].concat(S.profiles); for (var i = 0; i < qs.length; i++) { var v = qs[i].lengths && qs[i].lengths[id]; if (v != null && v !== '') return PNW.num(v); } return null; }
  function setLenOv(id, v) { S.profiles.forEach(function (q, k) { if (k === S.active || q.poleIds.indexOf(id) >= 0) { q.lengths = q.lengths || {}; if (v == null) delete q.lengths[id]; else q.lengths[id] = v; } }); }
  function badLen(L) { return !(L > 0) || L > 40; }
  function prowOf(id) { return project ? project.poles.filter(function (x) { return x.ID === id; })[0] || null : null; }
  function curLen(id) { var pr = prowOf(id); if (pr) return PNW.num(pr.Length); var o = lenOv(id); if (o != null) return o; var p = merged.poles[id]; return p ? PNW.existingLength(p).value : null; }
  function typeOf(id) { var L = curLen(id), pt = null; try { pt = poleTypeFor(id, badLen(L) ? null : L); } catch (e) { pt = null; } return pt && pt.length > 0 ? pt : null; }
  // Auto fix: pole length (and setting depth) from the pole type. ids: poles to fix; only lengths that differ from the type change.
  function fixFromType(ids) {
    var done = [], dsg = [];
    ids.forEach(function (id) { var pt = typeOf(id), L = curLen(id); if (!pt || (!badLen(L) && Math.abs(L - pt.length) < 0.005)) return; if (prowOf(id)) dsg.push([id, pt]); else { setLenOv(id, pt.length); done.push(id + ' ' + pt.length + ' m'); } });
    if (dsg.length) commit(function (p) { return dsg.map(function (x) { var r = p.poles.filter(function (q) { return q.ID === x[0]; })[0], from = r.Length; M.updatePole(p, x[0], { length: x[1].length, sunk: x[1].sinking != null ? x[1].sinking : defaultSunk(x[1].length) }); done.push(x[0] + ' ' + x[1].length + ' m'); return logEntry(x[0], '', 'Pole length', from, String(x[1].length), 'manual', 'From pole type ' + x[1].code); }); });
    else if (done.length) { S.generated = false; recompute(); }
    setStatus(done.length ? 'Length from pole type: ' + done.join(', ') + '.' : 'Nothing to fix: the lengths already match their pole types (or no pole type is known).', done.length ? 'good' : 'bad');
  }
  function lenFixList() { return Object.keys(merged.poles).filter(function (id) { return merged.poles[id].survey && badLen(curLen(id)) && typeOf(id); }); }
  function renderSelected() { renderSelectedInner(); renderCtx(); postSelected(); }
  function renderSelectedInner() {
    if (S.multi && S.multi.length > 1) { $('insTitle').textContent = S.multi.length + ' poles selected'; $('insZoom').hidden = true; $('insClear').hidden = false; $('selected').innerHTML = multiPane(); return; }
    if (S.selSpan && !S.selected) { $('insTitle').textContent = 'Span ' + S.selSpan.a + ' → ' + S.selSpan.b; $('insZoom').hidden = false; $('insClear').hidden = false; $('selected').innerHTML = spanPane(); return; }
    var id = S.selected, p = id && merged.poles[id];
    $('insTitle').textContent = p ? 'Pole Details' : 'Project summary';
    $('insZoom').hidden = $('insClear').hidden = !p;
    var xp = !p && id ? xPole(id) : null;
    if (xp) { $('insTitle').textContent = 'Pole ' + id; $('insZoom').hidden = $('insClear').hidden = false; $('selected').innerHTML = xPolePane(id, xp); return; }
    if (!p) { if (id) S.selected = null; $('selected').innerHTML = projectSummary(); return; }
    var r = built && built.rows.filter(function (x) { return x.id === id; })[0], inProf = prof().poleIds.indexOf(id) >= 0, ex = PNW.existingLength(p);
    var prow = project && project.poles.filter(function (x) { return x.ID === id; })[0];
    var cons = (dm && dm.byPole[id]) || [], chk = poleChecks(id), ne = chk.filter(function (c) { return c.level === 'error'; }).length;
    var L = prow ? PNW.num(prow.Length) : r && r.length != null ? r.length : lenOv(id) != null ? lenOv(id) : ex.value, hag = prow ? PNW.num(prow.HeightAG) : r ? r.height : null, sunk = prow ? PNW.num(prow.Sunk) : r ? r.sunk : null;
    if (!prow && !badLen(L)) { if (sunk == null) sunk = defaultSunk(L); if (hag == null) hag = Math.round((L - sunk) * 100) / 100; }
    var ch = prow ? PNW.num(prow.Distance) : r ? r.chainage : null, gl = p.survey ? p.survey.elevation : null;
    // Header: ID, new or existing, one status chip (the same on every section).
    var h = '<div class="inspane pd-head"><div class="ins-title"><b>' + esc(id) + '</b>' +
      (prow ? '<label class="pill ' + (prow.New === 'True' ? 'info' : 'mute') + ' pd-new" title="Tick for a new pole"><input type="checkbox" data-pnew' + (prow.New === 'True' ? ' checked' : '') + '> New</label>' : p.survey ? '' : '') +
      (inProf ? '' : p.survey ? '<button class="btn small primary" id="selAdd" title="Add this pole to the ground profile">＋ Profile</button>' : '<span class="pill mute">Not in profile</span>') +
      '<button class="pd-chip ' + (ne ? 'bad' : chk.length ? 'warn' : 'ok') + '" data-instab="checks" title="' + esc(chk.length ? chk.map(function (c) { return c.text; }).join('\n') : 'No design checks to look at') + '">' + (chk.length ? '⚠ ' + chk.length : '✓') + '</button></div>';
    // Key facts: pole inputs first (edited in place), then the numbers a designer reads.
    var pt = null; try { pt = poleTypeFor(id, L); } catch (e) { pt = null; }
    var ptSet = (S.design.poleTypes || {})[id];
    var kf = function (k, v, t) { return '<div class="kf"' + (t ? ' title="' + esc(t) + '"' : '') + '><small>' + k + '</small><b>' + (v == null || v === '' ? '<span class="muted">–</span>' : v) + '</b></div>'; };
    var ids = lineIds(), k = ids.indexOf(id), A = k > 0 && poleXY(ids[k - 1]), B = poleXY(id), spanB = A && B ? Math.hypot(A.e - B.e, A.n - B.n) : r && r.span != null ? r.span : null, dev = deviationAt(id);
    h += '<div class="kfs">';
    if (prow) h += '<div class="kf kf-type"><small>Pole type</small><select data-ptype="' + esc(id) + '" title="PNW library pole type">' + poleTypeOptions(ptSet || '', pt ? 'Auto: ' + esc(pt.code) : 'Not set') + '</select><button class="kf-str' + ((S.design.poleLib || {})[id] ? ' done' : '') + '" data-pstropen="' + esc(id) + '" title="' + ((S.design.poleLib || {})[id] ? 'Saved as pole type ' + esc(S.design.poleLib[id].code) + '. Click to recalculate. ' : '') + 'Open the pole strength calculation from the inspection data (PNW limit state method)">' + ico('shield-check') + ' Strength</button></div>' +
      '<div class="kf"><small>Length</small><input data-pfield="length" value="' + esc(prow.Length) + '" inputmode="decimal" aria-label="Pole length (m)"></div><div class="kf"><small>Depth</small><input data-pfield="sunk" value="' + esc(prow.Sunk) + '" inputmode="decimal" aria-label="Setting depth (m)"></div>';
    else h += '<div class="kf kf-type"><small>Pole type</small><select data-ptype2="' + esc(id) + '" title="PNW library pole type (sets the length)">' + poleTypeOptions(ptSet || '', pt ? 'Auto: ' + esc(pt.code) : 'Not set') + '</select></div>' +
      '<div class="kf"' + (ex.source && lenOv(id) == null ? ' title="From ' + esc(ex.source) + '"' : '') + '><small>Length</small><input data-plen2 value="' + (L != null ? esc(L) : '') + '" inputmode="decimal" aria-label="Pole length (m)"' + (badLen(L) ? ' class="bad" title="Not a valid pole length"' : '') + '></div>' + kf('Depth', sunk != null ? fmt(sunk) + ' m' : '', '10% of length + 0.6 m');
    if (pt && (badLen(L) || Math.abs(L - pt.length) >= 0.005)) h += '<button class="btn small pd-fix" data-pfix="' + esc(id) + '" title="Set the length' + (prow ? ' and setting depth' : '') + ' from pole type ' + esc(pt.code) + '">⟲ Auto fix: ' + esc(pt.length) + ' m from ' + esc(pt.code) + '</button>';
    h += kf('Above ground', hag != null ? f2(hag, 2) + ' m' : '') + kf('Ground RL', gl != null ? f2(gl, 2) : '', 'LiDAR elevation') + kf('Chainage', ch != null ? f2(ch, 2) : '') + kf('Span back', spanB != null ? f2(spanB, 2) + ' m' : '', k > 0 ? 'From ' + ids[k - 1] : 'First pole of the line') + kf('Deviation', dev != null ? f2(dev, 1) + '°' : '', 'Line deviation angle at this pole');
    var tr = null; try { tr = project && dm && tipSet().cases.length && tipPoles().indexOf(id) >= 0 ? tipCalc(id) : null; } catch (e) { tr = null; }
    if (tr && tr.results.length) {
      var w = tr.results.slice().sort(function (a, b) { return (b.pctHor || 0) - (a.pctHor || 0) || b.load - a.load; })[0];
      h += '<button class="pd-tip kf-tip" data-tipopen="' + esc(id) + '" title="Worst load case. Click to open the tipload.">Tipload <b>' + (w.pctHor != null ? f2(w.pctHor, 0) + '%' : f2(w.load) + ' kN') + '</b> ' + tipBadge(w) + '<small>' + esc(w.name) + (unverifiedFor(id) ? ' · provisional' : '') + '</small></button>';
    }
    h += '</div></div>';
    h += xBanner(id);
    var nOpen = p.defects.filter(defectOpen).length, nConf = chk.filter(function (c) { return c.conflict; }).length;
    var secs = [['design', 'Constructions', project ? cons.length : null]];
    if (S.selSection) secs.push(['cond', 'Conductor · ' + esc(S.selSection), null]);
    if (project && prow) { var xx = extras(id); secs.push(['equip', 'Stays & plant', xx.stays.length + xx.plant.length]); }
    if (U.insTab === 'photo' || aiResults[id]) secs.push(['photo', '✨ AI photo', null]);
    if (U.insTab === 'pstr' || (S.design.poleLib || {})[id]) secs.push(['pstr', 'Pole strength', null, (S.design.poleLib || {})[id] ? f2(S.design.poleLib[id].ultimate, 2) + ' kN' : '']);
    secs.push(['checks', 'Checks', chk.length]);
    secs.push(['pole', 'Survey & asset', null, [nConf ? nConf + ' conflict' + (nConf > 1 ? 's' : '') : '', nOpen ? nOpen + ' open defect' + (nOpen > 1 ? 's' : '') : ''].filter(Boolean).join(' · ')]);
    var paneOf = function (tab) {
      if (tab === 'cond') return conductorPane(S.selSection);
      if (tab === 'equip') return extrasHtml(id, prow);
      if (tab === 'design') return designPanel(id);
      if (tab === 'pstr') return strPane(id);
      if (tab === 'photo') return project && prow ? aiPanel(id, cons.slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); })) : '<p class="hint">AI photo match works on a design: ' + (project ? esc(id) + ' is not in the linked PNW project.' : 'link a PNW project first.') + '</p>' + (project ? '' : startDesignHint());
      if (tab === 'checks') return chk.length ? '<ul class="pd-chk">' + chk.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text) + (c.fix != null ? ' <button class="btn small" data-cdef="' + esc(c.u) + '" data-v="' + c.fix + '" data-ref="' + esc(c.ref || '') + '">Use ' + c.fix + ' m</button>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="pd-none">Nothing to check on ' + esc(id) + '.</p>';
      return polePane(id, p, r, inProf, ex, chk);
    };
    h += secHtml(secs, paneOf);
    $('selected').innerHTML = h + '</div>';
    if (secScroll) { var se = $('selected').querySelector('[data-pdsec="' + secScroll + '"]'); secScroll = null; if (se) se.scrollIntoView({ block: 'start' }); }
    if ($('selAdd')) $('selAdd').onclick = function () { var ids = prof().poleIds; ids.push(id); prof().poleIds = PNW.autoOrder(merged.poles, ids); S.generated = false; recompute(); setStatus(id + ' added and the profile re-ordered along the line. Use ↑ ↓ to adjust.', 'good'); };
    if ($('selRemove')) $('selRemove').onclick = function () { prof().poleIds = prof().poleIds.filter(function (x) { return x !== id; }); S.generated = false; recompute(); };
  }
  function xPolePane(id, xp) {
    var q = xp.pole, cons = (xp.line.dm.byPole[id] || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); }), shared = Object.keys(xp.line.common).map(function (k) { return xp.line.common[k].id; });
    var h = '<div class="inspane"><div class="ins-title"><b>' + esc(id) + '</b><span class="pill info" style="background:#ede9fe;color:#5b21b6">Intersecting line</span>' + (q.isNew ? '<span class="pill info">New pole</span>' : '') + '</div>' +
      '<p class="meta">' + esc(xp.line.title) + ' · meets the design at ' + esc(shared.join(', ')) + '</p><div class="facts">' + fact('Chainage (m)', fmt(q.chainage, 2)) + fact('Pole length (m)', fmt(q.length)) + fact('Above ground (m)', fmt(q.height)) + fact('Setting depth (m)', fmt(q.sunk)) + fact('Ground level (m)', fmt(q.ground, 2)) + fact('Constructions', cons.length) + '</div>';
    if (cons.length) h += '<table class="att"><tr><th>Construction</th><th class="num">Height AG (m)</th></tr>' + cons.map(function (c) { return '<tr><td>' + esc(c.descr || c.code) + '</td><td class="num">' + (c.kingbolt != null ? c.attachments.map(function (a) { return fmt(Math.round((c.kingbolt + a.y) * 1000) / 1000); }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(' / ') || fmt(c.kingbolt) : '–') + '</td></tr>'; }).join('') + '</table>';
    return h + '<div class="btnrow"><button class="btn small primary" data-xuse="' + esc(xp.line.name) + '">Edit this line as the design</button></div></div>';
  }
  /* stays and pole-mounted plant: kept with the design (PNW stores them in the tipload project, not the profile) */
  // Transformer arrangements (hanger height below the tip) come from the DCSH register's "plant" list, read from the drawings.
  // More arrangements read from the DCSH Part 4 drawings (2026-11-04): only drawings whose transformer support is
  // dimensioned from the top of the pole. Not added: H21 (no Tx support line), H24 and H47-3 (support not labelled),
  // H47-2 (measured from the king bolt), H48-1/H48-2 (mounting details only), H111/H112 (bracket spacing not dimensioned).
  var TX_EXTRA = [
    ['H10-2', 'Intermediate transformer HV to ABC (H10-2)', 3.115, 'DCSH H10-2 Rev N: 230 + 635 + 2250 from the tip to the Tx top bolt; RE 1500 below the DOF arm; LV king bolt 400 below the Tx top bolt', { hv: 0.23, re: 2.365, lv: 3.515 }],
    ['H11-2', 'Side mounted termination transformer with DOF (H11-2)', 2.5, 'DCSH H11-2 Rev I: Tx support 2500 below the top of pole; RE 900 below the Tx support', { hv: 0.23, re: 3.4 }],
    ['H11-3', 'Side mounted termination transformer strain (H11-3)', 2.575, 'DCSH H11-3 Rev D: 540 + 635 + 890 + 510 from the top of pole to the Tx support; RE 510 above it', { hv: 0.23, re: 2.065 }],
    ['H17-4', 'Transformer cable supplied (H17-4)', 2.5, 'DCSH H17-4 Rev D: 2500 from the top of pole to the transformer', {}],
    ['H20-1', 'Isolation transformer (H20-1)', 1.9, 'DCSH H20-1 Rev E: centre of the isolation transformer hanger bracket 1900 below the top of pole', {}],
    ['H20-2', 'Isolation tx 3ph termination, 1ph in-line without DOF (H20-2)', 3.71, 'DCSH H20-2 Rev F: 230 + 230 + 1000 + 1500 to the RE, 750 to the Tx support', { hv: 0.23, re: 2.96 }],
    ['H20-3', 'Isolation tx 3ph termination, 1ph in-line with DOF (H20-3)', 3.29, 'DCSH H20-3 Rev E: 230 + 80 + 230 + 1000 + 1500 to the RE, 250 to the Tx support', { hv: 0.23, re: 3.04 }],
    ['H20-4', 'Isolation tx 3ph termination, 1ph in-line with/without DOF (H20-4)', 3.71, 'DCSH H20-4 Rev E: 460 + 1000 + 1500 to the RE, 750 to the Tx support', { re: 2.96 }],
    ['H20-5', 'Isolation tx 3ph cable / 1ph tee-off with DOF (H20-5)', 3.03, 'DCSH H20-5 Rev G: 330 + 500 + 700 + 1500 to the Tx support; RE 1200 below the phase conductor (230)', { hv: 0.23, re: 1.43 }],
    ['H20-6', 'Isolation tx 3ph in-line / 1ph tee-off without DOF (H20-6)', 3.31, 'DCSH H20-6 Rev E: 230 + 830 + 1500 to the RE, 750 to the Tx support', { hv: 0.23, re: 2.56 }],
    ['H20-7', 'Isolation tx 3ph termination / 1ph cable with DOF (H20-7)', 3.71, 'DCSH H20-7 Rev E: 230 + 230 + 1000 + 1500 to the RE, 750 to the Tx support', { hv: 0.23, re: 2.96 }],
    ['H25', 'Intermediate transformer wishbone (H25)', 5.13, 'DCSH H25 Rev C: 380 + 750 + 1000 + 750 + 2250 from the top of pole to TX1/TX2; LV 1200 below', { lv: 6.33 }],
    ['H46-1', 'Single phase intermediate transformer without DOF (H46-1)', 1.81, 'DCSH H46-1 Rev J: 230 + 230 + 1350 to the Tx support (without dropout fuse); RE 350 below the 460 line; LV 1200 below', { hv: 0.23, re: 0.81, lv: 3.01 }],
    ['H46-1 DOF', 'Single phase intermediate transformer with DOF (H46-1)', 1.96, 'DCSH H46-1 Rev J: 230 + 230 + 1500 to the Tx support (with dropout fuse); RE 350 below the 460 line; LV 1200 below', { hv: 0.23, re: 0.81, lv: 3.16 }],
    ['H46-2', '3 phase no RE / 2 phase transformer with DOF (H46-2)', 2.33, 'DCSH H46-2 Rev B: 230 + 600 + 1500 from the top of pole to the Tx support', { hv: 0.23 }],
    ['H47-1', 'Single phase termination transformer (H47-1)', 1.68, 'DCSH H47-1 Rev G: 230 + 300 + 900 + 250 from the top of pole to the Tx support', { hv: 0.23 }],
    ['H47-4', 'Single phase cable termination and transformer (H47-4)', 1.78, 'DCSH H47-4 Rev B: 230 + 300 + 330 + 570 to the running earth, 350 to the Tx support', { hv: 0.23, re: 1.43 }]
  ];
  function txArr() { var r = dcshReg(), out = r && r.plant ? r.plant.filter(function (p) { return p.kind === 'transformer'; }).map(function (p) { return { id: p.id, title: p.title || p.id, below: p.hangerBelowTip, ref: p.ref || 'DCSH ' + p.id }; }) : []; TX_EXTRA.forEach(function (t) { if (!out.some(function (o) { return o.id === t[0]; })) out.push({ id: t[0], title: t[1], below: t[2], ref: t[3] }); }); return out; }
  function extras(id) { var x = S.design.extras || (S.design.extras = {}); return x[id] || (x[id] = { stays: [], plant: [] }); }
  function bearing(a, b) { var d = Math.atan2(b.easting - a.easting, b.northing - a.northing) * 180 / Math.PI; return Math.round(((d % 360) + 360) % 360 * 10) / 10; }
  // Neighbours along the design line, to point a stay away from the conductor pull and a transformer toward the line.
  function lineDirs(id) {
    var ps = dm ? dm.allPoles.filter(function (p) { return isFinite(p.easting) && isFinite(p.northing); }) : [], i = ps.findIndex(function (p) { return p.id === id; });
    if (i < 0) return null;
    var me = ps[i], nb = [ps[i - 1], ps[i + 1]].filter(Boolean);
    xLines.forEach(function (x) { var k = x.dm.allPoles.findIndex(function (p) { return (x.common[p.id] && x.common[p.id].id === id) || p.id === id; }); if (k >= 0) [x.dm.allPoles[k - 1], x.dm.allPoles[k + 1]].forEach(function (q) { if (q && isFinite(q.easting)) nb.push(q); }); });
    if (!nb.length) return null;
    var sx = 0, sy = 0; nb.forEach(function (q) { var L = Math.hypot(q.easting - me.easting, q.northing - me.northing) || 1; sx += (q.easting - me.easting) / L; sy += (q.northing - me.northing) / L; });
    var pull = Math.hypot(sx, sy) > 0.05 ? bearing(me, { easting: me.easting - sx, northing: me.northing - sy }) : null;
    return { stay: pull, toLine: bearing(me, nb[0]) };
  }
  // Plant code drop-down grouped like the PNW database: three-phase and single-phase transformers, then switchgear and reclosers.
  function plantSelect(key, cur) {
    var ks = Object.keys(PLANT_DB), g = [['3-phase transformers', function (k) { return /XT/i.test(k.replace(/[^A-Za-z0-9]/g, '')) && /3\s*ph/i.test(k) && !/GS|RC/i.test(k); }], ['1-phase transformers', function (k) { return /XT/i.test(k.replace(/[^A-Za-z0-9]/g, '')) && /1\s*-?\s*ph/i.test(k) && !/GS|RC/i.test(k); }], ['Other transformers', function (k) { return /^\W*X\W*T/i.test(k) && !/ph/i.test(k); }], ['Switchgear, reclosers and combinations', function () { return true; }]], used = {};
    var groups = []; g.forEach(function (x) { var l = ks.filter(function (k) { return !used[k] && x[1](k); }); if (!l.length) return; l.forEach(function (k) { used[k] = 1; }); groups.push({ label: x[0], items: l.map(function (k) { var d = PLANT_DB[k]; return { value: k, label: d.weight + ' kg', keys: x[0] + (/XT/i.test(k) ? ' transformer tx' : '') }; }) }); });
    return '<span class="xarr">' + combo('plsel|' + key, { value: cur || '', placeholder: 'Search plant code…', aria: 'Plant code', groups: function () { return groups; }, emptyText: 'no PNW plant database loaded.', onPick: function (v) { xfChange({ target: { dataset: { xf: key }, value: v } }); } }) + '</span>';
  }
  function extrasHtml(id, row) {
    var x = extras(id), hag = PNW.num(row.HeightAG), cons = ((dm && dm.byPole[id]) || []).filter(function (c) { return c.kingbolt != null; }).sort(function (a, b) { return b.kingbolt - a.kingbolt; });
    var wires = lib && lib.stays && lib.stays.length ? lib.stays.map(function (w) { return w.code || w.Code; }) : [];
    var h = '<div class="con"><div class="con-title">Stays and plant</div>';
    x.stays.forEach(function (st, i) {
      h += '<div class="xrow"><b>Stay ' + (i + 1) + '</b><label>Wire <select data-xf="stays|' + i + '|wire">' + wires.concat(wires.indexOf(st.wire) < 0 && st.wire ? [st.wire] : []).map(function (w) { return '<option' + (w === st.wire ? ' selected' : '') + '>' + esc(w) + '</option>'; }).join('') + '</select></label>' +
        '<label>Height AG (m) <input data-xf="stays|' + i + '|attHt" value="' + fmt(st.attHt) + '" inputmode="decimal"></label><label title="Bearing from the pole to the anchor, degrees from grid north">Bearing (°) <input data-xf="stays|' + i + '|dir" value="' + fmt(st.dir) + '" inputmode="decimal"></label>' +
        '<label title="Angle between the stay wire and the ground (PNW stay angle)">Angle to ground (°) <input data-xf="stays|' + i + '|angle" value="' + fmt(st.angle) + '" inputmode="decimal"></label><label title="Include this stay in the tipload"><input type="checkbox" data-xf="stays|' + i + '|include"' + (st.include !== false ? ' checked' : '') + '> In tipload</label>' + binBtn('data-xdel="stays|' + i + '"', 'Remove stay ' + (i + 1)) + '' +
        (st.ref ? '<small class="muted">' + esc(st.ref) + '</small>' : '') + '</div>';
    });
    x.plant.forEach(function (pl, i) {
      var arr = txArr().filter(function (a) { return a.id === pl.drawing; })[0], db = plantData(pl.code);
      h += '<div class="xrow">' + (arr ? dcshThumb(arr.id) : '') + '<b>Transformer</b><label>Code ' + plantSelect('plant|' + i + '|code', pl.code) + '</label>' +
        '<label class="xarr">Arrangement ' + combo('xfarr|' + i, { value: pl.drawing || '', placeholder: 'Search arrangement…', aria: 'Transformer arrangement', groups: (function () { return function () { return [{ label: 'DCSH Part 2 arrangements', items: txArr().map(function (a) { return { value: a.id, label: a.title, note: a.ref + (a.below != null ? ' · hanger ' + a.below + ' m below tip' : ''), keys: 'transformer tx' }; }) }]; }; })(), emptyText: 'no DCSH transformer arrangements loaded.', onPick: (function (k) { return function (v) { xfChange({ target: { dataset: { xf: 'plant|' + k + '|drawing' }, value: v } }); }; })(i) }) + '</label>' +
        '<label>Hanger height AG (m) <input data-xf="plant|' + i + '|attHt" value="' + fmt(pl.attHt) + '" inputmode="decimal"></label><label title="Bearing from the pole to the transformer, degrees from grid north">Bearing (°) <input data-xf="plant|' + i + '|dir" value="' + fmt(pl.dir) + '" inputmode="decimal"></label>' +
        '<label title="Plant weight from the PNW plant database">Weight (kg) <input data-xf="plant|' + i + '|weight" value="' + fmt(pl.weight) + '" placeholder="' + esc(db ? db.weight : '') + '" inputmode="decimal"></label><label title="Centre of mass distance from the side of the pole (PNW 7 plant offset)">Offset from pole (m) <input data-xf="plant|' + i + '|offset" value="' + fmt(pl.offset) + '" placeholder="' + esc(db ? db.offset : '') + '" inputmode="decimal"></label><label title="Area facing the wind">Wind area (m²) <input data-xf="plant|' + i + '|area" value="' + fmt(pl.area) + '" placeholder="' + esc(db ? db.area : '') + '" inputmode="decimal"></label><label><input type="checkbox" data-xf="plant|' + i + '|include"' + (pl.include !== false ? ' checked' : '') + '> In tipload</label>' + binBtn('data-xdel="plant|' + i + '"', 'Remove transformer') + '' +
        (pl.ref ? '<small class="muted">' + esc(pl.ref) + '</small>' : '') + (db && (pl.weight == null || pl.weight === '') ? '<small class="muted">Tipload uses ' + db.weight + ' kg, ' + db.offset + ' m, ' + db.area + ' m²: ' + esc(db.source) + '</small>' : !db && (pl.weight == null || pl.weight === '') ? '<small class="muted">Enter weight, offset and wind area from the PNW plant database to include it in the tipload.</small>' : '') + '</div>';
    });
    if (!x.stays.length && !x.plant.length) h += '<p class="meta">No stays or plant on ' + esc(id) + '.</p>';
    h += '<div class="btnrow"><button class="btn small" data-xadd="stay"' + (cons.length ? '' : ' disabled title="Add a construction first: the stay goes 300 mm below its king bolt"') + '>Add stay</button><button class="btn small" data-xadd="plant"' + (hag != null ? '' : ' disabled') + '>Add transformer</button></div></div>';
    return h;
  }
  // Re-place HV, RE and LV to the transformer arrangement (DCSH H10-1 / H11-1, measured from the tip), then the stays.
  var TX_POS = { 'H10-1': { hv: 0.23, re: 2.365, lv: 4.315, ref: 'DCSH H10-1 Rev L: top king bolt 230 below the tip, RE 635 + 1500 below it, LV crossarm 1200 below the hanger arm' },
    'H11-1': { hv: 0.23, re: 2.5, lv: null, ref: 'DCSH H11-1 Rev K: top king bolt 230 below the tip, RE 2500 below the tip, LV below the RE per H01-1 note 5/6 (note 4)' } };
  TX_EXTRA.forEach(function (t) { if (t[4] && (t[4].hv != null || t[4].re != null || t[4].lv != null)) TX_POS[t[0]] = Object.assign({ hv: null, re: null, lv: null, ref: t[3] }, t[4]); });
  function reLvMm(id, cons, re, lv) {
    var R = hvlvRule(); if (!R) return null;
    if (!re) return R.noRe['default'].mm;
    if (/^AB/i.test(lv.code || '')) return R.abc.mm;
    var t = reCondText(id, re), k = Object.keys(R.bare).filter(function (x) { return new RegExp(R.bare[x].match, 'i').test(t); })[0];
    return k ? R.bare[k].mm : null;
  }
  function reattach(id, drawing) {
    var pos = TX_POS[drawing], row = project.poles.filter(function (r) { return r.ID === id; })[0], hag = PNW.num(row && row.HeightAG); if (!pos || !(hag > 0)) return;
    var cons = ((dm && dm.byPole[id]) || []).filter(function (c) { return c.kingbolt != null; }).sort(function (a, b) { return b.kingbolt - a.kingbolt; }), r3 = function (v) { return Math.round(v * 1000) / 1000; };
    var hv = cons.filter(function (c) { return circuitClass(c.code) === 'hv'; }), re = cons.filter(function (c) { return /^RE/i.test(c.code || ''); }), lv = cons.filter(function (c) { return circuitClass(c.code) === 'lv'; }), mv = [], note = '';
    function shift(list, top) { if (!list.length) return; var d = r3(top - list[0].kingbolt); list.forEach(function (c) { if (Math.abs(d) > 0.0005) mv.push({ c: c, v: r3(c.kingbolt + d) }); }); }
    if (hv.length && pos.hv != null) shift(hv, hag - pos.hv);
    if (re.length && pos.re != null) shift(re, hag - pos.re);
    if (lv.length) {
      var lvTop = pos.lv != null ? hag - pos.lv : null, mm = reLvMm(id, cons, re[0], lv[0]), reAt = re.length && pos.re != null ? hag - pos.re : null;
      if (mm != null && reAt != null) lvTop = lvTop == null ? reAt - mm / 1000 : Math.min(lvTop, reAt - mm / 1000);
      else if (mm != null && lvTop == null && pos.re != null) lvTop = hag - pos.re - mm / 1000;
      if (lvTop == null) note = ' LV not moved: string the running earth first (its conductor sets the LV distance).';
      else if (lvTop < 2) note = ' LV not moved: the pole is too short for ' + drawing + ' (12.5 m pole minimum).';
      else shift(lv, lvTop);
    }
    var low = {}; mv.forEach(function (m) { low[m.c.unique] = m.v; });
    var kb = function (c) { return low[c.unique] != null ? low[c.unique] : c.kingbolt; }, top = cons[0], x = extras(id), sl = [];
    x.stays.forEach(function (st, i) { var on = cons.filter(function (c) { return c.unique === st.on; })[0] || top; if (!on) return; var v = r3(kb(on) - 0.3); if (Math.abs(v - st.attHt) > 0.0005) { sl.push(logEntry(id, 'Stay ' + (i + 1), 'Height AG', st.attHt + ' m', v + ' m', 'calculated', '300 mm below the ' + (on.descr || on.code) + ' king bolt after ' + drawing)); st.attHt = v; st.on = on.unique; } });
    if (mv.length) commit(function (p) { return mv.map(function (m) { M.updateConstruction(p, m.c.unique, { kingbolt: m.v }); return logEntry(id, m.c.descr, 'King bolt', m.c.kingbolt + ' m', m.v + ' m', 'calculated', pos.ref); }).concat(sl); });
    else if (sl.length) { S.design.log = liveLog().concat(sl); recompute(); }
    setStatus(mv.length || sl.length ? 'Re-attached ' + mv.length + ' construction' + (mv.length === 1 ? '' : 's') + (sl.length ? ' and ' + sl.length + ' stay' + (sl.length === 1 ? '' : 's') : '') + ' to ' + drawing + '.' + note : 'Constructions already match ' + drawing + '.' + note, note ? 'bad' : 'good');
  }
  function addExtra(id, kind) {
    var row = project.poles.filter(function (r) { return r.ID === id; })[0], hag = PNW.num(row.HeightAG), dirs = lineDirs(id) || {}, x = extras(id), entry, what;
    if (kind === 'stay') {
      var top = ((dm && dm.byPole[id]) || []).filter(function (c) { return c.kingbolt != null; }).sort(function (a, b) { return b.kingbolt - a.kingbolt; })[0];
      entry = { wire: lib && lib.stays && lib.stays.length ? (lib.stays[0].code || lib.stays[0].Code) : '', attHt: Math.round((top.kingbolt - 0.3) * 1000) / 1000, dir: dirs.stay != null ? dirs.stay : 0, angle: 45,
        on: top.unique, ref: 'Height: 300 mm below the ' + (top.descr || top.code) + ' king bolt (DCSH H01-1 / L03; your S1242155 tipload uses the same). Bearing: away from the conductors. Angle 45° as in your S1242155 tipload.' };
      x.stays.push(entry); what = 'Stay';
    } else {
      var tx = txArr(), term = dm && (dm.byPole[id] || []).some(function (c) { return /termination/i.test(c.code + ' ' + (M.libraryConstruction(lib, c.code) || {}).description); }), a = tx.filter(function (t) { return term ? /termination/i.test(t.title) : !/termination/i.test(t.title); })[0] || tx[0];
      entry = { code: 'X T 0127-3Ph', drawing: a.id, attHt: Math.round((hag - a.below) * 1000) / 1000, dir: dirs.toLine != null ? dirs.toLine : 0, ref: a.ref + '. Pick the size from the PNW plant list (Code).' };
      x.plant.push(entry); what = 'Transformer';
    }
    S.design.log = liveLog().concat([logEntry(id, what, what, '', kind === 'stay' ? entry.wire + ' at ' + entry.attHt + ' m, ' + entry.dir + '°' : entry.code + ' (' + entry.drawing + ') at ' + entry.attHt + ' m', 'calculated', entry.ref)]);
    recompute();
    if (kind !== 'stay') reattach(id, entry.drawing);
  }
  $('selected').addEventListener('click', function (e) {
    var a = e.target.closest('[data-xadd]'), d = e.target.closest('[data-xdel]'), id = S.selected;
    if (a) { addExtra(id, a.dataset.xadd); return; }
    if (d) { var k = d.dataset.xdel.split('|'), x = extras(id), it = x[k[0]].splice(+k[1], 1)[0]; S.design.log = liveLog().concat([logEntry(id, k[0] === 'stays' ? 'Stay' : 'Transformer', 'Removed', JSON.stringify(it), '', 'manual', '')]); recompute(); }
  });
  $('selected').addEventListener('change', function (e) { xfChange(e); });
  function xfChange(e) {
    var f = e.target.dataset && e.target.dataset.xf; if (!f) return;
    var k = f.split('|'), it = extras(S.selected)[k[0]][+k[1]], v = e.target.value, before = it[k[2]];
    if (k[2] === 'include') v = e.target.checked;
    else if (k[2] === 'weight' || k[2] === 'offset' || k[2] === 'area') {
      if (v.trim() === '') v = null; else { v = Number(v); if (!isFinite(v) || v < 0 || (k[2] === 'offset' && v > 5) || (k[2] === 'area' && v > 20)) { setStatus('Not a valid ' + (k[2] === 'weight' ? 'weight (kg)' : k[2] === 'offset' ? 'offset (m from the pole side)' : 'wind area (m²)') + '.', 'bad'); renderSelected(); return; } }
    } else if (k[2] === 'attHt' || k[2] === 'dir' || k[2] === 'angle') {
      v = Number(v); var hag = PNW.num((project.poles.filter(function (r) { return r.ID === S.selected; })[0] || {}).HeightAG);
      if (!isFinite(v) || (k[2] === 'attHt' && (v <= 0 || (hag != null && v > hag))) || (k[2] === 'angle' && (v < 0 || v >= 90))) { setStatus('Not a valid ' + (k[2] === 'attHt' ? 'height (above ground, below the tip)' : k[2] === 'angle' ? 'stay angle (0 to under 90°; 0 = horizontal, as PNW allows)' : 'bearing') + '.', 'bad'); renderSelected(); return; }
      if (k[2] === 'dir') v = ((v % 360) + 360) % 360;
    }
    if (k[2] === 'drawing') { var arr = txArr().filter(function (a) { return a.id === v; })[0], hg = PNW.num((project.poles.filter(function (r) { return r.ID === S.selected; })[0] || {}).HeightAG); if (arr && hg != null) { it.attHt = Math.round((hg - arr.below) * 1000) / 1000; it.ref = arr.ref; } }
    it[k[2]] = v;
    S.design.log = liveLog().concat([logEntry(S.selected, k[0] === 'stays' ? 'Stay' : 'Transformer', k[2], before, v, 'manual', '')]);
    recompute();
    if (k[2] === 'drawing') reattach(S.selected, v);
  }
  function xBanner(id) {
    var xp = xPole(id); if (!xp) return '';
    return '<div class="con"><div class="con-title">Intersecting line</div><p class="meta">' + esc(id) + ' is on ' + esc(xp.line.title) + ', which meets the design at ' + esc(Object.keys(xp.line.common).map(function (k) { return xp.line.common[k].id; }).join(', ')) + '.</p><div class="btnrow"><button class="btn small primary" data-xuse="' + esc(xp.line.name) + '">Edit this line as the design</button></div></div>';
  }
  // Survey & asset: the raw data, closed by default. Conflicts first, open defects only, source tags only where edited.
  function defectOpen(d) { return !/no longer|complete|closed|resolved|cancel|withdrawn/i.test((d.severity || '') + ' ' + (d.status || '')); }
  function dateOnly(v) { var d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-AU') : v; }
  function polePane(id, p, r, inProf, ex, chk) {
    var h = '', conf = (chk || []).filter(function (c) { return c.conflict; });
    if (conf.length) h += '<ul class="pd-chk">' + conf.map(function (c) { return '<li class="' + c.level + '">' + esc(c.text) + '</li>'; }).join('') + '</ul>';
    h += '<table class="props">';
    function row(k, v, tag) { if (v == null || v === '') return ''; h += '<tr><th>' + k + '</th><td>' + esc(v) + (tag || '') + '</td></tr>'; return ''; }
    function sec(t) { h += '<tr class="sec"><th colspan="2">' + t + '</th></tr>'; }
    if (p.survey) { sec('Survey (' + esc(p.survey.kind || 'LiDAR') + ')'); row('Easting', f2(p.survey.easting, 2)); row('Northing', f2(p.survey.northing, 2)); row('Elevation', f2(p.survey.elevation, 2)); row('LiDAR height', p.survey.lidarHeight != null ? p.survey.lidarHeight + ' m' : ''); row('Lean', p.survey.leanDeg != null ? p.survey.leanDeg + '°' : ''); row('Equipment no', p.survey.equipNo); row('Surveyed', dateOnly(p.survey.surveyed)); }
    else { sec('Survey'); row('Survey', 'No LiDAR survey row'); }
    if (!r && ex.value != null) { sec('Pole'); row('Existing length', ex.value + ' m (' + ex.source + ')'); }
    if (r && r.lengthSource === 'Edited') { sec('Ground profile'); row('Pole length', r.length + ' m', '<span class="tag edit">edited</span>'); }
    if (p.gis) { sec('GIS'); row('Description', p.gis.description); row('Length', p.gis.length != null ? p.gis.length + ' m' : ''); row('Stock', p.gis.stock); row('Species', p.gis.species); row('HV feeder', p.gis.feeder); row('LV feeder', p.gis.lvFeeder); var ll = poleLatLng(p); if (ll && p.gis.lat != null) { var off = map.distance(ll, L.latLng(p.gis.lat, p.gis.lng)); if (off > 2) row('Offset from LiDAR', off.toFixed(1) + ' m'); } }
    ['HV', 'LV'].forEach(function (l) { gisConductorsAt(id, l).forEach(function (t, k) { if (!k) sec('GIS ' + l + ' conductor'); row(t.description, gisText(t).slice(t.description.length + 4)); }); });
    if (p.insp) { sec('Latest inspection'); ['Pole Length', 'Pole Length (M)', 'Strength (kN)', 'Height Neutral Phase (m)', 'Height Running Earth (m)', 'Stay 1 Type'].forEach(function (k) { var a = p.insp.attrs[k]; if (a && a.value !== '' && a.value != null) row(k, a.value + (a.date ? ' (' + new Date(a.date).getFullYear() + ')' : '')); }); }
    var od = p.defects.filter(defectOpen);
    if (od.length) { sec('Open defects (' + od.length + ')'); od.slice(0, 8).forEach(function (d) { row(d.severity || 'Defect', d.description); }); }
    h += '</table><div class="btnrow">' + (inProf ? '<button class="btn small" id="selRemove" title="Take this pole out of the ground profile">Remove from profile</button>' : '') + (p.survey && p.survey.kind === 'Manual' ? '<button class="btn small" data-ctx="editpole">✎ Edit position…</button>' : '');
    var prow = project && project.poles.filter(function (x) { return x.ID === id; })[0];
    if (prow) h += project.segPoles.some(function (s) { return s.id === id; }) ? '' : binBtn('data-pdel="' + esc(id) + '"', 'Remove pole ' + id + ' from the design') + ' <span class="pd-none">Remove from design</span>';
    return h + '</div>';
  }
  // Checks on one pole that change the design or block a calculation. Data gaps (unmatched rows, duplicate GIS rows) stay in the Issues tab.
  var DATA_GAP = /^(unmatched|duplicate-id|invalid-coordinate|invalid-number|missing-id|unknown-file|no-geometry|missing-value)$/;
  function isGap(i) { return i.level !== 'error' && DATA_GAP.test(i.code || ''); }
  function poleChecks(id) {
    var out = [], p = merged.poles[id], prow = project && project.poles.filter(function (x) { return x.ID === id; })[0], r = built && built.rows.filter(function (x) { return x.id === id; })[0];
    allIssues.forEach(function (i) { if (i.poleId === id && (i.level === 'error' || i.level === 'warning') && !isGap(i)) out.push({ level: i.level, text: i.message, conflict: i.code === 'length-conflict' }); });
    var Lp = prow ? PNW.num(prow.Length) : r ? r.length : null, hag = prow ? PNW.num(prow.HeightAG) : r ? r.height : null;
    if (p && p.insp && !(prow && prow.New === 'True')) {
      var la = p.insp.attrs['Pole Length (M)'] || p.insp.attrs['Pole Length'], il = la ? parseFloat(la.value) : null, yr = function (a) { return a && a.date ? ' (' + new Date(a.date).getFullYear() + ')' : ''; };
      if (il > 0 && Lp > 0 && Math.abs(il - Lp) > 0.05) out.push({ level: 'warning', conflict: true, text: 'Length ' + fmt(Lp) + ' m, but the inspection says ' + il + ' m' + yr(la) + '.' });
      var sa = p.insp.attrs['Strength (kN)'], ik = sa ? parseFloat(sa.value) : null, pt = null; try { pt = poleTypeFor(id, Lp); } catch (e) { pt = null; }
      if (ik > 0 && pt && pt.kN > 0 && Math.abs(ik - pt.kN) > 0.01) out.push({ level: 'warning', conflict: true, text: 'Pole type ' + pt.code + ' is ' + pt.kN + ' kN, but the inspection says ' + ik + ' kN' + yr(sa) + '.' });
    }
    var cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
    cons.forEach(function (c, i) {
      var nm = c.descr || c.code;
      if (c.kingbolt != null && hag != null && c.kingbolt > hag) out.push({ level: 'error', u: c.unique, text: nm + ': king bolt ' + fmt(c.kingbolt) + ' m is above the pole tip (' + hag + ' m).' });
      var lr = lvRule(id, cons, i);
      if (lr && lr.value != null && c.kingbolt != null && Math.abs(lr.value - c.kingbolt) > 0.05) out.push({ level: 'warning', u: c.unique, fix: lr.value, ref: lr.src, text: nm + ': king bolt ' + fmt(c.kingbolt) + ' m; the HV–LV separation rule gives ' + lr.value + ' m.' });
      else if (lr && lr.value == null && lr.why) out.push({ level: 'warning', u: c.unique, text: nm + ' under HV: ' + lr.why });
    });
    var clr = PNW.num(S.settings.clr1), ids = lineIds(), k = ids.indexOf(id);
    if (clr > 0 && k >= 0) [[ids[k - 1], id], [id, ids[k + 1]]].forEach(function (s) { if (!s[0] || !s[1]) return; var v = null; try { v = spanClearance(s[0], s[1]); } catch (e) { v = null; } if (v != null && v < clr) out.push({ level: 'error', text: 'Ground clearance ' + v.toFixed(2) + ' m in span ' + s[0] + ' → ' + s[1] + ' (needs ' + clr + ' m).' }); });
    return out;
  }
  // Line deviation at a pole: the change of bearing between the span in and the span out.
  function deviationAt(id) {
    var ids = lineIds(), k = ids.indexOf(id); if (k <= 0 || k >= ids.length - 1) return null;
    var A = poleXY(ids[k - 1]), B = poleXY(id), C = poleXY(ids[k + 1]); if (!A || !B || !C) return null;
    var b1 = Math.atan2(B.e - A.e, B.n - A.n), b2 = Math.atan2(C.e - B.e, C.n - B.n), d = Math.abs(b2 - b1) * 180 / Math.PI;
    if (d > 180) d = 360 - d; return Math.round(d * 10) / 10;
  }
  function startDesignHint() {
    return '<p class="hint">Drop a saved PNW project (.pnwx) to edit its design, or start a new design from this ground profile.</p>' + (built && built.rows.length > 1 ? '<div class="btnrow"><button class="btn small primary" id="designStart">Start a design from this ground profile</button></div>' : '<p class="hint">Build a ground profile with at least two poles first.</p>');
  }
  // Empty state of the inspector: where the project stands and the next step.
  function projectSummary() {
    var ids = Object.keys(merged.poles), e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length;
    var steps = [
      [S.files.length > 0, 'Import the survey', S.files.length ? S.files.length + ' file' + (S.files.length > 1 ? 's' : '') + ' imported, ' + ids.length + ' poles' : 'Drop the QLINK LiDAR export and the GIS exports.', S.files.length ? '' : '<button class="btn small primary" data-act="import">Import files…</button>'],
      [!!(built && built.rows.length > 1), 'Build the ground profile', built ? built.rows.length + ' poles in ' + esc(prof().name || 'the profile') + ', ' + fmt(built.rows.length ? built.rows[built.rows.length - 1].chainage : 0, 2) + ' m' : 'Order the surveyed poles in the Project panel.', ''],
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
    var t = e.target.closest('[data-instab],[data-act],[data-xuse]'); if (!t) return;
    if (t.dataset.xuse) { linkDesign(t.dataset.xuse); select(S.selected); setStatus('Editing ' + t.dataset.xuse + '. The previous design is shown as an intersecting line.', 'good'); return; }
    if (t.dataset.instab) { var kk = secKey(t.dataset.instab); if (t.classList.contains('acch')) { var o0 = accOpenNow(kk); (U.accOpen = U.accOpen || {})[kk] = !o0; if (!o0) { U.insTab = kk; lastReq = kk; } else if (U.insTab === kk) { U.insTab = ''; lastReq = ''; } } else openSection(kk); saveUi(); renderSelected(); return; }
    if (t.dataset.act === 'import') $('fileInput').click();
    if (t.dataset.act === 'export') { recompute(); openReview(); }
  });
  $('insZoom').onclick = function () { showPole(S.selected); };
  $('insClear').onclick = function () { select(null); };

  /* ---------- table ---------- */
  var COLS = [
    ['order', 'Pole', function (p) { return p.id; }],
    ['inProf', 'In profile', function (p) { var i = prof().poleIds.indexOf(p.id); return i < 0 ? '' : '#' + (i + 1); }],
    ['easting', 'Easting (m)', function (p) { return p.survey ? p.survey.easting : null; }, 1, 2],
    ['northing', 'Northing (m)', function (p) { return p.survey ? p.survey.northing : null; }, 1, 2],
    ['elevation', 'Elevation (m)', function (p) { return p.survey ? p.survey.elevation : null; }, 1, 2],
    ['exLen', 'Existing length (m)', function (p) { var e = PNW.existingLength(p); return e.value == null ? null : e.value + ' (' + e.source + ')'; }],
    ['len', 'Profile length (m)', function (p) { var r = built && built.rows.filter(function (x) { return x.id === p.id; })[0]; return r ? r.length : null; }, 1, 1],
    ['chain', 'Chainage (m)', function (p) { var r = built && built.rows.filter(function (x) { return x.id === p.id; })[0]; return r ? r.chainage : null; }, 1, 2],
    ['desc', 'Description', function (p) { return (p.gis && p.gis.description) || (p.insp && p.insp.description) || ''; }],
    ['files', 'Found in', function (p) { return [p.survey && 'LiDAR', p.gis && 'GIS', p.insp && 'Inspections', p.defects.length && 'Defects', p.inList && 'Pole list'].filter(Boolean).join(', '); }],
    ['defects', 'Defects', function (p) { return p.defects.length || ''; }, 1],
    ['status', 'Status', function (p) { return levelFor(p.id) || 'ok'; }]
  ];
  function renderTable() {
    if (tab === 'spans') { $('tableWrap').innerHTML = spanTable(); return; }
    if (tab === 'transformers' || tab === 'stays') { $('tableWrap').innerHTML = equipTable(tab); return; }
    if (tab === 'calc') { $('tableWrap').innerHTML = calcTable(); return; }
    if (tab === 'tipsum') { $('tableWrap').innerHTML = tipsumTable(); return; }
    if (tab === 'issues') return renderIssueTable();
    if (tab === 'register') return renderRegister();
    if (tab === 'log') return renderLog();
    if (tab === 'sections') return renderSections();
    if (tab === 'heights') return renderHeights();
    var q = $('search').value.trim().toLowerCase(), f = $('filter').value;
    var list = Object.keys(merged.poles).map(function (id) { return merged.poles[id]; }).filter(function (p) {
      if (q && !smartScore(q, p.id + ' ' + (p.survey ? p.survey.equipNo : '') + ' ' + (p.gis ? p.gis.equipNo + ' ' + p.gis.description : ''))) return false;
      if (f === 'profile') return prof().poleIds.indexOf(p.id) >= 0;
      if (f === 'error' || f === 'warning') return levelFor(p.id) === f;
      if (f === 'unmatched') return !p.survey || (S.files.some(function (x) { return x.role === 'gisPoles'; }) && !p.gis);
      return true;
    });
    var col = COLS.filter(function (c) { return c[0] === sortCol; })[0] || COLS[0];
    list.sort(function (a, b) { var x = sortCol === 'order' ? a.order : col[2](a), y = sortCol === 'order' ? b.order : col[2](b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x > y ? 1 : x < y ? -1 : 0) * (sortDesc ? -1 : 1); });
    if (!list.length) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">' + (Object.keys(merged.poles).length ? 'No poles match the search or filter.' : 'Imported records appear here.') + '</p>'; return; }
    // Columns with no value in any row are left out; numbers use fixed decimals per quantity.
    var cols = COLS.filter(function (c) { return /^(order|status|easting|northing|elevation)$/.test(c[0]) || list.some(function (p) { var v = c[2](p); return v != null && v !== ''; }); });
    var h = '<table class="grid"><thead><tr>' + cols.map(function (c) { return '<th data-sort="' + c[0] + '" class="' + (c[3] ? 'num ' : '') + (c[0] === sortCol ? 'sorted' + (sortDesc ? ' desc' : '') : '') + '">' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>';
    list.forEach(function (p) {
      h += '<tr data-id="' + esc(p.id) + '" class="' + (isSel(p.id) ? 'sel' : '') + '">' + cols.map(function (c) {
        var v = c[2](p), miss = (c[0] === 'easting' || c[0] === 'northing' || c[0] === 'elevation') && (v == null || isNaN(v));
        if (c[0] === 'status') return '<td><span class="pill ' + (v === 'error' ? 'bad' : v === 'warning' ? 'warn' : 'ok') + '">' + v + '</span></td>';
        return '<td class="' + (c[3] ? 'num' : '') + (miss ? ' miss' : '') + '">' + (miss ? 'missing' : esc(c[4] != null && typeof v === 'number' && isFinite(v) ? v.toFixed(c[4]) : fmt(v))) + '</td>';
      }).join('') + '</tr>';
    });
    $('tableWrap').innerHTML = h + '</tbody></table>';
  }
  function renderIssueTable() {
    var q = $('search').value.trim().toLowerCase();
    var list = allIssues.filter(function (i) { return !q || smartScore(q, i.message + ' ' + (i.poleId || '') + ' ' + (i.file || '')); });
    var rank = { error: 0, warning: 1, info: 2 }; list.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    if (!list.length) { $('tableWrap').innerHTML = '<p class="status good" style="padding:14px">No issues found.</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Level</th><th>Pole</th><th>Issue</th><th>File</th></tr></thead><tbody>' + list.map(function (i) {
      return '<tr data-id="' + esc(i.poleId || '') + '"><td><span class="pill ' + (i.level === 'error' ? 'bad' : i.level === 'warning' ? 'warn' : 'info') + '">' + i.level + '</span></td><td>' + esc(i.poleId || '') + '</td><td style="white-space:normal">' + esc(i.message) + '</td><td>' + esc(i.file ? i.file + (i.row ? ' row ' + i.row : '') : '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  $('tableWrap').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]'); if (th) { if (sortCol === th.dataset.sort) sortDesc = !sortDesc; else { sortCol = th.dataset.sort; sortDesc = false; } renderTable(); return; }
    var tr = e.target.closest('tr[data-id]'); if (tr && tr.dataset.id && tab !== 'register' && tab !== 'sections' && !e.target.closest('input,select,button,.combo')) { select(tr.dataset.id, addInfo(e)); showPole(tr.dataset.id); }
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  var SEARCH_HINT = { poles: 'Search pole, equipment no…', sections: 'Search section, pole, conductor…', heights: 'Search pole or construction…', register: 'Search code, description, DCSH…', issues: 'Search issues…', log: 'Search…' };
  function setTab(t) {
    tab = t; U.tab = t; saveUi();
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { var on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('filter').hidden = t !== 'poles'; $('search').placeholder = SEARCH_HINT[t] || 'Search…'; renderTable();
    if (typeof syncTabMore === 'function' && $('tabMore')) syncTabMore();
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
      '<p class="hint">' + matched + ' of ' + ids.length + ' poles have a LiDAR survey row. ' + inf + ' informational note' + (inf === 1 ? '' : 's') + '.</p><div class="btnrow"><button class="btn small" id="openIssues">Show all issues</button>' + (function () { var n = lenFixList().length; return n ? '<button class="btn small" id="fixLens" title="Poles with a missing or invalid length (e.g. -9999) take the length of their pole type">⟲ Auto fix ' + n + ' length' + (n > 1 ? 's' : '') + ' from pole type</button>' : ''; })() + '</div>';
    $('openIssues').onclick = function () { openTab('issues'); };
    if ($('fixLens')) $('fixLens').onclick = function () { fixFromType(lenFixList()); };
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
      PNW.groundlineAoa(built).slice(1).map(function (r) { var src = r[3] ? built.rows.filter(function (q) { return q.id === r[3]; })[0] || {} : null; return '<tr' + (src ? '' : ' class="muted" title="Survey ground point"') + '>' + r.map(function (v, c) { var t = src && c === 5 && src.lengthSource === 'Edited' ? ' <span class="tag edit">edited</span>' : ''; var need = v == null && c < 7 && (src || c < 3); return '<td class="' + (typeof v === 'number' ? 'num' : '') + (need ? ' miss' : '') + '">' + (v == null ? (need ? 'missing' : '') : esc(v)) + t + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
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
  function gpBlob() { return new Blob([xlsxBytes(project && project.constructions && project.constructions.length ? designWorkbook() : PNW.groundProfileWorkbook(XLSX, built, prof().segments))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
  // With a design: the Groundline sheet gets Construction and Att Ht columns (extra constructions on the rows below the pole) and the
  // Segments sheet lists each strain section with its poles, constructions and attachment heights, as in PNW's sample
  // "ene with constructions4.xlsx". The first eight Groundline columns are unchanged.
  function designWorkbook() {
    var gl = PNW.groundlineAoa(built), hdr = gl[0].concat(['Construction', 'Att Ht']), out = [hdr], w = hdr.length;
    var consOf = function (id) { return project.constructions.filter(function (c) { return c.pole === id; }).sort(function (a, b) { return (PNW.num(b.attht) || 0) - (PNW.num(a.attht) || 0); }); };
    gl.slice(1).forEach(function (r, i) {
      var cs = r[3] ? consOf(r[3]) : [], row = r.slice(); while (row.length < w - 2) row.push(null);
      out.push(row.concat(cs[0] ? [cs[0].code, PNW.num(cs[0].attht)] : [null, null]));
      cs.slice(1).forEach(function (c) { var x = new Array(w - 2).fill(null); out.push(x.concat([c.code, PNW.num(c.attht)])); });
    });
    var seg = [['Conductor', 'Num conds', '%CBL', 'Tension kN', 'Table', 'Temperatures', 'Poles', 'Constructions', 'Att Ht']], order = {};
    built.rows.forEach(function (r, i) { order[r.id] = i; });
    (project.segments || []).forEach(function (sg) {
      var sp = project.segPoles.filter(function (r) { return r.strsection === sg.StrainSect && r.include !== 'False'; }).sort(function (a, b) { return (order[a.id] == null ? 1e9 : order[a.id]) - (order[b.id] == null ? 1e9 : order[b.id]); });
      var pct = /cbl/i.test(sg.TensionUnits || '') ? PNW.num(sg.Tension) : null, kn = /kn/i.test(sg.TensionUnits || '') ? PNW.num(sg.Tension) : (PNW.num(sg.kN) || null);
      sp.forEach(function (r, i) {
        var c = project.constructions.filter(function (x) { return x.pole === r.id && x.descr === r.constr; })[0], code = c ? c.code : String(r.constr || '').replace(/\s*\(\d+\)$/, '');
        seg.push((i ? [null, null, null, null, null, null] : [sg.Conductor || null, PNW.num(sg.numconds), pct, kn, String(sg.Table || '').trim() || null, String(sg.Conditions || '').trim() || null]).concat([r.id, code, PNW.num(r.attht)]));
      });
    });
    var wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(out);
    XLSX.utils.book_append_sheet(wb, ws, 'Groundline'); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seg), 'Segments');
    return wb;
  }
  // With a design the .pnwx export is the design project itself (poles, constructions, conductors, strain sections and tiploads).
  // The pole type chosen for each pole (a library type or a calculated Existing-<ID> pole strength type) is app state; write it into the
  // exported project so PNW opens each pole with that type, its diameters and its calculated strength.
  function withPoleTypes(xml) {
    var ty = S.design.poleTypes || {}, ids = Object.keys(ty); if (!xml || !ids.length) return xml;
    try {
      var p = M.readPnwx(xml); if (p.kind !== 'profile') return xml;
      var pl = S.design.poleLib || {}, changed = false;
      ids.forEach(function (id) {
        var code = ty[id], t = (pl[id] && pl[id].code === code ? pl[id] : null) || (lib && lib.poles.filter(function (x) { return x.code === code; })[0]);
        if (t && M.setPoleType(p, id, t)) changed = true;
      });
      var out = changed ? M.writePnwx(p) : xml, add = '';
      // A calculated strength type is not in PNW's own pole database. PNW keeps such a pole's type in the pole's saved tipload
      // (<pole_ID> with an embedded <poletype>, as in your S1242155 project), so write one for poles that have none yet.
      ids.forEach(function (id) {
        var code = ty[id], t = pl[id] && pl[id].code === code ? pl[id] : null;
        if (!t || (p.tiploads || {})[id] || new RegExp('<pole_' + id.replace(/[^\w-]/g, '') + '>').test(out)) return;
        var x = tipProjectXml(id, t, p.attrs || {}); if (x) add += x;
      });
      if (add) { var NL = /\r\n/.test(out) ? '\r\n' : '\n'; out = out.replace(/<\/profile_project>\s*$/, add.replace(/\n/g, NL) + '</profile_project>' + NL); }
      return out;
    } catch (e) { return xml; }
  }
  // A PNW tipload project for one pole, in the layout PNW 7.18 saves inside a profile (<pole_ID> CDATA): attributes, the pole type,
  // and one cct per circuit from this design (conductor, count, bearing, attachment height, span, MES, tension as the section has it).
  function tipProjectXml(id, t, pa) {
    var inp = tipInput(id); if (!inp || !(inp.pole.height > 0)) return '';
    var xe = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var n = function (v) { return v == null || v === '' || !isFinite(Number(v)) ? '0' : String(Math.round(Number(v) * 1000) / 1000); };
    var d = new Date(), hh = d.getHours() % 12 || 12, two = function (v) { return (v < 10 ? '0' : '') + v; };
    var saved = two(d.getDate()) + '/' + two(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hh + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
    var st = inp.stays || [], pl2 = (inp.plant || []);
    var A = [['saved', saved], ['currentoption', pa.currentoption || ''], ['title', id], ['flex', '0'], ['ht', n(inp.pole.height)], ['length', n(inp.pole.length)], ['sink', n(inp.pole.length - inp.pole.height)], ['diam', n(t.diamAvg)], ['poletype', t.code], ['orient', '0'], ['comment', ''], ['filename', '']];
    [0, 1].forEach(function (k) { var s0 = st[k] || {}; A.push(['stay' + (k + 1) + '_dir', n(s0.dir)], ['stay' + (k + 1) + '_angle', n(st[k] ? s0.angle : 0)], ['stay' + (k + 1) + '_att_ht', n(s0.attHt)], ['stay' + (k + 1) + '_checked', st[k] && s0.include !== false ? 'True' : 'False'], ['stay' + (k + 1) + '_wire', s0.wire || '']); });
    var p1 = pl2[0] || {}, p2 = pl2[1] || {};
    A.push(['plant_checked', pl2[0] && p1.include ? 'True' : 'False'], ['plant1', p1.code || ''], ['plant_attht', n(p1.attHt)], ['plant_dir', n(p1.dir)], ['plant_fixedload', '0'], ['plant_checked2', pl2[1] && p2.include ? 'True' : 'False'], ['plant2', p2.code || ''], ['plant_attht2', n(p2.attHt)], ['plant_dir2', n(p2.dir)],
      ['version', pa.pnw_version || '7.18.1'], ['tipload_version', '2.0.0.911'], ['soiltype', ''], ['footdiam', n(t.diamButt)], ['footfactor', '0'], ['gnddiam', n(t.diamGL)], ['class', '']);
    var PT = [['code', t.code], ['description', t.description || t.code], ['defLength', n(t.length)], ['soilType', '0'], ['defSunk1', n(t.sinking)], ['defSunk2', '0'], ['defSunk3', '0'], ['defSunk4', '0'], ['defHeight', n(t.height != null ? t.height : t.length - t.sinking)], ['material', t.material || 'Wood'], ['otherDesc', null],
      ['weightTotal', n(t.weight)], ['widthLong', '0'], ['widthTrans', '0'], ['diamTipLong', n(t.diamTip)], ['diamTipTrans', n(t.diamTip)], ['diamAvLong', n(t.diamAvg)], ['diamAvTrans', n(t.diamAvg)], ['diamGLLong', n(t.diamGL)], ['diamGLTrans', n(t.diamGL)], ['diamButtLong', n(t.diamButt)], ['diamButtTrans', n(t.diamButt)],
      ['limitLong', null], ['limitTrans', null], ['limitDownload', null], ['limitTorsional', '0,0,0'], ['limitUplift', '0,0,0'], ['limitnowind', '0'], ['limitwind1', '0'], ['limitwind2', '0'], ['limitultimate', n(t.ultimate)], ['limitdownult', n(t.vertical)], ['limitultimatetrans', n(t.ultimate)], ['remarks', null],
      ['Favourite', 'False'], ['setName', 'Western Power'], ['maxDevAngle', '0'], ['geometry', 'True'], ['strgroup', '6'], ['wallthickness', '0']];
    var row = function (pairs, ind) { return pairs.map(function (f) { return ind + '<' + f[0] + '>' + (f[1] == null ? '\n' + ind + '</' + f[0] + '>' : xe(f[1]) + '</' + f[0] + '>'); }).join('\n'); };
    var ccts = inp.circuits.map(function (c, i) {
      var m = /^\s*([\d.]+)\s*%CBL/i.exec(c.tensionText || ''), pc = !!m;
      return '    <cct>\n' + row([['Include', 'True'], ['Circuit_ID', String(i + 1)], ['Angle', n(Math.round(c.dir * 10) / 10)], ['Conductor', c.code || ''], ['Num_Conductors', String(c.n || 1)], ['Attach_Ht', n(c.attHt)], ['Span_Length', n(c.span)], ['MES', n(c.mes)], ['vertical', n(c.vdiff)], ['strsect', c.segment || ''], ['sectlen', n(c.mes)], ['iceperc', '1'],
        ['tenstype', pc ? '%CBL' : 'Tension'], ['tensvalue', pc ? m[1] : n(c.tension)], ['weight', '0'], ['diam', '0'], ['tensionkN', n(c.tension)], ['unique', '0'], ['std_tens', '0']], '      ') + '\n    </cct>';
    });
    return '  <pole_' + id + '><![CDATA[<tipload_project ' + A.map(function (a) { return a[0] + '="' + xe(a[1]) + '"'; }).join(' ') + '>\n  <poletype>\n    <poletype>\n' + row(PT, '      ') + '\n    </poletype>\n  </poletype>\n  <ccts>\n' + ccts.join('\n') + '\n  </ccts>\n</tipload_project>]]></pole_' + id + '>\n';
  }
  function pnwxText() { return withPoleTypes(pnwxTextRaw()); }
  function pnwxTextRaw() { if (project && project.constructions && project.constructions.length && projectXml()) return projectXml(); return PNW.profilePnwx(built, { title: 'Ground Profile - ' + baseName(), createdBy: S.settings.createdBy, option: S.settings.optionSet, clearance1: PNW.num(S.settings.clr1), clearance2: PNW.num(S.settings.clr2) }); }
  function exportDesign() { download(new Blob([withPoleTypes(projectXml())], { type: 'application/xml' }), linked.name.replace(/\.pnwx$/i, '') + (liveLog().length ? ' (edited)' : '') + '.pnwx'); setStatus('Downloaded the updated PNW project.', 'good'); }
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
    var pl = S.design.poleLib; if (pl) Object.keys(pl).forEach(function (k) { if (pl[k].code === k) { pl[k].code = strCode(k); var ty0 = S.design.poleTypes || {}; if (ty0[k] === k) ty0[k] = pl[k].code; } });
    if (lib && pl && Object.keys(pl).length) lib = Object.assign({}, lib, { poles: lib.poles.filter(function (x) { return !Object.keys(pl).some(function (k) { return pl[k].code === x.code; }); }).concat(Object.keys(pl).map(function (k) { return pl[k]; })) });
    var profiles = filesOf('pnwx').filter(function (f) { return f.kind === 'profile'; });
    if (S.design.link && !profiles.some(function (f) { return f.name === S.design.link; })) S.design = Object.assign(blankDesign(), { register: S.design.register });
    // No link yet: link the active profile's own line; a profile without one (after a switch) stays unlinked.
    if (!S.design.link && profiles.length) { var pf0 = prof() && prof().file, pick0 = pf0 ? profiles.filter(function (f) { return f.name === pf0; })[0] : S.profiles.filter(function (q) { return q.file || q.poleIds.length; }).length <= 1 ? profiles[0] : null; if (pick0) S.design.link = pick0.name; }
    linked = profiles.filter(function (f) { return f.name === S.design.link; })[0] || null;
    project = null;
    if (linked) { try { project = M.readPnwx(projectXml()); } catch (e) { setStatus('The linked project could not be read: ' + e.message, 'bad'); } }
    // Constructions saved without attachment points (so no wire could be strung to them) get the known layout of their code.
    if (project) { try {
      var bare = project.constructions.map(function (r) { return { r: r, lay: String(r.attachHt || '').trim() ? null : knownLayout(r.code) }; }).filter(function (x) { return x.lay && x.lay.attachments.length; });
      if (bare.length) {
        bare.forEach(function (x) { M.updateConstruction(project, x.r.unique, { attachments: x.lay.attachments }); });
        S.design.xml = M.writePnwx(project);
        S.design.log = liveLog().concat(bare.map(function (x) { return logEntry(x.r.pole, x.r.descr, 'Attachment offsets', '', x.lay.attachments.map(function (a) { return a.x + ', ' + a.y; }).join(' / '), 'auto', 'Missing in the project; from ' + x.lay.source); }));
        setStatus('Added attachment points to ' + bare.length + ' construction' + (bare.length > 1 ? 's' : '') + ' that had none (' + bare.slice(0, 4).map(function (x) { return x.r.pole + ' ' + x.r.code; }).join(', ') + (bare.length > 4 ? '…' : '') + '), from ' + bare[0].lay.source + '. See the Log.', 'good');
      }
    } catch (e) { /* leave the project as read */ } }
    $('useProj').hidden = !project;
  }
  function projectXml() { return S.design.xml || (linked ? linked.text : ''); }
  // Switching which line is the design keeps the edits made to the old one (written back to its file) and the pole extras,
  // and gives the new line its own profile instead of overwriting the one being worked on.
  // Switch the active profile. A profile that has its own PNW line (.pnwx) becomes the design being edited; one without a
  // line leaves design mode (the previous line's edits are kept in its file).
  function switchProfile(i) {
    i = +i; if (!S.profiles[i] || i === S.active) return;
    // One undo step for the whole switch (linking a line recomputes more than once on the way).
    if (linked && prof() && !prof().file) prof().file = linked.name;
    var before = lastSnap; restoring = true;
    try { switchProfileInner(i); } finally { restoring = false; }
    var now = snapState(); if (before != null && now !== before) { undoStack.push(before); redoStack = []; } lastSnap = now; renderHistory();
  }
  function switchProfileInner(i) {
    var nm = S.profiles[i].name || '', pf = S.profiles[i].file, f = filesOf('pnwx').filter(function (x) { if (x.kind !== 'profile') return false; if (pf) return x.name === pf; var t = x.name.replace(/^Ground Profile - /i, '').replace(/\.pnwx$/i, ''); return t === nm || t === nm + ' (design)'; })[0];
    if (f) { if (!linked || linked.name !== f.name) { linkDesign(f.name); S.active = i; S.generated = false; recompute(); } else { S.active = i; S.generated = false; recompute(); } setStatus('Switched to “' + nm + '” (' + f.name + ').', 'good'); return; }
    if (linked) { // leave the linked design (kept in its file) so the other profile is not shown with this line's design
      var old = S.design, lf = S.files.filter(function (x) { return x.name === linked.name; })[0]; if (lf && old.xml) lf.text = old.xml; xCache = {}; textCache = {}; regCache = null;
      S.design = Object.assign(blankDesign(), { register: old.register, log: old.log || [], extras: old.extras, poleTypes: old.poleTypes, tables: old.tables, pstr: old.pstr, poleLib: old.poleLib });
    }
    S.active = i; S.generated = false; recompute(); select(null); setStatus('Switched to “' + (nm || 'Profile ' + (i + 1)) + '”. It has no PNW line yet: Create profile or Auto design makes one.', 'good');
  }
  function linkDesign(name) {
    var old = S.design;
    if (linked && old.xml) { var lf = S.files.filter(function (f) { return f.name === linked.name; })[0]; if (lf) lf.text = old.xml; xCache = {}; textCache = {}; regCache = null; }
    S.design = Object.assign(blankDesign(), { register: old.register, link: name, log: old.log || [], extras: old.extras, poleTypes: old.poleTypes, tables: old.tables, pstr: old.pstr, poleLib: old.poleLib });
    recompute();
    var title = ((project && (project.attrs.title || name)) || name).replace(/^Ground Profile - /i, '').replace(/\.pnwx$/i, ''), idx = S.profiles.findIndex(function (q) { return q.file === name; }); if (idx < 0) idx = S.profiles.findIndex(function (q) { return q.name === title && !q.file; });
    if (idx < 0 && S.profiles.length === 1 && !S.profiles[0].poleIds.length) idx = 0;
    if (idx < 0) { S.profiles.push(newProfile(title)); idx = S.profiles.length - 1; }
    S.active = idx; S.profiles[idx].file = name; useProject(false);
  }
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
    // A table saved for the section only counts while it still fits the section's conductor and %CBL tension; after the
    // conductor or tension changes, the matching table (or w·L²/8T at the new tension) is used, so the sag follows the edit.
    var sug = suggestTable(seg);
    if (pick && sug.some(function (t) { return t.id === pick; })) return tables.filter(function (t) { return t.id === pick; })[0] || null;
    return sug[0] || null;
  }
  function suggestTable(seg) {
    var tables = stringing(); if (!tables.length || !seg) return [];
    // A table drawn for this conductor at the section's %CBL tension (same rules as the tension suggestions).
    var pct = seg.TensionUnits === '%CBL' ? Number(seg.Tension) : NaN;
    return M.tablesForConductor(tables, conductorFor(seg.Conductor)).filter(function (x) { return x.pct === pct; }).map(function (x) { return x.table; });
  }
  function applySag(d, p, own) {
    d = d || dm; p = p || project; own = own !== false && d === dm;
    if (!d) return;
    var mode = S.sagMode || 'auto', bySeg = {};
    d.wires.forEach(function (w) { if (w.phase === 1) (bySeg[w.segment] = bySeg[w.segment] || []).push(w.span); });
    d.sagNotes = {};
    d.wires.forEach(function (w) {
      w.sag = null; w.sagSource = 'not shown';
      if (mode === 'auto') { // DCSH Part 10 where a table fits the section, else w·L²/8T at the section's stringing tension
        var sa = p.segments.filter(function (s) { return s.StrainSect === w.segment; })[0], ta = (own ? tableFor(sa || {}) : suggestTable(sa || {})[0] || null), ra = ta ? M.tableSag(ta, 'final', Number(S.sagTemp || 15), w.span, M.rulingSpan(bySeg[w.segment] || [])) : null;
        if (ra && ra.value != null) { w.sag = ra.value; w.sagSource = ta.title + ' (DCSH Part 10 p' + ta.page + '), existing/final ' + (S.sagTemp || 15) + ' °C' + (ra.extrapolated ? ' (extended past the 45 °C column)' : ''); d.sagNotes[w.segment] = w.segment + ': DCSH ' + ta.title; return; }
        var ca = p.conductors.filter(function (c) { return String(c.Code).toUpperCase() === String(w.conductor).toUpperCase(); })[0];
        w.sag = M.illustrativeSag(w.span, ca, sa); w.sagSource = w.sag != null ? 'w·L²/8T at the stringing tension (' + sa.Tension + ' ' + sa.TensionUnits + '), no DCSH table for it' : 'no conductor mass or tension';
        d.sagNotes[w.segment] = w.segment + ': ' + (w.sag != null ? 'w·L²/8T at ' + sa.Tension + ' ' + sa.TensionUnits : 'no sag (no conductor mass or tension)');
      } else if (mode === 'illustrative') {
        var cond = p.conductors.filter(function (c) { return String(c.Code).toUpperCase() === String(w.conductor).toUpperCase(); })[0], seg = p.segments.filter(function (s) { return s.StrainSect === w.segment; })[0];
        w.sag = M.illustrativeSag(w.span, cond, seg); w.sagSource = w.sag != null ? 'illustrative w·L²/8T at stringing tension' : 'no conductor mass or tension';
      } else if (mode === 'dcsh') {
        var sg = p.segments.filter(function (s) { return s.StrainSect === w.segment; })[0], t = (own ? tableFor(sg || {}) : suggestTable(sg || {})[0] || null), rs = M.rulingSpan(bySeg[w.segment] || []);
        if (!t) { d.sagNotes[w.segment] = 'No DCSH stringing table chosen or matched for ' + w.segment + ' (' + (sg ? sg.Conductor + ' at ' + sg.Tension + ' ' + sg.TensionUnits : '?') + ').'; return; }
        var r = M.tableSag(t, 'final', Number(S.sagTemp || 15), w.span, rs);
        w.sag = r.value; w.sagSource = r.value != null ? t.title + ' (DCSH Part 10 p' + t.page + '), existing/final ' + (S.sagTemp || 15) + ' °C' + (r.extrapolated ? ' (extended past the 45 °C column)' : '') + ', ruling span ' + rs.toFixed(1) + ' m' : r.reason;
        d.sagNotes[w.segment] = w.segment + ': ' + (r.value != null ? t.title + ', p' + t.page + ', ruling span ' + rs.toFixed(1) + ' m' : r.reason);
      }
    });
  }
  function buildDesignModel() {
    dm = project ? M.designModel(project, { file: linked.name, poleType: poleTypeFor }) : null;
    applySag();
    syncIntersecting();
  }
  // Intersecting lines: the other saved PNW profiles that share a pole with the design (same ID, or within 0.5 m).
  // They are drawn with the design in plan and 3D (read only); the shared pole is drawn once and carries the
  // constructions of every line, each crossarm across its own line. "Use as design" on the file switches which one is edited.
  var xLines = [], xCache = {};
  function syncIntersecting() {
    xLines = [];
    if (!project || !dm) return;
    filesOf('pnwx').filter(function (f) { return f.kind === 'profile' && f.name !== linked.name; }).forEach(function (f) {
      var k = f.name + '|' + f.text.length, p = xCache[k];
      if (!p) { try { p = xCache[k] = M.readPnwx(f.text); } catch (e) { return; } }
      var d = M.designModel(p, { file: f.name, poleType: poleTypeFor }), common = {};
      d.allPoles.forEach(function (q) {
        var hit = dm.allPoles.filter(function (m) { return m.id === q.id || (isFinite(q.easting) && isFinite(m.easting) && Math.hypot(q.easting - m.easting, q.northing - m.northing) < 0.5); })[0];
        if (hit) common[q.id] = hit;
      });
      if (!Object.keys(common).length) return;
      applySag(d, p, false);
      xLines.push({ name: f.name, title: (p.attrs.title || f.name).replace(/\.pnwx$/i, ''), project: p, dm: d, common: common });
    });
  }
  function xPole(id) {
    for (var i = 0; i < xLines.length; i++) { var x = xLines[i], q = x.dm.allPoles.filter(function (p) { return p.id === id && !x.common[p.id]; })[0]; if (q) return { line: x, pole: q }; }
    return null;
  }

  /* undo / redo: every change to profiles or the design is a snapshot */
  function snapState() { return JSON.stringify({ profiles: S.profiles, active: S.active, design: S.design, manual: S.files.filter(function (f) { return f.manual || f.made; }) }); }
  function trackHistory() {
    var now = snapState();
    if (lastSnap != null && now !== lastSnap && !restoring) { undoStack.push(lastSnap); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
    lastSnap = now;
  }
  function restore(from, to) {
    if (!from.length) return;
    to.push(snapState());
    var s = JSON.parse(from.pop()); S.profiles = s.profiles; S.active = s.active; S.design = s.design; if (s.manual) S.files = S.files.filter(function (f) { return !f.manual && !f.made; }).concat(s.manual.map(function (f) { (f.items || []).forEach(function (x) { if (x.date && typeof x.date === 'string') x.date = new Date(x.date); }); return f; })); S.multi = []; if (S.selected && !merged.poles[S.selected]) S.selected = null;
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
      var dbl = ((window.PNW_BUILTIN || {}).dbLayouts || []).filter(function (x) { return x.code === c.code; })[0];
      reg.push({ id: c.code + '|library', code: c.code, attachments: dbl ? dbl.attachments : [], phases: 0, sources: [], observedBelowTip: [], fromLibrary: true, status: dbl ? 'Attachment points from the PNW construction database (Western Power set)' : 'Library entry only: no attachment offsets available, needs engineering review' });
    });
    reg.forEach(function (r) {
      r.lib = M.libraryConstruction(lib, r.code); r.dcsh = M.dcshFor(dc, r.code)[0] || null; r.user = (S.design.register || {})[r.id] || {};
      r.check = r.dcsh && r.attachments.length ? M.compareDcsh(r.dcsh, { attachments: r.attachments, kingbolt: null }, null) : null;
    });
    return (regCache = reg);
  }
  function regFor(c) { var k = c.code + '|' + JSON.stringify(c.attachments); return registerRows().filter(function (r) { return r.id === k; })[0] || null; }
  // Engineering status of a register row: the engineer's approval wins; otherwise what the DCSH comparison shows.
  // Short status in the construction header; a warning is a small orange bubble with the reason on hover.
  function statusBadge(st) { return st.cls === 'warn' ? '<span class="wbub xinfo" tabindex="0" title="' + esc(st.text) + '" aria-label="' + esc(st.text) + '">!</span>' : '<span class="pill ' + st.cls + (st.cls === 'bad' ? '' : ' xinfo') + '">' + esc(st.text) + '</span>'; }
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
    var q = $('search').value.trim().toLowerCase(), rows = registerRows().filter(function (r) { return !q || smartScore(q, r.code + ' ' + (r.lib ? r.lib.description : '') + ' ' + (r.dcsh ? r.dcsh.drawing + ' ' + r.dcsh.title : '')); });
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
    $('tableWrap').innerHTML = h + '</tbody></table><p class="hint explain" style="margin:8px">Attachment offsets come from your saved PNW projects; the DCSH column comes from the DCSH register file you imported. A construction is only "Approved" when an engineer sets it here; the tool never approves anything itself.</p>';
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
    S.design = Object.assign(blankDesign(), { register: S.design.register, link: name }); prof().file = name;
    recompute(); setStatus('Started a design from the ground profile. Add constructions to each pole, then string conductors in the Strain sections tab.', 'good');
  }
  var secForm = { tension: '', units: '%CBL' }, CT = { on: false, chain: [], hover: null };
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
    if (!project) { $('tableWrap').innerHTML = '<div style="padding:14px">' + startDesignHint() + '<p class="hint explain">The conductor schedule lists the strain sections of the linked PNW project.</p></div>'; return; }
    var tables = stringing(), q = $('search').value.trim().toLowerCase();
    var h = '<table class="grid"><thead><tr><th>Section</th><th>Poles</th><th>Conductor</th><th>Tension</th><th>Units</th><th class="num">Wires</th><th class="num">Spans</th><th class="num">Length</th><th class="num">Ruling span</th><th>DCSH sag table</th><th></th></tr></thead><tbody>';
    var shown = 0;
    project.segments.forEach(function (sg) {
      var n = sg.StrainSect, mem = project.segPoles.filter(function (x) { return x.strsection === n; }), sp = spansOf(mem.map(function (x) { return x.id; }));
      if (q && !smartScore(q, n + ' ' + sg.Conductor + ' ' + mem.map(function (x) { return x.id + ' ' + x.constr; }).join(' '))) return;
      shown++;
      var pick = (S.design.tables || {})[n] || '', sug = suggestTable(sg)[0], c = conductorFor(sg.Conductor), lvl = mem[0] ? levelOf(mem[0].constr) : '';
      h += '<tr data-sec="' + esc(n) + '" class="' + (S.selSection === n ? 'sel' : '') + '"><td><b>' + esc(n) + '</b>' + (sg.New === 'True' ? ' <span class="pill info">New</span>' : '') + '</td>' +
        '<td style="white-space:normal;min-width:180px">' + mem.map(function (x) { return esc(x.id) + ' <small class="muted">' + esc(x.constr) + '</small>'; }).join(' → ') + '</td>' +
        '<td class="fitc">' + combo('seccond|' + n, { value: sg.Conductor, placeholder: 'Search conductor…', aria: 'Conductor of ' + n, groups: function () { return conductorGroups(mem[0] && mem[0].id, lvl); }, onPick: function (v) {
          var cc = conductorFor(v); if (!cc) { setStatus(v + ' is not in the PNW library or this project.', 'bad'); renderTable(); return; }
          commit(function (p) { var s0 = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = s0.Conductor; M.updateSection(p, n, { conductor: cc }); return [logEntry('', n, 'Conductor', from, cc.code, 'manual', lib && lib.conductors.indexOf(cc) >= 0 ? 'PNW library ' + cc.code : '')]; });
        } }) + (c && c.name ? '<small class="muted" style="display:block">' + esc(c.name) + '</small>' : '') + '</td>' +
        '<td><input data-secten="' + esc(n) + '" value="' + esc(sg.Tension) + '" inputmode="decimal" style="width:64px" aria-label="Tension of ' + esc(n) + '"> ' + ((S.design.tensionAuto || {})[n] ? '<span class="tag der" title="Follows the ruling span (DCSH Part 10). Typing a tension makes it manual.">auto</span>' : '<button class="tag edit" data-secauto="' + esc(n) + '" title="Manual tension. Click to follow the ruling span (DCSH Part 10) instead.">manual</button>') + '</td>' +
        '<td><select data-secunits="' + esc(n) + '" aria-label="Tension units of ' + esc(n) + '"><option' + (sg.TensionUnits === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (sg.TensionUnits === 'kN' ? ' selected' : '') + '>kN</option></select></td>' +
        '<td class="num">' + esc(sg.numconds) + '</td><td class="num">' + sp.length + '</td><td class="num">' + (sp.length ? sp.reduce(function (a, b) { return a + b; }, 0).toFixed(1) + ' m' : '') + '</td>' +
        '<td class="num">' + (sp.length ? M.rulingSpan(sp).toFixed(1) + ' m' : '') + '</td>' +
        '<td><select data-secsag="' + esc(n) + '" aria-label="DCSH sag table for ' + esc(n) + '"><option value="">' + (sug ? 'Matched: ' + esc(sug.title) : 'None matched') + '</option>' + tables.filter(function (t) { return !t.legacy; }).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === pick ? ' selected' : '') + '>' + esc(t.title) + ' (p' + t.page + ')</option>'; }).join('') + '</select></td>' +
        '<td>' + binBtn('data-secdel="' + esc(n) + '"', 'Remove strain section ' + n) + '</td></tr>';
    });
    if (!project.segments.length) h += '<tr><td colspan="11" class="muted">No strain sections yet. String the first one with the form below.</td></tr>';
    else if (!shown) h += '<tr><td colspan="11" class="muted">No strain section matches the search.</td></tr>';
    h += '</tbody></table>';
    $('tableWrap').innerHTML = h + '<div class="con add" style="margin:10px 8px" id="secFormBox">' + (CT.on ? '<p class="hint">Drawing a conductor: use the panel over the view.</p>' : secFormHtml()) + '</div>';
    // Conductor boxes sized to their text.
    fitCombos($('tableWrap'));
  }
  // Tension of the section being strung: automatic (DCSH Part 10 table for the ruling span), else the only standard value,
  // else what the user picked. f.tmode: 'auto' | 'default' | 'manual'.
  function fillTension(f, mem, ts) {
    if (f.tensionUser) { f.tmode = 'manual'; return; }
    var at = f.cond && mem.length > 1 ? autoTension(f.cond, membersRs(mem)) : null;
    if (at) { f.tension = String(at.value); f.units = at.units; f.table = at.table; f.tsrc = at.note; f.tmode = 'auto'; return; }
    if (f.cond && ts.length === 1) { f.tension = String(ts[0].value); f.units = ts[0].units; f.table = ts[0].table || ''; f.tsrc = ts[0].note; f.tmode = 'default'; return; }
    f.tension = ''; f.table = ''; f.tsrc = ''; f.tmode = '';
  }
  function tmodeTag(f) { return f.tmode === 'auto' ? '<span class="tag der" title="' + esc(f.tsrc) + '">auto by span</span>' : f.tmode === 'default' ? '<span class="tag src" title="' + esc(f.tsrc) + '">default</span>' : f.tmode === 'manual' ? '<span class="tag edit">manual</span>' : ''; }
  // Standard tensions (this project and DCSH Part 10 tables) in a list; a typed value only when no standard value exists.
  function tensionPicker(f, ts, bad) {
    var typed = '<input data-secf="tension" value="' + esc(f.tension) + '" inputmode="decimal" placeholder="tension" style="width:70px"' + (bad ? ' class="invalid"' : '') + '>';
    if (f.typeT && ts.length) return typed + ' <select data-secf="tpick" style="width:auto"><option value="type" selected>typed</option><option value="auto">Auto</option>' + ts.map(function (t, i) { return '<option value="' + i + '">' + esc(t.label) + '</option>'; }).join('') + '</select>';
    if (!ts.length) return '<input data-secf="tension" value="' + esc(f.tension) + '" inputmode="decimal" placeholder="no standard value"' + (bad ? ' class="invalid"' : '') + '>';
    var cur = ts.filter(function (t) { return String(t.value) === String(f.tension) && t.units === f.units && (t.table || '') === (f.table || ''); })[0] || ts.filter(function (t) { return String(t.value) === String(f.tension) && t.units === f.units; })[0];
    return '<select data-secf="tpick"' + (bad ? ' class="invalid"' : '') + ' title="' + esc(cur ? cur.note : '') + '"><option value="auto"' + (f.tmode === 'auto' || f.tmode === 'default' ? ' selected' : '') + '>Auto' + (f.tmode === 'auto' || f.tmode === 'default' ? ' (' + esc(f.tension + ' ' + f.units) + ')' : '') + '</option>' +
      ts.map(function (t, i) { return '<option value="' + i + '"' + (f.tmode === 'manual' && t === cur ? ' selected' : '') + ' title="' + esc(t.note) + '">' + esc(t.label) + ' · ' + esc(t.note) + '</option>'; }).join('') + '<option value="type">Type a value…</option></select>';
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
    var mem = CT.on && CT.chain.length < 2 ? [] : sectionMembers(f), c = conductorFor(f.cond);
    fillTension(f, mem, ts);
    var ck = secChecks(f, mem, c, gis, ts);
    var poleSel = function (key, cur, label) { return '<select data-secf="' + key + '" aria-label="' + label + '">' + ids.map(function (i) { return '<option' + (i === cur ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('') + '</select>'; };
    var h = '<div class="con-title">String conductors (new strain section)</div>' + chipRow('cmat', condFilter, COND_MAT) + '<div class="secform">' +
      '<div class="field f-pole"><label>From pole</label>' + poleSel('from', f.from, 'From pole') + '</div><div class="field f-pole"><label>To pole</label>' + poleSel('to', f.to, 'To pole') + '</div>' +
      '<div class="field f-circ"><label title="Construction code prefix that carries the circuit, with how many poles in the range have it">Circuit</label><select data-secf="level" aria-label="Circuit">' + (levels.length ? levels.map(function (l) { return '<option value="' + esc(l) + '"' + (l === f.level ? ' selected' : '') + '>' + esc(l) + ' · ' + Object.keys(counts[l]).length + ' of ' + run.length + ' poles</option>'; }).join('') : '<option value="">Add constructions first</option>') + '</select></div>' +
      '<div class="field f-cond"><label>Conductor</label>' + combo('secNewCond', { value: f.cond, placeholder: 'Search conductor…', aria: 'Conductor for the new strain section', groups: function () { return conductorGroups(f.from, f.level); }, emptyText: 'import the PNW library tables or link a project with conductors.', onPick: function (v) { f.cond = v; f.condUser = true; f.gis = null; refreshSecForm(); } }) + '</div>' +
      '<div class="field f-ten"><label>Tension ' + tmodeTag(f) + '</label>' + tensionPicker(f, ts, ck.bad.tension) + '</div>' +
      '<div class="field f-un"><label>Units</label><select data-secf="units"><option' + (f.units === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (f.units === 'kN' ? ' selected' : '') + '>kN</option></select></div>' +
      '<div class="field f-add"><button class="btn small primary" id="secAdd" title="Add strain section" aria-label="Add strain section"' + (ck.ok ? '' : ' disabled') + '>' + ico('file-plus').replace('width="20" height="20"', 'width="15" height="15"') + ' Add</button></div></div>';
    if (c) h += '<p class="meta"><b>' + esc(c.code) + '</b> ' + esc(c.name || '') + (c.name2 ? ' · ' + esc(c.name2) : '') + (c.material ? ' · ' + esc(c.material) : '') + (c.cbl != null ? ' · CBL ' + c.cbl + ' kN' : '') + (c.mass != null ? ' · ' + c.mass + ' kg/m' : '') + '</p>';
    h += mem.length ? '<p class="meta">' + mem.map(function (m) { var pc = m.c ? parsedCon(m.id, m.c.unique) : null; return '<b>' + esc(m.id) + '</b> ' + (m.options.length > 1 ? '<select data-secpick="' + esc(m.id) + '" aria-label="Construction on ' + esc(m.id) + '">' + m.options.map(function (o) { return '<option value="' + esc(o.unique) + '"' + (o === m.c ? ' selected' : '') + '>' + esc(o.descr) + '</option>'; }).join('') + '</select>' : m.c ? esc(m.c.descr) : '<span class="pill bad">no ' + esc(f.level || '') + ' construction</span>') + (pc ? ' <small class="muted">' + pc.attachments.length + ' pts</small>' : ''); }).join(' → ') + '</p>' : '';
    if (ck.preview) h += '<p class="meta">' + ck.preview + '</p>';
    h += '<ul class="msgs">' + ck.msgs.map(function (m) { return '<li class="' + m.level + '">' + m.text + '</li>'; }).join('') + '</ul>';
    h += '<p class="hint explain">Each pole in between is included in line order. Conductors attach to the chosen construction\'s attachment points; the number of wires is the smallest number of attachment points along the section. The conductor is copied from the PNW library into the project. Load conditions are copied from an existing section, or Hot 75 °C, standard 15 °C, Uplift 0 °C and Warm 40 °C. PNW works out the sags and tiploads when you open the file.</p>';
    return h;
  }
  // Checks on the new strain section before it can be added: errors block it, warnings and notes are shown.
  function secChecks(f, mem, c, gis, ts) {
    var msgs = [], bad = {}, E = function (t, k) { msgs.push({ level: 'error', text: t }); if (k) bad[k] = 1; }, W = function (t) { msgs.push({ level: 'warning', text: t }); }, I = function (t) { msgs.push({ level: 'info', text: t }); };
    if (mem.length < 2) E('Choose two different poles.');
    if (!f.level) E('There are no constructions on these poles yet. Add them in the inspector (Constructions tab) first.');
    var missing = mem.filter(function (m) { return !m.c; });
    if (f.level && missing.length) E('No ' + esc(f.level) + ' construction on ' + esc(missing.map(function (m) { return m.id; }).join(', ')) + '. Add one in the inspector, or choose a shorter range.');
    var pts = mem.filter(function (m) { return m.c; }).map(function (m) { var pc = parsedCon(m.id, m.c.unique), n = pc ? pc.attachments.length : 0, lay = n ? null : knownLayout(m.c.code); return { id: m.id, descr: m.c.descr, n: n || (lay ? lay.attachments.length : 0), fill: lay && lay.attachments.length ? lay.source : '' }; });
    var none = pts.filter(function (x) { return !x.n; }), fill = pts.filter(function (x) { return x.fill; });
    if (fill.length) I(esc(fill.map(function (x) { return x.id + ' ' + x.descr; }).join(', ')) + ': attachment points will be added from the ' + esc(fill[0].fill) + '.');
    if (none.length) E(esc(none.map(function (x) { return x.id + ' ' + x.descr; }).join(', ')) + ' ' + (none.length > 1 ? 'have' : 'has') + ' no attachment points in DCSH, your projects or the PNW construction database, so no wire can be strung. Change the construction code.');
    var ns = pts.map(function (x) { return x.n; }).filter(Boolean), nmin = ns.length ? Math.min.apply(null, ns) : 0;
    if (ns.length && Math.max.apply(null, ns) !== nmin) W('Attachment points differ along the section (' + esc(pts.map(function (x) { return x.id + ' ' + x.n; }).join(', ')) + '), so ' + nmin + ' wire' + (nmin === 1 ? '' : 's') + ' will be strung.');
    pts.forEach(function (x) { var used = project.segPoles.filter(function (s) { return s.id === x.id && s.constr === x.descr; }).map(function (s) { return s.strsection; }); if (used.length && U.help) W(esc(x.id + ' ' + x.descr) + ' already carries ' + esc(used.join(', ')) + '.'); });
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
      if (q && !smartScore(q, id + ' ' + cons.map(function (c) { return c.descr + ' ' + c.code; }).join(' '))) return;
      h += '<tr class="group" data-id="' + esc(id) + '"><td colspan="12">' + esc(id) + ' <small class="muted">ch ' + esc(r.Distance) + ' m · ' + esc(r.Length) + ' m pole · ' + esc(r.HeightAG) + ' m above ground' + (cons.length ? '' : ' · no constructions') + '</small></td></tr>';
      cons.forEach(function (c) {
        var secs = carry[id + '|' + c.descr] || [], conds = secs.map(function (s) { return s + ' ' + (segCond[s] || ''); }).join(', ');
        var over = c.kingbolt != null && PNW.num(r.HeightAG) != null && c.kingbolt > PNW.num(r.HeightAG);
        if (!c.attachments.length) { n++; h += '<tr data-id="' + esc(id) + '"><td></td><td>' + esc(c.descr) + '</td><td>' + esc(c.code) + '</td><td class="num' + (over ? ' miss' : '') + '">' + fmt(c.kingbolt) + '</td><td colspan="3" class="miss">no attachment points</td><td>' + esc(conds) + '</td><td>' + esc(c.source ? c.source.kind : '') + '</td><td></td></tr>'; return; }
        c.attachments.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (a) {
          n++;
          var hag = c.kingbolt != null ? Math.round((c.kingbolt + a.y) * 1000) / 1000 : null, pt = (dm.points || []).filter(function (p) { return p.pole === id && p.construction === (c.descr || c.code) && p.order === a.order; })[0];
          h += '<tr data-id="' + esc(id) + '"><td></td><td>' + esc(c.descr) + '</td><td>' + esc(c.code) + '</td><td class="num' + (over ? ' miss' : '') + '">' + fmt(c.kingbolt) + '</td><td class="num">' + a.order + '</td><td class="num"><b>' + fmt(hag, 3) + '</b></td><td class="num">' + (pt ? fmt(pt.elevation, 3) : '') + '</td><td>' + esc(conds) + '</td><td>' + esc(c.source ? c.source.kind : '') + '</td><td>' + (over ? '<span class="pill bad">above tip</span>' : '') + '</td></tr>';
        });
      });
    });
    if (!n && !h) { $('tableWrap').innerHTML = '<p class="status" style="padding:14px">' + (q ? 'Nothing matches the search.' : 'No constructions in the linked project yet.') + '</p>'; return; }
    $('tableWrap').innerHTML = '<table class="grid"><thead><tr><th>Pole</th><th>Construction</th><th>Code</th><th class="num">King bolt AG (m)</th><th class="num">#</th><th class="num">Height AG (m)</th><th class="num">Elevation (m)</th><th>Carries</th><th>King bolt source</th><th></th></tr></thead><tbody>' + h + '</tbody></table>';
  }
  $('tableWrap').addEventListener('change', secChange);
  function secChange(e) {
    var t = e.target, d = t.dataset;
    if (d.secf) {
      var v = t.value.trim();
      if (d.secf === 'tension') { secForm.tension = v; secForm.tensionUser = v !== ''; secForm.table = ''; secForm.tsrc = ''; }
      else if (d.secf === 'tpick') { secForm.typeT = v === 'type'; if (v === 'type') { secForm.tensionUser = true; secForm.table = ''; secForm.tsrc = ''; } else if (v === 'auto') secForm.tensionUser = false; else { var tp = tensionSuggestions(secForm.cond)[+v]; if (tp) { secForm.tension = String(tp.value); secForm.units = tp.units; secForm.table = tp.table || ''; secForm.tsrc = tp.note; secForm.tensionUser = true; } } }
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
      if (S.design.tensionAuto) delete S.design.tensionAuto[n];
      commit(function (p) { var sg = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = sg.Tension + ' ' + sg.TensionUnits; M.updateSection(p, n, d.secten != null ? { tension: tv } : { units: t.value }); return [logEntry('', n, 'Tension', from, sg.Tension + ' ' + sg.TensionUnits, 'manual')]; });
    }
  }
  function refreshSecForm() { var box = CT.on ? $('ctForm') : $('secFormBox'); if (box && project) { box.innerHTML = secFormHtml(); fitCombos(box); } if (CT.on) ctDraw(); }
  // Search boxes in the conductor schedule and the string-conductors form are sized to their text.
  function fitCombos(root) { if (root) Array.prototype.forEach.call(root.querySelectorAll('td.fitc .combo input, .secform .combo input'), function (el) { el.style.width = 'calc(' + Math.max(6, (el.value || 'Search conductor').length + 1) + 'ch + 30px)'; }); }
  $('tableWrap').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b && tab === 'sections') { var tr = e.target.closest('tr[data-sec]'); if (tr && !e.target.closest('input,select,.combo')) { var mem0 = project.segPoles.filter(function (x) { return x.strsection === tr.dataset.sec; })[0]; select(S.selected || (mem0 && mem0.id) || null, { segment: S.selSection === tr.dataset.sec ? '' : tr.dataset.sec }); } return; }
    if (!b || tab !== 'sections') return;
    if (b.dataset.secauto) { var an = b.dataset.secauto, sg0 = project.segments.filter(function (x) { return x.StrainSect === an; })[0], ids0 = project.segPoles.filter(function (x) { return x.strsection === an; }).map(function (x) { return x.id; }), sp0 = spansOf(ids0);
      if (!sg0 || !sp0.length || !autoTension(sg0.Conductor, M.rulingSpan(sp0))) { setStatus('No DCSH Part 10 table for ' + (sg0 ? sg0.Conductor : an) + ' covers this ruling span, so the tension stays manual.', 'bad'); return; }
      (S.design.tensionAuto = S.design.tensionAuto || {})[an] = true; recompute(); setStatus(an + ' now follows its ruling span.', 'good'); return; }
    if (b.dataset.chip) { condFilter = b.dataset.chip.split(':')[1]; refreshSecForm(); return; }
    if (b.dataset.tpick != null) { var ts = tensionSuggestions(secForm.cond)[+b.dataset.tpick]; if (ts) { secForm.tension = String(ts.value); secForm.units = ts.units; secForm.table = ts.table || ''; secForm.tsrc = ts.note; secForm.tensionUser = true; } refreshSecForm(); return; }
    if (b.dataset.secdel != null) { var n = b.dataset.secdel; if (S.selSection === n) S.selSection = null; commit(function (p) { M.removeSection(p, n); return [logEntry('', n, 'Strain section', n, 'removed', 'manual')]; }); return; }
    if (b.id === 'secAdd') secAddNow();
  });
  function secAddNow() {
    {
      var f = secForm, c = conductorFor(f.cond), mem = sectionMembers(f), gis = circuitOf(f.level) ? gisConductorsAt(f.from, circuitOf(f.level)) : [], ck = secChecks(f, mem, c, gis, c ? tensionSuggestions(f.cond) : []);
      if (!ck.ok) { setStatus(ck.msgs.filter(function (m) { return m.level === 'error'; })[0].text.replace(/<[^>]+>/g, ''), 'bad'); refreshSecForm(); return; }
      var added = null;
      commit(function (p) {
        fillBare(p, mem.map(function (m) { return m.c.unique; }));
        var name = added = M.addSection(p, { conductor: c, tension: PNW.num(f.tension), units: f.units, poles: mem.map(function (m) { return { id: m.id, unique: m.c.unique }; }) });
        if (f.table) (S.design.tables = S.design.tables || {})[name] = f.table;
        if (f.tmode === 'auto') (S.design.tensionAuto = S.design.tensionAuto || {})[name] = true;
        return [logEntry(mem[0].id + '→' + mem[mem.length - 1].id, name, 'Strain section', '', c.code + ' at ' + f.tension + ' ' + f.units + ' on ' + mem.map(function (m) { return m.id + ' ' + m.c.descr; }).join(', '), f.gis && !f.condUser ? 'calculated' : 'manual', [lib && lib.conductors.indexOf(c) >= 0 ? 'PNW library ' + c.code : '', f.gis && !f.condUser ? 'GIS ' + f.gis.description + ' on feeder ' + f.gis.feeder + ' (' + f.gis.runs.join(', ') + ')' : '', f.tsrc ? 'tension from ' + f.tsrc : ''].filter(Boolean).join('; '))];
      });
      if (added) { secForm = { tension: '', units: f.units, from: f.from, to: f.to, level: f.level }; CT.chain = []; select(S.selected, { segment: added }); setStatus('Added strain section ' + added + '.', 'good'); if (CT.on) ctRender(); }
    }
  }
  function renderLog() {
    var l = liveLog(), lq = $('search').value.trim();
    if (lq && l.length) l = l.filter(function (x) { return smartScore(lq, [x.pole, x.construction, x.field, x.original, x.proposed, x.approved, x.source, x.ref, x.by].join(' ')); });
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
      chipRow('arr', conFilter.arr, [['all', 'Any arr.'], ['intermediate', 'Interm.'], ['strain', 'Strain/angle'], ['termination', 'Term.'], ['tee-off', 'Tee-off']]);
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
  // Default tension by span: the DCSH Part 10 table for this conductor whose ruling-span range holds the section's ruling span.
  function autoTension(code, rs) {
    var c = conductorFor(code); if (!c || !(rs > 0)) return null;
    var hits = tablesFor(c).filter(function (x) { return x.table.spanMin != null && rs >= x.table.spanMin - 1e-9 && rs <= x.table.spanMax + 1e-9; }).sort(function (a, b) { return a.table.spanMin - b.table.spanMin; });
    if (!hits.length) return null;
    var x = hits[0];
    return { value: x.pct, units: '%CBL', table: x.table.id, note: x.table.title + ' (DCSH Part 10 p' + x.table.page + ') for ruling span ' + rs.toFixed(1) + ' m' + (hits.length > 1 ? '; also fits ' + hits.slice(1).map(function (h) { return h.table.title; }).join(', ') : '') };
  }
  function membersRs(mem) { var sp = spansOf(mem.map(function (m) { return m.id; })); return sp.length ? M.rulingSpan(sp) : null; }
  // Sections on automatic tension follow their ruling span: when a span changes, the tension is re-read from DCSH Part 10.
  // A tension typed or picked by hand switches the section to manual and is never overwritten.
  function autoTensionSync() {
    var auto = S.design.tensionAuto; if (!project || !auto) return;
    var p = null, entries = [];
    Object.keys(auto).forEach(function (name) {
      var seg = project.segments.filter(function (x) { return x.StrainSect === name; })[0]; if (!seg) { delete auto[name]; return; }
      var ids = project.segPoles.filter(function (x) { return x.strsection === name; }).map(function (x) { return x.id; }), sp = spansOf(ids);
      var at = sp.length ? autoTension(seg.Conductor, M.rulingSpan(sp)) : null;
      if (!at || (PNW.num(seg.Tension) === at.value && seg.TensionUnits === at.units)) return;
      p = p || M.readPnwx(projectXml()); M.updateSection(p, name, { tension: at.value, units: at.units }); (S.design.tables = S.design.tables || {})[name] = at.table;
      entries.push(logEntry('', name, 'Tension', seg.Tension + ' ' + seg.TensionUnits, at.value + ' ' + at.units, 'calculated', at.note));
    });
    if (p) { S.design.xml = M.writePnwx(p); S.design.log = liveLog().concat(entries); syncDesign(); }
  }
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
    var itTxt = function (it) { return it.value + ' ' + (it.label || '') + ' ' + (it.note || '') + ' ' + (it.keys || ''); };
    var gs = o.groups().map(function (g, gi) { var items = smartRank(q, g.items, itTxt).slice(0, 80); return { g: g, items: items, gi: gi, top: words.length && items.length ? smartScore(q, itTxt(items[0])) : 0 }; });
    if (words.length) gs.sort(function (x, y) { return y.top - x.top || x.gi - y.gi; });
    gs.forEach(function (G) {
      var g = G.g, items = G.items;
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
      if (o && o.blurClear) comboClose(true); else if (o && typed !== (o.value || '') && exact) comboPick(exact); else if (o && o.free && typed && typed !== (o.value || '')) comboPick(null, typed); else comboClose(true);
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
    var r = registerRows().filter(function (x) { return x.code === code && x.attachments.length && !x.fromLibrary; });
    if (r.length) return { attachments: r[0].attachments, source: 'your project ' + r[0].sources[0] };
    var db = ((window.PNW_BUILTIN || {}).dbLayouts || []).filter(function (x) { return x.code === code; })[0];
    if (db && db.attachments.length) return { attachments: db.attachments, source: 'PNW construction database (Western Power set)' };
    var b = ((window.PNW_BUILTIN || {}).layouts || []).filter(function (x) { return x.code === code; })[0];
    return b ? { attachments: b.attachments, source: b.source } : null;
  }
  // Constructions saved without attachment points get them from the known layout of their code before a wire is strung.
  function fillBare(p, uniques) { var n = 0; uniques.forEach(function (u) { var r = p.constructions.filter(function (x) { return x.unique === String(u); })[0]; if (!r || String(r.attachHt || '').trim()) return; var lay = knownLayout(r.code); if (lay && lay.attachments.length) { M.updateConstruction(p, r.unique, { attachments: lay.attachments }); n++; } }); return n; }
  function poleTypeOptions(cur, keepLabel) {
    return '<option value="">' + keepLabel + '</option>' + (lib ? lib.poles : []).map(function (t) { return '<option value="' + esc(t.code) + '"' + (t.code === cur ? ' selected' : '') + '>' + esc(t.code) + (t.description ? ' · ' + esc(t.description) : '') + '</option>'; }).join('');
  }
  // Setting depth rule from the ground profile: 10% of the pole length + 0.6 m.
  function defaultSunk(L) { return Math.round((L * 0.1 + 0.6) * 100) / 100; }
  function poleBlock(id, row, pt) {
    var inSec = project.segPoles.some(function (s) { return s.id === id; }), next = project.poles[project.poles.indexOf(row) + 1];
    var ptSet = (S.design.poleTypes || {})[id], ptAuto = null; try { ptAuto = poleTypeFor(id, PNW.num(row.Length)); } catch (e) { ptAuto = null; }
    var gap = next ? Math.round((PNW.num(next.Distance) - PNW.num(row.Distance)) / 2 * 100) / 100 : 20;
    var h = '<div class="con"><div class="con-h"><b>Pole ' + esc(id) + '</b>' + (row.New === 'True' ? '<span class="pill info">New</span>' : '') + (pt.poleType ? '<small>' + esc(pt.poleType) + (pt.diamTip ? ' · tip ' + pt.diamTip + ' mm' : '') + '</small>' : '') + '</div>' +
      '<div class="row3"><div class="field' + (ptSet || ptAuto ? '' : ' req') + '"><label>Pole type' + (ptSet || ptAuto ? '' : ' <span class="reqn" title="Tipload needs the PNW pole type">needed for tipload</span>') + '</label><select data-ptype="' + esc(id) + '" title="PNW library pole type' + (ptAuto && !ptSet ? '. Tipload uses ' + esc(ptAuto.code) + (project.tiploads[id] && project.tiploads[id].attrs.poletype === ptAuto.code ? ' (from the PNW file)' : ' (matched from the GIS stock code and length)') + ' until you choose one.' : '') + '">' + poleTypeOptions(ptSet || '', ptAuto ? 'Auto: ' + esc(ptAuto.code) : 'Not set') + '</select></div>' +
      '<div class="field"><label>Length (m)</label><input data-pfield="length" value="' + esc(row.Length) + '" inputmode="decimal"></div><div class="field"><label>Depth (m)</label><input data-pfield="sunk" value="' + esc(row.Sunk) + '" inputmode="decimal" title="Setting depth"></div></div>' +
      '<p class="meta">' + esc(row.HeightAG) + ' m above ground · chainage ' + esc(row.Distance) + ' m · <label><input type="checkbox" data-pnew' + (row.New === 'True' ? ' checked' : '') + '> new pole</label></p>' +
      '<div class="btnrow">' + (inSec ? '<span class="meta">In a strain section, so it cannot be removed here.</span>' : '<button class="btn small" data-pdel="' + esc(id) + '">Remove pole from design</button>') + '</div>' +
      '<details class="addpole"><summary>Add a new pole near ' + esc(id) + '</summary><div class="row2"><div class="field"><label>New pole ID</label><input id="poleAddId" placeholder="e.g. P1"></div><div class="field"><label>Distance from ' + esc(id) + ' (m)</label><input id="poleAddDist" value="' + gap + '" inputmode="decimal" title="Positive is towards the next pole, negative towards the previous one"></div></div>' +
      '<div class="field"><label>Pole type</label><select id="poleAddType">' + poleTypeOptions('', 'Type the length') + '</select></div>' +
      '<div class="row2"><div class="field"><label>Length (m)</label><input id="poleAddLen" value="' + esc(row.Length) + '" inputmode="decimal"></div><div class="field"><label>Setting depth (m)</label><input id="poleAddSunk" placeholder="10% + 0.6 m" inputmode="decimal"></div></div>' +
      '<div class="btnrow"><button class="btn small primary" id="poleAdd" data-from="' + esc(id) + '">Add pole</button></div><p class="hint explain">The new pole goes on the ground line at that distance (positive is towards the next pole), with the ground level read from the profile.</p></details></div>';
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
      h += '<table class="att"><tr><th>Construction</th><th>#</th><th class="num">Height AG (m)</th><th>Carries</th></tr>' + pts.slice().sort(function (a, b) { return b.heightAG - a.heightAG; }).map(function (q) {
        return '<tr><td>' + esc(q.construction) + '</td><td>' + q.order + '</td><td class="num"><b>' + fmt(q.heightAG, 3) + '</b></td><td>' + esc((carry[q.construction] || []).join(', ')) + '</td></tr>';
      }).join('') + '</table>';
    }
    return h;
  }
  function designPanel(id) {
    if (!project) return startDesignHint();
    var row = project.poles.filter(function (r) { return r.ID === id; })[0];
    if (!row) return '<p class="pd-none">' + esc(id) + ' is not in the linked PNW project ' + esc(linked.name) + '.</p>';
    var hag = PNW.num(row.HeightAG), cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
    var h = '';
    if (!cons.length) h += '<p class="pd-none">No constructions on ' + esc(id) + ' yet.</p>';
    else h += '<div class="pd-colh"><span>Code</span><span>King bolt (m)</span></div>';
    cons.forEach(function (c, i) {
      var r = regFor(c), st = statusOf(r), lc = M.libraryConstruction(lib, c.code), def = kbFor(id, c.code, hag, cons.slice(0, i));
      var carries = project.segPoles.filter(function (s) { return s.id === id && s.constr === c.descr; }).map(function (s) { return s.strsection; }).filter(function (v, k, a) { return a.indexOf(v) === k; });
      var src = lastSource(id, c.descr, 'King bolt height'), d = M.dcshFor(dcshReg(), c.code)[0], cmp = d ? M.compareDcsh(d, c, i === 0 ? hag : null) : null;
      var u = esc(c.unique), bad = c.kingbolt != null && hag != null && c.kingbolt > hag, lr = lvRule(id, cons, i), off = lr && lr.value != null && c.kingbolt != null && Math.abs(lr.value - c.kingbolt) > 0.05;
      var hts = c.kingbolt != null ? c.attachments.map(function (a) { return f2(Math.round((c.kingbolt + a.y) * 1000) / 1000, 2); }).filter(function (v, k, arr) { return arr.indexOf(v) === k; }) : [];
      var tip = [c.descr, lc ? lc.description : c.code ? 'Not in the PNW library tables' : ''].filter(Boolean).join(' · ');
      h += '<div class="con pd-con" data-u="' + u + '" title="' + esc(tip) + '"><div class="pd-r1"><div class="pd-code">' + combo('ccode|' + c.unique, { value: c.code, placeholder: 'Search code…', aria: 'Construction code of ' + (c.descr || 'construction'), free: true, groups: function () { return constructionGroups(id); }, onPick: function (v) { changeCode(id, c.unique, v, 'manual', ''); if (!M.libraryConstruction(lib, v) && !knownLayout(v)) setStatus(v + ' is not in the PNW library or your projects: no defaults or offsets are known, so it needs engineering review.', 'bad'); } }) + '</div>' +
        (lc || !c.code ? '' : '<span class="pill warn" title="This code is not in the PNW library tables">?</span>') + lvUnderHvNote(cons, i, id) +
        '<input class="pd-kb' + (bad ? ' invalid' : off ? ' warnin' : '') + '" data-ckb="' + u + '" value="' + fmt(c.kingbolt) + '" inputmode="decimal" aria-label="King bolt height of ' + esc(c.descr || 'construction') + ' (m above ground)" title="' + (bad ? 'Above the pole tip (' + hag + ' m above ground)' : 'King bolt height above ground (m)' + (src === 'manual' ? ', edited' : '')) + '">' +
        (off ? '<button class="pd-def warn" data-cdef="' + u + '" data-v="' + lr.value + '" data-ref="' + esc(lr.src) + '" title="' + esc(lr.src) + '">' + lr.value + ' ↺</button>' : def && c.kingbolt != null && Math.abs(def.value - c.kingbolt) > 0.0005 ? '<button class="pd-def xinfo" data-cdef="' + u + '" data-v="' + def.value + '" data-ref="' + esc(def.source) + '" title="' + esc(def.source) + '">' + def.value + ' ↺</button>' : '') +
        binBtn('data-cdel="' + u + '"', 'Remove ' + (c.descr || 'construction'), carries.length ? 'Carries ' + carries.join(', ') + ': take it out of the conductor schedule first' : '') + '</div>';
      if (cmp && cmp.notes.length) h += '<details class="cwarn xinfo"><summary title="Click for the full DCSH check">⚠ ' + esc(cmp.notes[0]) + '</summary>' + (cmp.notes.length > 1 ? '<p>' + esc(cmp.notes.slice(1).join(' ')) + '</p>' : '') + '</details>';
      // What it carries, in one line: strain section, conductor, tension, attachment heights. Click a section to open it.
      var line = carries.map(function (n) { var sg = project.segments.filter(function (x) { return x.StrainSect === n; })[0] || {}, cd = conductorFor(sg.Conductor); return '<button class="pd-sec' + (S.selSection === n ? ' on' : '') + '" data-secshow="' + esc(n) + '" title="Open strain section ' + esc(n) + '">' + esc(n) + '</button> ' + esc(sg.Conductor || '') + (cd && cd.name ? ' <span class="muted">' + esc(cd.name) + '</span>' : '') + (sg.Tension ? ' · ' + esc(sg.Tension) + ' ' + esc(sg.TensionUnits || '') : ''); }).join('<br>');
      h += (line || hts.length ? '<div class="pd-carry">' + (line || '') : '<div class="pd-carry xinfo">') + statusBadge(st) + (hts.length ? '<span class="pd-hts" title="Attachment heights above ground (' + c.attachments.length + ' points)">' + hts.join(' / ') + ' m</span>' : '') + '</div></div>';
    });
    h += '<details class="con add pd-add" id="conAddBox"' + (conDraft.pole === id && conDraft.open ? ' open' : '') + '><summary>＋ Add construction</summary>' + conAddHtml(id) + '</details>';
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
    out.def = kbFor(id, d.code, x.hag, x.cons);
    if (!out.lc) out.msgs.push({ level: 'warning', text: esc(d.code) + ' is not in the PNW library tables, so there is no default height or voltage. Check the code.' });
    if (!out.lay) out.msgs.push({ level: 'warning', text: 'No attachment offsets are known for ' + esc(d.code) + ' (no dimensioned DCSH drawing, not in your projects and not in the PNW construction database). It will be added without attachment points and needs engineering review.' });
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
    if (conDraft.pole !== id) conDraft = { pole: id, code: '', kb: '', kbUser: false, open: false };
    var pv = conPreview(id);
    return conFilterChips() +
      '<div class="row2"><div class="field"><label>Construction code</label>' + combo('conAdd', { value: conDraft.code, placeholder: 'Search code or description…', aria: 'Construction code to add', free: true, groups: function () { return constructionGroups(id, conFilter); }, onPick: function (v) {
        conDraft.code = v;
        if (!conDraft.kbUser) { var x = conContext(id), df = kbFor(id, v, x.hag, x.cons); conDraft.kb = df ? String(df.value) : ''; }
        refreshConAdd();
      } }) + '</div>' +
      '<div class="field"><label for="conAddKb">King bolt above ground (m)</label><div style="display:flex;gap:4px;align-items:center"><input id="conAddKb" style="flex:1;min-width:0" inputmode="decimal" value="' + esc(conDraft.kb) + '" placeholder="library default">' +
        // Add button sits beside the height (Ishan, 2026-11-02), instead of a separate "Add to <pole>" button below the preview.
        '<button class="btn small primary" id="conAdd" data-pole="' + esc(id) + '" title="Add to ' + esc(id) + '" aria-label="Add to ' + esc(id) + '" style="flex:none;padding:4px 7px;display:inline-flex;align-items:center"' + (pv.ok ? '' : ' disabled') + '><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div></div></div>' +
      '<div id="conAddPrev">' + pv.html + '</div>' +
      '<div class="btnrow"><button class="btn small" id="conKbDefault" title="Go back to the library default height"' + (conDraft.kbUser ? '' : ' hidden') + '>Use default height</button>' + '</div>' +
      '<p class="hint explain">The king bolt starts at the PNW library default (below the tip, or below the construction above). Offsets are copied from a dimensioned DCSH drawing or one of your projects; nothing is made up. Attach the construction to conductors in the Conductor schedule.</p>';
  }
  function refreshConAdd() { var box = $('conAddBox'); if (box && S.selected) box.innerHTML = '<summary>＋ Add construction</summary>' + conAddHtml(S.selected); }
  $('selected').addEventListener('toggle', function (e) { if (e.target.id === 'conAddBox') conDraft.open = e.target.open; }, true);
  function refreshConPreview() { var id = S.selected, el = $('conAddPrev'); if (!el || !id) return; var pv = conPreview(id); el.innerHTML = pv.html; if ($('conAdd')) $('conAdd').disabled = !pv.ok; if ($('conKbDefault')) $('conKbDefault').hidden = !conDraft.kbUser; }
  $('selected').addEventListener('click', function (e) { var so = e.target.closest('[data-pstropen]'); if (so) { e.stopPropagation(); strStart(so.dataset.pstropen, so); return; }
    var b = e.target.closest('[data-pstrgo]'); if (b) { e.stopPropagation(); strApply(b.dataset.pstrgo); } var fx = e.target.closest('[data-pfix]'); if (fx) { e.stopPropagation(); fixFromType([fx.dataset.pfix]); } }, true);
  $('selected').addEventListener('change', function (e) {
    var t = e.target, id = S.selected;
    if (t.dataset.pps) { var ss = strSet(), v0 = t.value.trim(), k0 = t.dataset.pps, po = ss.poles[id] = ss.poles[id] || {};
      if (k0 === 'fb') { var sp0 = strRow(id).species; if (sp0) { if (v0 === '') delete ss.fb[sp0]; else ss.fb[sp0] = parseFloat(v0); } }
      else if (k0 === 'kd' && v0 !== '') { po.kd = parseFloat(v0); }
      else if (v0 === '') delete po[k0]; else po[k0] = k0 === 'species' ? v0 : parseFloat(v0);
      save(); openSection('pstr'); renderSelected(); return; }
    if (t.id === 'poleAddType') { var pt = lib && lib.poles.filter(function (x) { return x.code === t.value; })[0]; if (pt) { $('poleAddLen').value = pt.length; $('poleAddSunk').value = pt.sinking != null ? pt.sinking : ''; } return; }
    if (t.dataset.ptype2 != null) { // pole without a design row: type and length are kept with the profiles
      var ty2 = lib && lib.poles.filter(function (x) { return x.code === t.value; })[0], tp2 = S.design.poleTypes = S.design.poleTypes || {};
      if (ty2) { tp2[id] = ty2.code; setLenOv(id, ty2.length); } else delete tp2[id];
      S.generated = false; recompute(); setStatus(id + ': pole type ' + (ty2 ? ty2.code + ', length ' + ty2.length + ' m.' : 'not set.'), 'good'); return;
    }
    if (t.dataset.plen2 != null) {
      var v2 = PNW.num(t.value);
      if (t.value.trim() === '') setLenOv(id, null);
      else if (!(v2 > 0) || v2 > 60) { setStatus('"' + t.value + '" is not a valid pole length in metres.', 'bad'); renderSelected(); return; }
      else setLenOv(id, v2);
      if (S.design.poleTypes) delete S.design.poleTypes[id];
      S.generated = false; recompute(); setStatus(id + ': length ' + (t.value.trim() === '' ? 'back to the imported value.' : v2 + ' m (setting depth ' + defaultSunk(v2) + ' m).'), 'good'); return;
    }
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
    if (b.id === 'conKbDefault') { var cx = conContext(id), df = kbFor(id, conDraft.code, cx.hag, cx.cons); conDraft.kb = df ? String(df.value) : ''; conDraft.kbUser = false; refreshConAdd(); return; }
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
  function aiLevelFilter(j) { // keep a match only when its circuit level is on the pole by the AI's own account
    var lv = (j && j.levels) || {}, seen = {};
    ((j && j.components) || []).forEach(function (c) { if (!/conductor|wire|phase|neutral/i.test(c.name || '') || c.count == null) return; var k = /hv|high/i.test(c.level) ? 'hv' : /earth/i.test(c.level) ? 'earth' : /lv|low/i.test(c.level) ? 'lv' : null; if (k) seen[k] = (seen[k] || 0) + (Number(c.count) || 0); });
    return function (m) { var k = circuitClass(m.code); return !(lv[k] === false || (k in seen && seen[k] === 0)); };
  }
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
    var r = aiResults[id] || {}, h = '<div class="con ai' + (r.min ? ' min' : '') + '"><div class="ai-tools">' + (r.resp || r.error ? '<button class="btn small" data-aimin title="' + (r.min ? 'Show the AI results' : 'Minimise') + '">' + (r.min ? '▸' : '▾') + '</button><button class="btn small" data-aiclose title="Close and clear the AI results">✕</button>' : '') + '</div><div class="con-title" title="The photo is resized in your browser and sent once to ' + (IN_CLAUDE ? 'Claude on your account' : 'EVE\'s AI service') + '; it is not stored. Nothing changes until you approve a suggestion, and approvals are logged as AI suggestions.">✨ Analyse pole photo with AI</div>';
    if (r.min) return h + '<p class="meta">' + (r.groups ? r.groups.map(function (g) { return CLASS_LABEL[g.cls] + ': ' + (r.approved && r.approved[g.cls] ? r.approved[g.cls] + ' approved' : g.items[0] ? g.items[0].code : '–'); }).join(' · ') : '') + '</p></div>';
    var sv = streetViewUrl(id);
    h += '<div class="btnrow"><label class="btn small"><input type="file" id="aiPhoto" accept="image/jpeg,image/png,image/webp" hidden>' + (r.photo ? 'Another photo…' : 'Choose a photo…') + '</label>' + (sv ? '<button class="btn small" data-ctx="street" title="Street View inside the app, with capture straight into this analysis">🛣 Street View</button>' : '') + '<button class="btn small" data-ctx="photos" title="Add several photos and match them to poles">Import photos…</button>' + '</div>' +
      (IN_CLAUDE ? '<p class="meta">' + (aiRefCount() ? 'Learning from ' + aiRefCount() + ' approved photo' + (aiRefCount() === 1 ? '' : 's') + ' (sent as examples). <a href="#" data-airefclear>Clear</a>' : 'Approved matches are kept as example photos to improve later matches.') + '</p>' : '') +
      '<div class="ai-paste" tabindex="0" title="Paste a snip with Ctrl+V, or drop an image here">Paste a snip here (Ctrl+V) or drop an image. It is attached to ' + esc(id) + ' and analysed at once.</div>' + photoListHtml(id, r);
    if (r.thumb) h += '<img class="ai-thumb" src="' + r.thumb + '" alt="Photo of ' + esc(id) + '">';
    if (r.loading) h += '<p class="status">Looking at ' + esc(r.photo) + '…</p>';
    if (r.error) h += '<p class="hint warn">' + esc(r.error) + '</p>';
    if (r.resp) {
      var x = r.resp;
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
            '<small>' + (lc ? esc(lc.description) : '<span class="muted">not in the PNW library</span>') + (d ? ' · DCSH ' + esc(d.drawing) : '') + '</small>' +
            (same ? '<small class="ok">Already on this pole</small>' :
              done ? '' : '<div class="btnrow"><select data-aitarget="' + gi + '-' + i + '">' + opts + '</select><button class="btn small primary" data-aiok="' + gi + '-' + i + '">Approve</button></div>') + '</div></div>';
        });
        h += '</div>';
      });
      if (!x.matches.length) h += '<p class="hint">No code from your PNW library fits what the AI could see.</p>';
      h += aiCompareHtml(id, r, cons);
    }
    return h + '</div>';
  }
  function streetViewUrl(id) {
    var p = merged.poles[id], ll = p && (poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null));
    if (!ll) { var q = dm && dm.allPoles.filter(function (x) { return x.id === id; })[0]; ll = q ? toLatLng(q.easting, q.northing) : null; }
    return ll ? 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) : null;
  }
  // A snip pasted (Ctrl+V) or dropped while the AI photo tab is open is analysed like a chosen photo.
  function aiImageFrom(items) { for (var i = 0; i < (items ? items.length : 0); i++) { var it = items[i], f = it.getAsFile ? (it.kind === 'file' ? it.getAsFile() : null) : it; if (f && /^image\//.test(f.type)) return f; } return null; }
  document.addEventListener('paste', function (e) {
    if (!S.selected || !merged.poles[S.selected] || !((U.accOpen && U.accOpen.photo && $('aiPhoto')) || !$('svPanel').hidden)) return;
    var f = aiImageFrom(e.clipboardData && e.clipboardData.items); if (!f) return;
    e.preventDefault(); submitPhoto(S.selected, new File([f], 'Street View snip ' + S.selected + '.png', { type: f.type }), { source: 'Street View snip (pasted)' });
  });
  $('selected').addEventListener('dragover', function (e) { if (e.target.closest('.ai-paste')) { e.preventDefault(); e.stopPropagation(); } });
  $('selected').addEventListener('drop', function (e) { var z = e.target.closest('.ai-paste'); if (!z) return; e.preventDefault(); e.stopPropagation(); var f = aiImageFrom(e.dataTransfer && e.dataTransfer.files); if (f) runAi(S.selected, f); });
  $('selected').addEventListener('click', function (e) {
    var m = e.target.closest('[data-aimin]'), c = e.target.closest('[data-aiclose]'), r = aiResults[S.selected];
    if (m && r) { r.min = !r.min; renderSelected(); }
    if (c) { delete aiResults[S.selected]; renderSelected(); }
  });
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
  // Reference photos: approved AI matches are kept (2 per code, small JPEG) and sent with later requests as confirmed examples.
  var AIREF_KEY = 'pnwAiRefs';
  function aiRefs() { try { return JSON.parse(localStorage.getItem(AIREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function aiRefCount() { var o = aiRefs(); return Object.keys(o).reduce(function (n, k) { return n + (o[k] || []).length; }, 0); }
  function aiRefSave(code, view, pole) {
    if (!view) return; var im = new Image();
    im.onload = function () {
      var k = Math.min(1, 512 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      var o = aiRefs(), l = (o[code] || []).filter(function (x) { return x.pole !== pole; }); l.unshift({ pole: pole, img: c.toDataURL('image/jpeg', 0.7).split(',')[1] }); o[code] = l.slice(0, 2);
      try { localStorage.setItem(AIREF_KEY, JSON.stringify(o)); } catch (e) { setStatus('Reference photo not kept: browser storage is full.', 'bad'); }
      if (S.selected === pole) renderSelected();
    };
    im.src = 'data:image/jpeg;base64,' + view.split(',').pop();
  }
  function aiRefPick(pole) { // one per code, most-used codes first, at most 8
    var o = aiRefs(), G = window.PNW_AI_GUIDE || {}, codes = (G.common || []).concat(Object.keys(o)).filter(function (c, i, a) { return a.indexOf(c) === i && o[c] && o[c].length; });
    return codes.map(function (c) { var x = o[c].filter(function (r) { return r.pole !== pole; })[0]; return x && { code: c, pole: x.pole, data: x.img }; }).filter(Boolean).slice(0, 8);
  }
  function aiPrompt(id, existing) { // photo estimates only: heights and dimensions are never asked of the AI
    return 'You help an Australian power distribution designer. Look at the attached photo of pole ' + id + '. Identify the overhead line hardware you can see and rank which of these Poles n Wires construction codes describe each circuit level (HV, LV, running earth).\n' +
      'A construction code covers a whole circuit, not one conductor: one HV1 carries all three HV phases and one LV1 carries all four LV conductors (R W B N). Return at most 3 alternative codes per circuit level, ranked, and never repeat a code for each conductor. In components, count the conductors on each level (name "conductors", level HV, LV or earth).\n' +
      'Rules: only use codes from the list; if nothing fits a level, return no match for it. Describe only visible hardware (crossarms, insulator type: pin, post, disc/strain, reel; conductors per level; terminations; angle or straight; stays; pole top plant). Confidence 0 to 1, below 0.5 when the photo does not show the hardware clearly. Do not estimate dimensions, heights or pole strength.\n' +
      'Also report what you can see of stays (count), a pole-mounted transformer (present or not) and the conductors on each level; for conductors only name a code from the conductor list below, or null. If a pole number is legible, report it. List anything you cannot tell (field checks). Never present a guess as measured.\n' +
      'Many poles carry LV only, with no HV. First decide which circuit levels are actually on this pole from the photo alone. Only return an HV match when HV conductors and HV insulators are clearly visible on this pole (taller insulators, wider phase spacing, above the LV). Never add a level because it is common, because it is in the design, or because a reference photo shows it. Return no matches for a level that is not on the pole and set it false in "levels".\n' +
      'The PNW design currently lists: ' + (existing.join(', ') || 'none') + '. This may be a proposal or wrong: do not copy it; judge only from the photo.\n' +
      'Candidate conductor codes (code | name | material): ' + aiConductors(id).map(function (c) { return c.code + ' | ' + c.name + ' | ' + c.material; }).join('; ') + '\n' +
      (window.PNW_AI_GUIDE ? 'How to read the photo:\n' + PNW_AI_GUIDE.rules.map(function (x, k) { return (k + 1) + '. ' + x; }).join('\n') + '\n' : '') +
      'Candidate codes (code | description | DCSH | phases | what it looks like):\n' + aiCandidates().map(function (c) { return c.code + ' | ' + (c.description || '') + ' | ' + (c.dcsh || '') + ' | ' + (c.phases || '') + ' | ' + ((window.PNW_AI_GUIDE && PNW_AI_GUIDE.looks[c.code]) || ''); }).join('\n') +
      '\nReturn JSON only: {"photo_quality":string,"levels":{"hv":boolean,"lv":boolean,"earth":boolean},"pole_number":string|null,"components":[{"name":string,"level":string,"count":number|null,"confidence":number}],"matches":[{"level":string,"code":string,"rank":number,"confidence":number,"reasons":[string]}],"stays":{"count":number|null,"confidence":number,"notes":string},"transformer":{"present":boolean|null,"confidence":number,"notes":string},"conductors":[{"level":string,"count":number|null,"code":string|null,"confidence":number,"notes":string}],"field_checks":[string],"cautions":[string]}';
  }
  /* ---- Auto design: profile from QLINK, constructions from pole photos (or a Street View image aimed at the pole when there is
     no photo), strain sections from strain/termination constructions, conductor from the photo or the GIS feeder, tension by
     ruling span, LV heights by the separation rule. Everything is proposed on one review screen; nothing changes until Apply. ---- */
  var AD = { busy: false, plan: null };
  function bearingTo(a, b) {
    var r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  // Street View image of the pole: nearest outdoor panorama within 50 m, turned toward the pole, pitched to take in its top.
  function svImageFor(id) {
    var key = gmKey(), ll = poleLL(id); if (!ll) return Promise.resolve(null);
    if (!key) return IN_CLAUDE || webMapsOn() ? Promise.resolve(svMcpImage(id, ll)).catch(function () { return null; }) : Promise.resolve(null);
    return loadGmaps(key).then(function (gm) {
      return new Promise(function (res) {
        new gm.StreetViewService().getPanorama({ location: new gm.LatLng(ll.lat, ll.lng), radius: 50, source: 'outdoor' }, function (data, status) {
          if (status !== 'OK' || !data) return res(null);
          var at = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() }, dist = Math.max(3, L.latLng(at.lat, at.lng).distanceTo(ll));
          var row = project && project.poles.filter(function (r) { return r.ID === id; })[0], hag = row ? PNW.num(row.HeightAG) || 9 : 9;
          var pitch = Math.max(0, Math.min(40, Math.atan2(hag * 0.6 - 2.5, dist) * 180 / Math.PI)), heading = bearingTo(at, ll);
          var url = 'https://maps.googleapis.com/maps/api/streetview?size=1280x960&pano=' + encodeURIComponent(data.location.pano) + '&heading=' + heading.toFixed(1) + '&pitch=' + pitch.toFixed(1) + '&fov=70&key=' + encodeURIComponent(key);
          fetch(url, { mode: 'cors' }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
            res(b ? { file: new File([b], 'Street View ' + id + ' (auto).jpg', { type: 'image/jpeg' }), meta: { source: 'Street View (auto, ' + Math.round(dist) + ' m away' + (data.imageDate ? ', ' + data.imageDate : '') + ')', pov: { heading: Math.round(heading), pitch: Math.round(pitch), fov: 70, pano: data.location.pano } } } : null);
          }, function () { res(null); });
        });
      });
    }, function () { return null; });
  }
  function aiWait(id) { return new Promise(function (res) { (function t() { var r = aiResults[id]; if (!r || !r.loading) return res(r || null); setTimeout(t, 250); })(); }); }
  // The AI result for one pole: reuse an earlier analysis, else the newest attached photo, else Street View.
  function aiFor(id) {
    var r = aiResults[id]; if (r && r.resp) return Promise.resolve(r);
    var ph = photosOf(id), rec = ph[ph.length - 1];
    var viaPhoto = rec ? photoData(rec).then(function (d) { if (!d) return false; runAi(id, new File([b64Blob(d)], rec.name, { type: 'image/jpeg' }), { noAttach: true, photoId: rec.id, source: rec.source }); return true; }) : Promise.resolve(false);
    return viaPhoto.then(function (ok) {
      if (ok) return aiWait(id);
      return svImageFor(id).then(function (sv) { if (!sv) return null; runAi(id, sv.file, sv.meta); return aiWait(id); });
    });
  }
  function aiCls(level) { return /earth|^re/i.test(level) ? 'earth' : /hv/i.test(level) ? 'hv' : /lv/i.test(level) ? 'lv' : null; }
  var AD_ORDER = { hv: 0, earth: 1, lv: 2 };
  function adPlan() {
    var ids = project.poles.map(function (r) { return r.ID; }), plan = { poles: [], sections: [], missing: [], notes: [] };
    ids.forEach(function (id) {
      var r = aiResults[id], resp = r && r.resp, have = {}, P = { id: id, src: r && r.source, thumb: r && r.thumb, view: r && r.view, picks: [] };
      ((dm && dm.byPole[id]) || []).forEach(function (c) { have[circuitClass(c.code)] = c.code; });
      P.have = have;
      if (!resp) { plan.missing.push(id + ': ' + ((r && r.error) || (photosOf(id).length ? 'the photo could not be read' : gmKey() ? 'no photo and no Street View within 50 m' : (IN_CLAUDE || webMapsOn() ? 'no photo, and no Street View near the pole' : 'no photo (add a Google Maps key to use Street View)')))); plan.poles.push(P); return; }
      var best = {};
      resp.matches.slice().sort(function (a, b) { return a.rank - b.rank || b.confidence - a.confidence; }).forEach(function (m) { var k = circuitClass(m.code); if (AD_ORDER[k] != null && !best[k]) best[k] = m; });
      Object.keys(best).sort(function (a, b) { return AD_ORDER[a] - AD_ORDER[b]; }).forEach(function (k) {
        var m = best[k]; if (have[k]) return;
        P.picks.push({ cls: k, code: m.code, conf: m.confidence, on: m.confidence >= 0.5, why: m.reasons[0] || '', ref: 'Photo ' + r.photo + ', ' + m.level + ' rank ' + m.rank + ', ' + Math.round(m.confidence * 100) + '% (' + resp.model + ')' });
      });
      var o = resp.obs || {};
      if (o.stays && o.stays.count) plan.notes.push(id + ': ' + o.stays.count + ' stay' + (o.stays.count > 1 ? 's' : '') + ' seen (' + Math.round(o.stays.confidence * 100) + '%). Add in Equipment if correct.');
      if (o.transformer && o.transformer.present) plan.notes.push(id + ': transformer seen (' + Math.round(o.transformer.confidence * 100) + '%). Add in Equipment if correct.');
      P.obs = o; plan.poles.push(P);
    });
    adSections(plan); return plan;
  }
  // Sections per circuit, from the ticked proposals plus what is already on the poles: a run of consecutive poles carrying the
  // circuit, cut at every strain, termination or tee-off construction. Sections already strung are left alone.
  function adSections(plan) {
    var strung = {}; project.segPoles.forEach(function (s) { var c = ((dm && dm.byPole[s.id]) || []).filter(function (x) { return x.descr === s.constr; })[0]; if (c) strung[s.id + '|' + circuitClass(c.code)] = 1; });
    plan.sections = [];
    ['hv', 'earth', 'lv'].forEach(function (k) {
      var run = [];
      var flush = function () {
        if (run.length < 2) { run = []; return; }
        var cut = [0]; for (var i = 1; i < run.length - 1; i++) if (/termination|strain|tee-off/.test(run[i].arr)) cut.push(i); cut.push(run.length - 1);
        for (var j = 1; j < cut.length; j++) { var mem = run.slice(cut[j - 1], cut[j] + 1); if (!mem.every(function (m) { return strung[m.id + '|' + k]; })) plan.sections.push(adSection(plan, k, mem)); }
        run = [];
      };
      plan.poles.forEach(function (P) {
        var pk = P.picks.filter(function (x) { return x.cls === k && x.on; })[0], code = P.have[k] || (pk && pk.code);
        if (!code) { flush(); return; }
        var lc = M.libraryConstruction(lib, code);
        run.push({ id: P.id, code: code, arr: arrangementOf(lc && lc.description), P: P });
      });
      flush();
    });
    (plan.extra || []).forEach(function (x) {
      if (plan.sections.some(function (s) { return s.cls === x.cls && s.ids.join() === x.ids.join(); })) return;
      var mem = adMembers(plan, x.cls, x.ids); if (mem.ok) { var s1 = adSection(plan, x.cls, mem); s1.user = true; plan.sections.push(s1); }
    });
  }
  // Empties an add-row search box after Add (its blur handler can pick the typed text a moment later).
  function adClearDraft(key, f) { setTimeout(function () { AD.draft[f] = ''; if (combos[key]) combos[key].value = ''; var ci = comboInput(key); if (ci) ci.value = ''; }, 200); }
  function adKey(k, ids) { return k + '|' + ids.join(','); }
  // A construction picked or added by hand in the review: the user's code replaces the AI's.
  function adSetPick(P, x, v) { x.code = v; x.cls = circuitClass(v); x.on = true; x.conf = 1; x.user = true; x.why = 'Picked by you'; x.ref = 'Picked by the designer in Auto design'; adSections(AD.plan); adShow(); }
  // Poles of a hand-added section with their construction on that circuit (existing, or ticked in the review).
  function adMembers(plan, k, ids) {
    var out = [], missing = [];
    ids.forEach(function (id) { var P = plan.poles.filter(function (q) { return q.id === id; })[0] || { id: id, picks: [], have: {} }, pk = P.picks.filter(function (x) { return x.cls === k && x.on; })[0], code = P.have[k] || (pk && pk.code); if (!code) missing.push(id); else { var lc = M.libraryConstruction(lib, code); out.push({ id: id, code: code, arr: arrangementOf(lc && lc.description), P: P }); } });
    out.ok = !missing.length; out.missing = missing; return out;
  }
  function adSection(plan, k, mem) {
    var S1 = { cls: k, ids: mem.map(function (m) { return m.id; }), codes: mem.map(function (m) { return m.code; }), on: true, flags: [] }, votes = {};
    mem.forEach(function (m) { ((m.P.obs && m.P.obs.conductors) || []).forEach(function (c) { if (c.code && aiCls(c.level) === k) votes[c.code] = (votes[c.code] || 0) + (c.confidence || 0.1); }); });
    var vc = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
    var mine = plan.condPick && plan.condPick[adKey(k, S1.ids)];
    if (mine) { S1.cond = mine; S1.csrc = 'picked by you'; }
    else if (vc) { S1.cond = vc; S1.csrc = 'photo (' + Object.keys(votes).length + ' type' + (Object.keys(votes).length > 1 ? 's' : '') + ' seen)'; }
    else if (k !== 'earth') {
      var g = gisConductorsAt(mem[0].id, k.toUpperCase()).filter(function (t) { return t.lib; }).sort(function (a, b) { return b.length - a.length; })[0];
      if (g) { S1.cond = g.lib.code; S1.csrc = 'GIS ' + g.description + ' on ' + g.feeder; }
    }
    if (!S1.cond) { S1.flags.push('No conductor from the photos or the GIS export'); S1.on = false; }
    var noAtt = mem.filter(function (m) { return !knownLayout(m.code); }).map(function (m) { return m.id + ' ' + m.code; });
    if (noAtt.length) { S1.flags.push('No attachment offsets for ' + noAtt.join(', ')); S1.on = false; }
    if (S1.cond) {
      var rs = M.rulingSpan(spansOf(S1.ids)), at = autoTension(S1.cond, rs), ts = at ? null : tensionSuggestions(S1.cond);
      S1.rs = rs;
      if (at) { S1.tension = at.value; S1.units = at.units; S1.table = at.table; S1.tsrc = at.note; S1.auto = true; }
      else if (ts.length === 1) { S1.tension = ts[0].value; S1.units = ts[0].units; S1.table = ts[0].table; S1.tsrc = ts[0].note; }
      else { S1.flags.push(ts.length ? ts.length + ' possible tensions, pick one after' : 'No tension table for ' + S1.cond); S1.on = false; }
    }
    return S1;
  }
  function adNoLen(id) { var r = project && project.poles.filter(function (x) { return x.ID === id; })[0]; return !!r && !(PNW.num(r.HeightAG) > 0); }
  function adHtml(plan) {
    var pct = function (v) { return Math.round(v * 100) + '%'; }, h = '<p class="hint">Review the proposals. Untick anything that is wrong, then Apply. Each change is logged with its source, and AI picks stay flagged until checked in the field.</p>';
    h += '<h4>Constructions</h4><table class="grid"><thead><tr><th></th><th>Pole</th><th>Construction</th><th class="num">AI</th><th>Seen in</th><th>Why</th></tr></thead><tbody>';
    var n = 0;
    plan.poles.forEach(function (P, i) { P.picks.forEach(function (x, j) { n++; h += '<tr' + (x.conf < 0.5 ? ' class="warn"' : '') + '><td><input type="checkbox" data-adc="' + i + '-' + j + '"' + (x.on ? ' checked' : '') + (x.done ? ' disabled' : '') + ' aria-label="Use ' + esc(x.code) + ' on ' + esc(P.id) + '"></td><td>' + esc(P.id) + (x.done ? ' <span class="pill ok">added</span>' : '') + (j === 0 && adNoLen(P.id) ? '<br><input type="number" step="0.5" min="4" max="40" data-adlen="' + esc(P.id) + '" value="' + esc((AD.len || {})[P.id] || '') + '" placeholder="Length m" title="' + esc(P.id) + ' has no pole length, so its constructions and conductors cannot be placed. Enter the length here." style="width:84px" aria-label="Pole length of ' + esc(P.id) + '">' : '') + '</td><td class="adpick">' + combo('adc|' + i + '-' + j, { value: x.code, placeholder: 'Search construction…', aria: 'Construction on ' + P.id, free: true, groups: function () { return constructionGroups(P.id); }, onPick: function (v) { adSetPick(P, x, v); } }) + ' <small class="meta">' + x.cls.toUpperCase() + '</small></td><td class="num">' + (x.user ? 'you' : pct(x.conf)) + '</td><td>' + (P.thumb ? '<img class="adthumb" src="' + P.thumb + '" data-big="' + (P.view || P.thumb) + '" alt="Street View of ' + esc(P.id) + '" title="Hover to enlarge" style="height:28px;vertical-align:middle;border-radius:3px;cursor:zoom-in"> ' : '') + esc((P.src || '').replace(/ \(.*/, '')) + '</td><td class="adwhy"><small>' + esc(x.why) + '</small></td></tr>'; }); });
    if (!n) h += '<tr><td colspan="6" class="meta">No new constructions to propose.</td></tr>';
    var dr = AD.draft = AD.draft || {}, pids = plan.poles.map(function (P) { return P.id; }), psel = function (key, cur) { return '<select data-addr="' + key + '" aria-label="' + key + '">' + pids.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>'; };
    if (pids.indexOf(dr.pole) < 0) dr.pole = pids[0]; if (pids.indexOf(dr.from) < 0) dr.from = pids[0]; if (pids.indexOf(dr.to) < 0) dr.to = pids[pids.length - 1];
    h += '<tr class="adnew"><td>＋</td><td>' + psel('pole', dr.pole) + '</td><td class="adpick">' + combo('adNewCon', { value: dr.con || '', placeholder: 'Add a construction the AI missed…', aria: 'Construction to add', free: true, groups: function () { return constructionGroups(AD.draft.pole); }, onPick: function (v) { AD.draft.con = v; } }) + '</td><td colspan="3"><button class="btn small primary" id="adAddCon">Add</button></td></tr>';
    h += '</tbody></table><h4>Strain sections</h4><table class="grid"><thead><tr><th></th><th>Circuit</th><th>Poles</th><th>Conductor</th><th>Tension</th><th class="num">Ruling span</th><th>Notes</th></tr></thead><tbody>';
    plan.sections.forEach(function (s, i) { var sd = (plan.doneSec || {})[adKey(s.cls, s.ids)]; h += '<tr' + (s.flags.length && !sd ? ' class="warn"' : '') + '><td><input type="checkbox" data-ads="' + i + '"' + (s.on ? ' checked' : '') + (s.cond && s.tension && !sd ? '' : ' disabled') + ' aria-label="String section ' + (i + 1) + '">' + (sd ? ' <span class="pill ok">strung</span>' : '') + '</td><td>' + s.cls.toUpperCase() + '</td><td>' + esc(s.ids[0] + ' → ' + s.ids[s.ids.length - 1]) + ' <small class="meta">(' + s.ids.length + ')</small></td><td>' + '<div class="adpick">' + combo('ads|' + i, { value: s.cond || '', placeholder: 'Search conductor…', aria: 'Conductor for section ' + (i + 1), groups: function () { return conductorGroups(s.ids[0], s.codes[0]); }, onPick: function (v) { (plan.condPick = plan.condPick || {})[adKey(s.cls, s.ids)] = v; adSections(plan); adShow(); } }) + (s.csrc ? ' <small class="meta">' + esc(s.csrc) + '</small>' : '') + '</div></td><td>' + (s.tension ? esc(s.tension + ' ' + s.units) + (s.auto ? ' <small class="meta">auto</small>' : '') : '–') + '</td><td class="num">' + (s.rs ? s.rs.toFixed(1) + ' m' : '–') + '</td><td><small>' + esc(s.flags.join('; ') || s.tsrc || '') + '</small></td></tr>'; });
    if (!plan.sections.length) h += '<tr><td colspan="7" class="meta">No sections to string.</td></tr>';
    h += '<tr class="adnew"><td>＋</td><td><select data-addr="cls" aria-label="Circuit">' + [['lv', 'LV'], ['hv', 'HV'], ['earth', 'Earth']].map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === (dr.cls || 'lv') ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></td><td>' + psel('from', dr.from) + ' → ' + psel('to', dr.to) + '</td><td class="adpick">' + combo('adNewCond', { value: dr.cond || '', placeholder: 'Search conductor…', aria: 'Conductor for the new section', groups: function () { return conductorGroups(AD.draft.from, (AD.draft.cls || 'lv') === 'hv' ? 'H' : 'L'); }, onPick: function (v) { AD.draft.cond = v; } }) + '</td><td colspan="3"><button class="btn small primary" id="adAddSec">Add section</button> <small class="meta">Tension and ruling span come from the spans</small></td></tr>';
    h += '</tbody></table>' + (AD.err ? '<p class="hint bad" style="display:block">' + esc(AD.err) + '</p>' : '');
    if (plan.missing.length) h += '<h4>Needs you</h4><ul class="hint">' + plan.missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
    if (plan.notes.length) h += '<h4>Seen, not added</h4><ul class="hint">' + plan.notes.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
    return h + '<p class="hint">After Apply, LV king bolts under HV are set by the separation rule where it applies.</p><div class="btnrow"><button class="btn primary" id="adApply">Apply ticked</button><button class="btn" id="adCancel">Cancel</button></div>';
  }
  function adShow() {
    openGen('🪄 Auto design · review', adHtml(AD.plan));
    var body = $('genBody');
    body.onchange = function (e) {
      var t = e.target; if (t.dataset.adc) { var q = t.dataset.adc.split('-'); AD.plan.poles[+q[0]].picks[+q[1]].on = t.checked; adSections(AD.plan); adShow(); }
      else if (t.dataset.ads) AD.plan.sections[+t.dataset.ads].on = t.checked;
      else if (t.dataset.addr) AD.draft[t.dataset.addr] = t.value;
      else if (t.dataset.adlen != null) { var lv = PNW.num(t.value); AD.len = AD.len || {}; if (lv > 0 && lv <= 40) AD.len[t.dataset.adlen] = lv; else delete AD.len[t.dataset.adlen]; }
    };
    $('adAddCon').onclick = function () {
      var d = AD.draft, P = AD.plan.poles.filter(function (q) { return q.id === d.pole; })[0], ci = comboInput('adNewCon'), v = ((ci && ci.value) || d.con || '').trim();
      if (!P || !v) { AD.err = 'Pick a pole and a construction first.'; adShow(); return; }
      AD.err = ''; var x = { cls: circuitClass(v), code: '', conf: 1, on: true }; P.picks.push(x); d.con = ''; adSetPick(P, x, v); adClearDraft('adNewCon', 'con');
    };
    $('adAddSec').onclick = function () {
      var d = AD.draft, cn = comboInput('adNewCond'); if (cn && cn.value.trim()) d.cond = cn.value.trim(); var k = d.cls || 'lv', ids = AD.plan.poles.map(function (q) { return q.id; }), a = ids.indexOf(d.from), b = ids.indexOf(d.to);
      if (a < 0 || b < 0 || a === b) { AD.err = 'Pick two different poles.'; adShow(); return; }
      var run = ids.slice(Math.min(a, b), Math.max(a, b) + 1), mem = adMembers(AD.plan, k, run);
      if (!mem.ok) { AD.err = 'No ' + k.toUpperCase() + ' construction on ' + mem.missing.join(', ') + '. Add it in the Constructions table above first.'; adShow(); return; }
      AD.err = ''; if (d.cond) (AD.plan.condPick = AD.plan.condPick || {})[adKey(k, run)] = d.cond;
      (AD.plan.extra = AD.plan.extra || []).push({ cls: k, ids: run }); d.cond = ''; adSections(AD.plan); adShow(); adClearDraft('adNewCond', 'cond');
    };
    $('adCancel').onclick = closeGen; $('adApply').onclick = adApply;
  }
  function adApply() {
    var plan = AD.plan, nc = 0, ns = 0, nl = 0, fails = [];
    closeGen();
    commit(function (p) {
      var out = [];
      plan.poles.forEach(function (P) {
        var row = p.poles.filter(function (x) { return x.ID === P.id; })[0], hag = PNW.num(row.HeightAG), L = (AD.len || {})[P.id];
        if (!(hag > 0) && L > 0) { try { var from = row.Length, res = M.updatePole(p, P.id, { length: L, sunk: defaultSunk(L) }); hag = res.heightAG; delete AD.len[P.id]; out.push(logEntry(P.id, '', 'Pole length', from, String(L), 'manual', 'Auto design review; setting depth ' + defaultSunk(L) + ' m')); } catch (e) { fails.push(P.id + ': ' + e.message); } }
        var cur = ((dm && dm.byPole[P.id]) || []).slice();
        P.picks.filter(function (x) { return x.on && !x.done; }).forEach(function (x) {
          var d = hag > 0 ? kbFor(P.id, x.code, hag, cur) : null; if (!d) { fails.push(P.id + ' ' + x.code + ': ' + (hag > 0 ? 'no default king bolt height' : 'the pole has no length (enter it or pick the pole type in Pole Details)')); return; }
          var lay = knownLayout(x.code), lc = M.libraryConstruction(lib, x.code);
          var nr = M.addConstruction(p, P.id, { code: x.code, kingbolt: d.value, voltage: lc && lc.voltageLL != null ? lc.voltageLL : 0, attachments: lay ? lay.attachments : [], isNew: true });
          out.push(logEntry(P.id, nr.descr, 'Construction', '', 'added at ' + d.value + ' m', 'AI suggestion', 'Auto design; ' + x.ref + '; king bolt from ' + d.source + (lay ? '; offsets from ' + lay.source : ''))); cur.push({ code: x.code, kingbolt: d.value }); nc++; x.done = true;
        });
      });
      return out;
    });
    var secs = plan.sections.filter(function (s) { return s.on && s.cond && s.tension && !(plan.doneSec || {})[adKey(s.cls, s.ids)]; }), names = [];
    if (secs.length) commit(function (p) {
      var out = [];
      secs.forEach(function (s) {
        var poles = s.ids.map(function (id) { var c = ((dm.byPole[id]) || []).filter(function (x) { return circuitClass(x.code) === s.cls; }).sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); })[0]; return c && { id: id, unique: c.unique, descr: c.descr }; });
        if (poles.some(function (m) { return !m; })) { fails.push(s.cls.toUpperCase() + ' ' + s.ids[0] + '→' + s.ids[s.ids.length - 1] + ': a pole lost its construction'); return; }
        try {
          fillBare(p, poles.map(function (m) { return m.unique; }));
          var name = M.addSection(p, { conductor: conductorFor(s.cond), tension: s.tension, units: s.units, poles: poles.map(function (m) { return { id: m.id, unique: m.unique }; }) });
          if (s.table) (S.design.tables = S.design.tables || {})[name] = s.table;
          if (s.auto) (S.design.tensionAuto = S.design.tensionAuto || {})[name] = true;
          names.push(name); ns++; (plan.doneSec = plan.doneSec || {})[adKey(s.cls, s.ids)] = name;
          out.push(logEntry(s.ids[0] + '→' + s.ids[s.ids.length - 1], name, 'Strain section', '', s.cond + ' at ' + s.tension + ' ' + s.units + ' on ' + poles.map(function (m) { return m.id + ' ' + m.descr; }).join(', '), 'calculated', 'Auto design; conductor from ' + s.csrc + '; tension from ' + s.tsrc));
        } catch (e) { fails.push(s.cls.toUpperCase() + ' ' + s.ids[0] + '→' + s.ids[s.ids.length - 1] + ': ' + e.message); }
      });
      return out;
    });
    var ups = [];
    project.poles.forEach(function (r) {
      var cons = ((dm.byPole[r.ID]) || []).slice().sort(function (a, b) { return (b.kingbolt || 0) - (a.kingbolt || 0); });
      cons.forEach(function (c, i) { var x = lvRule(r.ID, cons, i); if (x && x.value != null && Math.abs(x.value - (c.kingbolt || 0)) > 0.0005 && plan.poles.some(function (P) { return P.id === r.ID && P.picks.some(function (k) { return k.on && k.code === c.code; }); })) ups.push({ id: r.ID, c: c, v: x.value, src: x.src }); });
    });
    if (ups.length) commit(function (p) { return ups.map(function (u) { M.updateConstruction(p, u.c.unique, { kingbolt: u.v }); nl++; return logEntry(u.id, u.c.descr, 'King bolt', u.c.kingbolt + ' m', u.v + ' m', 'calculated', 'Auto design; ' + u.src); }); });
    if (fails.length) openGen('🪄 Auto design: not everything was applied', '<p>' + nc + ' construction' + (nc === 1 ? '' : 's') + ' and ' + ns + ' strain section' + (ns === 1 ? '' : 's') + ' were added. These were not:</p><ul>' + fails.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><p class="hint">Back to review keeps what was added and lets you enter missing pole lengths or change constructions and conductors, then apply the rest.</p><div class="btnrow"><button class="btn primary" id="adFailBack">Back to review</button><button class="btn" id="adFailOk">Close</button></div>', { narrow: true }), $('adFailOk').onclick = closeGen, $('adFailBack').onclick = function () { closeGen(); AD.err = ''; adShow(); };
    setStatus('Auto design applied: ' + nc + ' construction' + (nc === 1 ? '' : 's') + ', ' + ns + ' strain section' + (ns === 1 ? '' : 's') + (nl ? ', ' + nl + ' LV height' + (nl === 1 ? '' : 's') + ' by the separation rule' : '') + '.' + (fails.length ? ' Not done: ' + fails.join('; ') + '.' : ''), fails.length ? 'bad' : 'good');
  }
  function autoDesign() {
    if (AD.busy) return;
    if (!Object.keys(merged.poles).some(function (id) { return merged.poles[id].survey; })) { setStatus('Load the QLINK LiDAR export first. Auto design takes the poles and ground levels from it.', 'bad'); return; }
    if (!prof().poleIds.length) { seedProfile(true); S.generated = false; recompute(); }
    // Constructions need the height above ground: take missing or invalid lengths (e.g. -9999) from the pole type first.
    var fixIds = lineIds().filter(function (k) { return badLen(curLen(k)) && typeOf(k); }); if (fixIds.length) fixFromType(fixIds);
    if (!project) startDesign();
    if (!project) return;
    var noLen = project.poles.filter(function (r) { return !(PNW.num(r.HeightAG) > 0); }).map(function (r) { return r.ID; });
    if (noLen.length && noLen.length === project.poles.length) { openGen('🪄 Auto design', '<p><b>' + esc(noLen.join(', ')) + '</b> ' + (noLen.length > 1 ? 'have' : 'has') + ' no pole length, so no construction can be placed on ' + (noLen.length > 1 ? 'them' : 'it') + ' (king bolts are measured from the pole tip).</p><p class="hint">Select the pole and enter its length or pick its pole type in Pole Details, then run Auto design again.</p><div class="btnrow"><button class="btn primary" id="adLenGo">Show ' + esc(noLen[0]) + '</button><button class="btn" id="adLenNo">Close</button></div>', { narrow: true }); $('adLenNo').onclick = closeGen; $('adLenGo').onclick = function () { closeGen(); select(noLen[0]); }; return; }
    var ids = project.poles.map(function (r) { return r.ID; }), i = 0;
    AD.busy = true;
    openGen('🪄 Auto design', '<p class="hint" id="adProg">Reading pole photos…</p><div class="btnrow"><button class="btn" id="adStop">Stop and review what is done</button></div>', { noFocus: true });
    var stop = false; $('adStop').onclick = function () { stop = true; };
    // Poles are analysed AD_PAR at a time (was one by one); a pole that hits the rate limit is retried once after a pause.
    var done = 0, live = 0, finished = false, AD_PAR = 4;
    var finish = function () { if (finished) return; finished = true; AD.busy = false; AD.err = ''; AD.draft = {}; AD.plan = adPlan(); adShow(); };
    var prog = function () { var el = $('adProg'); if (el) el.textContent = 'Analysed ' + done + ' of ' + ids.length + ' poles' + (live ? ' (' + live + ' in progress, ' + (gmKey() || IN_CLAUDE || webMapsOn() ? 'photos / Street View' : 'photos') + ')' : '') + '…'; };
    var one = function (id, again) {
      return aiFor(id).then(null, function () {}).then(function () {
        var r = aiResults[id];
        if (!again && r && !r.resp && /Too many requests/.test(r.error || '')) { delete aiResults[id]; return new Promise(function (res) { setTimeout(res, 4000); }).then(function () { return one(id, true); }); }
      });
    };
    var worker = function () {
      if (stop || i >= ids.length) { if (!live || stop) finish(); return; }
      var id = ids[i++]; live++; prog();
      one(id).then(function () { live--; done++; prog(); worker(); });
    };
    prog(); for (var w = 0; w < AD_PAR; w++) worker();
  }
  function runAiClaude(id, file, meta) {
    var r = aiResults[id] = { photo: file.name, loading: true, source: (meta && meta.source) || 'photo' }; renderSelected();
    var existing = ((dm && dm.byPole[id]) || []).map(function (c) { return c.descr; });
    // meta.extra: more photos of the same pole (Street View from the other side); the AI says which one is best.
    var shots = [{ file: file, meta: meta || {} }].concat((meta && meta.extra) || []), imgs = [];
    Promise.all([sampleP || Promise.resolve(null)].concat(shots.map(function (s) { return shrink(s.file); }))).then(function (x) {
      var sample = x[0]; imgs = x.slice(1); var img = imgs[0]; r.thumb = img.thumb; r.view = img.view;
      if (shots.length === 1) { if (!(meta && meta.noAttach)) r.photoId = attachPhoto(id, file.name, img, meta).id; else if (meta && meta.photoId) r.photoId = meta.photoId; }
      renderSelected();
      if (!sample) throw new Error('Asking Claude is not available in this view of the page.');
      var refs = aiRefPick(id), blobs = imgs.concat(refs).map(function (im) { var bytes = atob(im.data), arr = new Uint8Array(bytes.length); for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i); return new Blob([arr], { type: 'image/jpeg' }); });
      var pr = aiPrompt(id, existing) + (shots.length > 1 ? '\nThere are ' + shots.length + ' photos of the same pole, taken one step either side of it along the road and all facing the pole (photo 1 = ' + shots.map(function (s, k) { return 'photo ' + (k + 1) + ': ' + s.file.name; }).join(', ') + '). Base the answer on the clearest photo, using the other to confirm hardware that is hidden or unclear. Add "best_photo": the number (1 to ' + shots.length + ') of the clearest view of the pole top hardware.' : '') +
        (refs.length ? '\nPhotos ' + (shots.length + 1) + ' to ' + (shots.length + refs.length) + ' are NOT this pole: they are reference photos of other poles the designer has confirmed (' + refs.map(function (f, k) { return 'photo ' + (shots.length + k + 1) + ' = ' + f.code; }).join(', ') + '). Use them only to recognise what those constructions look like; analyse only photo 1' + (shots.length > 1 ? ' to ' + shots.length : '') + '.' : '');
      r.refs = refs.length;
      return sample.json(pr, { images: blobs, modelTier: 'default' });
    }).then(function (j) {
      if (shots.length > 1) { // keep the best photo with the pole
        var bi = Math.max(1, Math.min(shots.length, Number(j && j.best_photo) || 1)) - 1, bs = shots[bi], bm = Object.assign({}, bs.meta); delete bm.extra;
        r.photo = bs.file.name; r.source = (bm.source || 'Street View') + (shots.length > 1 ? ' · best of ' + shots.length : ''); r.thumb = imgs[bi].thumb; r.view = imgs[bi].view; r.best = bi + 1;
        r.photoId = attachPhoto(id, bs.file.name, imgs[bi], bm).id;
      }
      var valid = {}; aiCandidates().forEach(function (c) { valid[String(c.code).toUpperCase()] = c.code; });
      var conf = function (v) { return Math.max(0, Math.min(1, Number(v) || 0)); }, all = Array.isArray(j.matches) ? j.matches : [];
      var lvOk = aiLevelFilter(j), matches = all.filter(function (m) { return valid[String(m.code || '').toUpperCase()]; }).filter(function (m) { return lvOk({ code: valid[String(m.code).toUpperCase()] }); }).map(function (m) { return { level: String(m.level || ''), code: valid[String(m.code).toUpperCase()], rank: Number(m.rank) || 99, confidence: conf(m.confidence), reasons: (m.reasons || []).map(String).slice(0, 5) }; });
      r.resp = { model: 'Claude', photo_quality: String(j.photo_quality || ''), components: (j.components || []).map(function (c) { return { name: String(c.name || ''), level: String(c.level || ''), count: Number(c.count) || null, confidence: conf(c.confidence) }; }),
        matches: matches, cautions: (j.cautions || []).map(String).concat((function () { var bad = all.filter(function (m) { return !valid[String(m.code || '').toUpperCase()]; }).length; return bad ? [bad + ' suggestion(s) used codes that are not in your PNW library and were removed.'] : []; })()),
        obs: aiObservations(j) };
    }).catch(function (e) { r.error = e && e.code === 'not_granted' ? 'Claude was not allowed to look at the photo. Allow it when asked to use this.' : e && e.code === 'rate_limited' ? 'Too many requests at once. Wait a moment and try again.' : (e && e.message) || String(e); })
      .then(function () { r.loading = false; if (S.selected === id) renderSelected(); });
  }
  function runAi(id, file, meta) {
    if (IN_CLAUDE) return runAiClaude(id, file, meta);
    var r = aiResults[id] = { photo: file.name, loading: true, source: (meta && meta.source) || 'photo' }; renderSelected();
    shrink(file).then(function (img) {
      r.thumb = img.thumb; r.view = img.view; if (!(meta && meta.noAttach)) r.photoId = attachPhoto(id, file.name, img, meta).id; else if (meta && meta.photoId) r.photoId = meta.photoId; renderSelected();
      var existing = ((dm && dm.byPole[id]) || []).map(function (c) { return c.descr; });
      return fetch(AI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: AI_KEY, Authorization: 'Bearer ' + AI_KEY }, body: JSON.stringify({ mime: 'image/jpeg', image: img.data, pole: id, existing: existing, candidates: aiCandidates() }) });
    }).then(function (res) {
      if (res.status === 404) throw new Error('The AI photo service is not switched on yet (the pnw-pole-photo-ai function is not deployed).');
      return res.json().then(function (j) { if (!res.ok || !j.ok) throw new Error(j.error || 'AI request failed (' + res.status + ').'); return j; });
    }).then(function (j) { var ok = aiLevelFilter(j); j.matches = (j.matches || []).filter(ok); r.resp = j; r.resp.obs = r.resp.obs || aiObservations(j); }).catch(function (e) { r.error = /Failed to fetch|NetworkError/i.test(e.message) ? 'Could not reach the AI service. Check the connection; the service only answers on evedesignandengineering.com.' : e.message; })
      .then(function () { r.loading = false; if (S.selected === id) renderSelected(); });
  }
  $('selected').addEventListener('change', function (e) { if (e.target.id === 'aiPhoto' && e.target.files[0]) runAi(S.selected, e.target.files[0]); });
  $('selected').addEventListener('click', function (e) {
    if (e.target.closest('[data-airefclear]')) { e.preventDefault(); try { localStorage.removeItem(AIREF_KEY); } catch (x) {} setStatus('Reference photos cleared.', 'good'); renderSelected(); return; }
    var b = e.target.closest('[data-aiok]'); if (!b) return;
    var id = S.selected, r = aiResults[id], gi = b.dataset.aiok.split('-'), g = r.groups[+gi[0]], m = g.items[+gi[1]];
    if (m.confidence < 0.5 && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Low confidence: click again to approve'; b.classList.add('danger'); setStatus('The AI is under 50% sure of ' + m.code + ' for ' + id + '. Approve only if you can confirm it from the photo or the field.', 'bad'); return; }
    var target = document.querySelector('[data-aitarget="' + b.dataset.aiok + '"]').value, ref = 'Photo ' + r.photo + ', ' + m.level + ' rank ' + m.rank + ', ' + Math.round(m.confidence * 100) + '% (' + r.resp.model + ')';
    var mark = function () { (r.approved || (r.approved = {}))[g.cls] = m.code; aiRefSave(m.code, r.view, id); };
    if ((((dm && dm.byPole[id]) || []).some(function (c) { return String(c.code).toUpperCase() === m.code.toUpperCase(); }))) { setStatus(m.code + ' is already on ' + id + '; one construction carries the whole circuit.', 'bad'); return; }
    if (target !== 'new') { mark(); changeCode(id, target, m.code, 'AI suggestion', ref); return; }
    var cons = ((dm && dm.byPole[id]) || []).slice().sort(function (a, c) { return (c.kingbolt || 0) - (a.kingbolt || 0); }), row = project.poles.filter(function (x) { return x.ID === id; })[0];
    var d = kbFor(id, m.code, PNW.num(row.HeightAG), cons);
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
    renderExtras();
    if (v === '3d' || v === 'split') { if (!mounted3d) mount3d(); else update3d(); }
    if (v === 'profile' || v === 'split') renderProfileView();
    var notes = [];
    if (dm) Object.keys(dm.sagNotes || {}).forEach(function (k) { notes.push(dm.sagNotes[k]); });
    $('sagMode').value = S.sagMode || 'auto'; $('sagTemp').value = String(S.sagTemp || 15); $('sagTemp').hidden = S.sagMode === 'none' || S.sagMode === 'illustrative';
    $('sagNote').textContent = (S.sagMode || 'auto') === 'auto' ? 'Sag shown: ' + (Object.keys(dm && dm.sagNotes || {}).map(function (k) { return dm.sagNotes[k]; }).join(' · ') || 'no strain sections') + '. Drawn true to scale in 3D; exaggerated with the profile.' : S.sagMode === 'dcsh' ? (stringing().length ? notes.join(' · ') : 'Import the DCSH Part 10 text to use stringing tables.') : S.sagMode === 'illustrative' ? 'Illustrative sag w·L²/8T at the stringing tension; not PNW\'s sag.' : 'Conductors drawn as straight chords (no sag).'; $('sagNote').title = $('sagNote').textContent;
  }
  function mount3d() {
    if (!window.PNW3D) {
      $('v3host').innerHTML = '<p class="v3msg">Loading the 3D viewer…</p>';
      window.addEventListener('pnw3d-ready', function () { $('v3host').innerHTML = ''; mount3d(); }, { once: true });
      setTimeout(function () { if (!window.PNW3D) $('v3host').innerHTML = '<p class="v3msg">The 3D viewer could not load (three.js from cdn.jsdelivr.net). Check the internet connection and reload.</p>'; }, 10000);
      return;
    }
    window.PNW3D.mount($('v3host'), function (id, info) { clr3d = id && info && info.to ? [id, info.to, info.segment] : null; select(id, id ? info : { segment: '' }); show3dClr(); if (SV3.on && id && !(info && info.to)) sv3Show(id); });
    mounted3d = true; update3d(); window.PNW3D.select(S.selected); window.PNW3D.selectSection(S.selSection); base3d();
    if ($('stage').clientWidth < 820) $('v3legend').open = false;
    var fade = function () { $('v3help').classList.add('fade'); }; setTimeout(fade, 6000); $('v3host').addEventListener('pointerdown', fade, { once: true });
  }
  function data3d() {
    if (dm && dm.poles.length) {
      var ribbon = function (ps, ax) { return ps.map(function (p, i) { return { easting: p.easting, northing: p.northing, ground: p.ground, right: ax[i] ? ax[i].right : [1, 0] }; }); };
      var ex = S.design.extras || {}, stays = [], plant = [];
      Object.keys(ex).forEach(function (id) { (ex[id].stays || []).forEach(function (st) { stays.push(Object.assign({ pole: id }, st)); }); (ex[id].plant || []).forEach(function (pl) { plant.push(Object.assign({ pole: id }, pl)); }); });
      var d = { poles: dm.poles.slice(), axes: dm.axes.slice(), constructions: dm.constructions.slice(), points: dm.points.slice(), wires: dm.wires.slice(), ribbons: [ribbon(dm.poles, dm.axes)], stays: stays, plant: plant, showLabels: S.labels, keepView: true };
      xLines.forEach(function (x) {
        var axisOf = {}, shift = {};
        x.dm.poles.forEach(function (p, i) {
          axisOf[p.id] = x.dm.axes[i] ? x.dm.axes[i].right : [1, 0];
          var m = x.common[p.id];
          if (m) shift[p.id] = { id: m.id, e: m.easting - p.easting, n: m.northing - p.northing, z: (m.ground != null ? m.ground : p.ground) - p.ground };
          else { d.poles.push(Object.assign({}, p, { line: x.title })); d.axes.push(x.dm.axes[i]); }
        });
        var mv = function (q) { var t = shift[q.pole]; return t ? Object.assign({}, q, { pole: t.id, easting: q.easting + t.e, northing: q.northing + t.n, elevation: q.elevation + t.z, right: axisOf[q.pole] }) : Object.assign({}, q, { right: axisOf[q.pole] }); };
        x.dm.constructions.forEach(function (c) { d.constructions.push(Object.assign({}, c, { pole: shift[c.pole] ? shift[c.pole].id : c.pole, axis: axisOf[c.pole] })); });
        x.dm.points.forEach(function (q) { d.points.push(mv(q)); });
        x.dm.wires.forEach(function (w) { d.wires.push(Object.assign({}, w, { segment: x.title + ' · ' + w.segment, from: mv(w.from), to: mv(w.to) })); });
        d.ribbons.push(ribbon(x.dm.poles, x.dm.axes));
      });
      return d;
    }
    var rows = built ? built.rows.filter(function (r) { return isFinite(r.easting) && isFinite(r.northing) && isFinite(r.elevation); }) : [];
    var poles = rows.map(function (r) { var t = poleTypeFor(r.id, r.length); return { id: r.id, easting: r.easting, northing: r.northing, ground: r.elevation, height: r.height, sunk: r.sunk, diamTip: t ? t.diamTip : null, diamGL: t ? t.diamGL : null }; });
    return { poles: poles, axes: M.crossarmAxes(poles), constructions: [], points: [], wires: [], showLabels: S.labels, keepView: true };
  }
  // 3D map layer: web tiles under the model (website only; the private build's page policy blocks tile servers).
  function base3d() {
    if (!window.PNW3D || !mounted3d) return;
    var def = '+proj=utm +zone=' + S.zone + ' +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    $('v3base').value = U.base3d || (IN_CLAUDE ? 'satellite' : 'none'); $('v3terrain').checked = !!U.terrain3d;
    window.PNW3D.basemap({ kind: $('v3base').value, terrain: !!U.terrain3d, fetch: IN_CLAUDE ? function (kind, z, x, y) { var n2 = Math.pow(2, z), lon = (x + 0.5) / n2 * 360 - 180, yy = Math.PI - 2 * Math.PI * (y + 0.5) / n2, lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy))); return mapsCall('static_map', { lat: +lat.toFixed(7), lng: +lon.toFixed(7), zoom: z, width: 256, height: 256, scale: 2, maptype: kind === 'street' ? 'roadmap' : 'satellite' }).then(function (r) { var im = mapsImg(r); return im ? im.url : null; }, function (e) { if (!base3d.err) { base3d.err = true; setStatus('3D map: ' + mapsErr(e), 'bad'); } return null; }); } : null, attr: 'Map data © Google', toLL: function (e, n) { var l = toLatLng(e, n); return l ? [l.lat, l.lng] : null; }, toEN: function (lat, lng) { try { return proj4('EPSG:4326', def, [lng, lat]); } catch (x) { return null; } } });
  }
  $('v3base').onchange = function () { U.base3d = this.value; saveUi(); base3d(); };
  $('v3terrain').onchange = function () { U.terrain3d = this.checked; saveUi(); base3d(); };
  function update3d() {
    if (!mounted3d) return;
    var d = data3d(); window.PNW3D.update(d); show3dClr(); if (SV3.on) sv3Draw();
    if (CT.on) ctDraw();
    $('v3empty').hidden = d.poles.length > 0;
  }
  var WCOL = { hv: '#c2410c', lv: '#2f6ea4', earth: '#64748b', other: '#0f766e' };
  function wireKind(w) { return /^RE/i.test(w.code || '') ? 'earth' : w.voltage == null ? 'other' : w.voltage > 1 ? 'hv' : 'lv'; }
  /* profile view: zoom (wheel, buttons, keys), pan (drag), fit, pole and span selection */
  var pv = { x0: null, x1: null, geom: null };
  function lineRows() {
    if (dm && dm.allPoles.length) return dm.allPoles.filter(function (p) { return p.chainage != null && p.ground != null; });
    return built ? built.rows.filter(function (r) { return r.chainage != null && isFinite(r.elevation); }).map(function (r) { return { id: r.id, chainage: r.chainage, ground: r.elevation, height: r.height, sunk: r.sunk }; }) : [];
  }
  function lineIds() { return dm && dm.allPoles.length ? dm.allPoles.map(function (p) { return p.id; }) : prof().poleIds.slice(); }
  function pvFull() { var r = lineRows(), g = dm && project ? project.ground.map(function (q) { return PNW.num(q.Chainage); }).filter(isFinite) : []; var x1 = Math.max.apply(null, r.map(function (p) { return p.chainage; }).concat(g)); return { x0: 0, x1: isFinite(x1) && x1 > 0 ? x1 : 1 }; }
  function pvRange() { var f = pvFull(), a = pv.x0 == null ? f.x0 : pv.x0, b = pv.x1 == null ? f.x1 : pv.x1; if (b - a < 4) { var c = (a + b) / 2; a = c - 2; b = c + 2; } return { x0: a, x1: b, full: f }; }
  function pvSet(a, b) {
    var f = pvFull(), w = Math.max(4, b - a), span = f.x1 - f.x0, pad = span * 0.04;
    var full = span + 2 * pad, c = (a + b) / 2; w = Math.min(w, full * 5);
    if (w > full + 1e-6) { c = Math.max(f.x0, Math.min(f.x1, c)); pv.x0 = c - w / 2; pv.x1 = c + w / 2; return; }
    a = c - w / 2; b = c + w / 2; if (a < f.x0 - pad) { a = f.x0 - pad; b = a + w; } if (b > f.x1 + pad) { b = f.x1 + pad; a = b - w; }
    if (b - a >= full - 1e-6) { pv.x0 = pv.x1 = null; } else { pv.x0 = a; pv.x1 = b; }
  }
  function pvZoom(k, at) { var r = pvRange(), c = at == null ? (r.x0 + r.x1) / 2 : at, w = (r.x1 - r.x0) * k; pvSet(c - (c - r.x0) * k, c + (r.x1 - c) * k); renderProfileView(); }
  function pvFit() { pv.x0 = pv.x1 = null; renderProfileView(); }
  function chainOfPole(id) { var q = lineRows().filter(function (p) { return p.id === id; })[0]; return q ? q.chainage : null; }
  // Zoom to a pole and its two spans.
  function pvFocus(id) {
    var rows = lineRows(), i = rows.findIndex(function (p) { return p.id === id; }); if (i < 0) return;
    var a = rows[Math.max(0, i - 1)].chainage, b = rows[Math.min(rows.length - 1, i + 1)].chainage, m = Math.max(5, (b - a) * 0.15); pvSet(a - m, b + m);
  }
  // Keep a selected pole inside the visible window without changing the zoom.
  function pvEnsure(id) {
    if (pv.x0 == null) return; var c = chainOfPole(id); if (c == null) return;
    var r = pvRange(), w = r.x1 - r.x0, m = w * 0.08;
    if (c < r.x0 + m || c > r.x1 - m) pvSet(c - w / 2, c + w / 2);
  }
  function renderProfileView() {
    var box = $('profileView'), cs = getComputedStyle(box), W = Math.max(box.clientWidth - 16, 300), H = Math.max(box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 38 - (box.querySelector('.pv-legend') ? box.querySelector('.pv-legend').offsetHeight : 20), 90), m = { l: 52, r: 20, t: 14, b: 30 };
    var poles, ground, clr = [];
    if (dm && dm.allPoles.length) {
      poles = dm.allPoles.filter(function (p) { return p.chainage != null && p.ground != null; });
      ground = project.ground.map(function (g) { return { c: PNW.num(g.Chainage), z: PNW.num(g.Level), c1: PNW.num(g.Clearance1) }; }).filter(function (g) { return isFinite(g.c) && isFinite(g.z); });
      clr = ground.filter(function (g) { return g.c1 > 0; });
    } else if (built) {
      poles = built.rows.filter(function (r) { return r.chainage != null && isFinite(r.elevation); }).map(function (r) { return { id: r.id, chainage: r.chainage, ground: r.elevation, height: r.height, sunk: r.sunk }; });
      ground = PNW.groundSeq(built).filter(function (r) { return r.chainage != null && isFinite(r.elevation); }).map(function (r) { return { c: r.chainage, z: r.elevation }; });
    } else poles = [];
    if (poles.length < 2) {
      var only = prof().poleIds.length === 1 ? ' ' + esc(prof().poleIds[0]) + ' is the first pole of ' + esc(prof().name || 'this profile') + '. Select the next poles on the plan and choose <b>Add to profile</b>.' : '';
      box.innerHTML = '<p class="v3msg">Build a profile with at least two surveyed poles, or drop a PNW project, to see the profile.' + only + '</p>'; pv.geom = null; return;
    }
    var chainOf = {}; poles.forEach(function (p) { chainOf[p.id] = p.chainage; });
    var R = pvRange(), x0 = R.x0, x1 = R.x1, inWin = function (c) { return c >= x0 - (x1 - x0) * 0.02 && c <= x1 + (x1 - x0) * 0.02; };
    // vertical range follows what is visible (poles in the window, ground within it)
    var vis = poles.filter(function (p) { return inWin(p.chainage); }), gv = ground.filter(function (q) { return q.c >= x0 - 1e-9 && q.c <= x1 + 1e-9; });
    if (!vis.length) vis = poles;
    if (pv.x0 != null && ground.length > 1) { var zAt = function (c) { for (var i = 1; i < ground.length; i++) if (ground[i].c >= c) { var a = ground[i - 1], b = ground[i], t = b.c === a.c ? 0 : (c - a.c) / (b.c - a.c); return a.z + (b.z - a.z) * Math.max(0, Math.min(1, t)); } return ground[ground.length - 1].z; }; gv = gv.concat([{ c: x0, z: zAt(x0) }, { c: x1, z: zAt(x1) }]); }
    var lo = Math.min.apply(null, vis.map(function (p) { return p.ground - (p.sunk || 0); }).concat(gv.map(function (g) { return g.z; }))), hi = Math.max.apply(null, vis.map(function (p) { return p.ground + (p.height || 0); }).concat(clr.filter(function (g) { return inWin(g.c); }).map(function (g) { return g.z + g.c1; })));
    var y0 = Math.floor(lo - 0.5), y1 = Math.ceil(hi + 1);
    var pw = W - m.l - m.r, X = function (v) { return m.l + (v - x0) / (x1 - x0) * pw; }, Y = function (v) { return H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b); };
    pv.geom = { l: m.l, w: pw, x0: x0, x1: x1 };
    var g = '', step = niceStep(y1 - y0, 5), xs = niceStep(x1 - x0, 8);
    for (var v = Math.ceil(y0 / step) * step; v <= y1; v += step) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#e6ebf0"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 3) + '" text-anchor="end" class="ax">' + +v.toFixed(2) + '</text>';
    for (var c = Math.ceil(x0 / xs) * xs; c <= x1 + 1e-9; c += xs) g += '<text x="' + X(c) + '" y="' + (H - m.b + 14) + '" text-anchor="middle" class="ax">' + +c.toFixed(1) + '</text>';
    var d = '<g clip-path="url(#pvclip)">';
    // selected span band, then span hit areas (under the pole hit areas)
    var ids = poles.map(function (p) { return p.id; });
    if (S.selSpan && chainOf[S.selSpan.a] != null && chainOf[S.selSpan.b] != null) { var sa = X(chainOf[S.selSpan.a]), sb = X(chainOf[S.selSpan.b]); d += '<rect x="' + Math.min(sa, sb) + '" y="' + m.t + '" width="' + Math.abs(sb - sa) + '" height="' + (H - m.t - m.b) + '" fill="#f59e0b" opacity=".13"/>'; }
    if (pvShow().ground) d += '<path d="' + ground.map(function (q, i) { return (i ? 'L' : 'M') + X(q.c).toFixed(1) + ' ' + Y(q.z).toFixed(1); }).join(' ') + '" fill="none" stroke="#2f6ea4" stroke-width="2"/>';
    if (clr.length > 1 && pvShow().clr) d += '<path d="' + clr.map(function (q, i) { return (i ? 'L' : 'M') + X(q.c).toFixed(1) + ' ' + Y(q.z + q.c1).toFixed(1); }).join(' ') + '" fill="none" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="6 4"/>';
    poles.forEach(function (p) {
      var sel = isSel(p.id), x = X(p.chainage);
      if (x < m.l - 40 || x > W - m.r + 40) return;
      if (p.sunk) d += '<line x1="' + x + '" x2="' + x + '" y1="' + Y(p.ground) + '" y2="' + Y(p.ground - p.sunk) + '" stroke="#5b4636" stroke-width="3" stroke-dasharray="3 3" opacity=".6"/>';
      if (p.height) d += '<line x1="' + x + '" x2="' + x + '" y1="' + Y(p.ground) + '" y2="' + Y(p.ground + p.height) + '" stroke="' + (sel ? '#f59e0b' : '#8b6b4a') + '" stroke-width="' + (sel ? 5 : 3) + '"/>';
      d += '<text x="' + x + '" y="' + (Y(p.ground + (p.height || 0)) - 6) + '" text-anchor="' + (x - m.l < 36 ? 'start' : m.l + pw - x < 36 ? 'end' : 'middle') + '" class="pl' + (sel ? ' sel' : '') + '">' + esc(p.id) + '</text>';
    });
    if (dm) {
      dm.wires.forEach(function (w) {
        var wk = wireKind(w); if (wk !== 'other' && pvShow()[wk] === false) return;
        var a = chainOf[w.from.pole], b = chainOf[w.to.pole]; if (a == null || b == null || Math.max(a, b) < x0 || Math.min(a, b) > x1) return;
        var pts = []; for (var k = 0; k <= 20; k++) { var t = k / 20, z = w.from.elevation + (w.to.elevation - w.from.elevation) * t - (w.sag ? 4 * w.sag * t * (1 - t) : 0); pts.push(X(a + (b - a) * t).toFixed(1) + ' ' + Y(z).toFixed(1)); }
        d += '<path d="M' + pts.join(' L') + '" fill="none" stroke="' + WCOL[wireKind(w)] + '" stroke-width="1.4"><title>' + esc(w.segment + ' ' + w.conductor + ' phase ' + w.phase + ' · ' + w.from.pole + ' → ' + w.to.pole + ' · span ' + w.span.toFixed(2) + ' m · sag ' + (w.sag != null ? w.sag.toFixed(2) + ' m (' + w.sagSource + ')' : 'not shown')) + '</title></path>';
      });
      if (pvShow().att) dm.points.forEach(function (q) { var c0 = chainOf[q.pole]; if (c0 == null || c0 < x0 || c0 > x1) return; d += '<circle cx="' + X(c0) + '" cy="' + Y(q.elevation) + '" r="2.6" fill="#fff" stroke="#172638" stroke-width="1.2"><title>' + esc(q.pole + ' ' + q.construction + ' #' + q.order + ': ' + q.heightAG + ' m above ground (king bolt ' + q.provenance.kingbolt + ' + y ' + q.provenance.y + ')') + '</title></circle>'; });
    }
    for (var i = 1; i < ids.length; i++) d += '<rect class="hit span" data-span="' + esc(ids[i - 1]) + '|' + esc(ids[i]) + '" x="' + X(chainOf[ids[i - 1]]) + '" y="' + m.t + '" width="' + Math.max(0, X(chainOf[ids[i]]) - X(chainOf[ids[i - 1]])) + '" height="' + (H - m.t - m.b) + '" fill="transparent"><title>Span ' + esc(ids[i - 1]) + ' → ' + esc(ids[i]) + ': click to select</title></rect>';
    if (CT.on && dm) d += ctProfile(chainOf, X, Y);
    poles.forEach(function (p) { d += '<rect class="hit' + (CT.on ? ' ct' : '') + '" data-pick="' + esc(p.id) + '" x="' + (X(p.chainage) - 12) + '" y="' + m.t + '" width="24" height="' + (H - m.t - m.b) + '" fill="transparent"/>'; });
    d += '</g>';
    g = '<defs><clipPath id="pvclip"><rect x="' + m.l + '" y="0" width="' + pw + '" height="' + H + '"/></clipPath></defs>' + g + d;
    g += '<text x="' + (m.l + pw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" class="ax">Chainage (m)</text><text transform="translate(11 ' + (m.t + (H - m.t - m.b) / 2) + ') rotate(-90)" text-anchor="middle" class="ax">RL (m)</text>';
    var leg = '<div class="chart-legend pv-legend"><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#2f6ea4" stroke-width="2"/></svg>Ground</span>' + (clr.length > 1 ? '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="6 4"/></svg><span title="Clearance 1 line from the PNW project, for reference only">Clearance line (ref.)</span></span>' : '') +
      '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#5b4636" stroke-width="3" stroke-dasharray="3 3" opacity=".6"/></svg>Embedment</span>' + (dm ? '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.hv + '" stroke-width="2"/></svg>HV</span><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.lv + '" stroke-width="2"/></svg>LV</span><span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + WCOL.earth + '" stroke-width="2"/></svg>Running earth</span>' : '') + '<span class="muted explain">Wheel zooms, drag pans, double-click fits · ← → change pole · vertical scale exaggerated</span></div>';
    if (!$('pvPlot')) box.innerHTML = '<div id="pvPlot"></div><div class="pv-nav"><input type="range" id="pvSlide" min="0" max="1000" step="1" aria-label="Pan along the profile" title="Drag to move along the line (or use the mouse wheel)">' +
      '<span class="pv-scale" id="pvScale" title="Horizontal scale only; the vertical scale does not change. Ctrl + wheel zooms horizontally."></span>' +
      '<button class="ibtn" data-pvz="out" title="Zoom out horizontally" aria-label="Zoom out horizontally">−</button><button class="ibtn" data-pvz="in" title="Zoom in horizontally" aria-label="Zoom in horizontally">+</button><button class="ibtn" data-pvz="fit" title="Whole line" aria-label="Show the whole line">⤢</button></div>';
    $('pvPlot').innerHTML = leg + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Line profile" style="touch-action:none">' + g + '</svg>';
    var fr = R.full, fw = fr.x1 - fr.x0, ww = x1 - x0, sl = $('pvSlide'), mpp = ww / pw, ratio = Math.round(mpp / 0.000264583 / 10) * 10;
    sl.disabled = !(fw - ww > 1e-6); if (document.activeElement !== sl) sl.value = fw - ww > 1e-6 ? Math.round(Math.max(0, Math.min(1, (x0 - fr.x0) / (fw - ww))) * 1000) : 0;
    $('pvScale').textContent = 'H ×' + (fw / ww).toFixed(fw / ww < 1 ? 2 : 1) + ' · ≈1:' + ratio.toLocaleString('en-AU') + ' · ' + fmt(Math.max(fr.x0, x0), 0) + '–' + fmt(Math.min(fr.x1, x1), 0) + ' m';
  }
  (function () {
    var box = $('profileView'), drag = null, moved = false, raf = 0;
    box.tabIndex = 0;
    function chainAt(e) { var g = pv.geom, svg = box.querySelector('svg'); if (!g || !svg) return null; var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * (svg.viewBox.baseVal.width || r.width); return g.x0 + (x - g.l) / g.w * (g.x1 - g.x0); }
    // Wheel moves along the line; Ctrl + wheel changes the horizontal scale only.
    box.addEventListener('wheel', function (e) { if (!pv.geom || e.target.closest('.pv-nav')) return; e.preventDefault(); if (e.ctrlKey) { pvZoom(Math.exp(e.deltaY * 0.0016), chainAt(e)); return; } var r = pvRange(), w = r.x1 - r.x0, dc = Math.sign(e.deltaY || e.deltaX) * w * 0.1; pvSet(r.x0 + dc, r.x1 + dc); renderProfileView(); }, { passive: false });
    box.addEventListener('input', function (e) { if (e.target.id !== 'pvSlide') return; var r = pvRange(), f = r.full, w = r.x1 - r.x0, a = f.x0 + e.target.value / 1000 * Math.max(0, f.x1 - f.x0 - w); pvSet(a, a + w); renderProfileView(); });
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-pvz]'); if (!b) return; e.stopPropagation(); if (b.dataset.pvz === 'fit') pvFit(); else pvZoom(b.dataset.pvz === 'in' ? 1 / 1.5 : 1.5); });
    box.addEventListener('pointerdown', function (e) { if (e.button !== 0 || !pv.geom || e.target.closest('.pv-nav')) return; drag = { x: e.clientX, x0: pv.geom.x0, x1: pv.geom.x1 }; moved = false; });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.x; if (Math.abs(dx) > 4) { moved = true; box.classList.add('pan'); }
      if (!moved) return; var svg = box.querySelector('svg'), sc = svg ? (svg.viewBox.baseVal.width || 1) / svg.getBoundingClientRect().width : 1, dc = dx * sc / pv.geom.w * (drag.x1 - drag.x0);
      pvSet(drag.x0 - dc, drag.x1 - dc); if (!raf) raf = requestAnimationFrame(function () { raf = 0; renderProfileView(); });
    });
    window.addEventListener('pointerup', function () { drag = null; box.classList.remove('pan'); setTimeout(function () { moved = false; }, 0); });
    box.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); return; }
      var t = e.target.closest('[data-pick]'); if (t) { select(t.dataset.pick, addInfo(e)); return; }
      var sp = e.target.closest('[data-span]'); if (sp) { var k = sp.dataset.span.split('|'); selectSpan(k[0], k[1]); }
    });
    box.addEventListener('dblclick', function (e) { if (e.target.closest('[data-pick]')) { pvFocus(e.target.closest('[data-pick]').dataset.pick); renderProfileView(); } else pvFit(); });
    box.addEventListener('keydown', function (e) {
      var k = e.key, ids = lineIds(), i = ids.indexOf(S.selected);
      if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); var j = i < 0 ? (k === 'ArrowRight' ? 0 : ids.length - 1) : i + (k === 'ArrowRight' ? 1 : -1); if (ids[j]) select(ids[j]); }
      else if (k === 'Home' && ids.length) { e.preventDefault(); select(ids[0]); } else if (k === 'End' && ids.length) { e.preventDefault(); select(ids[ids.length - 1]); }
      else if (k === '+' || k === '=') pvZoom(0.7); else if (k === '-' || k === '_') pvZoom(1 / 0.7);
      else if (k === '0' || k === 'f' || k === 'F') pvFit(); else if (k === 'z' || k === 'Z') { if (S.selected) { pvFocus(S.selected); renderProfileView(); } }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { /* leave page scroll alone */ }
    });
  })();
  Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) { b.onclick = function () { setView(b.dataset.view); }; });
  function cam(fn) { if (!window.PNW3D || !mounted3d) { setStatus('Open the 3D view first.'); return false; } return fn(window.PNW3D); }
  $('v3fit').onclick = function () { cam(function (v) { v.fit(); }); };
  $('v3reset').onclick = function () { cam(function (v) { v.reset(); }); };
  $('v3focus').onclick = function () { if (!S.selected) { setStatus('Select a pole first, then Focus selected frames it.'); return; } cam(function (v) { if (!v.focus(S.selected)) setStatus(S.selected + ' is not drawn in 3D (no coordinates or ground level).', 'bad'); }); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-cam]'), function (b) { b.onclick = function () { cam(function (v) { v.view(b.dataset.cam); }); }; });
  $('sagMode').onchange = function () { S.sagMode = this.value; buildDesignModel(); save(); renderViews(); };
  $('sagTemp').onchange = function () { S.sagTemp = Number(this.value); buildDesignModel(); save(); renderViews(); };
  [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].forEach(function (t) { $('sagTemp').insertAdjacentHTML('beforeend', '<option value="' + t + '">' + t + ' °C final' + (t > 45 ? ' (extended)' : '') + '</option>'); });
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
      buffers = {}; undoStack = []; redoStack = []; lastSnap = null; aiResults = {}; syncInputs(); recompute(); fit(); setView(S.view, true); markDirty(false);
      setStatus('Opened ' + file.name + '. ' + summaryText(), 'good');
    }).catch(function (e) { setStatus(file.name + ' could not be opened: ' + e.message, 'bad'); });
  }
  $('tbSave').onclick = function () { saveProjectFile(); markDirty(false); };
  $('tbOpen').onclick = function () { $('projInput').click(); };
  $('projInput').onchange = function () { if (this.files[0]) openProjectFile(this.files[0]); this.value = ''; };
  $('tbUndo').onclick = function () { if (!undoStack.length) { setStatus('Nothing to undo.'); return; } restore(undoStack, redoStack); setStatus('Undone (' + undoStack.length + ' more step' + (undoStack.length === 1 ? '' : 's') + ' to undo). Ctrl+Y redoes.', 'good'); };
  $('tbRedo').onclick = function () { if (!redoStack.length) { setStatus('Nothing to redo.'); return; } restore(redoStack, undoStack); setStatus('Redone.', 'good'); };
  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) work everywhere except while typing in a text box, where the browser's own undo applies.
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var a = document.activeElement, typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|range|file|color)$/i.test(a.type)));
    var k = (e.key || '').toLowerCase(); if (k !== 'z' && k !== 'y') return;
    if (typing && a.value !== a.defaultValue) return;
    e.preventDefault(); if (a && a !== document.body && a.blur) a.blur();
    if (k === 'z' && !e.shiftKey) $('tbUndo').click(); else $('tbRedo').click();
  }, true);

  /* ---------- toolbar and wiring ---------- */
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); drop.classList.add('over'); } }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (ev === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }); });
  document.addEventListener('drop', function (e) { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); addFiles(e.dataTransfer.files); });
  $('pickBtn').onclick = $('tbUpload').onclick = function () { replaceIdx = null; $('fileInput').click(); };
  $('fileInput').onchange = function () {
    var fl = this.files;
    if (replaceIdx != null && fl.length === 1 && S.files[replaceIdx]) {
      var old = S.files[replaceIdx].name; S.files.splice(replaceIdx, 1); delete buffers[old]; setStatus('Replacing ' + old + '…');
    }
    replaceIdx = null; addFiles(fl); this.value = '';
  };
  // Fit project works in whichever view is open: the map extent, or the 3D camera on the whole line.
  $('tbFit').onclick = function () { if ((S.view === '3d' || S.view === 'split') && window.PNW3D && mounted3d) window.PNW3D.fit(); else if (S.view === 'plan') fit(); else pvFit(); };
  $('tbLayers').onclick = function (e) {
    var pop = $('layersPop'), open = pop.hidden; pop.hidden = !open; this.setAttribute('aria-expanded', open);
    if (open) { var r = $('mView').getBoundingClientRect(), t = $('mView').closest('.toolbar').getBoundingClientRect(); pop.style.left = Math.max(0, Math.min(r.left - t.left, t.width - 320)) + 'px'; pop.style.top = (r.bottom - t.top + 6) + 'px'; if (S.view !== 'plan') setStatus('Layers apply to the plan view.'); }
    e.stopPropagation();
  };
  document.addEventListener('click', function (e) { var pop = $('layersPop'); if (!pop.hidden && !pop.contains(e.target)) { pop.hidden = true; $('tbLayers').setAttribute('aria-expanded', 'false'); } });
  $('tbLabels').onclick = function () { S.labels = !S.labels; this.classList.toggle('on', S.labels); this.setAttribute('aria-pressed', S.labels); renderMap(); renderViews(); save(); };
  /* ---------- tipload (PNW method, pnw-tipload.js): circuits from the design, stays and plant from the pole's extras ---------- */
  var TIP = window.PNWTip, BUILTIN_TIP = (window.PNW_BUILTIN || {}).tipload || null, tipSel = null, tipOptsOpen = null;
  var TIP_COL = ['#c2410c', '#2f6ea4', '#0f766e', '#7c3aed', '#a16207', '#be185d', '#475569'];
  // PNW option sets (load combinations) by the name PNW stores in a tipload project's "currentoption". AM-SL1 from the
  // S1242155 report; A-SL1 from the S802232 report (09/09/2026), both Options pages. A tipload file uses its own set.
  var OPT_SETS = {};
  if (BUILTIN_TIP) OPT_SETS['v7 REGION AM-SL1'] = BUILTIN_TIP.cases;
  OPT_SETS['v7 REGION A-SL1'] = [
    { name: 'Max wind load', ice: 'None', temp: 15, windPole: 1170, windCond: 900, windPlant: 1710, Ft: 1.25, Wn: 1, Gs: 1.1, Gc: 1.25, strengthClass: 'Ultimate limit', phi: 1, include: true },
    { name: 'Everyday', ice: 'None', temp: 15, windPole: 0, windCond: 0, windPlant: 0, Ft: 1.1, Wn: 1, Gs: 1.1, Gc: 1.25, strengthClass: 'Ultimate limit', phi: 0.57, include: true }];
  function optSetOf(name) { name = String(name || '').trim(); if (OPT_SETS[name]) return name; var k = Object.keys(OPT_SETS).filter(function (x) { return x.toUpperCase() === name.toUpperCase(); })[0]; return k || null; }
  function tipSet() {
    if (!S.tipload) S.tipload = BUILTIN_TIP ? { cases: JSON.parse(JSON.stringify(BUILTIN_TIP.cases)), options: Object.assign({}, TIP.DEFAULT_OPTIONS, BUILTIN_TIP.options), source: BUILTIN_TIP.name } : { cases: [], options: Object.assign({}, TIP.DEFAULT_OPTIONS), source: '' };
    S.tipload.options = Object.assign({}, TIP.DEFAULT_OPTIONS, S.tipload.options);
    return S.tipload;
  }
  // Plant weight, centre-of-mass offset and wind area by code: the user's entries first, then the private built-in set.
  // PNW pole-mounted plant database (Western Power set, from Ishan's PNW export pnwdata-wp-may19.xml): code, weight kg, offset m, wind area m².
  var PLANT_DB = {}; [["GS0311 AND XT0026",582.0,0.9,1.77],["GS0310 AND XT0018",187.0,0.71,1.22],["RC0001 AND XT0026",470.0,0.76,1.08],["RC0001 AND XT0018",400.0,0.73,0.95],["RC0002 AND XT0026",420.0,0.76,1.08],["RC0002 AND XT0018",350.0,0.73,0.95],["GS6016 AND XT0018",253.0,1.39,1.51],["GS0131 AND XT0022",278.0,1.39,1.57],["GS6016 AND XT0026",323.0,1.39,1.7],["GS0131 AND XT0040",408.0,1.39,1.84],["GS0320 AND XT0026",377.0,1.3575,1.77],["GS0320 AND XT0018",307.0,1.3575,1.59],["GS0319 AND XT0018",242.0,1.3575,1.59],["''XT0040 -1 Phase",280.0,0.784,0.251],["'GS0319-LBS",117.0,1.358,0.73],["GS0320-LBS",182.0,1.358,0.73],["GS0311-3Ph-Rec",387.0,0.8975,0.77],["GS0312-3Ph-Rec",387.0,0.935,0.792],["GS0315-3Ph-Rec",148.0,1.0565,0.579],["GS6016 - LBS/SC",128.0,1.395,0.65],["GS0131 - LBS/SC",128.0,1.395,0.65],["XT 0184 - 3Ph",1680.0,0.898,1.942],["GS0314- 1 PhRec",82.0,1.057,0.579],["GS 0310 -1PhRec",62.0,0.708,0.519],["X T 000 8-3Ph",360.0,0.768,0.461],["XT0010-3Ph",1310.0,0.823,1.489],["XT 00 13 -3Ph",340.0,0.768,0.392],["X T0030-3Ph",340.0,0.778,0.48],["X T0032-3Ph",850.0,0.846,0.942],["X T 0033-3Ph",1330.0,0.843,1.684],["X T00 35 - 3Ph",580.0,0.818,0.634],["X T0 038 -3Ph",1150.0,0.843,1.053],["X T 0039-3Ph",1460.0,0.838,1.214],["X T 0127-3Ph",960.0,0.813,0.851],[".. XT 0140 -3Ph",500.0,0.765,0.534],[".XT0141-3Ph",780.0,0.787,0.666],["GS0319 AND XT0022",242.0,1.3575,1.59],["RC0001 - CB",275.0,0.7305,0.342],["RC0002 - CB",225.0,0.7305,0.342],["..X T 0142-3Ph",550.0,0.812,0.495],[".   XT0143-3Ph",640.0,0.828,0.595],["..XT..0181-3Ph",1860.0,0.898,1.986],[". XT. 0182 - 3 Ph",1600.0,0.858,1.92],["X T 0007-1Ph",175.0,0.724,0.205],[".X T 0018-1Ph",125.0,0.714,0.148],[".XT0020-1Ph",240.0,0.746,0.212],[".XT0022-1Ph",150.0,0.759,0.161],["XT  0024 - 1Ph",265.0,0.803,0.234],["XT0039-3ph",245.0,0.743,0.214],["XT0039",195.0,0.7565,0.201],["GS0312 AND XT0035",967.0,0.94,2.96],["GS0311 AND XT0018",512.0,0.9,1.61],["GS0312 AND XT0022",537.0,0.94,1.68],["XT0214",1960.0,0.7,1.8],["XT0219",1860.0,0.7,1.85],["XT0224",1955.0,0.7,1.9]].forEach(function (r) { PLANT_DB[r[0]] = { weight: r[1], offset: r[2], area: r[3], source: 'PNW plant database (Western Power set)' }; });
  function plantData(code) {
    if (!code) return null;
    var k = String(code).trim(), own = S.tipload && S.tipload.plant && S.tipload.plant[k], db = BUILTIN_TIP && BUILTIN_TIP.plant;
    if (own && own.weight != null && own.offset != null && own.area != null) return Object.assign({ source: 'your plant data' }, own);
    return PLANT_DB[k] || (db ? db[k] || null : null);
  }
  function plantCodes() {
    var out = [];
    Object.keys(S.design.extras || {}).forEach(function (id) { (S.design.extras[id].plant || []).forEach(function (p) { if (p.code && out.indexOf(p.code.trim()) < 0) out.push(p.code.trim()); }); });
    tipFiles().forEach(function (f) { try { var a = M.readPnwx(f.text).attrs; ['plant1', 'plant2'].forEach(function (k) { var c = (a[k] || '').trim(); if (c && out.indexOf(c) < 0) out.push(c); }); } catch (e) { /* not readable */ } });
    Object.keys((S.tipload && S.tipload.plant) || {}).forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
    return out;
  }
  function tipConductor(p, code) {
    var u = String(code || '').toUpperCase(), r = ((p && p.conductors) || []).filter(function (c) { return String(c.Code).toUpperCase() === u; })[0];
    if (r) return { code: r.Code, mass: PNW.num(r.Mass_kg_m), diam: PNW.num(r.NomDia_mm), E: PNW.num(r.ModElast_Gpa), csa: PNW.num(r.CSA_mm2), alpha: PNW.num(r.ExpCoeff__C), cbl: PNW.num(r.CBL_kN), src: 'project' };
    var c = lib && lib.conductors.filter(function (x) { return String(x.code).toUpperCase() === u; })[0];
    return c ? { code: c.code, mass: c.mass, diam: c.diameter, E: c.modElast, csa: c.csa, alpha: PNW.num(c.expCoeff), cbl: c.cbl, src: 'PNW library' } : null;
  }
  // Wires touching pole `id` in one project's design model; `alias` maps that project's pole ids to the design's ids.
  function tipCircuitsFrom(p, d, id, alias, line) {
    var out = {}, segs = {};
    (p.segments || []).forEach(function (s) { segs[s.StrainSect] = s; });
    d.wires.forEach(function (w) {
      var a = alias(w.from.pole), b = alias(w.to.pole), me, other;
      if (a === id) { me = w.from; other = w.to; } else if (b === id) { me = w.to; other = w.from; } else return;
      var seg = segs[w.segment] || {}, cond = tipConductor(p, w.conductor || seg.Conductor), t = PNW.num(seg.Tension);
      var kN = seg.TensionUnits === '%CBL' ? (cond && cond.cbl > 0 && t > 0 ? t / 100 * cond.cbl : null) : seg.TensionUnits === 'kN' ? t : null;
      var span = Math.hypot(other.easting - me.easting, other.northing - me.northing), dir = bearing(me, other), mes = PNW.num(seg.MES);
      var key = w.segment + '|' + me.heightAG + '|' + dir + '|' + other.pole;
      if (out[key]) { out[key].n++; return; }
      out[key] = { line: line, segment: w.segment, code: cond ? cond.code : w.conductor, cond: cond, n: 1, dir: dir, attHt: me.heightAG, span: Math.round(span * 100) / 100,
        mes: mes > 0 ? mes : Math.round(span * 100) / 100, vdiff: Math.round((other.elevation - me.elevation) * 100) / 100, tension: kN, tensionText: seg.Tension + ' ' + (seg.TensionUnits || ''), to: alias(other.pole), construction: me.construction };
    });
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  // Dropped PNW tipload projects are calculated as they are, to compare with PNW's own results.
  function tipFiles() { return filesOf('pnwx').filter(function (f) { return f.kind === 'tipload'; }); }
  function tipFileInput(name) {
    var f = tipFiles().filter(function (x) { return x.name === name; })[0]; if (!f) return null;
    var t; try { t = M.readPnwx(f.text); } catch (e) { return null; }
    var inp = TIP.fromTipProject(t, function (code) { return tipConductor(null, code); }, plantData, function (w) { var x = ((lib && lib.stays) || []).filter(function (s) { return s.code === w; })[0]; return x ? x.strength : null; });
    inp.circuits.forEach(function (c) { c.to = ''; c.line = ''; });
    if (inp.circuits.some(function (c) { return !c.cond; })) inp.notes.push('Some conductors are not in the PNW library tables, so they have no properties.');
    inp.plant.forEach(function (p) { var db = plantData(p.code); if (db && p.include) inp.notes.push(p.code + ': ' + db.source); });
    inp.file = name; inp.optionSet = (t.attrs && t.attrs.currentoption) || '';
    if (inp.optionSet && !optSetOf(inp.optionSet)) inp.notes.push('This file uses option set “' + inp.optionSet + '”, which is not built in here, so the load combinations below are used. Paste that report’s Options page to add it.');
    return inp;
  }
  function tipInput(id) {
    if (/^tip:/.test(id)) return tipFileInput(id.slice(4));
    var q = dm && dm.allPoles.filter(function (p) { return p.id === id; })[0];
    if (!q) return null;
    var t = poleTypeFor(id, q.length), notes = [];
    var cct = tipCircuitsFrom(project, dm, id, function (x) { return x; }, '');
    xLines.forEach(function (x) { if (Object.keys(x.common).some(function (k) { return x.common[k].id === id; })) cct = cct.concat(tipCircuitsFrom(x.project, x.dm, id, function (pid) { return x.common[pid] ? x.common[pid].id : pid; }, x.title)); });
    var ex = (S.design.extras || {})[id] || { stays: [], plant: [] }, stays = (lib && lib.stays) || [];
    var pole = { id: id, height: q.height, length: q.length, type: t ? t.code : null, diamAvg: t && t.diamAvg > 0 ? t.diamAvg : null, diamTip: t ? t.diamTip : null, diamGL: t ? t.diamGL : null,
      weight: t ? t.weight : null, strength: t ? t.ultimate : null, strengthVert: t ? t.vertical : null, flex: 0 };
    if (!t) notes.push('No PNW library pole type for ' + id + ': no wind on the pole, no self weight and no % loaded. Pick the pole type in the Pole tab.');
    var plant = ex.plant.map(function (pl) {
      var db = plantData(pl.code), w = pl.weight != null && pl.weight !== '' ? Number(pl.weight) : db ? db.weight : null;
      var r = { code: pl.code, attHt: Number(pl.attHt), dir: Number(pl.dir), weight: w, offset: pl.offset != null && pl.offset !== '' ? Number(pl.offset) : db ? db.offset : null, area: pl.area != null && pl.area !== '' ? Number(pl.area) : db ? db.area : null, include: pl.include !== false };
      if (r.include && (r.weight == null || r.offset == null || r.area == null)) { notes.push('Transformer ' + (pl.code || '') + ' has no weight, offset or wind area, so it is left out. Enter them in the Pole tab (PNW plant database values).'); r.include = false; }
      else if (db && (pl.weight == null || pl.weight === '')) notes.push((pl.code || '') + ': ' + db.source);
      return r;
    });
    return { pole: pole, circuits: cct, notes: notes, plant: plant,
      stays: ex.stays.map(function (s) { var w = stays.filter(function (x) { return (x.code || x.Code) === s.wire; })[0]; return { wire: s.wire, attHt: Number(s.attHt), dir: Number(s.dir), angle: s.angle === '' || s.angle == null || !isFinite(Number(s.angle)) ? 45 : Number(s.angle), include: s.include !== false, strength: w ? w.strength : null }; }) };
  }
  function tipCalc(id) { var inp = tipInput(id); if (!inp) return null; var st = tipSet(), os = inp.optionSet && optSetOf(inp.optionSet), cases = os ? OPT_SETS[os] : st.cases, r = TIP.calc(inp, cases, st.options); r.input = inp; if (os && !inp._osNote) { inp._osNote = 1; inp.notes.unshift('Load combinations: ' + os + ' (the option set saved in this file).'); } r.optionSet = os || st.source || ''; return r; }
  function tipPoles() { return (dm ? dm.allPoles.filter(function (p) { return p.height > 0; }).map(function (p) { return p.id; }) : []).concat(tipFiles().map(function (f) { return 'tip:' + f.name; })); }
  function tipName(id) { return /^tip:/.test(id) ? 'PNW tipload ' + id.slice(4).replace(/\.pnwx$/i, '') : id; }
  var f2 = function (v, dp) { return v == null || !isFinite(v) ? '–' : Number(v).toFixed(dp == null ? 2 : dp); };
  function tipBadge(r) { return r.pass == null ? '<span class="pill mute">no strength</span>' : r.pass ? '<span class="pill ok">PASS</span>' : '<span class="pill bad">FAIL</span>'; }

  function tipPolar(r) {
    var S0 = 300, c = S0 / 2, R = c - 40, inp = r.input, res = r.results, max = Math.max.apply(null, res.map(function (x) { return x.load; }).concat([0.001]));
    var step = niceStep(max, 3), top = Math.ceil(max / step) * step, k = R / top;
    var P = function (b, rad) { return [c + Math.sin(b * Math.PI / 180) * rad, c - Math.cos(b * Math.PI / 180) * rad]; };
    var g = '';
    var used = inp.circuits.map(function (q) { return q.dir; }).concat(inp.stays.map(function (q) { return q.dir; }), inp.plant.map(function (q) { return q.dir; }), res.map(function (q) { return q.dir; }), res.filter(function (q) { return q.wind; }).map(function (q) { return q.windFrom; }));
    var gap = function (b) { return Math.min.apply(null, used.map(function (u) { var d = Math.abs(((u - b) % 360 + 540) % 360 - 180); return d; }).concat([180])); }, rb = [135, 45, 225, 315, 160, 200, 20, 340].sort(function (a, b) { return gap(b) - gap(a); })[0];
    for (var v = step; v <= top + 1e-9; v += step) { var lp0 = P(rb, v * k); g += '<circle cx="' + c + '" cy="' + c + '" r="' + (v * k) + '" fill="none" stroke="#e6ebf0"/><text x="' + (lp0[0] + 3) + '" y="' + (lp0[1] + 10) + '" class="ax">' + +v.toFixed(2) + ' kN</text>'; }
    ['N', 'E', 'S', 'W'].forEach(function (t, i) { if (inp.circuits.some(function (q) { return Math.abs(((q.dir - i * 90) % 360 + 540) % 360 - 180) < 14; })) return; var p = P(i * 90, R + 14); g += '<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" class="ax b">' + t + '</text>'; });
    var grp = {}; inp.circuits.forEach(function (cc) { var p = P(cc.dir, R); g += '<line x1="' + c + '" y1="' + c + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="#94a3b8" stroke-width="1.5"/>'; var dk = Math.round(cc.dir / 10) * 10 % 360, gg = grp[dk] = grp[dk] || { dir: cc.dir, t: [] }, t = esc(cc.code) + '×' + cc.n; if (gg.t.indexOf(t) < 0) gg.t.push(t); });
    Object.keys(grp).forEach(function (dk) { var gg = grp[dk], b = gg.dir, p = P(b, R + 6), sx = Math.sin(b * Math.PI / 180), sy = -Math.cos(b * Math.PI / 180), anc = sx > 0.3 ? 'start' : sx < -0.3 ? 'end' : 'middle', y0 = p[1] + (sy > 0.3 ? 10 : sy < -0.3 ? -2 - (gg.t.length - 1) * 11 : 4 - (gg.t.length - 1) * 5.5); g += '<text text-anchor="' + anc + '" class="ax cl">' + gg.t.map(function (t, j) { return '<tspan x="' + p[0] + '" y="' + (y0 + j * 11) + '">' + t + '</tspan>'; }).join('') + '</text>'; });
    inp.stays.forEach(function (s, i) { // stay: line from the pole to its anchor, with the anchor bar across the end (as PNW draws it)
      var b = s.dir, p = P(b, R * 0.82), q1 = P(b + 90, 9), q2 = P(b - 90, 9), dx = q1[0] - c, dy = q1[1] - c, op = s.include ? '' : ' opacity=".45" stroke-dasharray="5 3"', lp = P(b, R * 0.82 + 14);
      g += '<line x1="' + c + '" y1="' + c + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="#ef4444" stroke-width="2.5"' + op + '/><line x1="' + (p[0] + dx) + '" y1="' + (p[1] + dy) + '" x2="' + (p[0] - dx) + '" y2="' + (p[1] - dy) + '" stroke="#ef4444" stroke-width="3" stroke-linecap="round"' + op + '/>';
      g += '<text x="' + lp[0] + '" y="' + (lp[1] + 4) + '" text-anchor="middle" class="ax cl" fill="#fca5a5">Stay ' + (i + 1) + ' ' + f2(+s.angle || 45, 0) + '°' + (s.include ? '' : ' (off)') + '</text>'; });
    inp.plant.forEach(function (pl) { if (!isFinite(pl.dir)) return; var p = P(pl.dir, 20); g += '<g transform="rotate(' + pl.dir + ' ' + p[0] + ' ' + p[1] + ')"' + (pl.include ? '' : ' opacity=".5"') + '><rect x="' + (p[0] - 13) + '" y="' + (p[1] - 8) + '" width="26" height="16" rx="3" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2"/></g><text x="' + p[0] + '" y="' + (p[1] + 3.5) + '" text-anchor="middle" class="ax b" style="font-size:9px">TX<title>' + esc(pl.code) + (pl.weight != null ? ', ' + pl.weight + ' kg' : '') + '</title></text>'; });
    res.forEach(function (x, i) {
      var col = TIP_COL[i % TIP_COL.length], p = P(x.dir, x.load * k);
      if (x.wind && x.windFrom != null) { var w0 = P(x.windFrom, R); g += '<line x1="' + w0[0] + '" y1="' + w0[1] + '" x2="' + c + '" y2="' + c + '" stroke="' + col + '" stroke-width="1.2" stroke-dasharray="5 4"/>'; }
      g += '<line x1="' + c + '" y1="' + c + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="' + col + '" stroke-width="2.5" marker-end="url(#tipArr' + i + ')"/>';
    });
    var defs = res.map(function (x, i) { return '<marker id="tipArr' + i + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + TIP_COL[i % TIP_COL.length] + '"/></marker>'; }).join('');
    return '<svg class="tip-polar" viewBox="0 0 ' + S0 + ' ' + S0 + '" role="img" aria-label="Polar diagram: circuits, stays and the resultant tipload of each load case"><defs>' + defs + '</defs>' + g + '<circle cx="' + c + '" cy="' + c + '" r="6" fill="#8b6b4a" stroke="#f472b6" stroke-width="2"><title>Pole</title></circle></svg>';
  }
  function tipCurve(r) {
    var res = r.results.filter(function (x) { return x.wind; });
    if (!res.length) return '';
    var W = 340, H = 190, m = { l: 36, r: 8, t: 10, b: 28 }, max = Math.max.apply(null, res.map(function (x) { return Math.max.apply(null, x.curve.map(function (c) { return Math.max(c.load, c.unstayed); })); }));
    var step = niceStep(max || 1, 4), top = Math.ceil((max || 1) / step) * step;
    var X = function (v) { return m.l + v / 360 * (W - m.l - m.r); }, Y = function (v) { return H - m.b - v / top * (H - m.t - m.b); }, g = '';
    for (var v = 0; v <= top + 1e-9; v += step) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#e6ebf0"/><text x="' + (m.l - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end" class="ax">' + +v.toFixed(2) + '</text>';
    for (var a = 0; a <= 360; a += 45) g += '<text x="' + X(a) + '" y="' + (H - m.b + 14) + '" text-anchor="middle" class="ax">' + a + '°</text>';
    g += '<text x="' + ((W + m.l) / 2) + '" y="' + (H - 3) + '" text-anchor="middle" class="ax">Wind from (°)</text>';
    res.forEach(function (x) {
      var i = r.results.indexOf(x), col = TIP_COL[i % TIP_COL.length], pts = x.curve.concat([{ from: 360, load: x.curve[0].load, unstayed: x.curve[0].unstayed }]);
      if (r.input.stays.some(function (s) { return s.include; })) g += '<path d="' + pts.map(function (c, j) { return (j ? 'L' : 'M') + X(c.from).toFixed(1) + ' ' + Y(c.unstayed).toFixed(1); }).join('') + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-dasharray="4 3" opacity=".7"/>';
      g += '<path d="' + pts.map(function (c, j) { return (j ? 'L' : 'M') + X(c.from).toFixed(1) + ' ' + Y(c.load).toFixed(1); }).join('') + '" fill="none" stroke="' + col + '" stroke-width="2"/>';
      g += '<circle cx="' + X(x.windFrom) + '" cy="' + Y(x.load) + '" r="4" fill="' + col + '" stroke="#fff" stroke-width="2"/>';
    });
    window.__tipCurve = { res: res, all: r.results, X0: m.l, X1: W - m.r, W: W };
    return '<div class="tip-curve" id="tipCurve"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Tipload against wind direction">' + g + '<line id="tipX" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="#64748b" stroke-width="1" visibility="hidden"/></svg><div class="tt" id="tipTt" hidden></div></div>';
  }
  function tipLegend(r) { return '<div class="chart-legend">' + r.results.map(function (x, i) { return '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="' + TIP_COL[i % TIP_COL.length] + '" stroke-width="2.5"/></svg>' + esc(x.name) + '</span>'; }).join('') + (r.input.stays.some(function (s) { return s.include; }) ? '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Unstayed</span>' : '') + '<span><svg width="22" height="8"><line x1="0" x2="22" y1="4" y2="4" stroke="#64748b" stroke-width="1.2" stroke-dasharray="5 4"/></svg>Wind from (polar)</span></div>'; }

  function tipCasesHtml() {
    var st = tipSet(), o = st.options, inp = function (i, k, v, w) { return '<input data-lc="' + i + '|' + k + '" value="' + esc(v) + '" inputmode="decimal" style="width:' + (w || 56) + 'px" aria-label="' + esc(k) + '">'; };
    var h = '<details class="tip-opts"' + ((tipOptsOpen != null ? tipOptsOpen : !st.cases.length) ? ' open' : '') + '><summary>Load combinations and options' + (st.source ? ' · ' + esc(st.source) : '') + '</summary>';
    h += '<div class="tablewrap"><table class="grid"><thead><tr><th>Use</th><th>Name</th><th class="num">Temp °C</th><th class="num">Wind on pole Pa</th><th class="num">Wind on conductors Pa</th><th class="num">Wind on plant Pa</th><th class="num">Ft</th><th class="num">Wn</th><th class="num">Gs</th><th class="num">Gc</th><th class="num">Strength factor Ø</th><th></th></tr></thead><tbody>' +
      st.cases.map(function (c, i) { return '<tr><td><input type="checkbox" data-lc="' + i + '|include"' + (c.include !== false ? ' checked' : '') + ' aria-label="Use ' + esc(c.name) + '"></td><td><input data-lc="' + i + '|name" value="' + esc(c.name) + '" style="width:120px" aria-label="Name"></td><td>' + inp(i, 'temp', c.temp) + '</td><td>' + inp(i, 'windPole', c.windPole) + '</td><td>' + inp(i, 'windCond', c.windCond) + '</td><td>' + inp(i, 'windPlant', c.windPlant) + '</td><td>' + inp(i, 'Ft', c.Ft, 46) + '</td><td>' + inp(i, 'Wn', c.Wn, 46) + '</td><td>' + inp(i, 'Gs', c.Gs, 46) + '</td><td>' + inp(i, 'Gc', c.Gc, 46) + '</td><td>' + inp(i, 'phi', c.phi, 46) + '</td><td><button class="btn small" data-lcdel="' + i + '" aria-label="Remove ' + esc(c.name) + '">×</button></td></tr>'; }).join('') +
      '</tbody></table></div><div class="btnrow"><button class="btn small" id="lcAdd">Add load combination</button><label class="meta" style="display:flex;gap:6px;align-items:center">Option set for design poles <select id="lcSet"><option value="">Choose…</option>' + Object.keys(OPT_SETS).map(function (k) { return '<option' + (st.source && st.source.indexOf(k) >= 0 ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></label><span class="meta">Dropped tipload files use their own option set.</span></div>';
    h += '<div class="tip-optrow"><label>Wind direction step (°) <input data-to="step" value="' + o.step + '" inputmode="decimal" style="width:50px"></label><label title="Tipload is the moment divided by (tip height − this distance)">Load point below tip (m) <input data-to="loadBelowTip" value="' + o.loadBelowTip + '" inputmode="decimal" style="width:50px"></label>' +
      '<label>Wind on pole applied <select data-to="poleWindAt"><option value="half"' + (o.poleWindAt === 'half' ? ' selected' : '') + '>half way up</option><option value="centroid"' + (o.poleWindAt === 'centroid' ? ' selected' : '') + '>at the centroid</option></select></label>' +
      '<label>Wind on conductor <select data-to="condWindage"><option value="cos2"' + (o.condWindage === 'cos2' ? ' selected' : '') + '>cos² of incidence</option><option value="independent"' + (o.condWindage === 'independent' ? ' selected' : '') + '>independent of incidence</option></select></label>' +
      '<label>Wind for tension calc <select data-to="tensionWindage"><option value="cos2"' + (o.tensionWindage === 'cos2' ? ' selected' : '') + '>cos² of incidence</option><option value="independent"' + (o.tensionWindage === 'independent' ? ' selected' : '') + '>independent of incidence</option></select></label>' +
      '<label>Pole top allowance <input data-to="poleTop" value="' + o.poleTop + '" inputmode="decimal" style="width:50px"></label><label>Stringing temperature (°C) <input data-to="stdTemp" value="' + o.stdTemp + '" inputmode="decimal" style="width:50px"></label></div>';
    var codes = plantCodes();
    if (codes.length) h += '<h3 class="sub">Plant data</h3><table class="grid"><thead><tr><th>Plant code</th><th class="num">Weight (kg)</th><th class="num" title="Centre of mass from the side of the pole (PNW 7)">Offset from pole (m)</th><th class="num">Wind area (m²)</th><th>Source</th></tr></thead><tbody>' + codes.map(function (c) {
      var own = (st.plant || {})[c] || {}, d = plantData(c), v = function (k) { return own[k] != null ? own[k] : ''; }, ph = function (k) { return d && d[k] != null ? d[k] : ''; };
      return '<tr><td>' + esc(c) + '</td>' + ['weight', 'offset', 'area'].map(function (k) { return '<td class="num"><input data-pd="' + esc(c) + '|' + k + '" value="' + esc(v(k)) + '" placeholder="' + esc(ph(k)) + '" inputmode="decimal" style="width:70px" aria-label="' + esc(c + ' ' + k) + '"></td>'; }).join('') + '<td><small class="muted">' + esc(d ? d.source : 'missing: the plant is left out of the tipload') + '</small></td></tr>';
    }).join('') + '</tbody></table>';
    h += '<p class="hint explain">' + (BUILTIN_TIP ? esc(BUILTIN_TIP.optionsSource) : 'Enter the load combinations from your PNW Options, or paste them from a PNW tipload report below. Only what you enter is used.') + '</p>';
    h += '<div class="tip-paste"><textarea id="lcPaste" rows="3" placeholder="Paste the Options page text of a PNW tipload report (open the PDF, select all, copy) to read its load combinations"></textarea><button class="btn small" id="lcRead">Read load combinations</button></div></details>';
    return h;
  }
  function tipPoleHtml(id) {
    var r = tipCalc(id); if (!r) return '<p class="hint">Pick a pole.</p>';
    var inp = r.input, P = inp.pole, res = r.results, h = '';
    if (!/^tip:/.test(id) && unverifiedFor(id)) h += '<div class="verifybar"><b>Provisional: ' + unverifiedFor(id) + ' photo-derived input' + (unverifiedFor(id) > 1 ? 's' : '') + ' on this pole ' + (unverifiedFor(id) > 1 ? 'are' : 'is') + ' not field-verified.</b> Heights and offsets come from the library and DCSH rules, not from measurement. Once checked on site: <button class="btn small" data-tipverify="' + esc(id) + '">✓ Mark as verified in the field</button></div>';
    h += '<div class="tip-head"><h3 class="sub">' + esc(tipName(id)) + '</h3><span class="meta">' + esc(P.type || 'no pole type') + ' · ' + f2(P.height) + ' m above ground' + (P.diamAvg ? ' · average diameter ' + P.diamAvg + ' mm' : '') + (P.strength ? ' · strength ' + P.strength + '/' + (P.strengthVert || '–') + ' kN' : '') + '</span>' + (inp.file ? '<span class="pill info">calculated from the PNW file as saved</span>' : '<button class="btn small" data-tipgo="' + esc(id) + '">Show pole</button>') + '</div>';
    if (!res.length) h += '<p class="status bad">No load combinations ticked.</p>';
    else {
      h += '<div class="tip-tiles">' + res.map(function (x, i) { return '<div class="tile ' + (x.pass === false ? 'bad' : x.pass ? 'ok' : '') + '"><small><span class="sw" style="background:' + TIP_COL[i % TIP_COL.length] + '"></span>' + esc(x.name) + '</small><b>' + f2(x.load) + ' kN</b><span>' + (x.pctHor != null ? f2(x.pctHor, 0) + '% loaded · ' : '') + f2(x.dir, 0) + '°</span></div>'; }).join('') + '</div>';
      var row = function (k, fn) { return '<tr><th>' + k + '</th>' + res.map(function (x) { return '<td class="num">' + fn(x) + '</td>'; }).join('') + '</tr>'; };
      h += '<div class="tip-grid"><div><table class="grid tip-res"><thead><tr><th>Load name</th>' + res.map(function (x, i) { return '<th class="num"><span class="sw" style="background:' + TIP_COL[i % TIP_COL.length] + '"></span>' + esc(x.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        row('Result', function (x) { return tipBadge(x) + (x.bc != null ? ' <small class="muted">(combined B&amp;C)</small>' : ''); }) +
        row('Resultant load (kN)', function (x) { return '<b>' + f2(x.load) + '</b>'; }) + row('Direction (°)', function (x) { return f2(x.dir, 0); }) + row('Wind direction (°)', function (x) { return x.wind ? f2(x.windFrom, 0) : 'N/A'; }) +
        row('Moment (kN·m)', function (x) { return f2(x.moment); }) + row('Pole capacity ØR (kN)', function (x) { return f2(x.capacity, 1); }) + row('% Loaded (hor)', function (x) { return f2(x.pctHor, 0); }) +
        row('Stay loads (kN)', function (x) { return x.stays.length ? x.stays.map(function (s) { return f2(s.load) + (s.pct != null ? ' (' + f2(s.pct, 0) + '%)' : ''); }).join(' / ') : ''; }) +
        row('Vertical load (kN)', function (x) { return f2(x.vertical); }) + row('% Loaded (vert)', function (x) { return f2(x.pctVert, 0); }) + row('B&amp;C check', function (x) { return f2(x.bc); }) + row('Max unstayed load (kN)', function (x) { return f2(x.unstayed); }) +
        '</tbody></table>';
      h += '<h3 class="sub">Kingbolt loadings</h3><table class="grid"><thead><tr><th class="num">Attach. Ht (m)</th><th class="num">Load (kN)</th><th class="num">Direction (°)</th><th>Load case</th></tr></thead><tbody>' +
        res.filter(function (x) { return x.wind; }).slice(0, 1).concat(res.filter(function (x) { return x.wind; }).length ? [] : res.slice(0, 1)).map(function (x) { return x.kingbolt.map(function (k) { return '<tr><td class="num">' + f2(k.attHt) + '</td><td class="num">' + f2(k.load) + '</td><td class="num">' + f2(k.dir, 0) + '</td><td>' + esc(x.name) + '</td></tr>'; }).join(''); }).join('') + '</tbody></table></div>' +
        '<div class="tip-figs">' + tipLegend(r) + '<div class="tip-fig"><small>Plan: loads and directions</small>' + tipPolar(r) + '</div>' + tipCurve(r) + '</div></div>';
    }
    h += '<h3 class="sub">Circuits</h3>' + (inp.circuits.length ? '<div class="tablewrap"><table class="grid"><thead><tr><th>Section</th><th class="num">Direction (°)</th><th>Conductor</th><th class="num">Number</th><th class="num">Attach Ht (m)</th><th class="num">Span (m)</th><th class="num">RS/MES (m)</th><th class="num">Vertical diff (m)</th><th>Tension</th><th class="num">kN</th><th>To</th></tr></thead><tbody>' +
      inp.circuits.map(function (c) { return '<tr><td>' + esc((c.line ? c.line + ' · ' : '') + c.segment) + '</td><td class="num">' + f2(c.dir, 1) + '</td><td>' + esc(c.code) + (c.cond ? '' : ' <span class="tag bad">no data</span>') + '</td><td class="num">' + c.n + '</td><td class="num">' + f2(c.attHt) + '</td><td class="num">' + f2(c.span) + '</td><td class="num">' + f2(c.mes) + '</td><td class="num">' + f2(c.vdiff) + '</td><td>' + esc(c.tensionText) + '</td><td class="num">' + f2(c.tension) + '</td><td>' + esc(c.to) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="hint">No conductors attached to this pole.</p>');
    h += '<h3 class="sub">Stays and plant</h3>' + (inp.stays.length || inp.plant.length ? '<table class="grid"><tbody>' + inp.stays.map(function (s, i) { return '<tr><th>Stay ' + (i + 1) + (s.include ? '' : ' (not included)') + '</th><td>' + esc(s.wire) + ' at ' + f2(s.attHt) + ' m, bearing ' + f2(s.dir, 1) + '°, ' + f2(s.angle, 0) + '° to ground' + (s.strength ? ', strength ' + s.strength + ' kN' : '') + '</td></tr>'; }).join('') + inp.plant.map(function (p) { return '<tr><th>Plant' + (p.include ? '' : ' (not included)') + '</th><td>' + esc(p.code) + ' at ' + f2(p.attHt) + ' m, bearing ' + f2(p.dir, 0) + '°' + (p.weight != null ? ', ' + p.weight + ' kg, centre of mass ' + f2(p.offset) + ' m from the pole, wind area ' + f2(p.area) + ' m²' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="hint">None.' + (inp.file ? '' : ' Add stays and transformers in the Constructions tab of the inspector.') + '</p>');
    var saved = project && project.tiploads && project.tiploads[id] && project.tiploads[id].attrs;
    if (saved) h += '<p class="hint">PNW has tipload data saved for ' + esc(id) + ' in this project (stay ' + esc(saved.stay1_wire || 'none') + (saved.stay1_checked === 'True' ? '' : ', not included') + '; plant ' + esc((saved.plant1 || '').trim() || 'none') + (saved.plant1 && saved.plant1.trim() ? ' at ' + esc(saved.plant_attht) + ' m' : '') + '). <button class="btn small" data-tipuse="' + esc(id) + '">Use its stay and plant</button></p>';
    var notes = inp.notes.concat(r.issues);
    if (notes.length) h += '<ul class="issues-list">' + notes.map(function (n) { return '<li class="warning">' + esc(n) + '</li>'; }).join('') + '</ul>';
    h += '<p class="hint explain">Method as in the PNW 7 manual: wind from every ' + r.options.step + '°, conductor tension by change of state from the stringing tension at the ruling span, loads added as vectors and the worst direction reported. Tipload = ground moment ÷ (tip height − ' + r.options.loadBelowTip + ' m). Ice is not modelled. ' + (BUILTIN_TIP ? 'Checked against your S1242155 PNW report: 6.58 kN @ 66° (wind from 300°), 2.53 kN @ 45°, kingbolt 4.73 kN.' : 'Checked against a PNW 7.18 tipload report to the precision it prints.') + '</p>';
    return h;
  }
  function tipTableHtml(ids) {
    var st = tipSet(), cs = st.cases.filter(function (c) { return c.include !== false; });
    return '<div class="tablewrap tip-all"><table class="grid"><thead><tr><th>Pole</th><th>Type</th>' + cs.map(function (c, i) { return '<th class="num"><span class="sw" style="background:' + TIP_COL[i % TIP_COL.length] + '"></span>' + esc(c.name) + '</th>'; }).join('') + '<th>Result</th></tr></thead><tbody>' +
      ids.map(function (id) {
        var r = tipCalc(id); if (!r) return '';
        var fail = r.results.some(function (x) { return x.pass === false; }), none = r.results.every(function (x) { return x.pass == null; });
        return '<tr data-tippick="' + esc(id) + '" class="' + (id === tipSel ? 'sel' : '') + '"><td><b>' + esc(tipName(id)) + '</b></td><td>' + esc(r.input.pole.type || '–') + '</td>' + r.results.map(function (x) { return '<td class="num">' + f2(x.load) + ' kN @ ' + f2(x.dir, 0) + '°' + (x.pctHor != null ? ' · ' + f2(x.pctHor, 0) + '%' : '') + '</td>'; }).join('') + '<td>' + (none ? '<span class="pill mute">no strength</span>' : fail ? '<span class="pill bad">FAIL</span>' : '<span class="pill ok">PASS</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function openTip(id) {
    var ids = tipPoles();
    if (!ids.length) { setStatus('Tipload needs a design or a PNW tipload project: link a PNW project (drop a .pnwx), start a design from the ground profile, or drop a PNW tipload .pnwx.', 'bad'); return; }
    tipSel = id && ids.indexOf(id) >= 0 ? id : tipSel && ids.indexOf(tipSel) >= 0 ? tipSel : S.selected && ids.indexOf(S.selected) >= 0 ? S.selected : ids[0];
    renderTip(); $('tipDlg').hidden = false; $('closeTip').focus();
  }
  function renderTip() {
    var ids = tipPoles(), st = tipSet();
    $('tipBody').innerHTML = tipCasesHtml() + (st.cases.length ? tipTableHtml(ids) + '<div class="tip-pole">' + tipPoleHtml(tipSel) + '</div>' : '') +
      '<div class="btnrow"><button class="btn small" id="tipCsv"' + (st.cases.length ? '' : ' disabled') + '>Download tiploads (.csv)</button></div>';
    bindTipCurve();
  }
  function bindTipCurve() {
    var box = $('tipCurve'); if (!box) return;
    box.addEventListener('mousemove', function (e) {
      var d = window.__tipCurve, svg = box.querySelector('svg'), b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * d.W;
      if (x < d.X0 || x > d.X1) { $('tipTt').hidden = true; $('tipX').setAttribute('visibility', 'hidden'); return; }
      var a = (x - d.X0) / (d.X1 - d.X0) * 360, i = Math.round(a / (d.res[0].curve[1] ? d.res[0].curve[1].from - d.res[0].curve[0].from : 360)) % d.res[0].curve.length, from = d.res[0].curve[i].from;
      $('tipX').setAttribute('x1', d.X0 + from / 360 * (d.X1 - d.X0)); $('tipX').setAttribute('x2', d.X0 + from / 360 * (d.X1 - d.X0)); $('tipX').setAttribute('visibility', 'visible');
      var tt = $('tipTt'); tt.innerHTML = '<b>Wind from ' + from + '°</b>' + d.res.map(function (r) { var c = r.curve[i]; return '<br><span class="sw" style="background:' + TIP_COL[d.all.indexOf(r) % TIP_COL.length] + '"></span>' + esc(r.name) + ': ' + f2(c.load) + ' kN' + (Math.abs(c.unstayed - c.load) > 0.005 ? ' (unstayed ' + f2(c.unstayed) + ')' : ''); }).join('');
      var bb = box.getBoundingClientRect(); tt.hidden = false; tt.style.left = Math.min(e.clientX - bb.left + 12, bb.width - 200) + 'px'; tt.style.top = (e.clientY - bb.top + 12) + 'px';
    });
    box.addEventListener('mouseleave', function () { $('tipTt').hidden = true; $('tipX').setAttribute('visibility', 'hidden'); });
  }
  function tipCsv() {
    var st = tipSet(), cs = st.cases.filter(function (c) { return c.include !== false; }), rows = [['Pole', 'Pole type', 'Load case', 'Resultant load kN', 'Direction deg', 'Wind from deg', 'Moment kNm', 'Capacity kN', '% loaded hor', 'Vertical kN', '% loaded vert', 'B&C', 'Result']];
    tipPoles().forEach(function (id) { var r = tipCalc(id); if (!r) return; r.results.forEach(function (x) { rows.push([tipName(id), r.input.pole.type || '', x.name, f2(x.load), f2(x.dir, 0), x.wind ? f2(x.windFrom, 0) : 'N/A', f2(x.moment), f2(x.capacity, 1), f2(x.pctHor, 0), f2(x.vertical), f2(x.pctVert, 0), f2(x.bc), x.pass == null ? '' : x.pass ? 'PASS' : 'FAIL']); }); });
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    download(new Blob([csv], { type: 'text/csv' }), 'Tiploads - ' + (linked ? linked.name.replace(/\.pnwx$/i, '') : baseName()) + '.csv'); setStatus('Downloaded the tipload table.', 'good');
  }
  $('tipBody').addEventListener('click', function (e) {
    var tv = e.target.closest('[data-tipverify]'); if (tv) { (S.design.verified = S.design.verified || {})[tv.dataset.tipverify] = { at: new Date().toISOString(), by: S.settings.createdBy || 'designer' }; save(); recompute(); renderTip(); setStatus('Marked the photo-derived inputs for ' + tv.dataset.tipverify + ' as verified in the field.', 'good'); return; }
    var t = e.target, pick = t.closest('[data-tippick]'), go = t.closest('[data-tipgo]'), del = t.closest('[data-lcdel]'), use = t.closest('[data-tipuse]');
    if (pick) { tipSel = pick.dataset.tippick; renderTip(); var tp = $('tipBody').querySelector('.tip-pole'); if (tp) tp.scrollIntoView({ block: 'nearest' }); return; }
    if (go) { select(go.dataset.tipgo); zoomTo(go.dataset.tipgo); return; }
    if (del) { tipSet().cases.splice(+del.dataset.lcdel, 1); save(); renderTip(); return; }
    if (t.id === 'lcAdd') { tipSet().cases.push({ name: 'Load ' + (tipSet().cases.length + 1), ice: 'None', temp: 15, windPole: 0, windCond: 0, windPlant: 0, Ft: 1, Wn: 1, Gs: 1, Gc: 1, strengthClass: 'Ultimate limit', phi: 1, include: true }); save(); renderTip(); return; }
    if (t.id === 'lcRead') {
      var got = TIP.parseReportOptions($('lcPaste').value);
      if (!got.length) { setStatus('No load combinations found in the pasted text. Copy the Options page of a PNW tipload report.', 'bad'); return; }
      var st = tipSet(); st.cases = got; st.source = 'pasted from a PNW tipload report'; save(); renderTip(); setStatus('Read ' + got.length + ' load combination' + (got.length > 1 ? 's' : '') + ': ' + got.map(function (c) { return c.name; }).join(', ') + '.', 'good'); return;
    }
    if (t.id === 'tipCsv') { tipCsv(); return; }
    if (use) {
      var a = project.tiploads[use.dataset.tipuse].attrs, x = extras(use.dataset.tipuse);
      x.stays = [1, 2].filter(function (n) { return a['stay' + n + '_wire'] && Number(a['stay' + n + '_att_ht']) > 0; }).map(function (n) { return { wire: a['stay' + n + '_wire'], attHt: Number(a['stay' + n + '_att_ht']), dir: Number(a['stay' + n + '_dir']), angle: Number(a['stay' + n + '_angle']) || 45, include: a['stay' + n + '_checked'] === 'True', ref: 'From the tipload saved in PNW' }; });
      x.plant = [['plant1', 'plant_attht', 'plant_dir', 'plant_checked'], ['plant2', 'plant_attht2', 'plant_dir2', 'plant_checked2']].filter(function (k) { return a[k[0]] && a[k[0]].trim(); }).map(function (k) { return { code: a[k[0]].trim(), drawing: (txArr()[0] || {}).id, attHt: Number(a[k[1]]), dir: Number(a[k[2]]), include: a[k[3]] === 'True', ref: 'From the tipload saved in PNW' }; });
      S.design.log = liveLog().concat([logEntry(use.dataset.tipuse, 'Stays and plant', 'From PNW tipload', '', x.stays.length + ' stay(s), ' + x.plant.length + ' plant item(s)', 'manual', 'PNW tipload saved in ' + linked.name)]);
      recompute(); renderTip();
    }
  });
  $('tipBody').addEventListener('change', function (e) {
    var t = e.target, st = tipSet();
    if (t.dataset.lc) {
      var k = t.dataset.lc.split('|'), c = st.cases[+k[0]];
      if (k[1] === 'include') c.include = t.checked;
      else if (k[1] === 'name') { if (!t.value.trim()) { renderTip(); return; } c.name = t.value.trim(); }
      else { var v = Number(t.value); if (t.value === '' || !isFinite(v) || (k[1] !== 'temp' && v < 0)) { setStatus('"' + t.value + '" is not a valid ' + k[1] + '.', 'bad'); renderTip(); return; } c[k[1]] = v; }
      st.source = st.source && /edited/.test(st.source) ? st.source : (st.source ? st.source + ', edited' : 'edited'); save(); renderTip(); return;
    }
    if (t.dataset.pd) {
      var q = t.dataset.pd.split('|'), pd = st.plant || (st.plant = {}), row = pd[q[0]] || (pd[q[0]] = {}), x = t.value.trim() === '' ? null : Number(t.value);
      if (x != null && (!isFinite(x) || x < 0)) { setStatus('"' + t.value + '" is not a valid ' + q[1] + '.', 'bad'); renderTip(); return; }
      row[q[1]] = x; save(); renderTip(); return;
    }
    if (t.dataset.to) {
      var o = st.options, key = t.dataset.to;
      if (t.tagName === 'SELECT') o[key] = t.value;
      else { var n = Number(t.value); if (!isFinite(n) || (key === 'step' && !(n > 0 && n <= 90)) || (key !== 'stdTemp' && n < 0)) { setStatus('"' + t.value + '" is not valid here.', 'bad'); renderTip(); return; } o[key] = n; }
      save(); renderTip();
    }
  });
  $('tipBody').addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('tip-opts')) tipOptsOpen = e.target.open; }, true);
  $('closeTip').onclick = function () { $('tipDlg').hidden = true; };
  $('tipDlg').addEventListener('keydown', function (e) { if (e.key === 'Escape') $('tipDlg').hidden = true; });
  $('tbTip').onclick = function () { recompute(); openTip(S.selected); };
  /* ---------- conductor tool: string a strain section pole to pole in plan, 3D or profile ---------- */
  var lyCt = L.layerGroup().addTo(map), CT_SNAP = 14, CT_COL = { chain: '#16a34a', cand: '#f97316' };
  function ctToggle(on) {
    CT.on = on; CT.chain = []; CT.hover = null;
    if (on && !project) { CT.on = false; setStatus('Link a PNW project or start a design first: conductors attach to its constructions.', 'bad'); }
    if (CT.on) { secForm.pick = {}; secForm.tensionUser = false; openTab('sections'); var bb = bounds(); if (S.view === 'plan' && bb.isValid()) map.fitBounds(bb, { paddingTopLeft: [380, 30], paddingBottomRight: [30, 30], maxZoom: 19 }); }
    ctRender(); if (tab === 'sections') renderTable();
  }
  function ctAdd(id) {
    var ids = project ? project.poles.map(function (r) { return r.ID; }) : [], k = ids.indexOf(id), c = CT.chain;
    if (k < 0) { setStatus(id + ' is not in the linked PNW project, so a conductor cannot attach to it.', 'bad'); return; }
    if (c[c.length - 1] === id) return;
    if (c.length > 1 && (ids.indexOf(c[c.length - 1]) - ids.indexOf(c[0])) * (k - ids.indexOf(c[c.length - 1])) <= 0) { setStatus('A strain section follows line order: pick a pole beyond ' + c[c.length - 1] + ', or undo.', 'bad'); return; }
    c.push(id); secForm.from = c[0]; secForm.to = c[c.length - 1]; ctRender();
  }
  function ctMembers() { return CT.chain.length > 1 ? sectionMembers(secForm) : []; }
  // Attachment points of the construction each member uses (green), and of the hovered pole's candidate (orange).
  function ctPts() {
    var out = [], mem = ctMembers(), inChain = {};
    mem.forEach(function (m) { inChain[m.id] = 1; if (m.c) dm.points.forEach(function (q) { if (q.pole === m.id && q.code === m.c.code) out.push(Object.assign({ color: CT_COL.chain }, q)); }); });
    var hv = CT.hover && !inChain[CT.hover] ? CT.hover : CT.chain.length === 1 ? CT.chain[0] : null;
    if (hv) dm.points.forEach(function (q) { if (q.pole === hv && (!secForm.level || levelOf(q.code) === secForm.level)) out.push(Object.assign({ color: hv === CT.chain[0] ? CT_COL.chain : CT_COL.cand }, q)); });
    return out;
  }
  function ctProfile(chainOf, X, Y) {
    var g = '', last = {};
    ctPts().forEach(function (q) { var c0 = chainOf[q.pole]; if (c0 == null) return; g += '<circle cx="' + X(c0) + '" cy="' + Y(q.elevation) + '" r="4.5" fill="none" stroke="' + q.color + '" stroke-width="2.2" pointer-events="none"/>'; if (q.color === CT_COL.chain && (!last[q.pole] || q.elevation > last[q.pole].elevation)) last[q.pole] = q; });
    var ln = ctMembers().map(function (m) { return last[m.id]; }).filter(Boolean);
    if (ln.length > 1) g += '<path d="' + ln.map(function (q, i) { return (i ? 'L' : 'M') + X(chainOf[q.pole]).toFixed(1) + ' ' + Y(q.elevation).toFixed(1); }).join(' ') + '" fill="none" stroke="' + CT_COL.chain + '" stroke-width="2" stroke-dasharray="6 3" pointer-events="none"/>';
    return g;
  }
  function ctPlan(cursor) {
    lyCt.clearLayers(); if (!CT.on) return;
    var ll = function (id) { var p = merged.poles[id]; return p ? poleLatLng(p) : null; };
    var path = (ctMembers().length ? ctMembers().map(function (m) { return m.id; }) : CT.chain).map(ll).filter(Boolean);
    if (path.length > 1) L.polyline(path, { color: CT_COL.chain, weight: 5, opacity: .8, interactive: false }).addTo(lyCt);
    path.forEach(function (x) { L.circleMarker(x, { radius: 9, weight: 2, color: CT_COL.chain, fill: false, interactive: false }).addTo(lyCt); });
    var snap = CT.hover && ll(CT.hover), end = snap || cursor;
    if (path.length && end) L.polyline([path[path.length - 1], end], { color: snap ? CT_COL.chain : '#64748b', weight: 2, dashArray: '6 4', interactive: false }).addTo(lyCt);
    if (snap) L.circleMarker(snap, { radius: 13, weight: 3, color: CT_COL.cand, dashArray: '4 3', fill: false, interactive: false }).addTo(lyCt);
  }
  function ctDraw() {
    ctPlan();
    if (window.PNW3D && mounted3d) { window.PNW3D.hover(CT.on ? function (id) { if (CT.hover !== id) { CT.hover = id; ctDraw(); } } : null); window.PNW3D.marks(CT.on && dm ? ctPts() : []); }
    if (S.view === 'profile' || S.view === 'split') renderProfileView();
  }
  function ctRender() {
    var pn = $('ctPanel'); pn.hidden = !CT.on;
    $('tbCond').classList.toggle('on', CT.on); $('tbCond').setAttribute('aria-pressed', CT.on);
    $('mapWrap').classList.toggle('ct-on', CT.on);
    if (CT.on) pn.innerHTML = '<div class="ct-head"><b>Draw conductor</b><span class="ct-chain">' + (CT.chain.length ? CT.chain.map(esc).join(' → ') : 'Click the first pole') + '</span>' +
      '<button class="ibtn" id="ctUndo" title="Remove the last pole" aria-label="Undo last pole"' + (CT.chain.length ? '' : ' disabled') + '>↶</button><button class="ibtn" id="ctCancel" title="Stop drawing (Esc)" aria-label="Stop drawing">✕</button></div>' +
      '<div id="ctForm">' + secFormHtml() + '</div>';
    ctDraw();
  }
  $('tbCond').onclick = function () { ctToggle(!CT.on); };
  $('ctPanel').addEventListener('change', secChange);
  $('ctPanel').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ctCancel') ctToggle(false);
    else if (b.id === 'ctUndo') { CT.chain.pop(); if (CT.chain.length) { secForm.from = CT.chain[0]; secForm.to = CT.chain[CT.chain.length - 1]; } ctRender(); }
    else if (b.id === 'secAdd') { if (CT.chain.length < 2) { setStatus('Pick at least two poles.', 'bad'); return; } secAddNow(); }
    else if (b.dataset.chip) { condFilter = b.dataset.chip.split(':')[1]; refreshSecForm(); }
  });
  // Plan view: the nearest pole within CT_SNAP screen pixels is the snap target; nothing connects without a snap.
  map.on('mousemove', function (e) {
    if (!CT.on) return;
    var best = null, bd = CT_SNAP, ids = project ? project.poles.map(function (r) { return r.ID; }) : [];
    ids.forEach(function (id) { var x = markers[id]; if (!x) return; var d = map.latLngToContainerPoint(x.getLatLng()).distanceTo(e.containerPoint); if (d <= bd) { bd = d; best = id; } });
    CT.hover = best; ctPlan(e.latlng);
  });
  map.on('click', function () { if (CT.on && CT.hover) ctAdd(CT.hover); });
  window.__pnwMarker = function (id) { var x = markers[id]; return x ? map.latLngToContainerPoint(x.getLatLng()) : null; }; // screen position, for tests
  // One line per load case for the inspector's Pole tab.
  function tipSummaryHtml(id) {
    if (!project || !dm || !tipSet().cases.length || tipPoles().indexOf(id) < 0) return '';
    var r = tipCalc(id); if (!r || !r.results.length) return '';
    return '<div class="con tip-sum"><div class="con-title">Tipload' + (unverifiedFor(id) ? ' <span class="pill unv" title="Includes photo-derived changes that have not been verified in the field">provisional</span>' : '') + '</div>' + r.results.map(function (x, i) { return '<div><span class="sw" style="background:' + TIP_COL[i % TIP_COL.length] + '"></span>' + esc(x.name) + ': <b>' + f2(x.load) + ' kN</b> @ ' + f2(x.dir, 0) + '°' + (x.pctHor != null ? ' · ' + f2(x.pctHor, 0) + '%' : '') + ' ' + tipBadge(x) + '</div>'; }).join('') + '<div class="btnrow"><button class="btn small" data-tipopen="' + esc(id) + '">Open tipload</button></div></div>';
  }
  $('selected').addEventListener('click', function (e) { var b = e.target.closest('[data-tipopen]'); if (b) openTip(b.dataset.tipopen); });

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
  // Help: explanations are hidden by default and shown everywhere with the ? Help button.
  // The Info toggle in the title bar shows or hides all notes, hints and explanations (off by default); ? in the view bar does the same.
  function applyHelp() { document.body.classList.toggle('help-on', !!U.help); ['vHelp', 'infoBtn'].forEach(function (k) { if ($(k)) { $(k).classList.toggle('on', !!U.help); $(k).setAttribute('aria-pressed', !!U.help); } }); if ($('infoBtn')) $('infoBtn').title = U.help ? 'Hide the extra information (notes, hints, checks)' : 'Show the extra information (notes, hints, checks)'; }
  $('vHelp').onclick = $('infoBtn').onclick = function () { U.help = !U.help; saveUi(); applyHelp(); };
  function applyTheme() { var l = U.theme === 'light'; document.documentElement.dataset.theme = l ? 'light' : 'dark'; var b = $('themeBtn'); if (b) { b.innerHTML = l ? '☾ <span class="tbl">Dark</span>' : '☀ <span class="tbl">Light</span>'; b.title = l ? 'Switch to dark mode' : 'Switch to light mode'; } }
  $('themeBtn').onclick = function () { U.theme = U.theme === 'light' ? 'dark' : 'light'; saveUi(); applyTheme(); }; applyTheme();
  applyHelp();
  // Full window: one panel fills the browser window (not the screen); Esc or the same button restores it.
  var fullEl = null;
  function setFull(id) {
    if (fullEl) { fullEl.classList.remove('fullwin'); }
    fullEl = id && (!fullEl || fullEl.id !== id) ? $(id) : null;
    if (fullEl) fullEl.classList.add('fullwin');
    Array.prototype.forEach.call(document.querySelectorAll('[data-full]'), function (b) { var on = !!fullEl && b.dataset.full === fullEl.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    setTimeout(function () { map.invalidateSize(); if (window.PNW3D && mounted3d) window.PNW3D.resize(); if (S.view === 'profile' || S.view === 'split') renderProfileView(); }, 30);
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-full]'); if (b) setFull(b.dataset.full); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && fullEl && !e.defaultPrevented && document.getElementById('tipDlg').hidden && document.getElementById('review').hidden) { setFull(null); return; }
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (CT.on) { ctToggle(false); return; }
    if (!$('layersPop').hidden) { $('layersPop').hidden = true; return; }
    if (!$('review').hidden || !$('tipDlg').hidden || !$('genDlg').hidden || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (S.selected || S.selSection) select(null);
  });
  // New project asks in a dialog: browser confirm() dialogs are blocked when the page runs inside Claude.
  $('tbReset').onclick = function () {
    if (!S.files.length && !prof().poleIds.length && !S.design.xml) { setStatus('Nothing to clear: this is already a new project.'); return; }
    openGen('Start a new project?', '<p>This removes the imported files, profiles, design and change log from this browser. <b>Save the project first</b> (Files → Save project) if you want to keep them.</p><div class="btnrow"><button class="btn danger" id="resetOk">Clear everything</button><button class="btn" id="resetNo">Cancel</button></div>', { narrow: true });
    $('resetNo').onclick = function () { closeGen(); };
    $('resetOk').onclick = function () {
      closeGen();
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      S = blank(); buffers = {}; flags = {}; aiResults = {}; secForm = { tension: '', units: '%CBL' }; conDraft = { pole: null, code: '', kb: '', kbUser: false }; S.selSection = null; undoStack = []; redoStack = []; lastSnap = null; pv.x0 = pv.x1 = null;
      syncInputs(); recompute(); setView('plan', true); setStatus('New project. Saved data removed from this browser.', 'good');
    };
  };
  [['lySurvey', lySurvey], ['lyGis', lyGis], ['lyAlign', lyAlign], ['lySpanLbl', lySpan], ['lyExtent', lyExtent]].forEach(function (x) {
    $(x[0]).onchange = function () { if (this.checked) x[1].addTo(map); else map.removeLayer(x[1]); };
  });
  for (var z = 49; z <= 56; z++) $('zone').insertAdjacentHTML('beforeend', '<option value="' + z + '">Zone ' + z + (z === 50 ? ' (Perth)' : '') + '</option>');
  $('zone').onchange = function () { S.zone = +this.value; recompute(); fit(); };
  [['createdBy', 'createdBy'], ['optionSet', 'optionSet'], ['clr1', 'clr1'], ['clr2', 'clr2']].forEach(function (x) { $(x[0]).onchange = function () { S.settings[x[1]] = this.value.trim(); save(); }; });

  /* ---------- workspace: menus, dialogs, contextual bar, profile navigation, manual poles and spans ---------- */
  var genRestore = [];
  function openGen(title, content, opts) {
    opts = opts || {}; closeGen();
    $('genTitle').textContent = title;
    var body = $('genBody'); body.innerHTML = '';
    if (typeof content === 'string') body.innerHTML = content; else if (content && content.nodeType) body.appendChild(content);
    $('genDlg').querySelector('.dlg-card').className = 'dlg-card gen' + (opts.narrow ? ' narrow' : '') + (opts.side ? ' side' : '');
    $('genDlg').hidden = false;
    if (opts.onClose) genRestore.push(opts.onClose);
    setTimeout(function () { var f = body.querySelector('[autofocus],input:not([type=hidden]):not([type=file]),select,button'); if (f && !opts.noFocus) f.focus(); }, 30);
  }
  function closeGen() { var r = genRestore; genRestore = []; r.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); $('genDlg').hidden = true; $('genBody').innerHTML = ''; var z = document.querySelector('.adzoom'); if (z) z.hidden = true; }
  (function () { var pv = document.createElement('div'); pv.className = 'adzoom'; pv.hidden = true; pv.innerHTML = '<img alt="">'; document.body.appendChild(pv);
    $('genBody').addEventListener('mouseover', function (e) { var im = e.target.closest && e.target.closest('img.adthumb'); if (!im) return; pv.firstChild.src = im.dataset.big || im.src; var r = im.getBoundingClientRect(), w = Math.min(720, innerWidth - 24), h = w * 0.75; pv.style.width = w + 'px'; pv.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left - w / 2)) + 'px'; pv.style.top = (r.top > innerHeight / 2 ? Math.max(12, r.top - h - 10) : Math.min(innerHeight - h - 12, r.bottom + 10)) + 'px'; pv.hidden = false; });
    $('genBody').addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('img.adthumb')) pv.hidden = true; }); })();
  $('genClose').onclick = closeGen;
  $('genDlg').addEventListener('mousedown', function (e) { if (e.target === $('genDlg')) closeGen(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('genDlg').hidden) { e.preventDefault(); closeGen(); } });

  // Files → Imported files: the drop zone and the file list live here, not in the side panel.
  function openFilesDlg() {
    var holder = $('filesHolder'), body = document.createElement('div'); body.className = 'filelist';
    body.appendChild($('drop')); body.appendChild($('files'));
    var bar = document.createElement('div'); bar.className = 'btnrow'; bar.innerHTML = '<button class="btn primary" id="fdImport">Import files…</button><button class="btn" id="fdPhotos">Import pole photos…</button>';
    body.insertBefore(bar, body.firstChild);
    openGen('Imported files and data mapping', body, { onClose: function () { holder.appendChild($('drop')); holder.appendChild($('files')); } });
    $('fdImport').onclick = function () { replaceIdx = null; $('fileInput').click(); };
    $('fdPhotos').onclick = function () { closeGen(); openPhotoDlg(); };
    renderFiles();
  }
  $('mImported').onclick = openFilesDlg;
  $('mExpTip').onclick = function () { openTip(S.selected && tipPoles().indexOf(S.selected) >= 0 ? S.selected : null); };
  $('mExpLog').onclick = function () { if (!liveLog().length) { setStatus('No design changes recorded yet.', 'bad'); return; } exportLog(); };

  // Menus
  function closeMenus(keep) { Array.prototype.forEach.call(document.querySelectorAll('.menu'), function (m) { if (m === keep) return; m.querySelector('.mpop').hidden = true; m.querySelector('.mbtn').setAttribute('aria-expanded', 'false'); }); }
  Array.prototype.forEach.call(document.querySelectorAll('.menu'), function (m) {
    var b = m.querySelector('.mbtn'), pop = m.querySelector('.mpop');
    b.onclick = function (e) { if (e) e.stopPropagation(); var open = pop.hidden; closeMenus(m); pop.hidden = !open; b.setAttribute('aria-expanded', String(open)); };
    b.onmouseenter = function () { var any = Array.prototype.some.call(document.querySelectorAll('.mpop'), function (x) { return !x.hidden; }); if (any && pop.hidden) b.onclick(); };
    pop.addEventListener('click', function (e) { if (e.target.closest('.mi')) closeMenus(); });
    m.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(pop.querySelectorAll('.mi:not(:disabled)')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && !pop.hidden) { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp' && !pop.hidden) { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if ((e.key === 'ArrowDown' || e.key === 'Enter') && pop.hidden && document.activeElement === b) { e.preventDefault(); b.onclick(); if (items[0]) items[0].focus(); }
      else if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); e.stopPropagation(); closeMenus(); b.focus(); }
    }, true);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeMenus(); });
  $('dispBtn').onclick = function (e) { e.stopPropagation(); var p = $('dispPop'); p.hidden = !p.hidden; this.setAttribute('aria-expanded', String(!p.hidden));
    // The view header scrolls sideways (overflow), which clipped this popup: place it in the window, under the button.
    if (!p.hidden) { var b = this.getBoundingClientRect(); p.style.top = (b.bottom + 4) + 'px'; p.style.left = Math.max(8, Math.min(b.right - p.offsetWidth, innerWidth - p.offsetWidth - 8)) + 'px'; } };
  document.addEventListener('click', function (e) { var p = $('dispPop'); if (!p.hidden && !e.target.closest('.dispwrap')) { p.hidden = true; $('dispBtn').setAttribute('aria-expanded', 'false'); } });
  function refreshMenus() { var has = !!(S.selected && poleXY(S.selected)); $('mNewX').disabled = !has; $('mStreet').disabled = !has; }

  // Geometry of any pole the app knows about: the design line, the profile, the survey, or an intersecting line.
  function poleXY(id) {
    var q = dm && dm.allPoles.filter(function (p) { return p.id === id; })[0];
    if (q && isFinite(q.easting)) return { e: q.easting, n: q.northing, ground: q.ground, chainage: q.chainage };
    var r = built && built.rows.filter(function (x) { return x.id === id; })[0];
    if (r && isFinite(r.easting)) return { e: r.easting, n: r.northing, ground: r.elevation, chainage: r.chainage };
    var p = merged.poles[id]; if (p && p.survey && isFinite(p.survey.easting)) return { e: p.survey.easting, n: p.survey.northing, ground: p.survey.elevation, chainage: null };
    var x = xPole(id); if (x && isFinite(x.pole.easting)) return { e: x.pole.easting, n: x.pole.northing, ground: x.pole.ground, chainage: x.pole.chainage };
    return null;
  }
  function addToProfile(id) { var ids = prof().poleIds; if (ids.indexOf(id) >= 0) return; ids.push(id); prof().poleIds = PNW.autoOrder(merged.poles, ids); S.generated = false; recompute(); setStatus(id + ' added and the profile re-ordered along the line. Use ↑ ↓ to adjust.', 'good'); }
  function removeFromProfile(id) { prof().poleIds = prof().poleIds.filter(function (x) { return x !== id; }); S.generated = false; recompute(); }

  // Select a pole on the plan, then open (or create) the profile that contains it.
  function openProfileFor(id) {
    var inDesign = !!(dm && dm.allPoles.some(function (p) { return p.id === id; }));
    var xp = !inDesign && xPole(id);
    if (xp) { linkDesign(xp.line.name); setStatus('Editing ' + xp.line.title + ' (the intersecting line through ' + id + ').', 'good'); }
    else if (!inDesign) {
      var idx = S.active; if (prof().poleIds.indexOf(id) < 0) { idx = -1; S.profiles.forEach(function (p, i) { if (idx < 0 && p.poleIds.indexOf(id) >= 0) idx = i; }); }
      if (idx < 0) {
        if (!merged.poles[id]) return;
        var np = newProfile(id + ' profile'); np.poleIds = [id]; S.profiles.push(np); idx = S.profiles.length - 1;
        setStatus('Started profile "' + np.name + '" with ' + id + '. Select the next poles and choose Add to profile.', 'good');
      } else if (idx !== S.active) setStatus('Opened profile "' + (S.profiles[idx].name || 'Profile ' + (idx + 1)) + '".', 'good');
      if (idx !== S.active) { S.active = idx; S.generated = false; recompute(); }
    }
    S.selected = id; pvFocus(id); setView('profile'); select(id);
  }
  function selectSpan(a, b) {
    S.selSpan = { a: a, b: b }; S.selected = null; S.multi = []; S.selSection = null; flags.inspected = true;
    if (!U.right) { U.right = true; applyLayout(); }
    renderSelected(); highlight(); renderProfile(); renderSteps();
    if (window.PNW3D && mounted3d) { window.PNW3D.select(null); }
    if (S.view === 'profile' || S.view === 'split') renderProfileView();
    renderExtras(true);
    var la = poleLL(a), lb = poleLL(b); if (la && lb) panPlanTo(L.latLng((la.lat + lb.lat) / 2, (la.lng + lb.lng) / 2));
  }
  function spanPane() {
    var s = S.selSpan, A = poleXY(s.a), B = poleXY(s.b); if (!A || !B) return '<div class="inspane"><p class="hint">This span has no coordinates.</p></div>';
    var len = Math.hypot(B.e - A.e, B.n - A.n), brg = PNW.bearing({ easting: A.e, northing: A.n }, { easting: B.e, northing: B.n }), dz = (B.ground != null && A.ground != null) ? B.ground - A.ground : null;
    var h = '<div class="inspane"><div class="ins-title"><b>' + esc(s.a) + ' → ' + esc(s.b) + '</b><span class="pill info">Span</span></div><div class="facts">' + fact('Length (m)', fmt(len, 2)) + fact('Min ground clearance (m)', spanClearance(s.a, s.b) != null ? fmt(spanClearance(s.a, s.b), 2) : '', '', 'Lowest conductor point above the ground profile, at the current sag') + fact('Bearing (°)', fmt(brg, 1)) + fact('Ground rise (m)', dz == null ? '' : fmt(dz, 2)) + fact('Slope (%)', dz == null || !len ? '' : fmt(dz / len * 100, 1)) + fact('Chainage from', A.chainage == null ? '' : fmt(A.chainage, 2)) + fact('Chainage to', B.chainage == null ? '' : fmt(B.chainage, 2)) + '</div>';
    var ws = dm ? dm.wires.filter(function (w) { return (w.from.pole === s.a && w.to.pole === s.b) || (w.from.pole === s.b && w.to.pole === s.a); }) : [];
    if (ws.length) {
      var by = {}; ws.forEach(function (w) { (by[w.segment] = by[w.segment] || []).push(w); });
      var rsOf = {}; dm.wires.forEach(function (w) { if (w.phase === 1) (rsOf[w.segment] = rsOf[w.segment] || []).push(w.span); });
      h += '<table class="att"><tr><th>Section</th><th>Conductor</th><th class="num">Wires</th><th class="num">Sag (m)</th><th class="num">Ruling span (m)</th></tr>' + Object.keys(by).map(function (k) {
        var w0 = by[k][0], seg = project.segments.filter(function (x) { return x.StrainSect === k; })[0], rs = M.rulingSpan(rsOf[k] || []);
        return '<tr title="' + esc(w0.sagSource || '') + '"><td>' + esc(k) + (seg ? '<br><small class="muted">' + esc(seg.Tension + ' ' + (seg.TensionUnits || '')) + '</small>' : '') + '</td><td>' + esc(w0.conductor) + '</td><td class="num">' + by[k].length + '</td><td class="num">' + (w0.sag != null ? fmt(w0.sag, 2) : '–') + '</td><td class="num">' + (rs ? fmt(rs, 1) : '–') + '</td></tr>';
      }).join('') + '</table><p class="hint">Sag comes from the DCSH Part 10 table for the section where one fits, otherwise w·L²/8T at the stringing tension (hover a row for its source). Tension and tipload are calculated per pole in Tipload.</p>';
    } else h += '<p class="hint">' + (project ? 'No conductors are strung on this span yet. Use the Conductor schedule tab to string a section across it.' : 'Start a design from the ground profile to add conductors to this span.') + '</p>';
    h += '<div class="btnrow"><button class="btn small" data-ctx="spanprofile">Show in profile</button>' + (project ? '<button class="btn small" data-ctx="spansections">Conductor schedule</button>' : '') + '<button class="btn small" data-ctx="clear">Clear</button></div></div>';
    return h;
  }

  // Contextual bar: acts on the selected pole or span, so the actions follow the selection.
  function renderCtx() {
    var bar = $('ctxBar'), id = S.selected, h = ''; refreshMenus();
    if (S.multi && S.multi.length > 1) {
      h = '<span class="who">' + S.multi.length + ' poles selected<small>bulk edit in the panel</small></span><button class="btn small" data-wb="madd">Add to profile</button><button class="btn small" data-wb="mrem">Remove from profile</button><button class="btn small" data-wb="mzoom">⌖ Zoom to</button><span class="sp"></span><button class="ibtn" data-ctx="clear" title="Clear the selection (Esc)" aria-label="Clear the selection">✕</button>';
    } else if (id && poleXY(id)) {
      var p = merged.poles[id], ids = lineIds(), i = ids.indexOf(id), k = prof().poleIds.indexOf(id), inDm = !!(dm && dm.allPoles.some(function (q) { return q.id === id; })), xp = !inDm && xPole(id);
      var has = inDm || k >= 0 || xp || S.profiles.some(function (q) { return q.poleIds.indexOf(id) >= 0; });
      h = '<span class="who">Pole ' + esc(id) + '<small>' + (inDm && k >= 0 ? 'profile #' + (k + 1) + ' of ' + prof().poleIds.length : inDm ? 'on the design line' : k >= 0 ? 'profile #' + (k + 1) + ' of ' + prof().poleIds.length : xp ? 'intersecting line' : 'not in a profile') + '</small></span>' +
        '<span class="seg nav"><button data-ctx="prev" title="Previous pole along the line ( [ )"' + (i > 0 ? '' : ' disabled') + '>◀</button><button data-ctx="next" title="Next pole along the line ( ] )"' + (i >= 0 && i < ids.length - 1 ? '' : ' disabled') + '>▶</button></span>' +
        (p && p.survey && k < 0 && !xp ? '<button class="btn small primary" data-ctx="add" title="Add this pole to the active profile">Add to profile</button>' : '') +
        (k >= 0 && !inDm ? '<button class="btn small" data-ctx="remove" title="Take this pole out of the active profile">Remove</button>' : '') +
        '<button class="btn small" data-wb="edit" title="Edit this pole: length, construction, conductors, equipment">✎ Edit</button><button class="btn small" data-ctx="profile" title="' + (has ? 'Show the longitudinal profile through this pole' : 'Start a new profile at this pole') + '">' + (has ? '📈 Open profile' : '＋ Create profile') + '</button>' +
        '<button class="btn small" data-ctx="street" title="Street View of this pole, inside the app, with capture to AI">🛣 Street View</button>' +
        '<button class="btn small" data-ctx="photo" title="Analyse a photo of this pole with AI">✨ AI photo</button>' +
        (tipPoles().indexOf(id) >= 0 ? '<button class="btn small" data-ctx="tip" title="Tipload for this pole">⇲ Tipload</button>' : '') +
        '<button class="btn small" data-ctx="focus" title="Zoom the current view to this pole (Z)">⌖ Zoom to</button><span class="sp"></span><button class="ibtn" data-ctx="clear" title="Clear the selection (Esc)" aria-label="Clear the selection">✕</button>';
    } else if (S.selSpan) {
      h = '<span class="who">Span ' + esc(S.selSpan.a) + ' → ' + esc(S.selSpan.b) + '</span><button class="btn small" data-wb="spanedit">✎ Edit span</button><button class="btn small" data-wb="spancond">＋ Add conductor</button><button class="btn small" data-wb="spansag">⌒ Sag calculation</button><button class="btn small" data-ctx="spanprofile">📈 Show in profile</button><button class="btn small" data-ctx="spana">Select ' + esc(S.selSpan.a) + '</button><button class="btn small" data-ctx="spanb">Select ' + esc(S.selSpan.b) + '</button><span class="sp"></span><button class="ibtn" data-ctx="clear" aria-label="Clear the selection">✕</button>';
    }
    var was = bar.hidden; bar.innerHTML = h; bar.hidden = !h;
    if (was !== bar.hidden) requestAnimationFrame(function () { if (map && map.invalidateSize) map.invalidateSize(); if (S.view === 'profile' || S.view === 'split') renderProfileView(); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ctx]'); if (!b || b.disabled) return;
    var act = b.dataset.ctx, id = S.selected, ids = lineIds(), i = ids.indexOf(id);
    if (act === 'prev' && ids[i - 1]) { select(ids[i - 1]); showPole(ids[i - 1]); }
    else if (act === 'next' && ids[i + 1]) { select(ids[i + 1]); showPole(ids[i + 1]); }
    else if (act === 'add') addToProfile(id);
    else if (act === 'remove') removeFromProfile(id);
    else if (act === 'profile') openProfileFor(id);
    else if (act === 'street') openStreetView(id);
    else if (act === 'photo') { U.insTab = 'photo'; if (!U.right) { U.right = true; applyLayout(); } saveUi(); select(id); }
    else if (act === 'tip') openTip(id);
    else if (act === 'focus') { if (S.view === 'profile') { pvFocus(id); renderProfileView(); } else showPole(id); }
    else if (act === 'clear') select(null);
    else if (act === 'spanprofile') { var s = S.selSpan; if (s) { var ca = chainOfPole(s.a), cb = chainOfPole(s.b); if (ca != null && cb != null) pvSet(Math.min(ca, cb) - 5, Math.max(ca, cb) + 5); } setView('profile'); }
    else if (act === 'spansections') openTab('sections');
    else if (act === 'spana') select(S.selSpan.a); else if (act === 'spanb') select(S.selSpan.b);
    else if (act === 'editpole') openPoleDlg(id);
    else if (act === 'photos') openPhotoDlg();
  });
  // [ and ] step along the line, Z zooms to the selection (when no field has focus)
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('genDlg').hidden) return;
    var ids = lineIds(), i = ids.indexOf(S.selected);
    if (e.key === ']' && ids[i + 1]) { select(ids[i + 1]); showPole(ids[i + 1]); } else if (e.key === '[' && i > 0) { select(ids[i - 1]); showPole(ids[i - 1]); }
    else if ((e.key === 'z' || e.key === 'Z') && S.selected && document.activeElement !== $('profileView')) showPole(S.selected);
  });
  // profile view buttons
  (function () {
    var t = document.createElement('div'); t.className = 'pv-tools'; t.id = 'pvTools';
    t.innerHTML = '<button class="btn small" data-pv="fit" title="Fit the whole line (0 or double-click)">⤢ Fit</button><button class="btn small" data-pv="sel" title="Zoom to the selected pole (Z)" aria-label="Zoom to the selected pole">⌖</button>';
    document.querySelector('.viewhead').insertBefore(t, document.querySelector('.dispwrap'));
    t.addEventListener('click', function (e) { var b = e.target.closest('[data-pv]'); if (!b) return; var k = b.dataset.pv; if (k === 'in') pvZoom(0.7); else if (k === 'out') pvZoom(1 / 0.7); else if (k === 'fit') pvFit(); else if (S.selected) { pvFocus(S.selected); renderProfileView(); } else setStatus('Select a pole first.'); });
  })();
  if (window.ResizeObserver) new ResizeObserver(function () { if (map && map.invalidateSize) map.invalidateSize(); }).observe($('map'));

  /* ---- manual design: poles and spans from scratch ---- */
  var pickMode = null, npDraft = null;
  function fromLatLng(ll) {
    var def = '+proj=utm +zone=' + S.zone + ' +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
    try { var xy = proj4('EPSG:4326', def, [ll.lng, ll.lat]); return isFinite(xy[0]) && isFinite(xy[1]) ? { e: xy[0], n: xy[1] } : null; } catch (x) { return null; }
  }
  function manualFile() {
    var f = S.files.filter(function (x) { return x.manual; })[0];
    if (!f) { f = { name: 'Manual poles', manual: true, role: 'survey', status: 'ok', items: [], sheets: [], issues: [], size: 0, summary: '', confidence: 'manual' }; S.files.push(f); }
    return f;
  }
  function numIn(id) { var v = $(id).value.trim(); return v === '' ? NaN : Number(v); }
  function validMga(e, n) { return e > 100000 && e < 900000 && n > 1000000 && n < 10000000; }
  function openPoleDlg(editId, draft) {
    var mf = S.files.filter(function (x) { return x.manual; })[0], cur = editId && mf ? mf.items.filter(function (x) { return x.id === editId; })[0] : null;
    if (editId && !cur) { setStatus(editId + ' was not created by hand, so it cannot be edited here. Edit the source file instead.', 'bad'); return; }
    var sel = S.selected && poleXY(S.selected) ? S.selected : null, d = draft || npDraft || {}, mode = d.mode || (cur ? 'coord' : sel ? 'span' : 'coord');
    var inProf = prof().poleIds.length || !cur;
    var selOpts = Object.keys(merged.poles).filter(function (k) { return poleXY(k); }).map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
    var h = '<p class="hint">Create a pole by hand: the plan, profile, spans and tipload all use it like a surveyed pole. Ground level and position are your inputs; they are marked <b>Manual</b>, not LiDAR.</p>' +
      '<div class="grid2"><div class="field"><label for="npId">Pole ID</label><input id="npId" value="' + esc(cur ? cur.id : d.id || '') + '"' + (cur ? ' readonly' : '') + ' placeholder="e.g. NEW1"></div>' +
      '<div class="field"><label for="npLen">Pole length (m)</label><input id="npLen" inputmode="decimal" value="' + esc(d.len != null ? d.len : cur && prof().lengths[cur.id] != null ? prof().lengths[cur.id] : '') + '" placeholder="e.g. 12.5"></div></div>' +
      (cur ? '' : '<div class="seg" id="npMode" role="group" aria-label="How to place the pole"><button data-m="coord" class="' + (mode === 'coord' ? 'on' : '') + '">Coordinates</button><button data-m="span" class="' + (mode === 'span' ? 'on' : '') + '">From another pole</button><button data-m="click" class="' + (mode === 'click' ? 'on' : '') + '">Click on the plan</button></div>') +
      '<div id="npCoord" class="grid2"' + (mode === 'span' ? ' hidden' : '') + '><div class="field"><label for="npE">Easting (m, MGA)</label><input id="npE" inputmode="decimal" value="' + esc(d.e != null ? d.e : cur ? cur.easting : '') + '"></div><div class="field"><label for="npN">Northing (m, MGA)</label><input id="npN" inputmode="decimal" value="' + esc(d.n != null ? d.n : cur ? cur.northing : '') + '"></div></div>' +
      '<div id="npSpan" class="grid2"' + (mode === 'span' ? '' : ' hidden') + '><div class="field"><label for="npFrom">From pole (type to search)</label><input id="npFrom" list="npFromList" value="' + esc(d.from || sel || '') + '"><datalist id="npFromList">' + selOpts + '</datalist></div><div class="field"><label for="npSpanLen">Span length (m)</label><input id="npSpanLen" inputmode="decimal" value="' + esc(d.span != null ? d.span : '') + '"></div><div class="field"><label for="npBrg">Bearing from the pole (° from grid north)</label><input id="npBrg" inputmode="decimal" value="' + esc(d.brg != null ? d.brg : '') + '"></div></div>' +
      '<div class="grid2"><div class="field"><label for="npZ">Ground level (m)</label><input id="npZ" inputmode="decimal" value="' + esc(d.z != null ? d.z : cur ? cur.elevation : '') + '" placeholder="same as the from-pole if blank"></div></div>' +
      (cur ? '' : '<label class="inline"><input type="checkbox" id="npAdd"' + (d.add === false ? '' : ' checked') + '> Add to profile “' + esc(prof().name || 'Profile ' + (S.active + 1)) + '”' + '</label>') +
      '<p class="hint warn" id="npMsg" hidden></p><div class="btnrow"><button class="btn primary" id="npOk">' + (cur ? 'Save changes' : 'Create pole') + '</button>' + (cur ? '<button class="btn danger" id="npDel">Delete pole</button>' : '') + '<button class="btn" id="npCancel">Cancel</button></div>';
    openGen(cur ? 'Edit pole ' + cur.id : 'New pole', h, { narrow: true });
    var msg = function (t) { $('npMsg').textContent = t; $('npMsg').hidden = !t; };
    var curMode = mode;
    Array.prototype.forEach.call(document.querySelectorAll('#npMode button'), function (b) {
      b.onclick = function () {
        var m = b.dataset.m;
        if (m === 'click') { // closes the dialog; the next click on the plan fills the coordinates
          npDraft = { id: $('npId').value.trim(), len: $('npLen').value.trim(), z: $('npZ').value.trim(), add: $('npAdd').checked, mode: 'coord' };
          closeGen(); setView('plan'); pickMode = function (ll) { var xy = fromLatLng(ll); if (!xy) { setStatus('That point could not be converted to MGA.', 'bad'); return; } npDraft.e = Math.round(xy.e * 100) / 100; npDraft.n = Math.round(xy.n * 100) / 100; openPoleDlg(null, npDraft); };
          document.body.classList.add('pickmode'); setStatus('Click the plan where the new pole goes (Esc to cancel).'); return;
        }
        curMode = m; Array.prototype.forEach.call(document.querySelectorAll('#npMode button'), function (x) { x.classList.toggle('on', x === b); });
        $('npCoord').hidden = m === 'span'; $('npSpan').hidden = m !== 'span';
      };
    });
    $('npCancel').onclick = closeGen;
    if (cur) $('npDel').onclick = function () {
      mf.items = mf.items.filter(function (x) { return x.id !== cur.id; }); mf.summary = mf.items.length + ' poles';
      if (!mf.items.length) S.files = S.files.filter(function (x) { return x !== mf; });
      S.profiles.forEach(function (p) { p.poleIds = p.poleIds.filter(function (x) { return x !== cur.id; }); delete p.lengths[cur.id]; });
      S.generated = false; if (S.selected === cur.id) S.selected = null; closeGen(); recompute(); setStatus('Deleted pole ' + cur.id + '.', 'good');
    };
    $('npOk').onclick = function () {
      var id = $('npId').value.trim().toUpperCase(), z = numIn('npZ'), len = numIn('npLen'), E, N, fromId = null;
      if (!id) return msg('Enter a pole ID.');
      if (!cur && (merged.poles[id] || (dm && dm.allPoles.some(function (q) { return q.id === id; })))) return msg('Pole ' + id + ' already exists. Use a different ID.');
      if (curMode === 'span' && !cur) {
        fromId = $('npFrom').value.trim().toUpperCase(); var A = poleXY(fromId), L = numIn('npSpanLen'), br = numIn('npBrg');
        if (!A) return msg('Choose a from-pole that has coordinates.');
        if (!(L > 0)) return msg('Enter the span length in metres.'); if (!isFinite(br)) return msg('Enter the bearing in degrees from grid north.');
        E = A.e + L * Math.sin(br * Math.PI / 180); N = A.n + L * Math.cos(br * Math.PI / 180); if (!isFinite(z) && A.ground != null) z = A.ground;
      } else { E = numIn('npE'); N = numIn('npN'); }
      if (!isFinite(E) || !isFinite(N)) return msg('Enter the easting and northing.');
      if (!validMga(E, N)) return msg(E + ', ' + N + ' is not a valid MGA easting/northing.');
      if (!isFinite(z)) return msg('Enter the ground level (m).');
      if ($('npLen').value.trim() !== '' && !(len > 0 && len < 40)) return msg('Pole length must be between 0 and 40 m.');
      E = Math.round(E * 1000) / 1000; N = Math.round(N * 1000) / 1000;
      var f = manualFile();
      if (cur) { cur.easting = E; cur.northing = N; cur.elevation = z; }
      else f.items.push({ id: id, equipNo: '', group: '', dataType: '', easting: E, northing: N, elevation: z, lidarHeight: null, leanDeg: null, bays: null, bayAngles: [], surveyed: '', kind: 'Manual', src: { file: 'Manual poles', row: 'pole ' + (f.items.length + 1) } });
      f.summary = f.items.length + ' pole' + (f.items.length > 1 ? 's' : '');
      if (isFinite(len)) prof().lengths[id] = len; else if (cur && $('npLen').value.trim() === '') delete prof().lengths[id];
      if (!cur && $('npAdd') && $('npAdd').checked) {
        var ids = prof().poleIds, at = fromId ? ids.indexOf(fromId) : -1;
        if (at >= 0) ids.splice(at + 1, 0, id); else ids.push(id);
      }
      npDraft = null; S.generated = false; closeGen(); recompute(); select(id); showPole(id);
      setStatus((cur ? 'Updated ' : 'Created ') + id + (cur ? '.' : ' at ' + E + ', ' + N + '. Ground level ' + z + ' m is your input (Manual).'), 'good');
    };
  }
  $('mNewPole').onclick = function () { openPoleDlg(null); };

  // Intersection span: a two-pole line that shares a pole with the design. It is kept as its own PNW profile file, so it is
  // drawn with the design in plan and 3D, its shared pole carries both lines' constructions, and it can be edited as the design.
  function openXDlg() {
    var A = S.selected; if (!A || !poleXY(A)) { setStatus('Select the pole on the line that the intersecting span connects to.', 'bad'); return; }
    if (!(dm && dm.allPoles.some(function (q) { return q.id === A; }))) { setStatus('Pole ' + A + ' is not on the design line. Add it to the profile and start a design (Inspector → Constructions) first.', 'bad'); return; }
    var qa = dm.allPoles.filter(function (q) { return q.id === A; })[0], la = qa.length != null ? qa.length : '';
    var others = Object.keys(merged.poles).filter(function (k) { return k !== A && poleXY(k); });
    var h = '<p class="hint">An intersecting span runs from <b>' + esc(A) + '</b> to another pole (new or existing). It is saved as its own two-pole PNW profile that shares ' + esc(A) + ', so both lines show on the plan and in 3D, and ' + esc(A) + ' carries the constructions of both.</p>' +
      '<div class="grid2"><div class="field"><label for="xName">Line name</label><input id="xName" value="' + esc(A) + ' intersection"></div><div class="field"><label for="xLenA">Length of ' + esc(A) + ' (m)</label><input id="xLenA" inputmode="decimal" value="' + esc(la) + '"></div></div>' +
      '<div class="seg" id="xMode" role="group" aria-label="Far end"><button data-m="new" class="on">New pole</button><button data-m="old">Existing pole</button></div>' +
      '<div id="xNew" class="grid2"><div class="field"><label for="xId">New pole ID</label><input id="xId" placeholder="e.g. X1"></div><div class="field"><label for="xLenB">Pole length (m)</label><input id="xLenB" inputmode="decimal"></div><div class="field"><label for="xSpan">Span length (m)</label><input id="xSpan" inputmode="decimal"></div><div class="field"><label for="xBrg">Bearing from ' + esc(A) + ' (°)</label><input id="xBrg" inputmode="decimal"></div><div class="field"><label for="xZ">Ground level (m)</label><input id="xZ" inputmode="decimal" value="' + esc(qa.ground != null ? Math.round(qa.ground * 100) / 100 : '') + '"></div></div>' +
      '<div id="xOld" class="grid2" hidden><div class="field"><label for="xPick">Far pole</label><input id="xPick" list="xPoles" placeholder="type to search"><datalist id="xPoles">' + others.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist></div><div class="field"><label for="xLenO">Far pole length (m)</label><input id="xLenO" inputmode="decimal"></div></div>' +
      '<p class="hint warn" id="xMsg" hidden></p><div class="btnrow"><button class="btn primary" id="xOk">Create intersection span</button><button class="btn" id="xCancel">Cancel</button></div>';
    openGen('New intersection span from ' + A, h, { narrow: true });
    var mode = 'new', msg = function (t) { $('xMsg').textContent = t; $('xMsg').hidden = !t; };
    Array.prototype.forEach.call(document.querySelectorAll('#xMode button'), function (b) { b.onclick = function () { mode = b.dataset.m; Array.prototype.forEach.call(document.querySelectorAll('#xMode button'), function (x) { x.classList.toggle('on', x === b); }); $('xNew').hidden = mode !== 'new'; $('xOld').hidden = mode === 'new'; }; });
    $('xPick').oninput = function () { var k = this.value.trim().toUpperCase(), q = merged.poles[k]; if (q) { var ex = PNW.existingLength(q).value; if (ex != null && !$('xLenO').value) $('xLenO').value = ex; } };
    $('xCancel').onclick = closeGen;
    $('xOk').onclick = function () {
      var name = $('xName').value.trim(), lenA = numIn('xLenA'), B, lenB, created = null;
      if (!name) return msg('Name the line.'); if (!(lenA > 0)) return msg('Enter the length of ' + A + ' (m).');
      if (mode === 'new') {
        B = $('xId').value.trim().toUpperCase(); lenB = numIn('xLenB'); var L = numIn('xSpan'), br = numIn('xBrg'), z = numIn('xZ');
        if (!B) return msg('Enter the new pole ID.'); if (merged.poles[B] || (dm && dm.allPoles.some(function (q) { return q.id === B; }))) return msg('Pole ' + B + ' already exists. Choose “Existing pole” or a different ID.');
        if (!(L > 0) || !isFinite(br)) return msg('Enter the span length and bearing.'); if (!isFinite(z)) return msg('Enter the ground level.'); if (!(lenB > 0)) return msg('Enter the new pole length (m).');
        var E = Math.round((qa.easting + L * Math.sin(br * Math.PI / 180)) * 1000) / 1000, N = Math.round((qa.northing + L * Math.cos(br * Math.PI / 180)) * 1000) / 1000;
        if (!validMga(E, N)) return msg('The new pole would be outside the valid MGA range.');
        var f = manualFile(); f.items.push({ id: B, equipNo: '', group: '', dataType: '', easting: E, northing: N, elevation: z, lidarHeight: null, leanDeg: null, bays: null, bayAngles: [], surveyed: '', kind: 'Manual', src: { file: 'Manual poles', row: 'pole ' + (f.items.length + 1) } });
        f.summary = f.items.length + ' pole' + (f.items.length > 1 ? 's' : ''); created = f;
      } else { B = $('xPick').value.trim().toUpperCase(); lenB = numIn('xLenO'); if (!merged.poles[B] || !poleXY(B)) return msg('Choose an existing pole that has coordinates.'); if (!(lenB > 0)) return msg('Enter the far pole length (m).'); }
      var lengths = {}; lengths[A] = lenA; lengths[B] = lenB;
      var prevActive = S.active; recompute();
      var pr = { name: name, poleIds: [A, B], lengths: lengths, comments: {}, segments: [] }, bt = PNW.buildProfile(merged.poles, pr);
      if (!bt.ok) { if (created) { created.items.pop(); created.summary = created.items.length + ' poles'; if (!created.items.length) S.files = S.files.filter(function (x) { return x !== created; }); recompute(); } return msg(bt.issues.filter(function (i) { return i.level === 'error'; }).map(function (i) { return i.message; }).join(' ')); }
      var fname = 'Ground Profile - ' + name.replace(/[\\/:*?"<>|]+/g, '-') + ' (intersection).pnwx';
      var text = PNW.profilePnwx(bt, { title: 'Ground Profile - ' + name, createdBy: S.settings.createdBy, option: S.settings.optionSet, clearance1: PNW.num(S.settings.clr1), clearance2: PNW.num(S.settings.clr2) });
      var r = importText(fname, text); r.size = text.length; r.status = 'ok'; upsertFile(r);
      S.active = prevActive; closeGen(); recompute();
      S.design.log = liveLog().concat([logEntry(A, 'Intersection span', 'Created', '', A + ' → ' + B + ', ' + Math.round(bt.rows[1].span * 100) / 100 + ' m', 'manual', 'New line ' + name)]);
      recompute(); select(B); showPole(B);
      setStatus('Created intersection span ' + A + ' → ' + B + ' (' + (Math.round(bt.rows[1].span * 100) / 100) + ' m). It is drawn with the design; select ' + B + ' and use “Edit this line as the design” to add its constructions and conductors.', 'good');
    };
  }
  $('mNewX').onclick = openXDlg;

  /* ---------- pole photos: attach, match to poles, compare with the model, verify ---------- */
  var photoViews = {}, photoSeq = 0, IDB_NAME = 'eve-pnw-photos';
  function photosOf(id) { return (S.photos && S.photos[id]) || []; }
  function idbDo(mode, fn) {
    return new Promise(function (resolve) {
      try {
        var rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('v'); };
        rq.onerror = function () { resolve(null); };
        rq.onsuccess = function () { try { var tx = rq.result.transaction('v', mode), st = tx.objectStore('v'), q = fn(st); tx.oncomplete = function () { resolve(q && q.result !== undefined ? q.result : true); }; tx.onerror = function () { resolve(null); }; } catch (e) { resolve(null); } };
      } catch (e) { resolve(null); }
    });
  }
  // The resized photo is kept in this browser (IndexedDB) so it can be analysed again; only a small thumbnail goes in the project file.
  function attachPhoto(id, name, img, meta) {
    meta = meta || {};
    var rec = { id: 'ph' + Date.now().toString(36) + (photoSeq++), name: name, thumb: img.thumb, source: meta.source || 'Uploaded photo', at: new Date().toISOString(), pov: meta.pov || null };
    if (!S.photos) S.photos = {};
    S.photos[id] = photosOf(id).concat([rec]);
    photoViews[rec.id] = img.data; idbDo('readwrite', function (st) { return st.put(img.data, rec.id); });
    save(); return rec;
  }
  function photoData(rec) { return photoViews[rec.id] ? Promise.resolve(photoViews[rec.id]) : idbDo('readonly', function (st) { return st.get(rec.id); }).then(function (v) { if (v && typeof v === 'string') photoViews[rec.id] = v; return typeof v === 'string' ? v : null; }); }
  function b64Blob(b64, type) { var bytes = atob(b64), arr = new Uint8Array(bytes.length); for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i); return new Blob([arr], { type: type || 'image/jpeg' }); }
  // One entry point for every photo that arrives (file, paste, drop, Street View capture): attach to the pole and analyse.
  function submitPhoto(id, file, meta) {
    if (!merged.poles[id]) { setStatus('Select a pole first, then add its photo.', 'bad'); return; }
    U.insTab = 'photo'; if (!U.right) { U.right = true; applyLayout(); } saveUi();
    if (S.selected !== id) select(id);
    if (!project || !project.poles.some(function (r) { return r.ID === id; })) {
      shrink(file).then(function (img) { attachPhoto(id, file.name, img, meta); renderSelected(); setStatus('Photo attached to ' + id + '. Start a design that includes this pole to analyse it against the PNW constructions.', 'bad'); });
      return;
    }
    runAi(id, file, meta); setStatus('Photo attached to ' + id + ' and sent for AI analysis. Nothing in the design changes until you approve a suggestion.', 'good');
  }
  function photoListHtml(id, r) {
    var l = photosOf(id); if (!l.length) return '';
    return '<div class="ph-list" aria-label="Photos attached to ' + esc(id) + '">' + l.map(function (p) {
      return '<button class="ph' + (r && r.photoId === p.id ? ' on' : '') + '" data-phredo="' + esc(p.id) + '" title="' + esc(p.name + ' · ' + p.source + ' · ' + new Date(p.at).toLocaleString('en-AU') + '. Click to analyse it again.') + '"><img src="' + p.thumb + '" alt=""><small>' + esc(p.source.replace(/ \(.*/, '')) + '</small></button>';
    }).join('') + '</div>';
  }
  $('selected').addEventListener('click', function (e) {
    var b = e.target.closest('[data-phredo]'); if (!b) return;
    var rec = photosOf(S.selected).filter(function (p) { return p.id === b.dataset.phredo; })[0]; if (!rec) return;
    photoData(rec).then(function (d) {
      if (!d) { setStatus('The full photo is no longer stored in this browser. Capture or add it again.', 'bad'); return; }
      runAi(S.selected, new File([b64Blob(d)], rec.name, { type: 'image/jpeg' }), { noAttach: true, photoId: rec.id, source: rec.source });
    });
  });
  function aiConductors(id) {
    var out = {}; (lib ? lib.conductors : []).forEach(function (c) { out[String(c.code).toUpperCase()] = { code: c.code, name: c.name || c.name2 || '', material: c.material || '' }; });
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  function aiObservations(j) {
    var conf = function (v) { return Math.max(0, Math.min(1, Number(v) || 0)); }, valid = {}; aiConductors().forEach(function (c) { valid[String(c.code).toUpperCase()] = c.code; });
    var st = j && j.stays || {}, tx = j && j.transformer || {}, dropped = 0;
    var conds = (Array.isArray(j && j.conductors) ? j.conductors : []).map(function (c) {
      var code = c.code ? valid[String(c.code).toUpperCase()] : null; if (c.code && !code) dropped++;
      return { level: String(c.level || ''), count: Number(c.count) || null, code: code || null, confidence: conf(c.confidence), notes: String(c.notes || '').slice(0, 200) };
    });
    return { pole: j && j.pole_number != null && String(j.pole_number).trim() ? String(j.pole_number).trim() : null,
      stays: { count: st.count == null ? null : Number(st.count), confidence: conf(st.confidence), notes: String(st.notes || '').slice(0, 200) },
      transformer: { present: tx.present == null ? null : !!tx.present, confidence: conf(tx.confidence), notes: String(tx.notes || '').slice(0, 200) },
      conductors: conds, dropped: dropped, checks: (Array.isArray(j && j.field_checks) ? j.field_checks : []).map(String).slice(0, 8) };
  }
  // Inputs the model still needs before the tipload for this pole can be trusted (from the tipload engine's own notes plus the design).
  function missingInputs(id) {
    var out = [], prow = project && project.poles.filter(function (r) { return r.ID === id; })[0];
    if (!prow) return ['The pole is not in the linked design.'];
    var cons = (dm && dm.byPole[id]) || [];
    if (!cons.length) out.push('No construction is on the pole yet.');
    if (!poleTypeFor(id, PNW.num(prow.Length))) out.push('Pole type is not set (no wind on the pole, no self weight, no % loaded).');
    if (!(PNW.num(prow.Length) > 0)) out.push('Pole length is unknown.');
    var inp = tipInput(id); if (inp) inp.notes.forEach(function (n) { if (out.indexOf(n) < 0) out.push(n); });
    if (inp && !inp.circuits.length) out.push('No conductors are strung to this pole, so the tipload has no conductor loads.');
    inp && inp.circuits.forEach(function (c) { if (!(c.tension > 0)) out.push('Conductor ' + (c.code || '?') + ' towards ' + Math.round(c.dir) + '° has no stringing tension.'); });
    return out;
  }
  // Photo-derived changes stay flagged until someone marks them as checked in the field.
  function unverifiedFor(id) {
    var ver = (S.design.verified || {})[id], at = ver ? ver.at : '';
    return liveLog().filter(function (l) { return l.pole === id && (l.source === 'AI suggestion' || l.source === 'photo estimate') && l.t > at; }).length;
  }
  function verifyBar(id) {
    var n = unverifiedFor(id), ver = (S.design.verified || {})[id];
    if (!n) return ver ? '<p class="hint ok">Photo-derived inputs for ' + esc(id) + ' were marked field-verified by ' + esc(ver.by) + ' on ' + esc(new Date(ver.at).toLocaleDateString('en-AU')) + '.</p>' : '';
    return '<div class="verifybar"><b>' + n + ' photo-derived change' + (n > 1 ? 's' : '') + ' on ' + esc(id) + ' not yet field-verified.</b> Heights and offsets come from the library and DCSH rules, not from measurement, so the tipload for this pole is provisional. <div class="btnrow" style="margin-top:5px"><button class="btn small" data-verify="' + esc(id) + '">Mark as verified in the field</button></div></div>';
  }
  $('selected').addEventListener('click', function (e) {
    var b = e.target.closest('[data-verify]'); if (!b) return;
    var id = b.dataset.verify; (S.design.verified = S.design.verified || {})[id] = { at: new Date().toISOString(), by: S.settings.createdBy || 'designer' };
    recompute(); setStatus('Marked the photo-derived inputs for ' + id + ' as verified in the field.', 'good');
  });
  // The photo against the pole model: what the AI saw, what the model has, and what to do about each difference.
  function aiCompareHtml(id, r, cons) {
    var o = r.resp.obs, h = '<div class="con"><div class="con-title">Photo against the pole model</div><table class="att"><tr><th>Item</th><th>Photo (estimate)</th><th>Model</th><th></th></tr>', ex = extras(id), row = project.poles.filter(function (x) { return x.ID === id; })[0];
    function pc(c) { return '<span class="pill ' + (c >= 0.7 ? 'ok' : c >= 0.5 ? 'warn' : 'bad') + '">' + Math.round(c * 100) + '%</span>'; }
    if (o) {
      if (o.pole && o.pole.toUpperCase().replace(/^(\d+)$/, 'S$1') !== id.toUpperCase()) h += '<tr><td colspan="4"><span class="pill bad">Check the pole</span> The photo appears to show pole <b>' + esc(o.pole) + '</b> but it is attached to <b>' + esc(id) + '</b>.</td></tr>';
      else if (o.pole) h += '<tr><td>Pole number</td><td>' + esc(o.pole) + '</td><td>' + esc(id) + '</td><td><span class="pill ok">match</span></td></tr>';
      var sc = o.stays.count, ms = ex.stays.length;
      h += '<tr><td>Stays</td><td>' + (sc == null ? '<span class="muted">not clear</span>' : sc + ' ' + pc(o.stays.confidence)) + '</td><td>' + ms + '</td><td>' + (sc == null ? '' : sc === ms ? '<span class="pill ok">match</span>' : sc > ms ? '<button class="btn small" data-aiex="stay">Add stay</button>' : '<span class="pill warn">model has more</span>') + '</td></tr>';
      var tp = o.transformer.present, mt = ex.plant.length;
      h += '<tr><td>Transformer</td><td>' + (tp == null ? '<span class="muted">not clear</span>' : (tp ? 'yes' : 'no') + ' ' + pc(o.transformer.confidence)) + '</td><td>' + (mt ? mt : 'none') + '</td><td>' + (tp == null ? '' : tp && !mt ? '<button class="btn small" data-aiex="plant">Add transformer</button>' : tp === !!mt ? '<span class="pill ok">match</span>' : '<span class="pill warn">differs</span>') + '</td></tr>';
      var secs = project.segPoles.filter(function (q) { return q.id === id; }).map(function (q) { var sg = project.segments.filter(function (x) { return x.StrainSect === q.strsection; })[0]; return sg ? sg.Conductor : ''; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      o.conductors.forEach(function (c) {
        var gis = c.code ? gisConductorsAt(id, /hv|high/i.test(c.level) ? 'HV' : 'LV').some(function (t) { return t.lib && t.lib.code === c.code; }) : false;
        h += '<tr><td>' + esc(c.level || 'Conductor') + ' conductors</td><td>' + (c.count || '?') + (c.code ? ' · <b>' + esc(c.code) + '</b>' : ' · <span class="muted">type unclear</span>') + ' ' + pc(c.confidence) + (c.notes ? '<br><small class="muted">' + esc(c.notes) + '</small>' : '') + '</td><td>' + (secs.length ? esc(secs.join(', ')) : '<span class="muted">none strung</span>') + '</td><td>' + (c.code ? (secs.indexOf(c.code) >= 0 ? '<span class="pill ok">in a section</span>' : gis ? '<span class="pill info">matches GIS</span>' : '<span class="pill warn">not in model</span>') : '') + '</td></tr>';
      });
    }
    h += '</table><p class="hint">Conductor types are never changed from a photo: set them in the <button class="btn small" data-instab="conductors">Conductors</button> tab. New stays and transformers are added with library and DCSH default heights, flagged <span class="pill unv">unverified</span>, and appear in the change log as AI suggestions.</p>';
    var miss = missingInputs(id), checks = (o && o.checks) || [];
    if (miss.length || checks.length || (o && o.dropped)) h += '<div class="con-title xinfo" style="margin-top:6px">To check before relying on the results</div><ul class="msgs">' + miss.map(function (m) { return '<li class="warning">' + esc(m) + '</li>'; }).join('') + checks.map(function (m) { return '<li class="info">Field check: ' + esc(m) + '</li>'; }).join('') + (o && o.dropped ? '<li class="info">' + o.dropped + ' conductor suggestion(s) named a code that is not in your PNW library and were ignored.</li>' : '') + '</ul>';
    return h + verifyBar(id) + '</div>';
  }
  $('selected').addEventListener('click', function (e) {
    var b = e.target.closest('[data-aiex]'); if (!b) return;
    var id = S.selected, kind = b.dataset.aiex, before = liveLog().length;
    try { addExtra(id, kind); } catch (x) { setStatus('Could not add it: ' + x.message, 'bad'); return; }
    var log = liveLog().slice(); // addExtra logged it as "calculated"; it came from the photo, so say so and keep it unverified
    for (var i = before; i < log.length; i++) { if (log[i].pole === id) { log[i] = Object.assign({}, log[i], { source: 'AI suggestion', reference: 'From photo ' + ((aiResults[id] || {}).photo || '') + '. ' + log[i].reference }); } }
    S.design.log = log; save(); renderSelected();
    setStatus((kind === 'stay' ? 'Stay' : 'Transformer') + ' added to ' + id + ' as an unverified photo estimate: check its height, bearing and size before using the tipload.', 'good');
  });

  /* ---- Files → Import pole photos: match photos to poles (file name, then the number in the photo), review, attach, analyse ---- */
  function knownPoleIds() { var s = {}; Object.keys(merged.poles).forEach(function (k) { s[k] = 1; }); if (dm) dm.allPoles.forEach(function (p) { s[p.id] = 1; }); return Object.keys(s).sort(); }
  function idFromName(name) {
    var base = String(name).replace(/\.[^.]+$/, '').toUpperCase(), ids = knownPoleIds().filter(function (id) {
      var d = id.replace(/^S/, ''), re = new RegExp('(^|[^A-Z0-9])(' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/^S\d/.test(id) ? '|' + d : '') + ')([^A-Z0-9]|$)');
      return re.test(base);
    });
    ids.sort(function (a, b) { return b.length - a.length; });
    return ids[0] || null;
  }
  function readPoleNumber(img) {
    if (!sampleP) return Promise.resolve(null);
    var known = knownPoleIds();
    return sampleP.then(function (sample) {
      if (!sample) return null;
      return sample.json('Look at the attached photo of an overhead line pole. Read the pole number or ID plate if one is clearly legible (digits, sometimes with an S prefix). Pole IDs in this project, for matching only: ' + known.slice(0, 500).join(', ') + '. Return JSON only: {"pole_number": string|null, "confidence": number between 0 and 1, "note": string}. Use null when no number is legible. Never guess a number.', { images: [b64Blob(img.data)], modelTier: 'default' });
    }).then(function (j) {
      var n = j && j.pole_number != null ? String(j.pole_number).trim().toUpperCase().replace(/\s+/g, '') : ''; if (/^\d+$/.test(n)) n = 'S' + n;
      return n ? { id: known.indexOf(n) >= 0 ? n : null, read: n, confidence: Math.max(0, Math.min(1, Number(j.confidence) || 0)), note: String(j.note || '') } : null;
    }).catch(function () { return null; });
  }
  var photoJobs = [];
  function openPhotoDlg() {
    photoJobs = [];
    openGen('Import pole photos', '<p class="hint">Add photos of individual poles with the pole number visible. Each photo is matched to a pole by its file name' + (IN_CLAUDE ? ', then by reading the number in the photo with Claude' : '') + '. Nothing is attached until you confirm the pole for each photo, and nothing in the design changes until you approve an AI suggestion.</p><div class="btnrow"><button class="btn primary" id="phChoose">Choose photos…</button><span class="meta" id="phCount"></span></div><div id="phRows" style="display:grid;gap:8px"></div><datalist id="phIds">' + knownPoleIds().map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist><div class="btnrow"><label class="inline"><input type="checkbox" id="phAnalyse" checked> Analyse each attached photo with AI (needs the pole in the design)</label></div><div class="btnrow"><button class="btn primary" id="phGo" disabled>Attach photos</button><button class="btn" id="phCancel">Cancel</button></div>');
    $('phChoose').onclick = function () { $('photoInput').click(); }; $('phCancel').onclick = closeGen;
    $('phGo').onclick = function () {
      var jobs = photoJobs.filter(function (j) { return j.id && merged.poles[j.id] && j.img; }), want = $('phAnalyse').checked, first = null;
      if (!jobs.length) return;
      jobs.forEach(function (j) { attachPhoto(j.id, j.file.name, j.img, { source: 'Imported photo' + (j.how ? ' (' + j.how + ')' : '') }); if (!first) first = j.id; });
      closeGen(); renderSelected(); renderTable();
      setStatus('Attached ' + jobs.length + ' photo' + (jobs.length > 1 ? 's' : '') + ' to ' + jobs.map(function (j) { return j.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + '.', 'good');
      if (want) { // one at a time, so the service is not flooded; each result waits on its pole
        var seq = jobs.filter(function (j) { return project && project.poles.some(function (r) { return r.ID === j.id; }); }), n = 0;
        (function next() { var j = seq[n++]; if (!j) return; var rec = photosOf(j.id).slice(-1)[0]; U.insTab = 'photo'; saveUi(); select(j.id); runAi(j.id, j.file, { noAttach: true, photoId: rec && rec.id, source: 'Imported photo' }); var t = setInterval(function () { if (!aiResults[j.id] || !aiResults[j.id].loading) { clearInterval(t); next(); } }, 700); })();
      } else if (first) { U.insTab = 'photo'; saveUi(); select(first); }
    };
    function refresh() {
      $('phCount').textContent = photoJobs.length ? photoJobs.length + ' photo' + (photoJobs.length > 1 ? 's' : '') + ', ' + photoJobs.filter(function (j) { return j.id && merged.poles[j.id]; }).length + ' matched' : '';
      $('phRows').innerHTML = photoJobs.map(function (j, i) {
        return '<div class="photo-row"><img src="' + (j.img ? j.img.thumb : '') + '" alt=""><div><b>' + esc(j.file.name) + '</b><br><small>' + (j.busy ? 'Reading the photo…' : j.how ? 'Matched by ' + esc(j.how) + (j.conf != null ? ' (' + Math.round(j.conf * 100) + '%)' : '') : 'No match yet: choose the pole') + (j.note ? ' · ' + esc(j.note) : '') + '</small></div><div class="field" style="margin:0"><input data-phpick="' + i + '" list="phIds" value="' + esc(j.id || '') + '" placeholder="Pole" aria-label="Pole for ' + esc(j.file.name) + '" class="' + (j.id && !merged.poles[j.id] ? 'invalid' : '') + '" style="width:120px"></div></div>';
      }).join('');
      $('phGo').disabled = !photoJobs.some(function (j) { return j.id && merged.poles[j.id] && j.img; });
    }
    $('genBody').addEventListener('change', function (e) { var i = e.target.dataset && e.target.dataset.phpick; if (i == null) return; var j = photoJobs[+i]; j.id = e.target.value.trim().toUpperCase().replace(/^(\d+)$/, 'S$1'); j.how = j.id ? 'you' : null; j.conf = null; refresh(); });
    window.__phAdd = function (files) {
      Array.prototype.forEach.call(files, function (f) {
        if (!/^image\//.test(f.type)) return;
        var j = { file: f, busy: true }; photoJobs.push(j); refresh();
        shrink(f).then(function (img) {
          j.img = img; var id = idFromName(f.name);
          if (id) { j.id = id; j.how = 'file name'; j.busy = false; refresh(); return; }
          return readPoleNumber(img).then(function (res) { j.busy = false; if (res && res.id) { j.id = res.id; j.how = 'number in photo'; j.conf = res.confidence; if (res.confidence < 0.6) j.note = 'low confidence, please check'; } else if (res) j.note = 'read “' + res.read + '”, which is not a pole in this project'; refresh(); });
        }).catch(function () { j.busy = false; j.note = 'could not read this image'; refresh(); });
      });
    };
    refresh();
  }
  $('mPhotos').onclick = openPhotoDlg;
  $('tbAuto').onclick = function () { closeMenus(); autoDesign(); };
  $('mStreet').onclick = function () { if (S.selected) openStreetView(S.selected); else setStatus('Select a pole first, then open Street View.', 'bad'); };
  $('photoInput').onchange = function () { if (window.__phAdd && !$('genDlg').hidden) window.__phAdd(this.files); this.value = ''; };

  /* ---- Street View inside the app: embedded panorama, capture the visible pole, send it to the AI ---- */
  var GM_KEY = 'eve-pnw-gmaps-key', sv = { id: null, pano: null, gm: null, pov: null };
  function gmKey() { try { return localStorage.getItem(GM_KEY) || ''; } catch (e) { return ''; } }
  function poleLL(id) {
    var p = merged.poles[id], ll = p && (poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null));
    if (!ll) { var q = dm && dm.allPoles.filter(function (x) { return x.id === id; })[0] || (xPole(id) || {}).pole; ll = q && isFinite(q.easting) ? toLatLng(q.easting, q.northing) : null; }
    return ll;
  }
  function loadGmaps(key) {
    if (window.google && window.google.maps && window.google.maps.StreetViewPanorama) return Promise.resolve(window.google.maps);
    return new Promise(function (resolve, reject) {
      window.__pnwGm = function () { resolve(window.google.maps); };
      var sc = document.createElement('script'); sc.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=__pnwGm&v=quarterly'; sc.async = true;
      sc.onerror = function () { reject(new Error('Google Maps could not be loaded (blocked or offline).')); }; document.head.appendChild(sc);
      setTimeout(function () { reject(new Error('Google Maps did not load in time. Check the key and the network.')); }, 12000);
    });
  }
  function closeStreetView() { $('svPanel').hidden = true; $('svPanel').innerHTML = ''; sv = { id: null, pano: null, gm: null, pov: null }; }
  function openStreetView(id, llo) {
    var ll = llo || poleLL(id); if (!ll) { setStatus(id + ' has no location, so Street View cannot be opened for it.', 'bad'); return; }
    var panel = $('svPanel'), key = gmKey(); sv = { id: id, pano: null, gm: null, pov: null, ll: ll, mode: key ? 'api' : 'embed' };
    panel.hidden = false;
    panel.innerHTML = '<div class="svh"><b>🛣 Street View · ' + esc(id) + '</b><span class="grow" style="flex:1"></span><a class="btn small" id="svNew" target="_blank" rel="noopener" href="' + esc(llo ? 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) : streetViewUrl(id)) + '" title="Open Google Street View in its own window (then snip and paste)">New window ↗</a><button class="btn small" id="svKey" title="Optional Google Maps API key for a capture that needs no screen sharing">API key…</button><button class="ibtn" id="svClose" aria-label="Close Street View">✕</button></div>' +
      '<div class="svb" id="svBody"></div><div class="svf"><button class="btn primary" id="svCap" title="Capture what is shown and send it to the AI for ' + esc(id) + '">📸 Capture and analyse</button><span class="meta grow" id="svHint"></span></div>';
    $('svClose').onclick = closeStreetView; $('svKey').onclick = svKeyDlg; $('svCap').onclick = svCapture;
    if (llo) { $('svCap').hidden = true; sv.free = true; }
    if (key) svStartApi(id, ll, key); else if (IN_CLAUDE) svStartMcp(id, ll);
    else if (webMapsOn()) { $('svBody').innerHTML = '<p class="hint" style="padding:12px">Finding Street View near ' + esc(id) + '…</p>'; mapsCall('street_view_metadata', { lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7), radius: 50 }).then(function () { if (sv.id === id) svStartMcp(id, ll); }, function () { if (sv.id === id) svStartEmbed(id, ll); }); }
    else svStartEmbed(id, ll);
    if (!llo && S.selected !== id) select(id);
  }
  function poleHag(id) { var row = project && project.poles.filter(function (r) { return r.ID === id; })[0]; return row ? PNW.num(row.HeightAG) || 9 : 9; }
  function b64Blob(b64, type) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type }); }
  // Auto design photo: not the panorama right beside the pole (Ishan: it looks straight up the pole), but one a step back or
  // ahead along the line, 12–45 m away, looking at the pole. Tries along the line both ways, then across it, then the nearest.
  function svPickPano(id, ll) {
    var ids = lineIds(), k = ids.indexOf(id), dirs = [];
    [ids[k - 1], ids[k + 1]].forEach(function (o) { var q = o && poleLL(o); if (q) dirs.push(bearingTo(ll, q)); });
    if (!dirs.length) dirs = [0, 180]; dirs = dirs.concat(dirs.map(function (b) { return (b + 180) % 360; }), dirs.map(function (b) { return (b + 90) % 360; }), dirs.map(function (b) { return (b + 270) % 360; }));
    var seen = {}, tries = [];
    dirs.forEach(function (b) { var k2 = Math.round(b); if (seen[k2]) return; seen[k2] = 1; tries.push(L.latLng(ll.lat + 22 * Math.cos(b * Math.PI / 180) / 111320, ll.lng + 22 * Math.sin(b * Math.PI / 180) / (111320 * Math.cos(ll.lat * Math.PI / 180)))); });
    var i = 0;
    return (function next() {
      if (i >= tries.length) return Promise.resolve(null);
      var t = tries[i++];
      return mapsCall('street_view_metadata', { lat: +t.lat.toFixed(7), lng: +t.lng.toFixed(7), radius: 15 }).then(function (r) {
        var m = mapsInfo(r); if (!m.found) return next();
        var d = L.latLng(m.lat, m.lng).distanceTo(ll); return d >= 12 && d <= 45 ? m.pano : next();
      }, function () { return next(); });
    })();
  }
  // Two Street View panoramas one step either side of the pole along the line (toward the next and the previous pole),
  // each looking at the pole. Returns [{pano, side}] (one or two), or [] when there is none.
  function svStepPanos(id, ll) {
    var ids = lineIds(), k = ids.indexOf(id), nx = ids[k + 1] && poleLL(ids[k + 1]), pv = ids[k - 1] && poleLL(ids[k - 1]);
    var fwd = nx ? bearingTo(ll, nx) : pv ? (bearingTo(ll, pv) + 180) % 360 : 0, back = pv ? bearingTo(ll, pv) : (fwd + 180) % 360;
    var at = function (b, m) { return L.latLng(ll.lat + m * Math.cos(b * Math.PI / 180) / 111320, ll.lng + m * Math.sin(b * Math.PI / 180) / (111320 * Math.cos(ll.lat * Math.PI / 180))); };
    var used = {};
    function find(b, side) {
      var steps = [12, 20, 30, 8], i = 0;
      return (function next() {
        if (i >= steps.length) return Promise.resolve(null);
        var t = at(b, steps[i++]);
        return mapsCall('street_view_metadata', { lat: +t.lat.toFixed(7), lng: +t.lng.toFixed(7), radius: 12 }).then(function (r) {
          var m = mapsInfo(r); if (!m.found || used[m.pano]) return next();
          var dd = L.latLng(m.lat, m.lng).distanceTo(ll); if (dd < 5 || dd > 45) return next();
          used[m.pano] = 1; return { pano: m.pano, side: side };
        }, function () { return next(); });
      })();
    }
    // Both sides at once; if both land on the same panorama, look again behind (that pano is now marked used).
    return Promise.all([find(fwd, 'ahead'), find(back, 'behind')]).then(function (x) { return x[0] && x[1] && x[0].pano === x[1].pano ? find(back, 'behind').then(function (b) { return [x[0], b].filter(Boolean); }) : x.filter(Boolean); });
  }
  function svShot(id, ll, pano, side) {
    var inp = { lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7), radius: 50, height_m: poleHag(id), width: 640, height: 640, fov: pano ? 45 : 70 }; if (pano) inp.pano = pano;
    return mapsCall('street_view', inp).then(function (r) {
      var info = mapsInfo(r), im = mapsImg(r); if (!info.found || !im) return null;
      return { file: new File([b64Blob(im.b64, im.type)], 'Street View ' + id + (side ? ' ' + side : '') + ' (auto).jpg', { type: im.type }), cam: { heading: Number(info.heading), pitch: Number(info.pitch) || 0, fov: Number(info.fov) || inp.fov, dist: Number(info.distance_m), lat: info.lat, lng: info.lng, date: info.date || '' }, meta: { source: 'Street View (auto, PNW Maps, ' + (side ? side + ', ' : '') + Math.round(info.distance_m) + ' m away' + (info.date ? ', ' + info.date : '') + ')', pov: { heading: Math.round(info.heading), pitch: Math.round(info.pitch), fov: info.fov, pano: info.pano } } };
    }, function () { return null; });
  }
  // For the AI: the photos from one step ahead and one step behind, both facing the pole; the AI uses the better one.
  function svMcpImage(id, ll) {
    return svStepPanos(id, ll).then(function (ps) {
      if (!ps.length) return svPickPano(id, ll).then(function (pano) { return Promise.all([svShot(id, ll, pano, '')]); });
      return Promise.all(ps.map(function (p) { return svShot(id, ll, p.pano, p.side); }));
    }).then(function (list) {
      list = (list || []).filter(Boolean); if (!list.length) return null;
      var first = list[0]; first.meta.extra = list.slice(1); return first;
    }, function () { return null; });
  }
  /* 3D › Street View: the panorama one step ahead of (or behind) a pole, facing it, with the design's poles and
     conductors projected over the photo from the camera position (pinhole camera, Street View heading/pitch/fov,
     camera 2.5 m above the ground interpolated from the surveyed pole levels). */
  var SV3 = { on: false, side: 0, id: null, panos: null, panosFor: null, req: 0, cam: null, url: null };
  function sv3Ids() { var d = data3d(); return d.poles.filter(function (p) { return isFinite(p.easting) && isFinite(p.ground); }).map(function (p) { return p.id; }); }
  function sv3Msg(t) { $('sv3msg').textContent = t || ''; $('sv3msg').hidden = !t; }
  function sv3Toggle(on) {
    SV3.on = on == null ? !SV3.on : on; $('v3svp').hidden = !SV3.on; $('v3sv').classList.toggle('on', SV3.on);
    if (SV3.on) sv3Show(S.selected && sv3Ids().indexOf(S.selected) >= 0 ? S.selected : null);
  }
  function sv3Show(id) {
    var ids = sv3Ids(); id = id || SV3.id; if (ids.indexOf(id) < 0) id = ids[0];
    if (!id) { sv3Msg('No poles with coordinates and ground levels yet.'); return; }
    if (!IN_CLAUDE && !webMapsOn()) { sv3Msg('Street View is not available on this page right now (the Street View service did not answer).'); return; }
    var ll = poleLL(id); if (!ll) { sv3Msg(id + ' has no map position.'); return; }
    if (SV3.id !== id) SV3.side = 0;
    SV3.id = id; var req = ++SV3.req; $('sv3t').textContent = id; sv3Msg('Loading Street View for ' + id + '…');
    (SV3.panosFor === id ? Promise.resolve(SV3.panos) : svStepPanos(id, ll)).then(function (ps) {
      SV3.panos = ps; SV3.panosFor = id; var p = ps.length ? ps[SV3.side % ps.length] : null;
      return svShot(id, ll, p && p.pano, p ? p.side : '').then(function (sh) { return { sh: sh, p: p, n: ps.length }; });
    }).then(function (x) {
      if (req !== SV3.req) return;
      if (!x.sh) { sv3Msg('No Street View near ' + id + '.'); return; }
      var c = x.sh.cam, pole = data3d().poles.filter(function (q) { return q.id === id; })[0];
      // Camera: back from the pole along the view heading (grid bearing = true heading plus the direction of true north on the grid).
      var def = '+proj=utm +zone=' + S.zone + ' +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs', gam = 0, ce = null;
      try { var a0 = proj4('EPSG:4326', def, [ll.lng, ll.lat]), a1 = proj4('EPSG:4326', def, [ll.lng, ll.lat + 0.0005]); gam = Math.atan2(a1[0] - a0[0], a1[1] - a0[1]) * 180 / Math.PI; if (c.lat != null && c.lng != null) ce = proj4('EPSG:4326', def, [Number(c.lng), Number(c.lat)]); } catch (e) { gam = 0; }
      var hg = c.heading + gam, hr = hg * Math.PI / 180;
      if (!ce) ce = [pole.easting - Math.sin(hr) * c.dist, pole.northing - Math.cos(hr) * c.dist];
      SV3.cam = { e: ce[0], n: ce[1], heading: hg, pitch: c.pitch, fov: c.fov, side: x.p ? x.p.side : '', count: x.n, date: c.date, dist: c.dist };
      SV3.view = { pano: x.sh.meta.pov.pano, lat: c.lat != null ? Number(c.lat) : null, lng: c.lng != null ? Number(c.lng) : null, th: c.heading, pitch: c.pitch, fov: c.fov, date: c.date, gam: gam };
      if (SV3.url) URL.revokeObjectURL(SV3.url); SV3.url = URL.createObjectURL(x.sh.file);
      sv3Img(SV3.url);
      $('sv3side').disabled = x.n < 2; sv3Msg(''); sv3Title();
    }, function (e) { if (req === SV3.req) sv3Msg('Street View: ' + mapsErr(e)); });
  }
  // Look around like Google Street View: drag to turn (the overlay follows at once; the photo is fetched for the new
  // view when the drag ends), wheel to zoom, Walk / Back to move to the next panorama along the view, ◎ to face the pole.
  var DEF_UTM = function () { return '+proj=utm +zone=' + S.zone + ' +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'; };
  function sv3Img(src) { var im = $('sv3img'); im.onload = function () { im.style.transform = ''; sv3Draw(); }; im.src = src; }
  function sv3Title() {
    var v = SV3.view, ll = poleLL(SV3.id), dd = v && v.lat != null && ll ? L.latLng(v.lat, v.lng).distanceTo(ll) : null;
    $('sv3t').textContent = SV3.id + (dd != null ? ' · ' + Math.round(dd) + ' m away' : '') + (v && v.date ? ' · ' + v.date : '');
  }
  function sv3Cam() { // camera for the overlay from the Street View position and true heading
    var v = SV3.view; if (!v || v.lat == null) return;
    try { var def = DEF_UTM(), ce = proj4('EPSG:4326', def, [v.lng, v.lat]), a1 = proj4('EPSG:4326', def, [v.lng, v.lat + 0.0005]), gam = Math.atan2(a1[0] - ce[0], a1[1] - ce[1]) * 180 / Math.PI;
      SV3.cam = Object.assign({}, SV3.cam, { e: ce[0], n: ce[1], heading: v.th + gam, pitch: v.pitch, fov: v.fov }); } catch (e) { /* keep the last camera */ }
  }
  var sv3T = null;
  function sv3Load(delay) { // the photo for the current view (after a pause, so a drag or wheel makes one request)
    clearTimeout(sv3T); sv3T = setTimeout(function () {
      var v = SV3.view, ll = poleLL(SV3.id); if (!v || !ll) return; var req = ++SV3.req;
      var inp = { lat: +ll.lat.toFixed(7), lng: +ll.lng.toFixed(7), radius: 50, heading: +(((v.th % 360) + 360) % 360).toFixed(1), pitch: +v.pitch.toFixed(1), fov: +v.fov.toFixed(1), width: 640, height: 640 }; if (v.pano) inp.pano = v.pano;
      mapsCall('street_view', inp).then(function (r) {
        if (req !== SV3.req) return; var im = mapsImg(r), info = mapsInfo(r); if (!im) { sv3Msg('No Street View image here.'); return; }
        if (info.date) v.date = info.date; sv3Img(im.url); sv3Title(); sv3Msg('');
      }, function (e) { if (req === SV3.req) sv3Msg('Street View: ' + mapsErr(e)); });
    }, delay == null ? 0 : delay);
  }
  function sv3Walk(back) { // to the next panorama 8–25 m along the view (or behind it)
    var v = SV3.view; if (!v || v.lat == null) return; var b = (v.th + (back ? 180 : 0)) * Math.PI / 180, steps = [10, 15, 22], i = 0, req = ++SV3.req;
    sv3Msg(back ? 'Stepping back…' : 'Walking…');
    (function next() {
      if (i >= steps.length) { if (req === SV3.req) sv3Msg('No Street View further ' + (back ? 'back' : 'this way') + '.'); return; }
      var m = steps[i++], la = v.lat + m * Math.cos(b) / 111320, lo = v.lng + m * Math.sin(b) / (111320 * Math.cos(v.lat * Math.PI / 180));
      mapsCall('street_view_metadata', { lat: +la.toFixed(7), lng: +lo.toFixed(7), radius: 10 }).then(function (r) {
        if (req !== SV3.req) return; var k = mapsInfo(r); if (!k.found || k.pano === v.pano) return next();
        v.pano = k.pano; v.lat = Number(k.lat); v.lng = Number(k.lng); v.date = k.date || v.date; sv3Cam(); sv3Draw(); sv3Load(0);
      }, function () { next(); });
    })();
  }
  function sv3Face() { var v = SV3.view, ll = poleLL(SV3.id); if (!v || v.lat == null || !ll) return; v.th = bearingTo(L.latLng(v.lat, v.lng), ll); v.pitch = 15; sv3Cam(); sv3Draw(); sv3Load(0); }
  (function () {
    var wrap = document.querySelector('#v3svp .sv3wrap'), drag = null;
    var scale = function () { var im = $('sv3img'), r = wrap.getBoundingClientRect(), s = Math.min(r.width, r.height); return SV3.view ? SV3.view.fov / (s || 1) : 0.1; };
    wrap.addEventListener('pointerdown', function (e) { if (!SV3.view || e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, th: SV3.view.th, p: SV3.view.pitch, k: scale(), hit: e.target.closest && e.target.closest('[data-sv3p],[data-sv3w]'), moved: false }; wrap.setPointerCapture(e.pointerId); wrap.classList.add('drag'); });
    wrap.addEventListener('pointermove', function (e) {
      if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = SV3.view;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return; drag.moved = true;
      v.th = drag.th - dx * drag.k; v.pitch = Math.max(-60, Math.min(80, drag.p + dy * drag.k));
      $('sv3img').style.transform = 'translate(' + dx + 'px,' + (v.pitch === drag.p + dy * drag.k ? dy : (v.pitch - drag.p) / drag.k) + 'px)';
      sv3Cam(); sv3Draw();
    });
    // A click (no drag) on a pole or conductor drawn over the photo selects it, as in the plan and 3D views.
    var end = function () { if (!drag) return; var d0 = drag; drag = null; wrap.classList.remove('drag'); if (d0.moved) { sv3Load(150); return; } if (d0.hit) sv3Pick(d0.hit); };
    function sv3Pick(el) {
      if (el.dataset.sv3p) { select(el.dataset.sv3p, { noSwitch: true }); setStatus(el.dataset.sv3p + ' selected in Street View.', 'good'); }
      else { var k = el.dataset.sv3w.split('|'); clr3d = [k[0], k[1], k[2]]; select(k[0], { segment: k[2] || '', noSwitch: true }); show3dClr(); var c = spanClearance(k[0], k[1]); setStatus('Conductor ' + (k[2] || '') + ', span ' + k[0] + ' → ' + k[1] + (c != null ? ': ground clearance ' + c.toFixed(2) + ' m' : '') + '.', 'good'); }
      sv3Draw();
    }
    wrap.addEventListener('contextmenu', function (e) { var h = e.target.closest && e.target.closest('[data-sv3p],[data-sv3w]'); if (!h) return; e.preventDefault(); if (h.dataset.sv3p) poleMenu(h.dataset.sv3p, e.clientX, e.clientY); else { var k = h.dataset.sv3w.split('|'); spanMenu(k[0], k[1], e.clientX, e.clientY, k[2]); } });
    wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('wheel', function (e) {
      if (!SV3.view) return; e.preventDefault(); var v = SV3.view, f0 = v.fov;
      v.fov = Math.max(15, Math.min(100, v.fov * Math.exp(e.deltaY * 0.0015)));
      var s = Math.tan(f0 * Math.PI / 360) / Math.tan(v.fov * Math.PI / 360), im = $('sv3img'), cur = /scale\(([\d.]+)\)/.exec(im.style.transform);
      im.style.transform = 'scale(' + ((cur ? Number(cur[1]) : 1) * s).toFixed(3) + ')'; sv3Cam(); sv3Draw(); sv3Load(350);
    }, { passive: false });
    wrap.addEventListener('dblclick', function (e) { // walk toward where you double-click
      if (!SV3.view) return; var r = wrap.getBoundingClientRect(); SV3.view.th += (e.clientX - (r.left + r.width / 2)) * scale(); sv3Walk(false);
    });
    $('v3svp').addEventListener('keydown', function (e) {
      if (!SV3.view || /INPUT|SELECT/.test(e.target.tagName)) return; var v = SV3.view, k = e.key;
      if (k === 'ArrowUp') sv3Walk(false); else if (k === 'ArrowDown') sv3Walk(true);
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { v.th += k === 'ArrowLeft' ? -15 : 15; sv3Cam(); sv3Draw(); sv3Load(250); } else return;
      e.preventDefault();
    });
  })();
  function sv3Draw() {
    var svg = $('sv3svg'), im = $('sv3img'), c = SV3.cam; if (!SV3.on || !c || !im.naturalWidth) return;
    var W = im.naturalWidth, H = im.naturalHeight, d = data3d(), R = Math.PI / 180, h = c.heading * R, pt = c.pitch * R, f = (W / 2) / Math.tan(c.fov * R / 2);
    var F = [Math.sin(h) * Math.cos(pt), Math.cos(h) * Math.cos(pt), Math.sin(pt)], Rv = [Math.cos(h), -Math.sin(h), 0], U = [-Math.sin(h) * Math.sin(pt), -Math.cos(h) * Math.sin(pt), Math.cos(pt)];
    var near = d.poles.filter(function (p) { return isFinite(p.easting) && isFinite(p.ground); }).map(function (p) { return { p: p, d: Math.hypot(p.easting - c.e, p.northing - c.n) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 2);
    var gw = 0, gz = 0; near.forEach(function (q) { var k = 1 / Math.max(q.d, 0.5); gw += k; gz += k * q.p.ground; });
    var cz = (gw ? gz / gw : 0) + 2.5;
    var P = function (e, n, z) { var dx = e - c.e, dy = n - c.n, dz = z - cz, zc = dx * F[0] + dy * F[1] + dz * F[2]; if (zc < 0.5) return null; return [W / 2 + f * (dx * Rv[0] + dy * Rv[1]) / zc, H / 2 - f * (dx * U[0] + dy * U[1] + dz * U[2]) / zc, zc]; };
    var out = '', col = { hv: '#fb923c', lv: '#60a5fa', earth: '#cbd5e1', other: '#2dd4bf' };
    var show = $('sv3ov').checked;
    if (show) {
      d.wires.forEach(function (w) {
        var segs = [], cur = [];
        for (var k = 0; k <= 24; k++) { var t = k / 24, q = P(w.from.easting + (w.to.easting - w.from.easting) * t, w.from.northing + (w.to.northing - w.from.northing) * t, w.from.elevation + (w.to.elevation - w.from.elevation) * t - (w.sag ? 4 * w.sag * t * (1 - t) : 0)); if (q) cur.push(q[0].toFixed(1) + ',' + q[1].toFixed(1)); else if (cur.length) { segs.push(cur); cur = []; } }
        if (cur.length) segs.push(cur);
        var son = S.selSection && w.segment === S.selSection, key = esc(w.from.pole + '|' + w.to.pole + '|' + (w.segment || ''));
        segs.forEach(function (s) { if (s.length > 1) out += '<polyline points="' + s.join(' ') + '" fill="none" stroke="#0008" stroke-width="' + (son ? 6 : 4) + '"/><polyline points="' + s.join(' ') + '" fill="none" stroke="' + (son ? '#facc15' : col[wireKind(w)]) + '" stroke-width="' + (son ? 4 : 2) + '"/><polyline class="sv3hit" data-sv3w="' + key + '" points="' + s.join(' ') + '" fill="none" stroke="transparent" stroke-width="14"><title>' + esc((w.segment || '') + ' ' + (w.code || '') + ': ' + w.from.pole + ' → ' + w.to.pole) + '</title></polyline>'; });
      });
      d.poles.forEach(function (p) {
        if (!isFinite(p.easting) || !(p.height > 0)) return;
        var a = P(p.easting, p.northing, p.ground), b = P(p.easting, p.northing, p.ground + p.height); if (!a || !b) return;
        var wpx = Math.max(2, Math.min(40, 0.3 * f / a[2])), on = p.id === (S.selected || SV3.id);
        out += '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="#000a" stroke-width="' + (wpx + 3).toFixed(1) + '" stroke-linecap="round"/>' +
          '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="' + (on ? '#f59e0b' : '#a3e635') + '" stroke-opacity=".75" stroke-width="' + wpx.toFixed(1) + '" stroke-linecap="round"/>' +
          '<text x="' + (b[0] + wpx / 2 + 4).toFixed(1) + '" y="' + (b[1] + 4).toFixed(1) + '" class="sv3lbl' + (on ? ' on' : '') + '">' + esc(p.id) + '</text>' +
          '<line class="sv3hit" data-sv3p="' + esc(p.id) + '" x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="transparent" stroke-width="' + (wpx + 16).toFixed(1) + '"><title>' + esc(p.id) + '</title></line>';
      });
    }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = out;
  }
  $('v3sv').onclick = function () { sv3Toggle(); };
  $('v3svp').addEventListener('click', function (e) {
    var b = e.target.closest('[data-sv3]'); if (!b) return; var k = b.dataset.sv3, ids = sv3Ids(), i = ids.indexOf(SV3.id);
    if (k === 'close') sv3Toggle(false);
    else if (k === 'side') { SV3.side++; sv3Show(SV3.id); }
    else if (k === 'walk' || k === 'back') sv3Walk(k === 'back');
    else if (k === 'face') sv3Face();
    else if (k === 'prev' || k === 'next') { var j = i + (k === 'next' ? 1 : -1); if (ids[j]) { select(ids[j], { noSwitch: true }); sv3Show(ids[j]); } }
  });
  $('sv3ov').onchange = sv3Draw;
  function svStartMcp(id, ll) {
    sv.mode = 'mcp'; sv.hag = poleHag(id); sv.img = null;
    $('svBody').innerHTML = '<img class="svimg" id="svImg" alt="Street View toward ' + esc(id) + '"><div class="svnav"><button class="btn small" data-svm="f" title="Walk forward to the next panorama">⬆ Walk</button><button class="btn small" data-svm="b" title="Walk back">⬇</button><button class="btn small" data-svm="p" title="Turn to face the pole">◎ Pole</button><button class="btn small" data-svm="l" title="Turn left">⟲</button><button class="btn small" data-svm="r" title="Turn right">⟳</button><button class="btn small" data-svm="u" title="Look up">▲</button><button class="btn small" data-svm="d" title="Look down">▼</button><button class="btn small" data-svm="i" title="Zoom in">＋</button><button class="btn small" data-svm="o" title="Zoom out">−</button></div>';
    $('svBody').onclick = function (e) {
      var b = e.target.closest('[data-svm]'), p = sv.pov; if (!b || !p) return; var k = b.dataset.svm;
      if (k === 'f' || k === 'b') { svWalk(k === 'f' ? p.heading : (p.heading + 180) % 360); return; }
      if (k === 'p') { p.face = true; svMcpLoad(); return; }
      if (k === 'l') p.heading = (p.heading + 340) % 360; else if (k === 'r') p.heading = (p.heading + 20) % 360; else if (k === 'u') p.pitch = Math.min(80, p.pitch + 8); else if (k === 'd') p.pitch = Math.max(-30, p.pitch - 8); else if (k === 'i') p.fov = Math.max(15, p.fov / 1.5); else p.fov = Math.min(110, p.fov * 1.5);
      svMcpLoad();
    };
    svMcpLoad();
  }
  // Walk: the panorama about 12 m along the view direction (Street View links panoramas roughly every 10 m).
  function svWalk(hd) {
    var a = sv.at, p = sv.pov; if (!a || !p) return; var id = sv.id, cur = p.pano, tried = 0;
    $('svHint').textContent = 'Walking…';
    (function go(dist) {
      var r = hd * Math.PI / 180, lat = a.lat + dist * Math.cos(r) / 111320, lng = a.lng + dist * Math.sin(r) / (111320 * Math.cos(a.lat * Math.PI / 180));
      mapsCall('street_view_metadata', { lat: +lat.toFixed(7), lng: +lng.toFixed(7), radius: 8 }).then(function (m0) {
        if (sv.id !== id) return; var m = mapsInfo(m0);
        if (m.found && m.pano !== cur) { p.pano = m.pano; p.face = false; svMcpLoad(); return; }
        if (++tried < 3) go(dist + 10); else $('svHint').textContent = 'No panorama further that way.';
      }, function (e) { $('svHint').textContent = mapsErr(e); });
    })(12);
  }
  function svMcpLoad() {
    var id = sv.id, p = sv.pov, inp = { lat: +sv.ll.lat.toFixed(7), lng: +sv.ll.lng.toFixed(7), radius: 80, height_m: sv.hag, width: 640, height: 480 };
    if (p) { inp.pano = p.pano; if (!p.face) { inp.heading = Math.round(p.heading); inp.pitch = Math.round(p.pitch); } inp.fov = Math.round(p.fov); }
    $('svCap').disabled = true; $('svHint').textContent = 'Loading Street View through PNW Maps…';
    mapsCall('street_view', inp).then(function (r) {
      if (sv.id !== id) return; var info = mapsInfo(r), im = mapsImg(r);
      if (!info.found || !im) { $('svHint').textContent = 'No Street View coverage within 80 m of ' + id + '.'; return; }
      sv.pov = { pano: info.pano, heading: info.heading, pitch: info.pitch, fov: info.fov }; sv.at = { lat: info.lat, lng: info.lng }; sv.img = im; $('svImg').src = im.url; $('svCap').disabled = false;
      $('svHint').textContent = 'Facing ' + id + ' from ' + Math.round(info.distance_m) + ' m away' + (info.date ? ' (' + info.date + ')' : '') + '. Turn or zoom, then Capture.';
    }, function (e) { if (sv.id === id) $('svHint').textContent = mapsErr(e) + ' Or use “New window”, snip the pole and paste it here.'; });
  }
  function svStartEmbed(id, ll) {
    var f = document.createElement('iframe'); f.id = 'svFrame'; f.title = 'Street View at ' + id; f.allow = 'fullscreen; display-capture'; f.referrerPolicy = 'no-referrer';
    f.src = 'https://www.google.com/maps?q=&layer=c&cbll=' + ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) + '&cbp=12,0,,0,0&output=svembed'; $('svBody').appendChild(f);
    $('svHint').textContent = 'Drag to look around, aim at the pole, then Capture. The browser asks once to share this tab. Blank? This page’s host may block Google embeds: use “New window”, snip the pole and paste it here (Ctrl+V).';
  }
  function svStartApi(id, ll, key) {
    $('svBody').innerHTML = '<div class="svmap" id="svMap"></div>'; $('svHint').textContent = 'Loading Google Street View…';
    loadGmaps(key).then(function (gm) {
      sv.gm = gm; var here = new gm.LatLng(ll.lat, ll.lng);
      new gm.StreetViewService().getPanorama({ location: here, radius: 80, source: 'outdoor' }, function (data, status) {
        if (status !== 'OK' || !data) { $('svHint').textContent = 'No Street View coverage within 80 m of ' + id + '.'; $('svCap').disabled = true; return; }
        var heading = bearingTo({ lat: data.location.latLng.lat(), lng: data.location.latLng.lng() }, ll);
        sv.panorama = new gm.StreetViewPanorama($('svMap'), { pano: data.location.pano, pov: { heading: heading, pitch: 6 }, zoom: 1, addressControl: false, fullscreenControl: false });
        sv.panorama.addListener('pov_changed', function () { sv.pov = sv.panorama.getPov(); }); sv.pov = { heading: heading, pitch: 6 };
        $('svHint').textContent = 'Turned toward ' + id + ' from the nearest panorama (' + (data.imageDate || 'date unknown') + '). Adjust the view, then Capture.';
      });
    }).catch(function (e) { $('svBody').innerHTML = ''; $('svHint').textContent = e.message + ' Using the keyless embed instead.'; sv.mode = 'embed'; svStartEmbed(id, ll); });
  }
  function svKeyDlg() {
    openGen('Google Maps API key (optional)', '<p class="hint">With a key, Street View opens as a real panorama turned toward the pole, and Capture saves the exact view through the Street View Static API, with no screen sharing. Enable <b>Maps JavaScript API</b> and <b>Street View Static API</b> for the key, and restrict it to this site. The key is stored only in this browser.</p><div class="field"><label for="svKeyIn">API key</label><input id="svKeyIn" value="' + esc(gmKey()) + '" autocomplete="off" spellcheck="false"></div><div class="btnrow"><button class="btn primary" id="svKeySave">Save</button><button class="btn" id="svKeyClear">Remove key</button></div>', { narrow: true });
    $('svKeySave').onclick = function () { try { localStorage.setItem(GM_KEY, $('svKeyIn').value.trim()); } catch (e) { /* ignore */ } var id = sv.id; closeGen(); if (id) openStreetView(id); };
    $('svKeyClear').onclick = function () { try { localStorage.removeItem(GM_KEY); } catch (e) { /* ignore */ } var id = sv.id; closeGen(); if (id) openStreetView(id); };
  }
  function canvasBlob(c) { return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('The image could not be read back (cross-origin).')); }, 'image/jpeg', 0.9); }); }
  // Capture paths, best first: Street View Static API (exact view), then a screen capture of just the Street View frame, then paste.
  function svCapture() {
    var id = sv.id, hint = $('svHint'), btn = $('svCap'); if (!id) return; btn.disabled = true; hint.textContent = 'Capturing…';
    var done = function (blob, how, pov) { btn.disabled = false; hint.textContent = 'Captured and sent. Aim at another angle and capture again if needed.'; submitPhoto(id, new File([blob], 'Street View ' + id + ' ' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.jpg', { type: 'image/jpeg' }), { source: 'Street View capture (' + how + ')', pov: pov || null }); };
    var fail = function (e) { btn.disabled = false; hint.textContent = ((e && e.message) || 'Capture was not possible here.') + ' Use “New window”, snip the pole (Win+Shift+S) and paste it with Ctrl+V: it is analysed straight away.'; };
    if (sv.mode === 'mcp') { if (!sv.img) return fail(new Error('No Street View image yet.')); return done(b64Blob(sv.img.b64, sv.img.type), 'PNW Maps', { heading: Math.round(sv.pov.heading), pitch: Math.round(sv.pov.pitch), fov: Math.round(sv.pov.fov), pano: sv.pov.pano }); }
    if (sv.mode === 'api' && sv.panorama) {
      var pov = sv.panorama.getPov(), z = sv.panorama.getZoom ? sv.panorama.getZoom() : 1, fov = Math.max(10, Math.min(120, 180 / Math.pow(2, z))), pano = sv.panorama.getPano();
      var url = 'https://maps.googleapis.com/maps/api/streetview?size=1280x960&pano=' + encodeURIComponent(pano) + '&heading=' + pov.heading.toFixed(1) + '&pitch=' + pov.pitch.toFixed(1) + '&fov=' + fov.toFixed(0) + '&key=' + encodeURIComponent(gmKey());
      return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('Street View Static API answered ' + r.status + ' (is it enabled for the key?).'); return r.blob(); })
        .then(function (b) { done(b, 'Static API', { heading: Math.round(pov.heading), pitch: Math.round(pov.pitch), fov: fov, pano: pano }); }).catch(fail);
    }
    var frame = $('svFrame') || $('svBody');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return fail(new Error('This browser cannot capture the screen.'));
    navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' }).then(function (stream) {
      var track = stream.getVideoTracks()[0], cropped = window.CropTarget && track.cropTo ? window.CropTarget.fromElement(frame).then(function (t) { return track.cropTo(t); }).then(function () { return true; }, function () { return false; }) : Promise.resolve(false);
      return cropped.then(function (didCrop) {
        var v = document.createElement('video'); v.srcObject = stream; v.muted = true;
        return v.play().then(function () { return new Promise(function (r) { setTimeout(r, 400); }); }).then(function () {
          var c = document.createElement('canvas'), W = v.videoWidth, H = v.videoHeight, rc = frame.getBoundingClientRect();
          if (didCrop) { c.width = W; c.height = H; c.getContext('2d').drawImage(v, 0, 0); }
          else { var k = W / window.innerWidth; c.width = Math.round(rc.width * k); c.height = Math.round(rc.height * k); c.getContext('2d').drawImage(v, rc.left * k, rc.top * k, rc.width * k, rc.height * k, 0, 0, c.width, c.height); }
          track.stop(); return canvasBlob(c);
        });
      });
    }).then(function (b) { done(b, 'screen capture'); }).catch(function (e) { fail(e && (e.name === 'NotAllowedError' || e.name === 'NotSupportedError' || e.name === 'SecurityError') ? new Error('Screen capture is not available or was not allowed on this page.') : e); });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('svPanel').hidden && $('genDlg').hidden && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) closeStreetView(); });

  /* ---------- start ---------- */
  load();
  setView(S.view, true);
  /* ---------- integrated workspace: navigation rail, Add menu, plan tools, analysis workspace, multi-select, status bar ---------- */
  var planTool = 'select', measurePts = [], lyMeasure = null, calcAt = null, dirty = false;
  if (U.an == null) U.an = 'profile'; if (U.ah == null) U.ah = Math.round(Math.min(250, window.innerHeight * 0.25)); if (U.anOpen == null) U.anOpen = true;
  function markDirty(v) { dirty = v; if ($('statusBar')) renderStatusBar(); }
  function addInfo(e) { var o = e && (e.originalEvent || e); return o && (o.shiftKey || o.ctrlKey || o.metaKey) || (typeof multiMode !== 'undefined' && multiMode && o) ? { add: true } : undefined; }
  function isSel(id) { return S.selected === id || !!(S.multi && S.multi.indexOf(id) >= 0); }
  function hhmmss(d) { return d ? ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) : ''; }
  function pvShow() { var s = U.pvShow || {}; return { ground: s.ground !== false, clr: s.clr !== false, hv: s.hv !== false, lv: s.lv !== false, earth: s.earth !== false, att: s.att !== false }; }

  /* plan tools: select, pan, measure, draw, fit */
  function plClick(id, e) {
    L.DomEvent.stopPropagation(e);
    if (planTool === 'pan' || planTool === 'draw' || planTool === 'rect' || planTool === 'lasso') return;
    if (planTool === 'poly') { lassoAdd(poleLL(id) || e.latlng); return; }
    if (planTool === 'measure') { var p = merged.poles[id], ll = p && (poleLatLng(p) || (p.gis && p.gis.lat != null ? L.latLng(p.gis.lat, p.gis.lng) : null)); measureAdd(ll || e.latlng); return; }
    select(id, addInfo(e));
  }
  function plSpan(a, b, e) { L.DomEvent.stopPropagation(e); if (planTool === 'poly') lassoAdd(e.latlng); else if (planTool === 'select') selectSpan(a, b); else if (planTool === 'measure') measureAdd(e.latlng); }
  function planMapClick(ll) {
    if (planTool === 'poly') { lassoAdd(ll); return; }
    if (planTool === 'rect' || planTool === 'lasso') return;
    if (planTool === 'measure') { measureAdd(ll); return; }
    if (planTool === 'draw') { var xy = fromLatLng(ll); setTool('select'); if (xy) openPoleDlg(null, { mode: 'coord', e: Math.round(xy.e * 100) / 100, n: Math.round(xy.n * 100) / 100 }); return; }
    if (planTool === 'pan') return;
    if (planTool === 'move') { movePoleTo(snapLL(ll)); return; }
    if (planTool === 'measure') return;
    select(null);
  }
  function measureAdd(ll) { if (!ll) return; measurePts.push(ll); drawMeasure(); }
  function drawMeasure() {
    if (!lyMeasure) lyMeasure = L.layerGroup().addTo(map);
    lyMeasure.clearLayers();
    if (measurePts.length > 1) L.polyline(measurePts, { color: '#0f766e', weight: 3, dashArray: '6 4', interactive: false }).addTo(lyMeasure);
    measurePts.forEach(function (ll) { L.circleMarker(ll, { radius: 4, color: '#0f766e', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(lyMeasure); });
    var xy = measurePts.map(fromLatLng), tot = 0, last = 0;
    for (var i = 1; i < xy.length; i++) if (xy[i] && xy[i - 1]) { last = Math.hypot(xy[i].e - xy[i - 1].e, xy[i].n - xy[i - 1].n); tot += last; }
    var out = $('measureOut'); out.hidden = planTool !== 'measure' && !measurePts.length;
    out.innerHTML = (measurePts.length < 2 ? 'Click points or poles on the plan to measure' : 'Total <b>' + tot.toFixed(1) + ' m</b>' + (measurePts.length > 2 ? ' · last segment ' + last.toFixed(1) + ' m' : '')) +
      (measurePts.length ? ' <button class="btn small" data-meas="undo">Undo point</button><button class="btn small" data-meas="clear">Clear</button>' : '');
  }
  function clearMeasure() { measurePts = []; if (lyMeasure) lyMeasure.clearLayers(); $('measureOut').hidden = true; }
  function setTool(t) {
    if (t === 'fit') { $('tbFit').click(); return; }
    planTool = t; var w = $('mapWrap'); w.className = w.className.replace(/\btool-\w+/g, '').trim() + ' tool-' + t;
    Array.prototype.forEach.call(document.querySelectorAll('#planTools [data-tool]'), function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    if (t === 'measure') drawMeasure(); else if (t !== 'measure') clearMeasure();
    lassoClear(); if (t === 'rect' || t === 'lasso') map.dragging.disable(); else map.dragging.enable(); if (t === 'poly') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (t === 'rect') setStatus('Box select: drag a rectangle on the plan. Every pole inside is selected (hold Shift to add to the selection).');
    if (t === 'lasso') setStatus('Lasso select: hold the mouse button and draw a loop around the poles. Release to select (hold Shift to add to the selection).');
    if (t === 'poly') setStatus('Polygon select: click the corners of a shape, then double-click, press Enter or click the first corner to finish. Esc cancels.');
    if (t === 'draw') setStatus('Draw: click the plan where the new pole goes.');
    if (t === 'move') setStatus('Move: select a hand-made pole, then click its new position.');
    try { updToolStatus(); } catch (e) { /* before the ribbon exists */ }
  }
  $('planTools').addEventListener('click', function (e) { var b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  /* box and shape selection: every pole inside the outline is selected (a span goes with its two poles) */
  var lassoPts = [], lyLasso = null, rectStart = null, rectAdd = false;
  function lassoLayer() { if (!lyLasso) lyLasso = L.layerGroup().addTo(map); return lyLasso; }
  function lassoClear() { lassoPts = []; rectStart = null; if (lyLasso) lyLasso.clearLayers(); }
  function lassoDraw(hover) {
    var g = lassoLayer(); g.clearLayers(); var pts = hover ? lassoPts.concat([hover]) : lassoPts;
    if (pts.length > 1) L.polygon(pts, { color: '#2563eb', weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(g);
    lassoPts.forEach(function (ll, i) { L.circleMarker(ll, { radius: i ? 3 : 5, color: '#2563eb', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(g); });
  }
  function lassoAdd(ll) {
    if (!ll) return;
    if (lassoPts.length > 2) { var a = map.latLngToContainerPoint(lassoPts[0]), b = map.latLngToContainerPoint(ll); if (a.distanceTo(b) < 10) { lassoFinish(); return; } }
    lassoPts.push(ll); lassoDraw();
  }
  function inPoly(pt, poly) { var x = pt.x, y = pt.y, c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
  function polesInside(poly) { return Object.keys(merged.poles).filter(function (id) { var ll = poleLL(id); return ll && inPoly(map.latLngToContainerPoint(ll), poly); }); }
  function selectArea(ids, add) {
    var base = add ? (S.multi && S.multi.length ? S.multi.slice() : (S.selected ? [S.selected] : [])) : [];
    ids.forEach(function (k) { if (base.indexOf(k) < 0) base.push(k); });
    lassoClear();
    if (!base.length) { select(null); setStatus('No poles inside the shape.', 'bad'); return; }
    if (base.length === 1) select(base[0]); else { S.multi = base; select(base[base.length - 1], { keepMulti: true }); }
    setStatus(base.length + ' pole' + (base.length === 1 ? '' : 's') + ' selected. Delete them, add them to a profile or make a profile from them in Properties.', 'good');
  }
  function lassoFinish() { if (lassoPts.length < 3) { lassoClear(); return; } var poly = lassoPts.map(function (ll) { return map.latLngToContainerPoint(ll); }); selectArea(polesInside(poly), multiMode || lassoAdd.shift); }
  map.on('mousemove', function (e) {
    if (planTool === 'poly' && lassoPts.length) lassoDraw(e.latlng);
    else if (planTool === 'rect' && rectStart) { var g = lassoLayer(); g.clearLayers(); L.rectangle(L.latLngBounds(rectStart, e.latlng), { color: '#2563eb', weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(g); }
  });
  map.on('mousedown', function (e) { if (planTool !== 'rect') return; var o = e.originalEvent; if (o && o.button) return; rectStart = e.latlng; rectAdd = !!(o && (o.shiftKey || o.ctrlKey || o.metaKey)); });
  map.on('mouseup', function (e) {
    if (planTool !== 'rect' || !rectStart) return;
    var a = map.latLngToContainerPoint(rectStart), b = map.latLngToContainerPoint(e.latlng); rectStart = null;
    if (a.distanceTo(b) < 4) { lassoClear(); return; }
    selectArea(polesInside([a, L.point(b.x, a.y), b, L.point(a.x, b.y)]), multiMode || rectAdd);
  });
  map.on('dblclick', function () { if (planTool === 'poly') { lassoPts.pop(); lassoFinish(); } });
  // Lasso: freehand loop while the button is held (pointer events, so it works with a pen or finger too).
  var lassoFree = null;
  map.getContainer().addEventListener('pointerdown', function (e) {
    if (planTool !== 'lasso' || e.button || e.target.closest('.leaflet-control')) return;
    lassoClear(); lassoFree = { add: !!(e.shiftKey || e.ctrlKey || e.metaKey), pts: [map.mouseEventToContainerPoint(e)] };
    try { map.getContainer().setPointerCapture(e.pointerId); } catch (er) { /* old browser */ }
    e.preventDefault(); e.stopPropagation();
  }, true);
  map.getContainer().addEventListener('pointermove', function (e) {
    if (!lassoFree) return; var p = map.mouseEventToContainerPoint(e), l = lassoFree.pts[lassoFree.pts.length - 1];
    if (p.distanceTo(l) < 3) return; lassoFree.pts.push(p);
    var g = lassoLayer(); g.clearLayers(); L.polygon(lassoFree.pts.map(function (q) { return map.containerPointToLatLng(q); }), { color: '#2563eb', weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(g);
  }, true);
  function lassoEnd(e) {
    if (!lassoFree) return; var f = lassoFree; lassoFree = null;
    if (f.pts.length < 3) { lassoClear(); return; }
    selectArea(polesInside(f.pts), f.add || lassoAdd.shift);
    if (e) e.stopPropagation();
  }
  map.getContainer().addEventListener('pointerup', lassoEnd, true);
  map.getContainer().addEventListener('pointercancel', function () { lassoFree = null; lassoClear(); }, true);
  document.addEventListener('keydown', function (e) {
    if (planTool !== 'poly' && planTool !== 'rect' && planTool !== 'lasso') return; if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('genDlg').hidden) return;
    if (e.key === 'Escape' && (lassoPts.length || rectStart || lassoFree)) { lassoFree = null; lassoClear(); e.stopPropagation(); }
    else if (e.key === 'Enter' && planTool === 'poly') lassoFinish();
    else if (e.key === 'Backspace' && lassoPts.length) { lassoPts.pop(); lassoDraw(); e.preventDefault(); }
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Shift') lassoAdd.shift = true; });
  document.addEventListener('keyup', function (e) { if (e.key === 'Shift') lassoAdd.shift = false; });
  $('measureOut').addEventListener('click', function (e) { var b = e.target.closest('[data-meas]'); if (!b) return; if (b.dataset.meas === 'clear') { clearMeasure(); if (planTool === 'measure') drawMeasure(); } else { measurePts.pop(); drawMeasure(); } });
  setTool('select');

  /* generic searchable pole picker and the span dialog */
  function pickPole(title, ids, cb, label) {
    openGen(title, '<div class="field"><label for="ppIn">' + (label || 'Pole') + ' (type to search)</label><input id="ppIn" list="ppList" autocomplete="off" placeholder="e.g. S100003"></div><datalist id="ppList">' + ids.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('') + '</datalist><p class="hint warn" id="ppMsg" hidden></p><div class="btnrow"><button class="btn primary" id="ppOk">Continue</button></div>', { narrow: true });
    var go = function () { var v = $('ppIn').value.trim().toLowerCase(), hit = ids.filter(function (k) { return k.toLowerCase() === v; })[0]; if (!hit) { $('ppMsg').hidden = false; $('ppMsg').textContent = '“' + $('ppIn').value + '” is not one of the ' + ids.length + ' poles available. Pick one from the list.'; return; } closeGen(); cb(hit); };
    $('ppOk').onclick = go; $('ppIn').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function openSpanDlg() {
    var ids = Object.keys(merged.poles).filter(function (k) { return poleXY(k); });
    if (ids.length < 2) { setStatus('Add at least two poles first (Add → Pole, or import a survey).', 'bad'); return; }
    var opts = ids.map(function (k) { return '<option value="' + esc(k) + '">'; }).join('');
    openGen('Add span', '<p class="hint">A span joins two poles in the active profile (“' + esc(prof().name || 'Profile ' + (S.active + 1)) + '”). If one pole is already in the profile the other is inserted next to it; if neither is, they start the profile.</p>' +
      '<div class="grid2"><div class="field"><label for="spA">From pole (type to search)</label><input id="spA" list="spList" autocomplete="off" value="' + esc(S.selected && poleXY(S.selected) ? S.selected : '') + '"></div><div class="field"><label for="spB">To pole (type to search)</label><input id="spB" list="spList" autocomplete="off"></div></div><datalist id="spList">' + opts + '</datalist>' +
      '<p class="hint" id="spInfo" hidden></p><p class="hint warn" id="spMsg" hidden></p><div class="btnrow"><button class="btn primary" id="spOk">Add span</button></div>');
    var find = function (v) { v = v.trim().toLowerCase(); return ids.filter(function (k) { return k.toLowerCase() === v; })[0]; };
    var upd = function () { var a = find($('spA').value), b = find($('spB').value), A = a && poleXY(a), B = b && poleXY(b); $('spInfo').hidden = !(A && B); if (A && B) $('spInfo').textContent = 'Span length ' + Math.hypot(A.e - B.e, A.n - B.n).toFixed(2) + ' m.'; };
    $('spA').oninput = $('spB').oninput = upd;
    $('spOk').onclick = function () {
      var a = find($('spA').value), b = find($('spB').value), m = $('spMsg'); m.hidden = false;
      if (!a || !b) { m.textContent = 'Pick both poles from the list.'; return; }
      if (a === b) { m.textContent = 'A span needs two different poles.'; return; }
      var p = prof(), ia = p.poleIds.indexOf(a), ib = p.poleIds.indexOf(b);
      if (ia >= 0 && ib >= 0) { if (Math.abs(ia - ib) !== 1) { m.textContent = 'Both poles are already in the profile but not next to each other. Reorder them in the Project panel.'; return; } }
      else if (ia >= 0) p.poleIds.splice(ia + 1, 0, b); else if (ib >= 0) p.poleIds.splice(ib, 0, a); else p.poleIds.push(a, b);
      S.generated = false; closeGen(); recompute(); selectSpan(a, b); setStatus('Span ' + a + ' → ' + b + ' is in the profile.', 'good');
    };
  }

  /* Add menu: conductor, transformer and stay act on the selected pole (or ask which one) */
  function addEquip(kind) {
    if (!project) { setStatus('Start a design first: drop a PNW project, or generate a ground profile and start the design.', 'bad'); return; }
    var ids = project.poles.map(function (r) { return r.ID; });
    var go = function (id) {
      if (kind === 'cond') { U.insTab = 'design'; U.right = true; applyLayout(); saveUi(); select(id); setTimeout(function () { var b = $('conAddBox'); if (b) { b.open = true; conDraft.open = true; b.scrollIntoView({ block: 'nearest' }); var f = b.querySelector('select,input'); if (f) f.focus(); } }, 40); return; }
      var cons = ((dm && dm.byPole[id]) || []).filter(function (c) { return c.kingbolt != null; });
      if (!cons.length) { U.insTab = 'design'; select(id); setStatus(id + ' has no construction yet. Add a conductor/construction first, then the ' + (kind === 'stay' ? 'stay' : 'transformer') + '.', 'bad'); return; }
      var list = kind === 'stay' ? extras(id).stays : extras(id).plant, n0 = list.length;
      U.insTab = 'equip'; U.right = true; applyLayout(); saveUi();
      addExtra(id, kind === 'stay' ? 'stay' : 'plant');
      S.selEquip = { pole: id, kind: kind, i: n0 }; select(id);
      setStatus((kind === 'stay' ? 'Stay' : 'Transformer') + ' added to ' + id + ' with defaults from the library. Check the values below: tipload is recalculated.', 'good');
    };
    if (S.selected && ids.indexOf(S.selected) >= 0) go(S.selected); else pickPole('Which pole?', ids, go);
  }
  $('aPole').onclick = function () { openPoleDlg(); };
  $('aSpan').onclick = openSpanDlg;
  $('aCond').onclick = function () { addEquip('cond'); };
  $('aTx').onclick = function () { addEquip('plant'); };
  $('aStay').onclick = function () { addEquip('stay'); };
  $('aX').onclick = function () { $('mNewX').click(); };

  /* navigation rail */
  function filesHub() {
    openFilesDlg();
    var row = document.createElement('div'); row.className = 'btnrow'; row.style.margin = '0 0 10px';
    row.innerHTML = [['tbOpen', '📂 Open project…'], ['tbSave', '💾 Save project'], ['tbExport', '⬇ Export PNW files…'], ['mExpTip', '⇲ Tipload CSV…'], ['mExpLog', '🧾 Change log']].map(function (x) { return '<button class="btn" data-fa="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    row.addEventListener('click', function (e) { var b = e.target.closest('[data-fa]'); if (!b) return; var t = $(b.dataset.fa); if (!b.dataset.keep) closeGen(); t.click(); });
    $('genBody').insertBefore(row, $('genBody').firstChild);
  }
  $('rqGrid').addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (b && !b.disabled) $(b.dataset.q).click(); });
  $('rqToggle').onclick = function () { var q = $('railQuick'), m = !q.classList.contains('min'); q.classList.toggle('min', m); this.setAttribute('aria-expanded', !m); this.querySelector('span').textContent = m ? '▾' : '▴'; };
  function navGo(k) {
    if (k === 'home') { select(null); setStatus(summaryText()); }
    else if (k === 'project') { U.left = !U.left || !$('secProfile').open ? true : false; applyLayout(); if (U.left) $('secProfile').open = true; }
    else if (k === 'plan') setView('plan');
    else if (k === 'profile') setView('profile');
    else if (k === 'sag') { openTab('sections'); setAn('sag', true); }
    else if (k === 'tip') $('tbTip').click();
    else if (k === 'reports') $('tbExport').click();
    else if (k === 'import') { openFilesDlg(); }
    else if (k === 'export') filesHub();
    else if (k === 'files') { /* toggles the sub-list */ }
    else if (k === 'settings') { U.left = true; applyLayout(); $('secProject').open = true; $('secProject').scrollIntoView({ block: 'nearest' }); }
    markRail();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#rail [data-nav]'), function (b) { b.onclick = function () { navGo(b.dataset.nav); }; });
  function markRail() { Array.prototype.forEach.call(document.querySelectorAll('#rail [data-nav]'), function (b) { var k = b.dataset.nav, on = (k === 'plan' && (S.view === 'plan' || S.view === 'split' && false)) || (k === 'profile' && S.view === 'profile') || (k === 'sag' && tab === 'sections' && U.anOpen && U.an === 'sag'); b.classList.toggle('on', on); }); }

  /* analysis workspace under the plan */
  function setAn(t, open) { U.an = t; if (open) U.anOpen = true; saveUi(); renderAnalysis(); }
  function placeProfile() {
    var box = $('profileView'), dock = U.anOpen && U.an === 'profile' && S.view !== 'profile' && S.view !== 'split';
    if (dock) { if (box.parentNode !== $('anBody')) { $('anBody').innerHTML = ''; $('anBody').appendChild(box); } box.classList.add('docked'); }
    else { if (box.parentNode !== $('stage')) $('stage').appendChild(box); box.classList.remove('docked'); }
    return dock;
  }
  function groundTable() {
    var rows = dm && dm.allPoles.length ? dm.allPoles.map(function (p) { return { id: p.id, ch: p.chainage, z: p.ground, len: p.length, h: p.height, sunk: p.sunk }; }) : built ? built.rows.map(function (r) { return { id: r.id, ch: r.chainage, z: r.elevation, len: r.length, h: r.height, sunk: r.sunk }; }) : [];
    if (!rows.length) return '<p class="anmsg">No ground profile yet. Add poles to the active profile (select a pole on the plan, then Add to profile).</p>';
    return '<table class="grid"><thead><tr><th>Pole</th><th class="num">Chainage (m)</th><th class="num">Ground level (m)</th><th class="num">Span back (m)</th><th class="num">Pole length (m)</th><th class="num">Above ground (m)</th><th class="num">Setting depth (m)</th></tr></thead><tbody>' + rows.map(function (r, i) {
      return '<tr data-id="' + esc(r.id) + '" class="' + (isSel(r.id) ? 'sel' : '') + '"><td><b>' + esc(r.id) + '</b></td><td class="num">' + f2(r.ch) + '</td><td class="num">' + f2(r.z) + '</td><td class="num">' + (i ? f2(r.ch - rows[i - 1].ch) : '') + '</td><td class="num">' + f2(r.len, 1) + '</td><td class="num">' + f2(r.h, 2) + '</td><td class="num">' + f2(r.sunk, 2) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function groundAtFn() {
    var g = project && project.ground ? project.ground.map(function (q) { return { c: PNW.num(q.Chainage), z: PNW.num(q.Level) }; }).filter(function (q) { return isFinite(q.c) && isFinite(q.z); }) : [];
    if (g.length < 2 && built && built.ground && built.ground.length) g = PNW.groundSeq(built).filter(function (r) { return r.chainage != null && isFinite(r.elevation); }).map(function (r) { return { c: r.chainage, z: r.elevation }; });
    return g.length < 2 ? null : function (c) { for (var i = 1; i < g.length; i++) if (g[i].c >= c) { var a = g[i - 1], b = g[i], t = b.c === a.c ? 0 : (c - a.c) / (b.c - a.c); return a.z + (b.z - a.z) * Math.max(0, Math.min(1, t)); } return g[g.length - 1].z; };
  }
  function spanWires(a, b) { return dm ? dm.wires.filter(function (w) { return (w.from.pole === a && w.to.pole === b) || (w.from.pole === b && w.to.pole === a); }) : []; }
  // Lowest conductor point above the ground in a span: {clr, e, n, z, code}. Ground from the profile, else straight between the poles.
  function spanLowest(a, b, seg) {
    var gz = groundAtFn(), ws = spanWires(a, b).filter(function (w) { return !seg || w.segment === seg; }), best = null; if (!ws.length) return null;
    var gp = function (id) { var p = dm && (dm.allPoles || dm.poles).filter(function (q) { return q.id === id; })[0]; return p ? p.ground : null; };
    ws.forEach(function (w) {
      var c0 = chainOfPole(w.from.pole), c1 = chainOfPole(w.to.pole), g0 = gp(w.from.pole), g1 = gp(w.to.pole);
      if (gz ? c0 == null || c1 == null : g0 == null || g1 == null) return;
      for (var k = 0; k <= 24; k++) {
        var t = k / 24, z = w.from.elevation + (w.to.elevation - w.from.elevation) * t - (w.sag ? 4 * w.sag * t * (1 - t) : 0), c = z - (gz ? gz(c0 + (c1 - c0) * t) : g0 + (g1 - g0) * t);
        if (isFinite(c) && (!best || c < best.clr)) best = { clr: c, z: z, code: w.code || w.conductor || '', e: w.from.easting + (w.to.easting - w.from.easting) * t, n: w.from.northing + (w.to.northing - w.from.northing) * t };
      }
    });
    return best;
  }
  function spanClearance(a, b) { var r = spanLowest(a, b); return r ? r.clr : null; }
  // 3D: clicking a conductor shows its ground clearance (lowest point of that conductor in the span above the ground).
  var clr3d = null;
  function show3dClr() { if (!window.PNW3D || !window.PNW3D.clearance) return; var r = clr3d ? spanLowest(clr3d[0], clr3d[1], clr3d[2]) : null; window.PNW3D.clearance(r ? Object.assign(r, { text: 'Ground clearance ' + r.clr.toFixed(2) + ' m' + (r.code ? ' (' + r.code + ')' : '') }) : null); }
  function spanList() {
    var ids = lineIds(), out = [];
    for (var i = 1; i < ids.length; i++) {
      var a = ids[i - 1], b = ids[i], A = poleXY(a), B = poleXY(b), ws = spanWires(a, b), cs = {}, mx = null;
      ws.forEach(function (w) { cs[w.conductor] = 1; if (w.sag != null && (mx == null || w.sag > mx)) mx = w.sag; });
      var ca = chainOfPole(a), cb = chainOfPole(b);
      out.push({ a: a, b: b, len: A && B ? Math.hypot(A.e - B.e, A.n - B.n) : ca != null && cb != null ? Math.abs(cb - ca) : null, conds: Object.keys(cs), sag: mx, clr: spanClearance(a, b), sections: ws.map(function (w) { return w.segment; }).filter(function (v, k, ar) { return ar.indexOf(v) === k; }) });
    }
    return out;
  }
  function spanTable() {
    var L0 = spanList(); if (!L0.length) return '<p class="anmsg">No spans yet: a profile needs at least two poles.</p>';
    return '<table class="grid"><thead><tr><th>#</th><th>From</th><th>To</th><th class="num">Length (m)</th><th>Conductors</th><th class="num">Max sag (m)</th><th class="num">Min ground clearance (m)</th><th></th></tr></thead><tbody>' + L0.map(function (s, i) {
      var on = S.selSpan && !S.selected && ((S.selSpan.a === s.a && S.selSpan.b === s.b) || (S.selSpan.a === s.b && S.selSpan.b === s.a));
      return '<tr data-span="' + esc(s.a) + '|' + esc(s.b) + '" class="' + (on ? 'sel' : '') + '"><td>' + (i + 1) + '</td><td><b>' + esc(s.a) + '</b></td><td><b>' + esc(s.b) + '</b></td><td class="num">' + f2(s.len) + '</td><td>' + (s.conds.length ? esc(s.conds.join(', ')) : '<span class="muted">none strung</span>') + '</td><td class="num">' + f2(s.sag) + '</td><td class="num">' + f2(s.clr) + '</td><td><button class="btn small ghost" data-spdel="' + esc(s.a) + '|' + esc(s.b) + '" title="Delete span ' + esc(s.a) + ' → ' + esc(s.b) + '">🗑</button></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function sectionRows() {
    if (!project || !dm) return [];
    return project.segments.map(function (sg) {
      var n = sg.StrainSect, ws = dm.wires.filter(function (w) { return w.segment === n; }), sp = ws.filter(function (w) { return w.phase === 1; }).map(function (w) { return w.span; }), mx = null, src = '';
      ws.forEach(function (w) { if (w.sag != null && (mx == null || w.sag > mx)) { mx = w.sag; src = w.sagSource || ''; } });
      return { name: n, conductor: sg.Conductor, tension: sg.Tension + ' ' + (sg.TensionUnits || ''), spans: sp.length, ruling: sp.length ? M.rulingSpan(sp) : null, max: mx, src: src, first: ws[0] ? ws[0].from.pole : null };
    });
  }
  function calcTable() {
    var rows = sectionRows(); if (!rows.length) return '<p class="anmsg">' + (project ? 'No strain sections yet. String a conductor in the Conductor schedule.' : 'Sag and tension need a design: link a PNW project or start one from the ground profile.') + '</p>';
    return '<table class="grid"><thead><tr><th>Section</th><th>Conductor</th><th class="num">Tension</th><th class="num">Spans</th><th class="num">Ruling span (m)</th><th class="num">Max sag (m)</th><th>Sag source</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr data-csec="' + esc(r.name) + '" data-cpole="' + esc(r.first || '') + '" class="' + (S.selSection === r.name ? 'sel' : '') + '"><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.conductor) + '</td><td class="num">' + esc(r.tension) + '</td><td class="num">' + r.spans + '</td><td class="num">' + f2(r.ruling, 1) + '</td><td class="num">' + f2(r.max) + '</td><td>' + esc(r.src) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function tipsumTable() {
    if (!project || !dm) return '<p class="anmsg">Tipload needs a design: link a PNW project or start one from the ground profile.</p>';
    if (!tipSet().cases.length) return '<p class="anmsg">Enter the load combinations in Tipload (Tipload in the navigation) to see results here.</p>';
    var ids = tipPoles().filter(function (k) { return !/^tip:/.test(k); }); if (!ids.length) return '<p class="anmsg">No poles with a length yet.</p>';
    return '<table class="grid"><thead><tr><th>Pole</th><th>Worst load case</th><th class="num">Load (kN)</th><th class="num">Direction (°)</th><th class="num">% of strength</th><th>Result</th><th>Status</th></tr></thead><tbody>' + ids.map(function (id) {
      var r = null; try { r = tipCalc(id); } catch (e) { r = null; }
      if (!r || !r.results.length) return '<tr data-id="' + esc(id) + '" class="' + (isSel(id) ? 'sel' : '') + '"><td><b>' + esc(id) + '</b></td><td colspan="6" class="muted">Not calculated (see the pole’s Loading section)</td></tr>';
      var w = r.results.slice().sort(function (a, b) { return (b.pctHor != null ? b.pctHor : b.load) - (a.pctHor != null ? a.pctHor : a.load); })[0];
      return '<tr data-id="' + esc(id) + '" class="' + (isSel(id) ? 'sel' : '') + '"><td><b>' + esc(id) + '</b></td><td>' + esc(w.name) + '</td><td class="num">' + f2(w.load) + '</td><td class="num">' + f2(w.dir, 0) + '</td><td class="num">' + (w.pctHor != null ? f2(w.pctHor, 0) : '–') + '</td><td>' + tipBadge(r.results.some(function (x) { return x.pass === false; }) ? { pass: false } : w) + '</td><td>' + (unverifiedFor(id) ? '<span class="pill unv">provisional</span>' : '<span class="pill ok">current</span>') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function calcSummaryHtml() {
    var errs = allIssues.filter(function (i) { return i.level === 'error'; }).length, warns = allIssues.filter(function (i) { return i.level === 'warning'; }).length, unv = 0;
    if (dm) dm.allPoles.forEach(function (p) { try { if (unverifiedFor(p.id)) unv++; } catch (e) { /* ignore */ } });
    var secs = sectionRows(), tl = 0, fail = 0;
    if (project && dm && tipSet().cases.length) tipPoles().filter(function (k) { return !/^tip:/.test(k); }).forEach(function (id) { try { var r = tipCalc(id); if (r && r.results.length) { tl++; if (r.results.some(function (x) { return x.pass === false; })) fail++; } } catch (e) { /* ignore */ } });
    var t = function (k, v, c) { return '<div class="fact ' + (c || '') + '"><small>' + k + '</small><b>' + v + '</b></div>'; };
    return '<div class="calcsum">' + t('Poles in profile', (dm ? dm.allPoles.length : prof().poleIds.length)) + t('Spans', spanList().length) + t('Strain sections', secs.length) + t('Max sag (m)', f2(secs.reduce(function (m, r) { return r.max != null && r.max > m ? r.max : m; }, 0) || null)) +
      t('Tipload checked', tl) + t('Tipload fails', fail, fail ? 'bad' : '') + t('Errors', errs, errs ? 'bad' : '') + t('Warnings', warns, warns ? 'warn' : '') + t('Provisional poles', unv, unv ? 'warn' : '') + '</div>' +
      '<p class="meta" style="padding:0 12px">' + (calcAt ? 'Last calculated ' + hhmmss(calcAt) + '. ' : '') + 'Sag uses ' + esc(({ auto: 'DCSH tables, else w·L²/8T', none: 'no sag', dcsh: 'DCSH Part 10 tables', illustrative: 'illustrative w·L²/8T' })[S.sagMode || 'auto']) + ' at ' + esc(S.sagTemp || 15) + ' °C. Every edit recalculates sag, tension and tipload for the affected poles and spans.</p>';
  }
  function sagDetail() {
    if (!dm || !dm.wires.length) return '<p class="anmsg">' + (project ? 'No conductors are strung yet.' : 'Sag needs a design: link a PNW project or start one from the ground profile.') + '</p>';
    var by = {}; dm.wires.forEach(function (w) { var k = w.segment + '|' + w.from.pole + '|' + w.to.pole; if (!by[k]) by[k] = { w: w, n: 0, mx: null }; by[k].n++; if (w.sag != null && (by[k].mx == null || w.sag > by[k].mx)) by[k].mx = w.sag; });
    return '<table class="grid"><thead><tr><th>Section</th><th>From</th><th>To</th><th>Conductor</th><th class="num">Wires</th><th class="num">Span (m)</th><th class="num">Sag (m)</th><th>Source</th></tr></thead><tbody>' + Object.keys(by).map(function (k) {
      var x = by[k], w = x.w, on = S.selSpan && !S.selected && S.selSpan.a === w.from.pole && S.selSpan.b === w.to.pole;
      return '<tr data-span="' + esc(w.from.pole) + '|' + esc(w.to.pole) + '" class="' + (on || S.selSection === w.segment && isSel(w.from.pole) ? 'sel' : '') + '"><td><b>' + esc(w.segment) + '</b></td><td>' + esc(w.from.pole) + '</td><td>' + esc(w.to.pole) + '</td><td>' + esc(w.conductor) + '</td><td class="num">' + x.n + '</td><td class="num">' + f2(w.span) + '</td><td class="num">' + f2(x.mx) + '</td><td class="sagsrc">' + esc(w.sagSource || '') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function renderAnalysis() {
    var a = $('analysis'); if (!a) return;
    var docked = placeProfile(), main = S.view === 'profile' || S.view === 'split', an = main && U.an === 'profile' ? 'ground' : U.an, open = U.anOpen && !(main && U.an === 'profile');
    a.classList.toggle('min', !open); a.style.setProperty('--ah', U.ah + 'px'); $('anMin').textContent = open ? '▾' : '▴';
    Array.prototype.forEach.call(a.querySelectorAll('[data-an]'), function (b) { var on = b.dataset.an === an && open; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); if (b.dataset.an === 'profile') b.hidden = main; });
    if (!open) { markRail(); return; }
    var body = $('anBody');
    if (docked) { renderProfileView(); }
    else if (an === 'ground') body.innerHTML = '<div class="tablewrap">' + groundTable() + '</div>';
    else if (an === 'sag') body.innerHTML = '<div class="tablewrap">' + sagDetail() + '</div>';
    else body.innerHTML = calcSummaryHtml();
    markRail(); if ($('anCtl')) syncAnCtl();
  }
  $('analysis').querySelector('.antabs').addEventListener('click', function (e) { var b = e.target.closest('[data-an]'); if (b) { U.an = b.dataset.an; U.anOpen = true; saveUi(); renderAnalysis(); } });
  $('anMin').onclick = function () { if ((S.view === 'profile' || S.view === 'split') && U.an === 'profile') { U.an = 'ground'; U.anOpen = true; } else U.anOpen = !U.anOpen; saveUi(); renderAnalysis(); setTimeout(function () { if (map && map.invalidateSize) map.invalidateSize(); }, 30); };
  (function () {
    var r = $('anRes'), drag = null;
    r.addEventListener('pointerdown', function (e) { drag = { y: e.clientY, h: U.ah }; r.setPointerCapture && r.setPointerCapture(e.pointerId); e.preventDefault(); });
    r.addEventListener('pointermove', function (e) { if (!drag) return; U.ah = Math.max(120, Math.min(window.innerHeight * 0.7, drag.h + (drag.y - e.clientY))); $('analysis').style.setProperty('--ah', U.ah + 'px'); });
    r.addEventListener('pointerup', function () { if (!drag) return; drag = null; saveUi(); if (map && map.invalidateSize) map.invalidateSize(); if ($('profileView').classList.contains('docked')) renderProfileView(); });
  })();

  /* profile toolbar: layer toggles and profile switcher */
  (function () {
    var t = $('pvTools');
    t.insertAdjacentHTML('beforeend', '<select id="pvProf" class="btn small" aria-label="Active profile" title="Switch profile without leaving the view"></select><span class="seg pvtog" role="group" aria-label="Profile layers"><button class="btn small on" data-pvt="ground" title="Ground profile (terrain)">Ground</button><button class="btn small on" data-pvt="clr" title="Clearance line above the ground">Clearance</button><button class="btn small on" data-pvt="hv" title="HV conductors">HV</button><button class="btn small on" data-pvt="lv" title="LV conductors">LV</button><button class="btn small on" data-pvt="earth" title="Earth wire">Earth</button><button class="btn small on" data-pvt="att" title="Attachment points and heights">Attach.</button></span>');
    t.addEventListener('click', function (e) { var b = e.target.closest('[data-pvt]'); if (!b) return; var s = U.pvShow = U.pvShow || {}, k = b.dataset.pvt; s[k] = s[k] === false; saveUi(); syncPvTools(); renderProfileView(); });
    $('pvProf').onchange = function () { switchProfile(this.value); };
    $('anMin').parentNode.insertAdjacentHTML('afterbegin', '<span id="anPv" class="seg" hidden><button data-anpv="out" title="Zoom out" aria-label="Zoom out">−</button><button data-anpv="in" title="Zoom in" aria-label="Zoom in">＋</button><button data-anpv="fit" title="Fit the whole profile">⤢ Fit</button></span>');
    $('anPv').addEventListener('click', function (e) { var b = e.target.closest('[data-anpv]'); if (!b) return; if (b.dataset.anpv === 'fit') pvFit(); else pvZoom(b.dataset.anpv === 'in' ? 0.7 : 1 / 0.7); });
  })();
  function syncPvTools() {
    var s = pvShow(); Array.prototype.forEach.call(document.querySelectorAll('[data-pvt]'), function (b) { b.classList.toggle('on', s[b.dataset.pvt]); b.setAttribute('aria-pressed', s[b.dataset.pvt]); });
    $('pvProf').innerHTML = S.profiles.map(function (p, i) { return '<option value="' + i + '"' + (i === S.active ? ' selected' : '') + '>' + esc(p.name || 'Profile ' + (i + 1)) + '</option>'; }).join('');
    $('pvProf').hidden = S.profiles.length < 2;
  }

  /* selection panel pieces */
  function loadPane(id) {
    if (!project || !dm) return startDesignHint();
    if (!tipSet().cases.length) return '<p class="hint">Enter the load combinations in Tipload to see the loading on ' + esc(id) + '.</p><div class="btnrow"><button class="btn small" data-tipopen="' + esc(id) + '">Open tipload</button></div>';
    var h = tipSummaryHtml(id);
    return (h || '<p class="hint">No tipload for ' + esc(id) + ' yet: it needs a pole length and a construction.</p>') + (calcAt ? '<p class="meta">Calculated ' + hhmmss(calcAt) + '. Edits to this pole or its spans recalculate it.</p>' : '');
  }
  function conductorPane(n) {
    var sg = project && project.segments.filter(function (x) { return x.StrainSect === n; })[0];
    if (!sg) return '<p class="hint">Strain section ' + esc(n) + ' is not in the linked project.</p>';
    var cd = conductorFor(sg.Conductor), ws = dm ? dm.wires.filter(function (w) { return w.segment === n; }) : [], p1 = ws.filter(function (w) { return w.phase === 1; }), sp = p1.map(function (w) { return w.span; }), mx = null;
    ws.forEach(function (w) { if (w.sag != null && (mx == null || w.sag > mx)) mx = w.sag; });
    var h = '<div class="facts">' + fact('Conductor', sg.Conductor) + fact('Tension', sg.Tension + ' ' + (sg.TensionUnits || '')) + fact('Spans', sp.length) + fact('Ruling span (m)', sp.length ? M.rulingSpan(sp).toFixed(1) : '') + fact('Max sag (m)', mx != null ? mx.toFixed(2) : '') + fact('Temperature (°C)', S.sagMode === 'none' || S.sagMode === 'illustrative' ? '–' : (S.sagTemp || 15), '', 'Set in Display: sag and temperature') + '</div>';
    h += '<div class="row2"><div class="field"><label for="ctn">Tension</label><input id="ctn" data-ctn="' + esc(n) + '" value="' + esc(sg.Tension) + '" inputmode="decimal"></div><div class="field"><label for="ctu">Units</label><select id="ctu" data-ctu="' + esc(n) + '"><option' + (sg.TensionUnits === '%CBL' ? ' selected' : '') + '>%CBL</option><option' + (sg.TensionUnits === 'kN' ? ' selected' : '') + '>kN</option></select></div></div>';
    if (cd) { var skip = { weight_per_m: 0 }, rows = Object.keys(cd).filter(function (k) { return cd[k] != null && cd[k] !== '' && typeof cd[k] !== 'object' && String(cd[k]).length < 90; }).slice(0, 12); h += '<h3 class="sub xinfo" style="margin-top:6px">Specification</h3><table class="props xinfo">' + rows.map(function (k) { return '<tr><th>' + esc(k) + '</th><td>' + esc(cd[k]) + '</td></tr>'; }).join('') + '</table>'; }
    else h += '<p class="hint warn">' + esc(sg.Conductor) + ' is not in the PNW library tables, so it has no properties here.</p>';
    var cases = tipSet().cases; h += '<h3 class="sub xinfo" style="margin-top:8px">Loading conditions</h3><p class="meta">' + (cases.length ? cases.map(function (c) { return esc(c.name); }).join(' · ') : 'No tipload load combinations entered yet.') + '</p>';
    var by = {}; p1.forEach(function (w) { by[w.from.pole + '|' + w.to.pole] = w; });
    h += '<h3 class="sub" style="margin-top:8px">Sag by span</h3><table class="att"><tr><th>Span</th><th class="num">Length (m)</th><th class="num">Sag (m)</th></tr>' + Object.keys(by).map(function (k) { var w = by[k]; return '<tr data-span="' + esc(k) + '" style="cursor:pointer" title="' + esc(w.sagSource || '') + '"><td>' + esc(w.from.pole) + ' → ' + esc(w.to.pole) + '</td><td class="num">' + w.span.toFixed(2) + '</td><td class="num">' + (w.sag != null ? w.sag.toFixed(2) : '–') + '</td></tr>'; }).join('') + '</table>';
    h += '<div class="btnrow"><button class="btn small" data-wb="recalc">⟳ Recalculate</button><button class="btn small" data-secshow="' + esc(n) + '">Highlight in 3D</button><button class="btn small" data-gotab="sections">Conductor schedule</button><button class="btn small" data-wb="unsec">Done</button></div>';
    return h;
  }
  function multiPane() {
    var ids = S.multi.slice(), p = prof(), inP = ids.filter(function (k) { return p.poleIds.indexOf(k) >= 0; }), dsg = project ? ids.filter(function (k) { return project.poles.some(function (r) { return r.ID === k; }); }) : [];
    var chs = ids.map(chainOfPole).filter(function (v) { return v != null; });
    var h = '<div class="inspane"><div class="ins-title"><b>' + ids.length + ' poles selected</b><span class="pill info">Bulk edit</span>' + binBtn('data-wb="mdel"', 'Delete the selected poles') + '</div><div class="facts">' + fact('Selected', ids.length) + fact('In profile', inP.length + ' of ' + ids.length) + fact('Design poles', dsg.length) + (chs.length > 1 ? fact('Chainage span (m)', (Math.max.apply(null, chs) - Math.min.apply(null, chs)).toFixed(1)) : '') + '</div>';
    h += '<div class="chipsel">' + ids.map(function (k) { return '<button data-pick="' + esc(k) + '" title="Select only ' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>';
    h += '<h3 class="sub">Profile</h3><div class="bulk"><button class="btn small" data-wb="madd"' + (inP.length === ids.length ? ' disabled' : '') + '>Add all to profile</button><button class="btn small" data-wb="mrem"' + (inP.length ? '' : ' disabled') + '>Remove from profile</button><button class="btn small" data-wb="mzoom">⌖ Zoom to selection</button><button class="btn small" data-wb="mprof" title="A new profile (PNW line) from these poles; a pole shared with another profile is a tee-off">＋ Create profile</button></div>';
    h += '<h3 class="sub">Pole length</h3><div class="bulk"><div class="field"><input id="bkLen" inputmode="decimal" placeholder="m" style="width:80px" aria-label="New pole length for all selected poles in the profile"></div><button class="btn small" data-wb="mlen"' + (inP.length ? '' : ' disabled title="Only poles in the profile have a length"') + '>Set length on ' + inP.length + ' pole' + (inP.length === 1 ? '' : 's') + '</button></div>';
    h += '<h3 class="sub">Design</h3><div class="bulk"><button class="btn small" data-wb="mstay"' + (dsg.length ? '' : ' disabled title="Needs poles in the linked design"') + '>＋ Stay on each</button><button class="btn small" data-wb="mver"' + (dsg.length ? '' : ' disabled') + ' title="Mark photo-derived changes on these poles as verified in the field">✓ Mark verified</button><button class="btn small" data-wb="mtip">⇲ Tipload</button></div>';
    h += '<p class="hint">Shift- or Ctrl-click poles on the plan, profile or in the tables to add or remove them. Click a pole name above to work on it alone.</p><div class="btnrow"><button class="btn small" data-ctx="clear">Clear selection</button></div></div>';
    return h;
  }
  // Pole inspector sections: one flat list (no tabs). Constructions and a selected conductor open by default; the rest open on request.
  var GROUPS = [['config', 'Pole', []]], SEC_DEFAULT = { design: true, cond: true, photo: true };
  var lastReq = null, secScroll = null;
  function secKey(k) { return k === 'conductors' || k === 'attach' || k === 'load' ? 'design' : k; }
  function accOpenNow(key) { var o = U.accOpen = U.accOpen || {}; return o[key] === undefined ? !!SEC_DEFAULT[key] : !!o[key]; }
  function openSection(key) { key = secKey(key); U.accOpen = U.accOpen || {}; U.accOpen[key] = true; U.insTab = key; lastReq = key; secScroll = key; }
  function secHtml(secs, panes) {
    if (U.insTab && U.insTab !== lastReq && U.insTab !== 'pole') openSection(U.insTab); else lastReq = U.insTab;
    return '<div class="acc">' + secs.map(function (s) {
      var k = s[0], on = accOpenNow(k), badge = s[2] ? ' <span class="pill ' + (k === 'checks' ? 'warn' : 'mute') + '">' + s[2] + '</span>' : '', sub = s[3] ? '<small class="pd-sub">' + s[3] + '</small>' : '';
      return '<div class="accs' + (on ? ' open' : '') + (k === 'cond' ? ' cond' : '') + '" data-pdsec="' + k + '"><button class="acch" data-instab="' + k + '" aria-expanded="' + on + '">' + s[1] + badge + sub + '</button>' + (on ? '<div class="inspane">' + panes(k) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  $('selected').addEventListener('click', function (e) { var g = e.target.closest('[data-insgroup]'); if (g) { U.insGroup = g.dataset.insgroup; saveUi(); renderSelected(); } });
  $('insNewProf').onclick = function () { $('newProfile').click(); };
  function postSelected() {
    var eq = S.selEquip && S.selEquip.pole === S.selected ? S.selEquip : null, any = false;
    Array.prototype.forEach.call($('selected').querySelectorAll('.xrow'), function (r) {
      var f = r.querySelector('[data-xf]'); if (!f || !/^(stays|plant)\|/.test(f.dataset.xf)) return;
      var k = f.dataset.xf.split('|'); r.dataset.eq = k[0] + '|' + k[1]; r.title = 'Click the name to select only this item';
      var on = eq && ((k[0] === 'stays') === (eq.kind === 'stay')) && +k[1] === eq.i; if (eq) { r.hidden = !on; if (on) any = true; }
    });
    if (eq && any) { var first = $('selected').querySelector('.xrow:not([hidden])'); first.insertAdjacentHTML('beforebegin', '<p class="meta"><b>' + (eq.kind === 'stay' ? 'Stay' : 'Transformer') + ' selected</b> · only its properties are shown. <button class="btn small" data-wb="eqall">Show all equipment</button></p>'); }
    else if (eq && !any) S.selEquip = null;
    renderStatusBar();
  }
  function renderStatusBar() {
    var bar = $('sbDyn'); if (!bar) return;
    var errs = allIssues.filter(function (i) { return i.level === 'error'; }).length, warns = allIssues.filter(function (i) { return i.level === 'warning'; }).length, unv = 0;
    if (dm) dm.allPoles.forEach(function (p) { try { if (unverifiedFor(p.id)) unv++; } catch (e) { /* ignore */ } });
    var h = !dm ? '<span class="sb"><span class="dot mute"></span>No design linked: sag, tension and tipload need a PNW project</span>' : '<span class="sb"><span class="dot' + (errs ? ' bad' : warns || unv ? ' warn' : '') + '"></span>Calculations ' + (errs ? 'have errors' : unv ? 'provisional' : 'up to date') + (calcAt ? ' · ' + hhmmss(calcAt) : '') + ' · ' + dm.allPoles.length + ' poles · ' + (project ? project.segments.length : 0) + ' sections</span>';
    h += errs || warns ? '<button class="sb" data-sb="issues" title="Show the issues">' + errs + ' error' + (errs === 1 ? '' : 's') + ' · ' + warns + ' warning' + (warns === 1 ? '' : 's') + '</button>' : '<span class="sb">No issues</span>';
    if (unv) h += '<span class="sb" title="Photo or AI-derived changes that have not been verified in the field">⚠ ' + unv + ' pole' + (unv === 1 ? '' : 's') + ' with unverified photo changes</span>';
    var selTxt = S.multi && S.multi.length > 1 ? S.multi.length + ' poles selected' : S.selSpan && !S.selected ? 'Span ' + S.selSpan.a + ' → ' + S.selSpan.b : S.selected ? 'Pole ' + S.selected + (S.selSection ? ' · conductor ' + S.selSection : '') : 'Nothing selected';
    h += '<span class="sb">⌖ ' + esc(selTxt) + '</span><span class="grow"></span>';
    h += dirty ? '<button class="sb" data-sb="save" title="Your work is kept in this browser automatically. Save a project file to keep a copy.">● Unsaved changes: save project file</button>' : '<span class="sb">✓ Saved</span>';
    bar.innerHTML = h;
  }
  $('statusBar').addEventListener('click', function (e) { var b = e.target.closest('[data-sb]'); if (!b) return; if (b.dataset.sb === 'issues') $('tbIssues').click(); else $('tbSave').click(); });
  function syncHeader() {
    var sel = $('projTitle'); setTimeout(function () { var o = sel.options[sel.selectedIndex]; sel.title = o ? o.textContent : ''; }, 0); sel.innerHTML = S.profiles.map(function (p, i) { return '<option value="' + i + '"' + (i === S.active ? ' selected' : '') + '>' + esc(p.name || 'Profile ' + (i + 1)) + '</option>'; }).join('');
    var opts = Object.keys(merged.poles).map(function (k) { return '<option value="' + esc(k) + '">'; });
    var ids = lineIds(); for (var i = 1; i < ids.length; i++) opts.push('<option value="' + esc(ids[i - 1] + ' → ' + ids[i]) + '">');
    allCommands().forEach(function (c) { opts.push('<option value="' + esc(c.name) + '">Command</option>'); });
  }
  $('projTitle').onchange = function () { switchProfile(this.value); };
  function gsGo(v) {
    var self = $('gsearch'); v = String(v || '').trim(); var lo = v.toLowerCase(), pid = Object.keys(merged.poles).filter(function (k) { return k.toLowerCase() === lo; })[0];
    if (pid) { select(pid); showPole(pid); self.value = ''; return; }
    var near = lo ? smartRank(v, Object.keys(merged.poles).sort(), function (k) { var p = merged.poles[k]; return k + ' ' + (p.survey ? p.survey.equipNo : '') + ' ' + (p.gis ? p.gis.equipNo : ''); }) : [];
    if (near.length) { select(near[0]); showPole(near[0]); self.value = ''; if (near.length > 1) setStatus(near.length + ' poles match “' + v + '”: ' + near.slice(0, 6).join(', ') + (near.length > 6 ? '…' : '') + '. Showing ' + near[0] + '.'); return; }
    var cmd = lo ? allCommands().filter(function (c) { return c.name.toLowerCase() === lo; })[0] || smartRank(v, allCommands(), function (c) { return c.name + ' ' + c.id; })[0] : null;
    if (cmd) { self.value = ''; if (cmd.type === 'fn') { if (FN[cmd.id]) FN[cmd.id](); } else if (cmd.type === 'tool') setTool(cmd.id); else { var ce = $(cmd.id.replace(/^pan:/, '')); if (ce) ce.click(); } return; }
    var m = v.split(/\s*(?:→|->|>|\|)\s*/); if (m.length === 2 && poleXY(m[0]) && poleXY(m[1])) { selectSpan(m[0], m[1]); self.value = ''; return; }
    if (v) setStatus('“' + v + '” is not a pole, span or command in this project.', 'bad');
  }
  combos.gs = { value: '', free: true, blurClear: true, placeholder: 'Type a pole, span or command…', groups: gsGroups, onPick: function (v, it) { combos.gs.value = ''; $('gsearch').value = ''; if (it && it.go) it.go(); else gsGo(v); } };
  function gsGroups() {
    var ids = lineIds(), sp = [];
    for (var i = 1; i < ids.length; i++) sp.push({ value: ids[i - 1] + ' → ' + ids[i], label: 'Span', keys: ids[i - 1] + ' ' + ids[i] });
    return [
      { label: 'Poles', items: Object.keys(merged.poles).sort().map(function (k) { var p = merged.poles[k]; return { value: k, label: p.gis ? p.gis.description || '' : '', keys: (p.survey ? p.survey.equipNo : '') + ' ' + (p.gis ? p.gis.equipNo : '') }; }) },
      { label: 'Spans', items: sp },
      { label: 'Commands', items: allCommands().map(function (c) { return { value: c.name, label: 'Command', keys: c.id, go: function () { gsGo(c.name); } }; }) }
    ];
  }
  var wsReady = false;
  // Each table cell carries its column name, so phones can show rows as cards.
  new MutationObserver(function () {
    Array.prototype.forEach.call($('tableWrap').querySelectorAll('table.grid'), function (t) {
      var hs = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.replace(/[▴▾]/g, '').trim(); });
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) { Array.prototype.forEach.call(tr.children, function (td, i) { if (hs[i] && !td.dataset.label) td.dataset.label = hs[i]; }); });
    });
  }).observe($('tableWrap'), { childList: true });
  // Project summary folds to a slim bar once steps 1-5 are done and nothing is selected; the bar unfolds it.
  function sumDone() { return !!(S.files.length && built && built.rows.length > 1 && project && project.constructions.length && project.segments.length); }
  function syncFold() {
    var none = !S.selected && !S.selSpan && !(S.multi && S.multi.length > 1), fold = none && U.right && sumDone() && U.sumFold !== false, ws = $('workspace');
    var was = ws.classList.contains('sum-fold'); ws.classList.toggle('sum-fold', fold);
    var b = $('insFold'); if (!b) { $('insTitle').insertAdjacentHTML('afterend', '<button class="ibtn" id="insFold" aria-label="Fold the summary"></button>'); b = $('insFold'); b.onclick = function () { U.sumFold = !$('workspace').classList.contains('sum-fold'); saveUi(); syncFold(); }; }
    b.hidden = !none || !sumDone();
    var e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length;
    b.innerHTML = fold ? '<span>Project summary' + (e ? ' · ' + e + ' error' + (e > 1 ? 's' : '') : w ? ' · ' + w + ' warning' + (w > 1 ? 's' : '') : ' · ready') + '</span>' : '⇥';
    b.title = fold ? 'Show the project summary' : 'Fold the summary to a slim bar for more drawing space';
    b.className = 'ibtn' + (fold ? ' foldbar' + (e ? ' bad' : w ? ' warn' : '') : '');
    if (was !== fold) setTimeout(function () { if (map && map.invalidateSize) map.invalidateSize(); if (S.view !== 'plan') renderViews(); }, 30);
  }
  function renderExtras(sel) { if (!wsReady) return; syncFold(); if (sel && /^(spans|calc|tipsum)$/.test(tab)) renderTable(); syncHeader(); syncPvTools(); renderAnalysis(); renderStatusBar(); markRail(); renderExplorer(); syncPlanProf(); syncAnCtl(); syncTitleBar(); syncRibbon(); syncTabMore(); syncRail(); }
  function syncRail() { var pr = prof(), n = pr ? pr.poleIds.length : 0, has = S.files.length > 0; $('railState').textContent = has ? n + ' pole' + (n === 1 ? '' : 's') + ' in profile' : 'No project'; $('railFoot').querySelector('.dot').classList.toggle('off', !has); $('railName').textContent = has && pr ? pr.name || '' : ''; $('railQuick').classList.toggle('loaded', has); }

  /* delegated actions from the contextual panel, bars and tables */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-wb]');
    if (b) {
      var act = b.dataset.wb, id = S.selected, ids = S.multi || [], p = prof();
      if (act === 'edit') { var man = S.files.some(function (f) { return f.manual && f.items.some(function (x) { return x.id === id; }); }); U.insTab = 'pole'; U.right = true; applyLayout(); saveUi(); if (man) openPoleDlg(id); else { renderSelected(); setStatus('Editing ' + id + ': change its length, construction, conductors and equipment in the sections on the right.'); } }
      else if (act === 'spanedit') { var s = S.selSpan; if (s) { var mb = S.files.some(function (f) { return f.manual && f.items.some(function (x) { return x.id === s.b; }); }); if (mb) openPoleDlg(s.b); else { select(s.b); setStatus('A span follows its end poles: edit ' + s.b + ' here, or reorder poles in the Project panel.'); } } }
      else if (act === 'spancond') { var s2 = S.selSpan; if (!project) { setStatus('Start a design first to add conductors.', 'bad'); return; } if (s2) { secForm = Object.assign({ tension: '', units: '%CBL' }, secForm || {}, { from: s2.a, to: s2.b }); openTab('sections'); setStatus('String a conductor across ' + s2.a + ' → ' + s2.b + ' in the Conductor schedule: pick the circuit and tension, then Add.'); } }
      else if (act === 'spansag') { var s3 = S.selSpan; if (s3) { var ca = chainOfPole(s3.a), cb = chainOfPole(s3.b); if (ca != null && cb != null) pvSet(Math.min(ca, cb) - 5, Math.max(ca, cb) + 5); } setAn('sag', true); if (S.view !== 'plan' && S.view !== '3d') renderProfileView(); }
      else if (act === 'recalc') { recompute(); setStatus('Recalculated sag, tension and tipload.', 'good'); }
      else if (act === 'unsec') { S.selSection = null; select(S.selected); }
      else if (act === 'eqall') { S.selEquip = null; renderSelected(); }
      else if (act === 'madd') { ids.forEach(function (k) { if (p.poleIds.indexOf(k) < 0) p.poleIds.push(k); }); p.poleIds = PNW.autoOrder(merged.poles, p.poleIds); S.generated = false; recompute(); setStatus(ids.length + ' poles are in the profile, ordered along the line.', 'good'); }
      else if (act === 'mrem') { p.poleIds = p.poleIds.filter(function (k) { return ids.indexOf(k) < 0; }); S.generated = false; recompute(); }
      else if (act === 'mzoom') { var cs = ids.map(chainOfPole).filter(function (v) { return v != null; }); if (S.view === 'profile' && cs.length) { pvSet(Math.min.apply(null, cs) - 5, Math.max.apply(null, cs) + 5); renderProfileView(); } else { var lls = ids.map(function (k) { var q = merged.poles[k]; return q && (poleLatLng(q) || (q.gis && q.gis.lat != null ? L.latLng(q.gis.lat, q.gis.lng) : null)); }).filter(Boolean); if (lls.length) map.fitBounds(L.latLngBounds(lls).pad(0.3)); } }
      else if (act === 'mlen') { var n = PNW.num($('bkLen').value); if (!(n > 0) || n > 60) { setStatus('“' + $('bkLen').value + '” is not a valid pole length in metres.', 'bad'); return; } ids.forEach(function (k) { if (p.poleIds.indexOf(k) < 0) return; var ex = merged.poles[k] ? PNW.existingLength(merged.poles[k]).value : null; if (n === ex) delete p.lengths[k]; else p.lengths[k] = n; }); S.generated = false; var keep = ids.slice(); recompute(); S.multi = keep; select(keep[keep.length - 1], { add: false, keepMulti: true }); setStatus('Pole length ' + n + ' m applied; heights, sag and tipload recalculated.', 'good'); }
      else if (act === 'mstay') { var did = 0; ids.forEach(function (k) { var cons = ((dm && dm.byPole[k]) || []).filter(function (c) { return c.kingbolt != null; }); if (cons.length && project.poles.some(function (r) { return r.ID === k; })) { addExtra(k, 'stay'); did++; } }); setStatus(did + ' stay' + (did === 1 ? '' : 's') + ' added with library defaults; check each pole’s Transformer & stays section.', did ? 'good' : 'bad'); }
      else if (act === 'mver') { var vv = S.design.verified = S.design.verified || {}, now = new Date().toISOString(); ids.forEach(function (k) { vv[k] = { at: now, by: S.settings.createdBy || 'designer' }; }); save(); renderSelected(); renderStatusBar(); setStatus('Marked ' + ids.length + ' poles as verified in the field.', 'good'); }
      else if (act === 'mtip') openTip(id);
      else if (act === 'mdel') delPoles(ids.slice());
      else if (act === 'mprof') profPickDlg(ids.slice());
      return;
    }
    var c = e.target.closest('[data-csec]'); if (c && !e.target.closest('input,select,button')) { select(c.dataset.cpole || S.selected, { segment: c.dataset.csec }); return; }
    var sd = e.target.closest('[data-spdel]'); if (sd) { var kk = sd.dataset.spdel.split('|'); delSpan(kk[0], kk[1]); return; }
    var sp = e.target.closest('#tableWrap [data-span], #anBody [data-span], #selected [data-span]'); if (sp && !e.target.closest('input,select,button')) { var k = sp.dataset.span.split('|'); selectSpan(k[0], k[1]); return; }
    var an = e.target.closest('#anBody tr[data-id]'); if (an) { select(an.dataset.id, addInfo(e)); showPole(an.dataset.id); return; }
    var q = e.target.closest('.xrow[data-eq] > b'); if (q) { var r = q.parentNode, kk = r.dataset.eq.split('|'); S.selEquip = { pole: S.selected, kind: kk[0] === 'stays' ? 'stay' : 'transformer', i: +kk[1] }; renderSelected(); }
  });
  $('selected').addEventListener('change', function (e) {
    var t = e.target, d = t.dataset; if (d.ctn == null && d.ctu == null) return;
    var n = d.ctn || d.ctu, tv = PNW.num($('ctn').value);
    if (d.ctn != null && !(tv > 0)) { setStatus('“' + t.value + '” is not a valid tension for ' + n + '.', 'bad'); renderSelected(); return; }
    commit(function (p) { var sg = p.segments.filter(function (x) { return x.StrainSect === n; })[0], from = sg.Tension + ' ' + sg.TensionUnits; M.updateSection(p, n, d.ctn != null ? { tension: tv } : { units: t.value }); return [logEntry('', n, 'Tension', from, (d.ctn != null ? tv + ' ' + sg.TensionUnits : $('ctn').value + ' ' + t.value), 'manual')]; });
    setStatus('Section ' + n + ' updated; sag, tension and tipload recalculated.', 'good');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && $('genDlg').hidden && (S.multi && S.multi.length > 1)) select(null); });
  window.addEventListener('beforeunload', function (e) { if (dirty && S.files.length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- CAD shell: ribbon, explorer, title bar, status readouts, extra tools and tables ---------- */
  var multiMode = false, snapOn = true, ribTab = U.rtab || 'Home';
  var TOOL_HINT = { select: 'Select: click a pole or span (Shift or Ctrl adds)', pan: 'Pan: drag the plan', measure: 'Measure: click points or poles', draw: 'Draw: click the plan to place a new pole', move: 'Move: select a hand-made pole, then click its new position', rect: 'Box select: drag a rectangle (Shift adds)', poly: 'Polygon select: click corners, double-click or Enter to finish, Esc cancels', lasso: 'Lasso select: drag a freehand loop (Shift adds)' };
  function updToolStatus() { $('sbTool').innerHTML = 'Tool: <b>' + ({ select: 'Select', pan: 'Pan', measure: 'Measure', draw: 'Draw pole', move: 'Move pole', rect: 'Box select', poly: 'Polygon select', lasso: 'Lasso select' }[planTool] || planTool) + '</b>'; $('sbTool').title = TOOL_HINT[planTool] || ''; syncRibbon(); }
  function runWb(act) { var b = document.createElement('button'); b.dataset.wb = act; b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }
  function poleLL(id) { var q = merged.poles[id]; return q && (poleLatLng(q) || (q.gis && q.gis.lat != null ? L.latLng(q.gis.lat, q.gis.lng) : null)); }
  function snapLL(ll) {
    if (!snapOn || !ll || !map.latLngToContainerPoint) return ll;
    var pt = map.latLngToContainerPoint(ll), best = null, bd = 12;
    Object.keys(merged.poles).forEach(function (k) { var l2 = poleLL(k); if (!l2) return; var d = map.latLngToContainerPoint(l2).distanceTo(pt); if (d < bd) { bd = d; best = l2; } });
    return best || ll;
  }
  function panPlanTo(ll) { try { if (ll && map.getBounds && !map.getBounds().contains(ll)) map.panTo(ll); } catch (e) { /* ignore */ } }

  /* ribbon */
  // One home per command: Home holds the everyday tools, the other tabs the rest. Icons are Lucide (ISC licence).
  var ICONS = {"mouse-pointer-2": "<path d=\"M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z\"/>", "square-dashed-mouse-pointer": "<path d=\"M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z\"/><path d=\"M5 3a2 2 0 0 0-2 2\"/><path d=\"M19 3a2 2 0 0 1 2 2\"/><path d=\"M5 21a2 2 0 0 1-2-2\"/><path d=\"M9 3h1\"/><path d=\"M9 21h2\"/><path d=\"M14 3h1\"/><path d=\"M3 9v1\"/><path d=\"M21 9v2\"/><path d=\"M3 14v1\"/>", "hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\"/><path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\"/><path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\"/><path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\"/>", "ruler": "<path d=\"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z\"/><path d=\"m14.5 12.5 2-2\"/><path d=\"m11.5 9.5 2-2\"/><path d=\"m8.5 6.5 2-2\"/><path d=\"m17.5 15.5 2-2\"/>", "scan": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/><path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/>", "circle-dot": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/>", "move-horizontal": "<path d=\"m18 8 4 4-4 4\"/><path d=\"M2 12h20\"/><path d=\"m6 8-4 4 4 4\"/>", "spline": "<circle cx=\"19\" cy=\"5\" r=\"2\"/><circle cx=\"5\" cy=\"19\" r=\"2\"/><path d=\"M5 17A12 12 0 0 1 17 5\"/>", "wand-sparkles": "<path d=\"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72\"/><path d=\"m14 7 3 3\"/><path d=\"M5 6v4\"/><path d=\"M19 14v4\"/><path d=\"M10 2v2\"/><path d=\"M7 8H3\"/><path d=\"M21 16h-4\"/><path d=\"M11 3H9\"/>", "sparkles": "<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"/><path d=\"M20 3v4\"/><path d=\"M22 5h-4\"/><path d=\"M4 17v2\"/><path d=\"M5 18H3\"/>", "gauge": "<path d=\"m12 14 4-4\"/><path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>", "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m9 12 2 2 4-4\"/>", "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"/><path d=\"M12 9v4\"/><path d=\"M12 17h.01\"/>", "undo-2": "<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\"/>", "redo-2": "<path d=\"m15 14 5-5-5-5\"/><path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\"/>", "move": "<path d=\"M12 2v20\"/><path d=\"m15 19-3 3-3-3\"/><path d=\"m19 9 3 3-3 3\"/><path d=\"M2 12h20\"/><path d=\"m5 9-3 3 3 3\"/><path d=\"m9 5 3-3 3 3\"/>", "trash-2": "<path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/><line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\"/><line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\"/>", "pencil": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>", "split": "<path d=\"M16 3h5v5\"/><path d=\"M8 3H3v5\"/><path d=\"M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3\"/><path d=\"m15 9 6-6\"/>", "layout-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/>", "cable": "<path d=\"M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1\"/><path d=\"M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9\"/><path d=\"M21 21v-2h-4\"/><path d=\"M3 5h4V3\"/><path d=\"M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3\"/>", "box": "<path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/><path d=\"m3.3 7 8.7 5 8.7-5\"/><path d=\"M12 22V12\"/>", "anchor": "<path d=\"M12 22V8\"/><path d=\"M5 12H2a10 10 0 0 0 20 0h-3\"/><circle cx=\"12\" cy=\"5\" r=\"3\"/>", "camera": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\"/><circle cx=\"12\" cy=\"13\" r=\"3\"/>", "chart-spline": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7\"/>", "upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"17 8 12 3 7 8\"/><line x1=\"12\" x2=\"12\" y1=\"3\" y2=\"15\"/>", "files": "<path d=\"M20 7h-3a2 2 0 0 1-2-2V2\"/><path d=\"M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z\"/><path d=\"M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8\"/>", "images": "<path d=\"M18 22H4a2 2 0 0 1-2-2V6\"/><path d=\"m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18\"/><circle cx=\"12\" cy=\"8\" r=\"2\"/><rect width=\"16\" height=\"16\" x=\"6\" y=\"2\" rx=\"2\"/>", "folder-open": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\"/>", "save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"/><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"/>", "file-plus": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\"/><path d=\"M14 2v4a2 2 0 0 0 2 2h4\"/><path d=\"M9 15h6\"/><path d=\"M12 18v-6\"/>", "file-spreadsheet": "<path d=\"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z\"/><path d=\"M14 2v4a2 2 0 0 0 2 2h4\"/><path d=\"M8 13h2\"/><path d=\"M14 13h2\"/><path d=\"M8 17h2\"/><path d=\"M14 17h2\"/>", "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\"/>", "sheet": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><line x1=\"3\" x2=\"21\" y1=\"9\" y2=\"9\"/><line x1=\"3\" x2=\"21\" y1=\"15\" y2=\"15\"/><line x1=\"9\" x2=\"9\" y1=\"9\" y2=\"21\"/><line x1=\"15\" x2=\"15\" y1=\"9\" y2=\"21\"/>", "scroll-text": "<path d=\"M15 12h-5\"/><path d=\"M15 8h-5\"/><path d=\"M19 17V5a2 2 0 0 0-2-2H4\"/><path d=\"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3\"/>", "map": "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\"/><path d=\"M15 5.764v15\"/><path d=\"M9 3.236v15\"/>", "chart-line": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"m19 9-5 5-4-4-3 3\"/>", "columns-2": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M12 3v18\"/>", "zoom-in": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>", "zoom-out": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>", "panel-left": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M9 3v18\"/>", "panel-right": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M15 3v18\"/>", "panel-bottom": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 15h18\"/>", "chart-area": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"M7 11.207a.5.5 0 0 1 .146-.353l2-2a.5.5 0 0 1 .708 0l3.292 3.292a.5.5 0 0 0 .708 0l4.292-4.292a.5.5 0 0 1 .854.353V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z\"/>", "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>", "sliders-horizontal": "<line x1=\"21\" x2=\"14\" y1=\"4\" y2=\"4\"/><line x1=\"10\" x2=\"3\" y1=\"4\" y2=\"4\"/><line x1=\"21\" x2=\"12\" y1=\"12\" y2=\"12\"/><line x1=\"8\" x2=\"3\" y1=\"12\" y2=\"12\"/><line x1=\"21\" x2=\"16\" y1=\"20\" y2=\"20\"/><line x1=\"12\" x2=\"3\" y1=\"20\" y2=\"20\"/><line x1=\"14\" x2=\"14\" y1=\"2\" y2=\"6\"/><line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\"/><line x1=\"16\" x2=\"16\" y1=\"18\" y2=\"22\"/>", "tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>"};
  // One delete control for the whole app: a bin icon button. attrs = the data-* that the existing handler reads.
  function binBtn(attrs, label, disabledWhy) { return '<button type="button" class="ibin" ' + attrs + (disabledWhy ? ' disabled title="' + esc(disabledWhy) + '"' : ' title="' + esc(label) + '"') + ' aria-label="' + esc(label) + '">' + ico('trash-2') + '</button>'; }
  ICONS['shield-check'] = '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>';
  ICONS['square-dashed'] = '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>';
  ICONS['polygon'] = '<path d="M12 3 21 9.5 17.5 20h-11L3 9.5Z" stroke-dasharray="3 2"/><circle cx="12" cy="3" r="1.6"/><circle cx="21" cy="9.5" r="1.6"/><circle cx="17.5" cy="20" r="1.6"/><circle cx="6.5" cy="20" r="1.6"/><circle cx="3" cy="9.5" r="1.6"/>';
  ICONS['lasso'] = '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>';
  ICONS['route'] = '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>';
  function ico(n) { return ICONS[n] ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>' : n; }
  var RIB = [
    ['Home', [
      ['Modify', [['select', 'Select', 'mouse-pointer-2', 'tool', 'Select poles and spans (V)'], ['rect', 'Box select', 'square-dashed', 'tool', 'Drag a rectangle on the plan to select every pole inside (B)'], ['poly', 'Polygon select', 'polygon', 'tool', 'Click the corners of a polygon on the plan to select every pole inside (P). Shift adds.'], ['lasso', 'Lasso select', 'lasso', 'tool', 'Drag a freehand loop on the plan to select every pole inside (L). Shift adds.'], ['pan', 'Pan', 'hand', 'tool', 'Pan the plan (H)'], ['measure', 'Measure', 'ruler', 'tool', 'Measure distances on the plan (M)']]],
      ['Draw', [['aPole', 'Add pole', 'circle-dot', 'run', 'Create a pole: coordinates, from another pole, or click the plan'], ['aSpan', 'Add span', 'move-horizontal', 'run', 'Join two poles'], ['tbCond', 'Draw conductor', 'spline', 'run', 'Draw a strain section pole to pole: snaps to poles on the plan and to attachment points in 3D and profile (Esc to stop)']]],
      ['Profile', [['mkProf', 'Create profile', 'route', 'fn', 'Make a profile from the selected poles, or pick them from a list. Profiles that share a pole (tee-offs) load that pole together.']]],
      ['Automate', [['tbAuto', 'Auto design', 'wand-sparkles', 'run', 'Full draft design from QLINK, GIS exports and pole photos (Street View where there is no photo), for review'], ['tbAi', 'AI photo', 'sparkles', 'run', 'Analyse a pole photo with AI']]],
      ['Check', [['tbTip', 'Tipload', 'gauge', 'run', 'Tipload of every pole'], ['validate', 'Validate', 'circle-check', 'fn', 'Recalculate everything and list the errors and warnings'], ['tbIssues', 'Issues', 'triangle-alert', 'run', 'All errors and warnings']]],
      ['History', [['tbUndo', 'Undo', 'undo-2', 'run', 'Undo (Ctrl+Z)'], ['tbRedo', 'Redo', 'redo-2', 'run', 'Redo (Ctrl+Y)']]]]],
    ['Design', [
      ['Poles', [['move', 'Move pole', 'move', 'tool', 'Move a hand-made pole'], ['delPole', 'Delete pole', 'trash-2', 'fn', 'Delete the selected pole']]],
      ['Spans', [['editSpan', 'Edit span', 'pencil', 'fn', 'Edit the selected span'], ['aX', 'Intersection', 'split', 'run', 'Intersection span at the selected pole']]],
      ['Equipment', [['construction', 'Construction', 'layout-grid', 'fn', 'Add or edit constructions and attachments on the selected pole'], ['aCond', 'Conductor', 'cable', 'run', 'Add a conductor on the selected pole'], ['aTx', 'Transformer', 'box', 'run', 'Add a transformer to the selected pole'], ['aStay', 'Stay', 'anchor', 'run', 'Add a stay to the selected pole (edit it in Properties)']]],
      ['Photos', [['mStreet', 'Street View', 'camera', 'run', 'Street View of the selected pole, with capture']]],
      ['Calculate', [['sagten', 'Sag & tension', 'chart-spline', 'fn', 'Conductor schedule and sag results']]]]],
    ['Files', [
      ['Import', [['tbUpload', 'Import files', 'upload', 'run', 'LiDAR, GIS, inspections, conductor spreadsheets, PNW files'], ['mImported', 'Imported files', 'files', 'run', 'Review everything imported, with data mapping'], ['mPhotos', 'Pole photos', 'images', 'run', 'Match photos to poles']]],
      ['Project', [['tbOpen', 'Open', 'folder-open', 'run', 'Open a saved project file'], ['tbSave', 'Save', 'save', 'run', 'Save a project file'], ['tbReset', 'New', 'file-plus', 'run', 'New project']]],
      ['Export', [['tbGenerate', 'Ground profile', 'file-spreadsheet', 'run', 'Generate and review the ground profile'], ['tbExport', 'PNW files', 'download', 'run', 'Export the PNW ground profile and .pnwx'], ['mExpTip', 'Tipload CSV', 'sheet', 'run', 'Tipload results as CSV'], ['mExpLog', 'Change log', 'scroll-text', 'run', 'Change log as CSV']]]]],
    ['View', [
      ['Views', [['v:plan', 'Plan', 'map', 'view'], ['v:profile', 'Profile', 'chart-line', 'view'], ['v:3d', '3D', 'box', 'view'], ['v:split', '3D + Profile', 'columns-2', 'view']]],
      ['Navigate', [['fit', 'Fit', 'scan', 'tool', 'Fit the whole project in the current view'], ['zin', 'Zoom in', 'zoom-in', 'zoom'], ['zout', 'Zoom out', 'zoom-out', 'zoom']]],
      ['Layers', [['chk', [['lySurvey', 'Poles'], ['lyAlign', 'Spans'], ['lySpanLbl', 'Span lengths'], ['lyGis', 'GIS positions']]], ['chk', [['pv:hv', 'HV conductors'], ['pv:lv', 'LV conductors'], ['pv:ground', 'Ground profile'], ['pv:att', 'Attachments']]]]],
      ['Panels', [['pan:tbSide', 'Explorer', 'panel-left', 'run'], ['pan:tbInspector', 'Properties', 'panel-right', 'run'], ['pan:tbDock', 'Tables', 'panel-bottom', 'run'], ['pan:an', 'Profile dock', 'chart-area', 'fn', 'Show or hide the profile, sag and summary dock']]]]],
    ['Settings', [
      ['Project', [['settings', 'Project & PNW', 'settings', 'fn', 'Zone, PNW user, option set and clearances']]],
      ['Display', [['sagset', 'Sag display', 'sliders-horizontal', 'fn', 'How sag and temperature are drawn'], ['tbLabels', 'Pole labels', 'tag', 'run', 'Show or hide pole labels']]]]]
  ];
  // Delete poles: a hand-made pole goes from the project and every profile; an imported pole keeps its source data and leaves the active profile.
  function isManual(id) { return S.files.some(function (f) { return f.manual && f.items.some(function (x) { return x.id === id; }); }); }
  function delPoles(ids) {
    var man = ids.filter(isManual), imp = ids.filter(function (k) { return man.indexOf(k) < 0 && !(project && project.poles.some(function (r) { return r.ID === k; })); }), one = ids.length === 1;
    var txt = (man.length ? '<p><b>' + man.length + '</b> hand-made pole' + (man.length === 1 ? '' : 's') + ' (' + esc(man.slice(0, 8).join(', ')) + (man.length > 8 ? '…' : '') + ') will be removed from the project and from every profile.</p>' : '') +
      (imp.length ? '<p><b>' + imp.length + '</b> imported pole' + (imp.length === 1 ? '' : 's') + ' (' + esc(imp.slice(0, 8).join(', ')) + (imp.length > 8 ? '…' : '') + ') keep their source data and are removed from the active profile only.</p>' : '');
    var dsg0 = ids.filter(function (k) { return project && project.poles.some(function (r) { return r.ID === k; }); });
    if (dsg0.length) txt = '<p><b>' + dsg0.length + '</b> pole' + (dsg0.length === 1 ? '' : 's') + ' in the design (' + esc(dsg0.slice(0, 8).join(', ')) + (dsg0.length > 8 ? '…' : '') + ') will be removed from the PNW project with their constructions, stays and plant. Conductors through them are cut at those poles.</p>' + txt;
    openGen(one ? 'Delete pole ' + ids[0] : 'Delete ' + ids.length + ' poles', txt + '<div class="btnrow"><button class="btn danger" id="dpOk">Delete</button><button class="btn" id="dpNo">Cancel</button></div>', { narrow: true });
    $('dpNo').onclick = closeGen;
    $('dpOk').onclick = function () {
      closeGen();
      var dsg = ids.filter(inDesign); if (dsg.length && !delFromDesign(dsg)) return;
      if (man.length) { var mf = S.files.filter(function (x) { return x.manual; })[0]; mf.items = mf.items.filter(function (x) { return man.indexOf(x.id) < 0; }); mf.summary = mf.items.length + ' poles'; if (!mf.items.length) S.files = S.files.filter(function (x) { return x !== mf; }); S.profiles.forEach(function (p) { p.poleIds = p.poleIds.filter(function (x) { return man.indexOf(x) < 0; }); man.forEach(function (k) { delete p.lengths[k]; }); }); }
      if (imp.length || dsg.length) prof().poleIds = prof().poleIds.filter(function (x) { return imp.indexOf(x) < 0 && dsg.indexOf(x) < 0; });
      S.selected = null; S.multi = []; S.generated = false; recompute(); select(null);
      setStatus([dsg.length ? dsg.length + ' deleted from the design' + (dsg.length < 4 ? ' (' + dsg.join(', ') + ')' : '') : '', man.length ? man.length + ' hand-made deleted' : '', imp.length ? imp.length + ' removed from the profile' : ''].filter(Boolean).join(', ') + '.', 'good');
    };
  }
  /* Create profile: each profile is its own PNW line (.pnwx). A pole shared by two lines (a tee-off) is drawn once with the
     constructions of both, and its tipload takes the conductors of every line through it (see syncIntersecting / tipInput). */
  function makeProfile(ids, name) {
    ids = ids.filter(function (k) { return merged.poles[k] && poleXY(k); });
    if (ids.length < 2) return 'Pick at least two poles that have coordinates.';
    ids = PNW.autoOrder(merged.poles, ids);
    name = (name || '').trim() || 'Profile ' + (S.profiles.length + 1);
    var fname = 'Ground Profile - ' + name.replace(/[\\/:*?"<>|]+/g, '-') + '.pnwx';
    if (S.files.some(function (f) { return f.name === fname; }) || S.profiles.some(function (p) { return p.name === name && p.poleIds.length; })) return 'A profile called “' + name + '” already exists. Give it another name.';
    var lengths = {};
    ids.forEach(function (k) {
      var L = null; S.profiles.forEach(function (p) { if (L == null && p.lengths[k] != null) L = p.lengths[k]; });
      if (L == null && dm) { var q = dm.allPoles.filter(function (x) { return x.id === k; })[0]; if (q && q.length > 0) L = q.length; }
      var ex = PNW.existingLength(merged.poles[k]).value; if (L != null && L !== ex) lengths[k] = L;
    });
    var pr = { name: name, poleIds: ids, lengths: lengths, comments: {}, segments: [], file: fname }, bt = PNW.buildProfile(merged.poles, pr);
    if (!bt.ok) return bt.issues.filter(function (i) { return i.level === 'error'; }).map(function (i) { return i.message; }).join(' ');
    var text = PNW.profilePnwx(bt, { title: 'Ground Profile - ' + name, createdBy: S.settings.createdBy, option: S.settings.optionSet, clearance1: PNW.num(S.settings.clr1), clearance2: PNW.num(S.settings.clr2) });
    var r = importText(fname, text); r.size = text.length; r.status = 'ok'; r.made = true; upsertFile(r);
    var empty = S.profiles.findIndex(function (p) { return p.name === name; });
    if (empty >= 0) S.profiles[empty] = pr; else S.profiles.push(pr);
    var shared = [];
    S.profiles.forEach(function (p) { if (p !== pr) p.poleIds.forEach(function (k) { if (ids.indexOf(k) >= 0 && shared.indexOf(k) < 0) shared.push(k); }); });
    S.design.log = liveLog().concat([logEntry(ids[0], 'Profile', 'Created', '', name + ': ' + ids.join(', '), 'manual', fname)]);
    linkDesign(fname); S.multi = []; select(null);
    setStatus('Created “' + name + '” with ' + ids.length + ' poles (' + ids[0] + ' → ' + ids[ids.length - 1] + '). It is now the line being designed.' + (shared.length ? ' Shared with other profiles: ' + shared.join(', ') + '. Those poles carry the constructions of every line, and their tipload includes all of them.' : ''), 'good');
    return null;
  }
  function profNameDlg(ids) {
    var o = PNW.autoOrder(merged.poles, ids.slice());
    openGen('Create profile', '<div class="field"><label for="mpName">Profile name</label><input id="mpName" value="Profile ' + (S.profiles.length + 1) + '"></div><p class="meta">' + o.length + ' poles, in order along the line: ' + esc(o.join(' → ')) + '</p><p class="err" id="mpErr" hidden></p><div class="btnrow"><button class="btn primary" id="mpOk">Create profile</button><button class="btn" id="mpNo">Cancel</button></div>', { narrow: true });
    $('mpNo').onclick = closeGen;
    var go = function () { var e = makeProfile(ids, $('mpName').value); if (e) { $('mpErr').textContent = e; $('mpErr').hidden = false; } else closeGen(); };
    $('mpOk').onclick = go; $('mpName').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    setTimeout(function () { $('mpName').select(); }, 0);
  }
  function uniqueProfName() { var n = S.profiles.length + 1; while (S.profiles.some(function (p) { return p.name === 'Profile ' + n; }) || S.files.some(function (f) { return f.name === 'Ground Profile - Profile ' + n + '.pnwx'; })) n++; return 'Profile ' + n; }
  // Create profile: tick poles in the list or click them on the plan / 3D while the window is open. The order along the line,
  // shared poles (tee-offs) and a line that only repeats part of another profile are shown before anything is made.
  var mpPick = null;
  function profPickDlg(pre) {
    var order = Object.keys(merged.poles).filter(function (k) { return poleXY(k); }).sort();
    var inProf = function (k) { return S.profiles.filter(function (p) { return p.poleIds.indexOf(k) >= 0 && p.poleIds.length; }).map(function (p) { return p.name; }); };
    var picked = {}; (pre || []).forEach(function (k) { if (order.indexOf(k) >= 0) picked[k] = 1; });
    openGen('Create profile', '<div class="mp-top"><div class="field"><label for="mpName">Profile name</label><input id="mpName" value="' + esc(uniqueProfName()) + '"></div><div class="field"><label for="mpFind">Find pole</label><input id="mpFind" placeholder="Pole ID"></div></div>' +
      '<p class="hint" style="display:block">Tick poles here or click them on the plan or in 3D (this window stays open). For a tee-off, include the pole it branches from.</p>' +
      '<div class="mp-list">' + order.map(function (k) { var ip = inProf(k); return '<label data-mp="' + esc(k) + '"><input type="checkbox" value="' + esc(k) + '"' + (picked[k] ? ' checked' : '') + '> <b>' + esc(k) + '</b>' + (ip.length ? ' <small>' + esc(ip.join(', ')) + '</small>' : '') + '</label>'; }).join('') + '</div>' +
      '<div class="mp-sum" id="mpSum"></div><p class="err" id="mpErr" hidden></p><div class="btnrow"><button class="btn primary" id="mpOk">Create profile</button><button class="btn" id="mpClear">Clear ticks</button><button class="btn" id="mpNo">Cancel</button></div>', { noFocus: true, side: true });
    var box = $('genBody'), list = function () { return Array.prototype.map.call(box.querySelectorAll('.mp-list input:checked'), function (c) { return c.value; }); };
    function upd() {
      var ids = list(), o = ids.length > 1 ? PNW.autoOrder(merged.poles, ids.slice()) : ids, sum = $('mpSum'); if (!sum) return;
      var shared = o.filter(function (k) { return inProf(k).length; }), dup = S.profiles.filter(function (p) { return o.length > 1 && o.every(function (k) { return p.poleIds.indexOf(k) >= 0; }); }).map(function (p) { return p.name; });
      sum.innerHTML = '<b>' + o.length + ' pole' + (o.length === 1 ? '' : 's') + '</b>' + (o.length ? ': ' + esc(o.join(' → ')) : ' ticked') +
        (shared.length && !dup.length ? '<br><span class="ok">Shared with other profiles: ' + esc(shared.join(', ')) + ' (tee-off: these carry both lines and their tipload includes both).</span>' : '') +
        (dup.length ? '<br><span class="warn">Every ticked pole is already on ' + esc(dup.join(', ')) + '. This makes a second line over the same poles; for a tee-off, tick the branch poles plus the one pole it leaves from.</span>' : '') +
        (o.length < 2 ? '<br><span class="muted">Tick at least two poles.</span>' : '');
      $('mpOk').disabled = o.length < 2; $('mpErr').hidden = true;
    }
    mpPick = function (id) { var c = box.querySelector('[data-mp="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] input'); if (!c) return false; c.checked = !c.checked; c.closest('label').scrollIntoView({ block: 'nearest' }); upd(); return true; };
    box.querySelector('.mp-list').onchange = upd;
    $('mpFind').oninput = function () { var q = this.value.trim().toUpperCase(); Array.prototype.forEach.call(box.querySelectorAll('[data-mp]'), function (l) { l.hidden = q && !smartScore(q, l.dataset.mp + ' ' + l.textContent); }); };
    $('mpClear').onclick = function () { Array.prototype.forEach.call(box.querySelectorAll('.mp-list input:checked'), function (c) { c.checked = false; }); upd(); };
    $('mpNo').onclick = closeGen;
    var go = function () {
      var nm = $('mpName').value.trim(); if (!nm) { $('mpErr').textContent = 'Give the profile a name.'; $('mpErr').hidden = false; $('mpName').focus(); return; }
      var e; restoringWrap(function () { e = makeProfile(list(), nm); }); if (e) { $('mpErr').textContent = e; $('mpErr').hidden = false; } else closeGen();
    };
    $('mpOk').onclick = go; $('mpName').onkeydown = function (ev) { if (ev.key === 'Enter') go(); };
    upd(); setTimeout(function () { var n = $('mpName'); if (n) n.select(); }, 0);
  }
  // Run a multi-step change as one undo step.
  function restoringWrap(fn) { var before = lastSnap; restoring = true; try { fn(); } finally { restoring = false; } var now = snapState(); if (before != null && now !== before) { undoStack.push(before); redoStack = []; } lastSnap = now; renderHistory(); }
  // Delete a profile: its pole order and lengths go; a PNW line made here goes too, an imported .pnwx file stays in Files.
  function delProfileDlg(i) {
    var p = S.profiles[i]; if (!p) return; var nm = p.name || 'Profile ' + (i + 1), mf = p.file && S.files.filter(function (f) { return f.name === p.file && f.made; })[0];
    openGen('Delete profile ' + nm, '<p>Delete <b>' + esc(nm) + '</b> (' + p.poleIds.length + ' pole' + (p.poleIds.length === 1 ? '' : 's') + ')?' + (mf ? ' Its PNW line <b>' + esc(mf.name) + '</b>, made here, is deleted with it.' : p.file ? ' The imported file ' + esc(p.file) + ' stays in Files.' : '') + ' The survey stays. Ctrl+Z undoes this.</p><div class="btnrow"><button class="btn danger" id="dprOk">Delete profile</button><button class="btn" id="dprNo">Cancel</button></div>', { narrow: true });
    $('dprNo').onclick = closeGen;
    $('dprOk').onclick = function () {
      closeGen();
      restoringWrap(function () {
        var to = S.profiles.length > 1 ? (i === 0 ? 1 : 0) : -1;
        if (to >= 0 && S.active === i) switchProfileInner(to);
        if (S.profiles.length < 2) { S.profiles[0] = newProfile('Profile 1'); S.design = Object.assign(blankDesign(), { register: S.design.register, log: S.design.log }); S.active = 0; }
        else { var keep = S.profiles[S.active === i ? to : S.active]; S.profiles.splice(i, 1); S.active = S.profiles.indexOf(keep); }
        if (mf) S.files = S.files.filter(function (f) { return f !== mf; });
        xCache = {}; textCache = {}; regCache = null; S.generated = false; recompute(); select(null);
      });
      if (typeof renderExtras === 'function') renderExtras(); undoStatus('Deleted profile ' + nm + '.');
    };
  }
  function renameProfileDlg(i) {
    var p = S.profiles[i]; if (!p) return;
    openGen('Rename profile', '<div class="field"><label for="rnName">Profile name</label><input id="rnName" value="' + esc(p.name || '') + '"></div><p class="err" id="rnErr" hidden></p><div class="btnrow"><button class="btn primary" id="rnOk">Rename</button><button class="btn" id="rnNo">Cancel</button></div>', { narrow: true });
    $('rnNo').onclick = closeGen;
    var go = function () { var v = $('rnName').value.trim(); if (!v) return; if (S.profiles.some(function (q, k) { return k !== i && q.name === v; })) { $('rnErr').textContent = 'Another profile is called “' + v + '”.'; $('rnErr').hidden = false; return; } p.name = v; closeGen(); recompute(); setStatus('Renamed to “' + v + '”.', 'good'); };
    $('rnOk').onclick = go; $('rnName').onkeydown = function (e) { if (e.key === 'Enter') go(); }; setTimeout(function () { $('rnName').select(); }, 0);
  }
  /* ---------- Existing pole strength: the PNW Pole Strength module, limit state method (PNW 7 manual §11, AS7000:2016 appendix F).
     φM = φ·k1·kd·k20·k21·k22·fb·Z at the ground line, capacity at the tip = φM / height above ground; Loading 1 uses k1 for wind
     (short term), Loading 2 the long-term k1. A decayed section is the total area less the decay area, ignoring where the decay
     is (manual §11.5). fb comes from the PNW Species database and kd from AS7000 table F5: the user enters both. ---------- */
  // PNW Species table, Western Power set (Ishan's PNW database export pnwdata-wp-may19.xml): code: [name, fb MPa, density kg/m³, mid-length taper mm/m, softwood].
  var SPECIES = {"BB":["Blackbutt",80.0,1100.0,10.0,false],"BU":["Broadleaf Red Iron Bark",100.0,1100.0,10.0,false],"GB":["Grey Box",80.0,1100.0,10.0,false],"GG":["Grey Gum",100.0,1100.0,10.0,false],"GI":["Grey Iron Bark",100.0,1100.0,10.0,false],"GM":["Gympie Messmate",80.0,1100.0,10.0,false],"J":["Jarrah",42.0,1100.0,10.0,false],"K":["Karri",55.0,1100.0,10.0,false],"RI":["Red Iron Bark",80.0,1100.0,10.0,false],"RM":["Red Mahogany",80.0,1100.0,10.0,false],"RW":["Blood Wood Red",65.0,1100.0,10.0,false],"SG":["Spotted Gum",80.0,1100.0,10.0,false],"TW":["Tallow",80.0,1100.0,10.0,false],"WM":["Mahogany White",80.0,1100.0,10.0,false],"YS":["Yellow Stringybark",65.0,1100.0,10.0,false],"PR":["Radiata Pine",35.0,800.0,10.0,true],"CG":["Cadaga",80.0,1100.0,10.0,false],"CB":["Costal Box",80.0,1100.0,10.0,false],"CI":["Cooktown Iron Bark",100.0,1100.0,10.0,false],"CR":["Crow's Ash",80.0,1100.0,10.0,false],"GRM":["Grey Mahogany",80.0,1100.0,10.0,false],"HA":["Hickory Ash",100.0,1100.0,10.0,false],"IB":["Iron Bark",80.0,1100.0,10.0,false],"MR":["Marri",55.0,1100.0,10.0,false],"PM":["Maritime Pine",35.0,800.0,10.0,true],"PP":["Pinasta Pine",35.0,800.0,10.0,true],"RO":["Rosegum",65.0,1100.0,10.0,false],"SS":["Silvertop Stringybark",80.0,1100.0,10.0,false],"PS":["Pinus Silvestris/Baltic/Scotts",31.0,1100.0,10.0,true],"T":["Tingle Wood",80.0,1100.0,10.0,false],"UHW":["Unknown hardwood",42.0,1100.0,10.0,false],"USW":["Unknown softwood",35.0,800.0,10.0,true],"BA":["WA Blackbutt",42.0,1100.0,10.0,false],"WG":["Wandoo",80.0,1100.0,10.0,false],"S1":["Strength group S1",100.0,1100.0,10.0,false],"S2":["Strength group S2",80.0,1100.0,10.0,false],"S3":["Strength group S3",65.0,1100.0,10.0,false],"S4":["Strength group S4",50.0,1100.0,10.0,false],"S5":["Strength group S5",40.0,1100.0,10.0,true],"S6":["Strength group S6",35.0,1100.0,10.0,true],"S7":["Strength group S7",25.0,1100.0,10.0,true]};
  function spCode(name) { if (!name) return ''; if (SPECIES[name]) return name; var n = String(name).trim().toLowerCase(); for (var k in SPECIES) if (SPECIES[k][0].toLowerCase() === n) return k; return ''; }
  // kd by pole age, read by Ishan from PNW "File > Show factors" with new pole life 50 years (same for every species); straight lines between.
  var KD_AGE = [[5, 1], [10, 0.99], [15, 0.84], [20, 0.62], [25, 0.47], [30, 0.39], [35, 0.35], [40, 0.32], [45, 0.31], [50, 0.29], [60, 0.28]];
  function kdAge(a) { if (!(a >= 0)) return null; if (a <= KD_AGE[0][0]) return 1; for (var i = 1; i < KD_AGE.length; i++) if (a <= KD_AGE[i][0]) { var p = KD_AGE[i - 1], q = KD_AGE[i]; return Math.round((p[1] + (q[1] - p[1]) * (a - p[0]) / (q[0] - p[0])) * 10000) / 10000; } return KD_AGE[KD_AGE.length - 1][1]; }
  var STR_NUM = /^(phi|k1w|k1l|k20|k21|k22|kd)$/;
  function strSet() { var s = S.design.pstr = S.design.pstr || {}; var d = { phi: 0.7, k1w: 1, k1l: 0.57, k20: 1, k21: 1, k22: 1, kd: '' }; for (var k in d) if (s[k] === undefined) s[k] = d[k]; s.fb = s.fb || {}; s.poles = s.poles || {}; return s; }
  var GW1 = ['Good Wood Reading 1m AGL (mm)', 'Good Wood Reading 1M AGL', 'Good Wood Reading 1m AGL'], GLD = ['Pole Diameter GL (mm)', 'Pole Diameter Ground Line (mm)'], GWG = ['Good Wood Reading 100 AGL (mm)'];
  function firstNum(rec, names) { for (var i = 0; i < names.length; i++) { var v = rec && rec[names[i]], n = v == null ? null : parseFloat(v); if (n > 0) return n; } return null; }
  // Inputs from the inspection files: the newest inspection with a ground-line diameter (preferring one that also read good wood).
  function strAuto(id) {
    var p = merged.poles[id]; if (!p) return null; var ins = p.insp || { byDate: {}, attrs: {}, none: true }; // no inspection: the designer types the inputs
    var bd = ins.byDate || {}, ds = Object.keys(bd).sort().reverse(), withD = ds.filter(function (k) { return firstNum(bd[k], GLD); }), dk = withD.filter(function (k) { return firstNum(bd[k], GW1); })[0] || withD[0];
    var rec = dk ? bd[dk] : {}, yr = parseFloat((ins.attrs['Estimated Install Year'] || {}).value), mo = parseFloat((ins.attrs['Estimated Install Month'] || {}).value) || 1;
    var prw = project && project.poles.filter(function (x) { return x.ID === id; })[0], L = prw && PNW.num(prw.Length) > 0 ? PNW.num(prw.Length) : (prof().lengths[id]) || PNW.existingLength(p).value, sunk = prw && PNW.num(prw.Sunk) > 0 ? PNW.num(prw.Sunk) : L > 0 ? PNW.settingDepth(L) : null, sp = spCode(p.gis && p.gis.species);
    return { date: dk || '', D: firstNum(rec, GLD), gw1: firstNum(rec, GW1), gwGL: firstNum(rec, GWG), year: yr > 1900 ? yr : null, age: yr > 1900 ? Math.round(((Date.now() - Date.UTC(yr, mo - 1, 1)) / 31557600000) * 10) / 10 : null,
      L: L || null, sunk: sunk, hag: L > 0 ? Math.round((L - sunk) * 100) / 100 : null, species: sp, wood: SPECIES[sp] && SPECIES[sp][4] ? 'SOFT' : 'HARD', manual: !!ins.none, concrete: /PCON|concrete/i.test((ins.group || '') + ' ' + ((p.gis && p.gis.stock) || '')) };
  }
  function strRow(id) { var a = strAuto(id); if (!a) return null; var o = strSet().poles[id] || {}; var r = Object.assign({}, a); ['species', 'D', 'gwGL', 'hag', 'L', 'sunk', 'kd', 'wood', 'at', 'age'].forEach(function (k) { if (o[k] !== undefined && o[k] !== '') r[k] = o[k]; }); r.use = !!o.use; if ((o.kd == null || o.kd === '') && r.age != null) r.kd = kdAge(+r.age); return r; }
  function strCalc(r) {
    var s = strSet(), fb = parseFloat(s.fb[r.species] != null ? s.fb[r.species] : SPECIES[r.species] ? SPECIES[r.species][1] : NaN), kd = parseFloat(r.kd != null && r.kd !== '' ? r.kd : s.kd), D = parseFloat(r.D), t = parseFloat(r.gwGL), h = parseFloat(r.hag);
    var miss = [!(D > 0) && 'ground diameter', !r.species && 'species', r.species && !(fb > 0) && 'fb for ' + r.species, !(kd > 0) && 'kd', !(h > 0) && 'height'].filter(Boolean);
    if (miss.length) return { miss: miss };
    var at = r.at != null && r.at !== '' ? +r.at : 1, D0 = D; D = D0 - ((SPECIES[r.species] || [])[3] || 10) * at; var dec = t > 0 && t < D / 2 ? D - 2 * t : 0, De = Math.sqrt(D * D - dec * dec), Z = Math.PI * De * De * De / 32;
    var base = +s.phi * kd * +s.k20 * +s.k21 * +s.k22 * fb * Z / 1e6, m1 = base * +s.k1w, m2 = base * +s.k1l;
    return { m1: m1, m2: m2, t1: m1 / h, t2: m2 / h, De: De, Dsec: D, at: at };
  }
  // Saved like PNW does it: the result becomes a pole type coded with the pole number, selected as this pole's type.
  // Tip/butt diameters and weight use the module's defaults shown in the PNW screen: taper 10 mm/m, timber density 1100 kg/m³.
  function strPane(id) {
    var r = strRow(id); if (!r) return '<p class="pd-none">No inspection data for ' + esc(id) + '. Import the pole inspections file.</p>';
    if (r.concrete) return '<p class="pd-none">' + esc(id) + ' is a concrete pole: the strength module is for wood poles.</p>';
    var s = strSet(), c = strCalc(r), o = s.poles[id] || {}, saved = (S.design.poleLib || {})[id];
    var fld = function (k, label, v, w, ttl) { return '<label class="ps-f"' + (ttl ? ' title="' + esc(ttl) + '"' : '') + '><small>' + label + '</small><input data-pps="' + k + '" value="' + esc(v == null ? '' : String(v)) + '" style="width:' + (w || 60) + 'px"></label>'; };
    var spSel = '<label class="ps-f"><small>Species</small><select data-pps="species"><option value="">Choose…</option>' + Object.keys(SPECIES).map(function (k) { return '<option value="' + k + '"' + (k === r.species ? ' selected' : '') + '>' + k + ' · ' + esc(SPECIES[k][0]) + '</option>'; }).join('') + '</select></label>';
    var h = (r.manual ? '<p class="hint">No inspection data for ' + esc(id) + ': enter the inputs by hand.</p>' : '') + '<div class="ps-grid">' + spSel + fld('fb', 'fb MPa', r.species ? (s.fb[r.species] != null ? s.fb[r.species] : SPECIES[r.species] ? SPECIES[r.species][1] : '') : '', 56, 'Bending strength, PNW Species table (Western Power set)') + fld('age', 'Age y', r.age, 44, 'Pole age from the install year; kd follows it') + fld('kd', 'kd', r.kd != null && r.kd !== '' ? r.kd : s.kd, 54, 'Degradation factor from the pole age (PNW, new pole life 50 years). Type a value to override') +
      fld('D', 'GL Ø mm', r.D, 54, 'Ground-line diameter' + (r.date ? ', inspection ' + r.date : '')) + fld('at', 'Section m AGL', r.at != null && r.at !== '' ? r.at : 1, 44, 'Height of the critical section above ground (PNW: Diameter @ 1.0). Its diameter = GL diameter − mid taper × height') + fld('gwGL', 'Good wood', r.gwGL, 54, 'Good wood at the section. Blank = solid; a value = central decay') + '</div>';
    h += '<p class="meta">L ' + f2(r.L, 1) + ' m · sunk ' + f2(r.sunk, 2) + ' m · height ' + f2(r.hag, 2) + ' m' + (r.gw1 ? ' · good wood 1 m ' + r.gw1 + ' mm' : '') + (r.year ? ' · installed ' + r.year + ' (' + r.age + ' y)' : '') + (r.date ? ' · inspected ' + r.date : '') + '</p>';
    h += c.miss ? '<p class="ps-need">Enter the ' + esc(c.miss.join(', ')) + ' above to calculate the strength. Save as pole type unlocks when they are filled.</p>' : '<p class="meta">Section at ' + c.at + ' m: Ø ' + f2(c.Dsec, 0) + ' mm</p><div class="ps-res"><span>Loading 1 <b>' + f2(c.t1, 2) + ' kN</b> <small>' + f2(c.m1, 1) + ' kN·m</small></span><span>Loading 2 <b>' + f2(c.t2, 2) + ' kN</b> <small>' + f2(c.m2, 1) + ' kN·m</small></span></div>';
    h += '<div class="btnrow"><button class="btn small primary" data-pstrgo="' + esc(id) + '"' + (c.miss ? ' disabled' : '') + '>' + (saved ? 'Recalculate pole type ' : 'Save as pole type ') + esc(id) + '</button>' + (saved ? '<span class="meta">Pole type ' + esc(saved.code) + ': ' + f2(saved.ultimate, 2) + ' kN</span>' : '') + '</div>';
    return h;
  }
  function strCode(id) { return 'Existing-' + id; }
  // Strength button: calculate and save straight away; if inputs are missing, ask for them in a floating box beside the button.
  function strStart(id, btn) {
    var old = $('strPop'); if (old) old.remove();
    var r = strRow(id), c = r && strCalc(r);
    if (r && !r.concrete && c && !c.miss) { strApply(id); return; }
    var pop = document.createElement('div'); pop.id = 'strPop'; pop.className = 'pop'; pop.setAttribute('role', 'dialog');
    var h = '<b>Pole strength ' + esc(id) + '</b>';
    if (!r) h += '<p class="hint bad">No inspection data for ' + esc(id) + '. Import the pole inspections file first.</p>';
    else if (r.concrete) h += '<p class="hint">' + esc(id) + ' is a concrete pole: the strength module is for wood poles.</p>';
    else {
      var m = c.miss.join(' '), f = function (k, label, v) { return '<label>' + label + ' <input data-sp="' + k + '" value="' + esc(v == null ? '' : String(v)) + '" inputmode="decimal" style="width:80px"></label>'; };
      if (r.manual) h += '<p class="hint" style="margin:4px 0">No inspection data for ' + esc(id) + ': enter the values from the field.</p>';
      h += '<p class="meta" style="margin:4px 0">Missing: ' + esc(c.miss.join(', ')) + '</p>';
      h += '<label>Species <select data-sp="species"><option value="">Choose…</option>' + Object.keys(SPECIES).map(function (k) { return '<option value="' + k + '"' + (k === r.species ? ' selected' : '') + '>' + k + ' · ' + esc(SPECIES[k][0]) + '</option>'; }).join('') + '</select></label>';
      if (/fb for/.test(m)) h += f('fb', 'fb MPa', '');
      h += f('D', 'GL diameter mm', r.D) + f('gwGL', 'Good wood mm (blank = solid)', r.gwGL) + f('age', 'Pole age (years)', r.age) + f('L', 'Pole length m', r.L);
      h += '<div class="btnrow"><button class="btn small primary" data-spgo>Calculate and save</button><button class="btn small" data-spx>Cancel</button></div>';
    }
    if (!r || r.concrete) h += '<div class="btnrow"><button class="btn small" data-spx>Close</button></div>';
    pop.innerHTML = h; document.body.appendChild(pop);
    var b = btn.getBoundingClientRect(); pop.style.position = 'fixed'; pop.style.top = Math.max(8, Math.min(b.bottom + 6, innerHeight - pop.offsetHeight - 8)) + 'px'; pop.style.left = Math.max(8, Math.min(b.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    var first = pop.querySelector('select,input'); if (first) first.focus();
    pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') pop.remove(); if (e.key === 'Enter' && pop.querySelector('[data-spgo]')) pop.querySelector('[data-spgo]').click(); });
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-spx]')) { pop.remove(); return; }
      if (!e.target.closest('[data-spgo]')) return;
      var ss = strSet(), po = ss.poles[id] = ss.poles[id] || {};
      Array.prototype.forEach.call(pop.querySelectorAll('[data-sp]'), function (el) {
        var k = el.dataset.sp, v = el.value.trim(); if (v === '') return;
        if (k === 'species') po.species = v;
        else if (k === 'fb') { var sp = po.species || r.species; if (sp) ss.fb[sp] = parseFloat(v); }
        else if (k === 'L') { if (parseFloat(v) === +r.L) return; po.L = parseFloat(v); po.sunk = PNW.settingDepth(po.L); po.hag = Math.round((po.L - po.sunk) * 100) / 100; }
        else po[k] = parseFloat(v);
      });
      save();
      var c2 = strCalc(strRow(id));
      pop.remove();
      if (c2.miss) { strStart(id, btn.isConnected ? btn : document.querySelector('[data-pstropen="' + id + '"]') || btn); setStatus('Still missing for ' + id + ': ' + c2.miss.join(', ') + '.', 'bad'); return; }
      strApply(id);
    });
    setTimeout(function () { document.addEventListener('mousedown', function off(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', off); if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } }); }, 0);
  }
  function strApply(id) {
    var r = strRow(id), c = r && strCalc(r); if (!c || c.miss) { openSection('pstr'); saveUi(); renderSelected(); setStatus('Pole strength for ' + id + ' needs ' + ((c && c.miss) || ['inspection data']).join(', ') + '.', 'bad'); return; }
    var spd = SPECIES[r.species] || [], D = +r.D, L = +r.L, sk = +r.sunk, hg = +r.hag, tp = spd[3] || 10, dens = spd[2] || 1100, dT = D - tp * hg, dB = D + tp * sk, fr = function (a, b, len) { return Math.PI / 12 * len * (a * a + a * b + b * b) / 1e6; };
    var ent = { code: strCode(id), description: 'Existing ' + (SPECIES[r.species] ? SPECIES[r.species][0] : r.species || 'wood') + ' ' + L + 'm/' + c.t1.toFixed(2) + 'kN (pole strength ' + new Date().toISOString().slice(0, 10) + ')', length: L, sinking: sk, height: hg, material: 'Wood',
      diamTip: Math.round(dT), diamGL: D, diamButt: Math.round(dB), diamAvg: Math.round(D - tp * hg / 2), weight: Math.round(dens * (fr(D, dT, hg) + fr(dB, D, sk))), ultimate: Math.round(c.t1 * 100) / 100, vertical: null, kN: Math.round(c.t1 * 100) / 100,
      selfSupporting: false, strength: { m1: c.m1, m2: c.m2, t1: c.t1, t2: c.t2, inputs: r } };
    (S.design.poleLib = S.design.poleLib || {})[id] = ent;
    var types = S.design.poleTypes = S.design.poleTypes || {}, before = types[id] || '', inProj = project && project.poles.some(function (x) { return x.ID === id; });
    var msg = 'Pole type ' + ent.code + ' saved (' + ent.ultimate + ' kN wind, ' + c.t2.toFixed(2) + ' kN long term) and selected for ' + id + '.';
    openSection('pstr'); saveUi(); // show the calculation, so the click visibly does something even when the type was already set
    if (inProj) { syncDesign(); commit(function (p) { M.updatePole(p, id, { length: L, sunk: sk }); types[id] = ent.code; return [logEntry(id, '', 'Pole type', before, ent.code + ' (' + ent.description + ')', 'calculated', 'PNW Pole Strength, limit state method')]; }); }
    else { types[id] = ent.code; S.design.log = liveLog().concat([logEntry(id, '', 'Pole type', before, ent.code, 'calculated', 'PNW Pole Strength, limit state method')]); recompute(); }
    setStatus(msg, 'good');
  }
  var FN = {
    delPole: function () { var ids = S.multi && S.multi.length > 1 ? S.multi.slice() : (S.selected ? [S.selected] : []); if (!ids.length) { setStatus('Select a pole first.', 'bad'); return; } delPoles(ids); },
    mkProf: function () { profPickDlg(S.multi && S.multi.length > 1 ? S.multi.slice() : S.selected ? [S.selected] : []); },
    editSpan: function () { if (!S.selSpan) { setStatus('Select a span first: click a span on the plan, the profile or the Span table.', 'bad'); return; } runWb('spanedit'); },
    construction: function () { var id = S.selected; if (!id) { setStatus('Select a pole first.', 'bad'); return; } if (!project) { setStatus('Start a design first to add constructions.', 'bad'); return; } U.right = true; applyLayout(); openSection('design'); saveUi(); select(id); },
    sagten: function () { navGo('sag'); },
    validate: function () { recompute(); openTab('issues'); var e = allIssues.filter(function (i) { return i.level === 'error'; }).length, w = allIssues.filter(function (i) { return i.level === 'warning'; }).length; setStatus('Validated and recalculated: ' + e + ' error' + (e === 1 ? '' : 's') + ', ' + w + ' warning' + (w === 1 ? '' : 's') + '.', e ? 'bad' : 'good'); },
    settings: function () { U.left = true; applyLayout(); $('secProject').open = true; $('secProject').scrollIntoView({ block: 'nearest' }); },
    sagset: function () { if (!$('dispBtn').offsetParent) { setView('profile'); setStatus('Sag display options are in the Profile and 3D views.'); } setTimeout(function () { if ($('dispPop').hidden) $('dispBtn').click(); }, 60); },
    'pan:an': function () { U.anOpen = !U.anOpen; saveUi(); renderAnalysis(); setTimeout(function () { if (map && map.invalidateSize) map.invalidateSize(); }, 30); }
  };
  function ribBtn(d) {
    var id = d[0], title = d[1], type = d[3];
    return '<button class="rbt" data-rid="' + esc(id) + '" data-rt="' + type + '" title="' + esc(d[4] || title) + '" aria-label="' + esc(title) + '"><span class="ic">' + ico(d[2]) + '</span><span>' + esc(title) + '</span></button>';
  }
  function renderRibbon() {
    if (U.ribMin == null) U.ribMin = window.innerHeight < 900 || window.innerWidth < 700;
    $('ribbon').classList.toggle('min', !!U.ribMin);
    $('rtabs').innerHTML = RIB.map(function (t) { return '<button role="tab" data-rtab="' + t[0] + '" class="' + (t[0] === ribTab && !U.ribMin ? 'on' : '') + '" aria-selected="' + (t[0] === ribTab) + '" title="Double-click to ' + (U.ribMin ? 'pin' : 'collapse') + ' the ribbon">' + t[0] + '</button>'; }).join('') +
      '<span class="grow" style="flex:1"></span><button id="ribMin" class="ribmin" title="' + (U.ribMin ? 'Show the ribbon' : 'Collapse the ribbon to its tabs for more drawing space') + '" aria-label="' + (U.ribMin ? 'Show the ribbon' : 'Collapse the ribbon') + '" aria-expanded="' + !U.ribMin + '">' + (U.ribMin ? '▾' : '▴') + '</button>';
    var tab = RIB.filter(function (t) { return t[0] === ribTab; })[0] || RIB[0];
    $('rbody').innerHTML = tab[1].map(function (g) {
      var inner = g[1].map(function (d) {
        if (d[0] === 'chk') { var pv = /^pv:/.test(d[1][0][0]); return '<details class="rdd"><summary class="rbt" title="' + (pv ? 'Profile and 3D layers' : 'Plan layers') + '"><span class="ic">' + ico('layout-grid') + '</span><span>' + (pv ? 'Profile layers' : 'Plan layers') + ' ▾</span></summary><div class="rddm">' + d[1].map(function (c) { return '<label class="rchk"><input type="checkbox" data-rchk="' + c[0] + '"> ' + c[1] + '</label>'; }).join('') + '</div></details>'; }
        return ribBtn(d);
      }).join('');
      return '<div class="rgrp" role="group" aria-label="' + g[0] + '" title="' + g[0] + '"><div class="rbtns">' + inner + '</div><div class="rlab">' + g[0] + '</div></div>';
    }).join('');
    syncRibbon(); rove();
    // Layer dropdowns: one per menu open at a time, placed under their button (the ribbon scrolls sideways, so the menu is fixed).
    Array.prototype.forEach.call(document.querySelectorAll('#rbody .rdd'), function (dd) {
      dd.addEventListener('toggle', function () { if (!dd.open) return; Array.prototype.forEach.call(document.querySelectorAll('#rbody .rdd[open]'), function (o) { if (o !== dd) o.open = false; }); var r = dd.querySelector('summary').getBoundingClientRect(), m = dd.querySelector('.rddm'); m.style.left = Math.min(r.left, innerWidth - 200) + 'px'; m.style.top = r.bottom + 2 + 'px'; });
    });
  }
  document.addEventListener('click', function (e) { if (!e.target.closest('.rdd')) Array.prototype.forEach.call(document.querySelectorAll('#rbody .rdd[open]'), function (o) { o.open = false; }); });
  // Arrow keys move within the ribbon tabs and within the ribbon buttons; each is one Tab stop.
  function rove() {
    [['#rtabs', '[data-rtab]'], ['#rbody', '.rbt, [data-rchk]']].forEach(function (g) {
      var els = Array.prototype.slice.call(document.querySelectorAll(g[0] + ' ' + g[1].split(', ').join(', ' + g[0] + ' '))), cur = els.filter(function (el) { return el.classList.contains('on'); })[0] || els[0];
      els.forEach(function (el) { el.tabIndex = el === cur ? 0 : -1; });
    });
  }
  ['rtabs', 'rbody'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      var k = e.key; if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(k)) return;
      var els = Array.prototype.slice.call($(id).querySelectorAll(id === 'rtabs' ? '[data-rtab]' : '.rbt, [data-rchk]')).filter(function (el) { return !el.disabled && el.offsetParent; }), i = els.indexOf(document.activeElement); if (i < 0) return;
      var j = k === 'Home' ? 0 : k === 'End' ? els.length - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + els.length) % els.length;
      e.preventDefault(); els.forEach(function (el) { el.tabIndex = -1; }); els[j].tabIndex = 0; els[j].focus();
    });
  });
  function syncRibbon() {
    Array.prototype.forEach.call(document.querySelectorAll('#rbody .rbt'), function (b) {
      var id = b.dataset.rid, t = b.dataset.rt, on = false, dis = false;
      if (t === 'tool') on = planTool === id; else if (t === 'multi') on = multiMode; else if (t === 'view') on = S.view === id.slice(2);
      else if (t === 'run') { var el = $(id.replace(/^pan:/, '')); if (el) { dis = el.disabled; if (/^pan:/.test(id)) on = el.classList.contains('on'); if (id === 'tbLabels') on = !!S.labels; } }
      else if (id === 'pan:an') on = U.anOpen;
      if (b.dataset.tt == null) b.dataset.tt = b.title;
      b.classList.toggle('on', on); b.disabled = dis; b.setAttribute('aria-pressed', on); b.title = b.dataset.tt + (dis ? ' (not available yet: ' + (S.files.length ? 'select a pole first' : 'import the survey files first') + ')' : '');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#rbody [data-rchk]'), function (c) { var k = c.dataset.rchk; c.checked = /^pv:/.test(k) ? pvShow()[k.slice(3)] : !!($(k) && $(k).checked); });
  }
  function ribSet(min) { U.ribMin = min; saveUi(); renderRibbon(); setTimeout(function () { if (map && map.invalidateSize) map.invalidateSize(); if (S.view !== 'plan') renderViews(); }, 30); }
  $('rtabs').addEventListener('click', function (e) {
    if (e.target.closest('#ribMin')) { ribSet(!U.ribMin); return; }
    var b = e.target.closest('[data-rtab]'); if (!b) return;
    ribTab = U.rtab = b.dataset.rtab; if (U.ribMin) ribSet(false); else { saveUi(); renderRibbon(); }
  });
  $('rtabs').addEventListener('dblclick', function (e) { if (e.target.closest('[data-rtab]')) ribSet(!U.ribMin); });
  // Single-key tools (not while typing) and Ctrl+K for search.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); $('gsearch').focus(); $('gsearch').select(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('genDlg').hidden) return;
    var t = { v: 'select', h: 'pan', m: 'measure', b: 'rect', p: 'poly', l: 'lasso' }[e.key.toLowerCase()]; if (!t) return;
    setTool(t); if (S.view !== 'plan' && S.view !== 'split') setView('plan'); syncRibbon();
  });
  $('rbody').addEventListener('click', function (e) {
    var b = e.target.closest('.rbt'); if (!b || b.disabled) return;
    var id = b.dataset.rid, t = b.dataset.rt;
    if (t === 'tool') { if (id === 'fit' && S.view !== 'plan') $('tbFit').click(); else setTool(id); if (id !== 'fit' && S.view !== 'plan') setView('plan'); }
    else if (t === 'multi') { multiMode = !multiMode; updToolStatus(); }
    else if (t === 'zoom') { if (S.view === 'profile' || S.view === 'split') pvZoom(id === 'zin' ? 0.7 : 1 / 0.7); else if (map && map.zoomIn) (id === 'zin' ? map.zoomIn() : map.zoomOut()); }
    else if (t === 'view') setView(id.slice(2));
    else if (t === 'run') { var el = $(id.replace(/^pan:/, '')); if (el) el.click(); }
    else if (t === 'fn') FN[id] && FN[id]();
    setTimeout(syncRibbon, 0);
  });
  $('rbody').addEventListener('change', function (e) {
    var c = e.target.closest('[data-rchk]'); if (!c) return; var k = c.dataset.rchk;
    if (/^pv:/.test(k)) { var s = U.pvShow = U.pvShow || {}; s[k.slice(3)] = c.checked; saveUi(); syncPvTools(); if (S.view === 'profile' || S.view === 'split' || U.anOpen) renderProfileView(); }
    else if ($(k) && $(k).checked !== c.checked) $(k).click();
  });

  /* title bar */
  $('bell').onclick = function () { $('tbIssues').click(); };
  $('helpBtn').onclick = function () {
    openGen('Shortcuts', '<table class="props"><tr><th>Shift / Ctrl + click</th><td>Add a pole to the selection (plan, profile, tables)</td></tr><tr><th>[ and ]</th><td>Previous / next pole along the line</td></tr><tr><th>Z</th><td>Zoom the current view to the selection</td></tr><tr><th>Esc</th><td>Clear the selection</td></tr><tr><th>?</th><td>Open this list</td></tr><tr><th>S</th><td>Snap on / off</td></tr><tr><th>Wheel / drag</th><td>Zoom and pan the profile; double-click fits it</td></tr><tr><th>Ctrl+Z / Ctrl+Y</th><td>Undo / redo</td></tr><tr><th>Search box</th><td>Type a pole, a span (A → B) or a command such as “Add pole”</td></tr></table>', { narrow: true });
  };
  function allCommands() { var out = []; RIB.forEach(function (t) { t[1].forEach(function (g) { g[1].forEach(function (d) { if (d[0] !== 'chk' && d[3] && d[3] !== 'view' && d[3] !== 'zoom' && d[3] !== 'multi') if (!out.some(function (o) { return o.id === d[0]; })) out.push({ id: d[0], type: d[3], name: d[1] }); }); }); }); return out; }
  document.addEventListener('keydown', function (e) { if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && $('genDlg').hidden) { snapOn = !snapOn; syncSnap(); } });
  document.addEventListener('keydown', function (e) { if (e.key === '?' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && $('genDlg').hidden) { e.preventDefault(); $('helpBtn').click(); } });
  function syncSnap() { $('sbSnap').classList.toggle('on', snapOn); $('sbSnap').innerHTML = 'Snap: <b>' + (snapOn ? 'ON' : 'OFF') + '</b>'; }
  $('sbSnap').onclick = function () { snapOn = !snapOn; syncSnap(); };

  /* status readouts: coordinates, scale */
  map.on('mousemove', function (e) { var xy = e && e.latlng && fromLatLng(e.latlng); if (xy) $('sbCoord').innerHTML = 'E <b>' + xy.e.toFixed(1) + '</b> N <b>' + xy.n.toFixed(1) + '</b>'; });
  function updScale() {
    try { var z = map.getZoom(), lat = map.getCenter().lat, mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z), n = Math.round(mpp / 0.0002646); $('sbScale').innerHTML = 'Scale <b>1:' + n.toLocaleString('en-AU') + '</b>'; } catch (e) { /* stub map */ }
  }
  map.on('zoomend', updScale); map.on('moveend', updScale);

  /* project explorer */
  function exKey(k) { return U.exp && U.exp[k] !== undefined ? U.exp[k] : ({ layers: false, design: true, poles: false, spans: false, conds: false, equip: false, cons: false, profiles: true, files: false })[k]; }
  function exNode(k, title, count, inner) { return '<details data-k="' + k + '"' + (exKey(k) ? ' open' : '') + '><summary>' + title + (count != null ? ' <small style="color:#7f93ad">(' + count + ')</small>' : '') + '</summary><div class="xn">' + inner + '</div></details>'; }
  function exItem(attrs, ico, label, sub, sel) { return '<div class="xi' + (sel ? ' sel' : '') + '" ' + attrs + '><i>' + ico + '</i><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function exChk(src, label, on) { return '<label class="xi"><input type="checkbox" data-xl="' + src + '"' + (on ? ' checked' : '') + '> ' + label + '</label>'; }
  function renderExplorer() {
    var ex = $('explorer'); if (!ex) return;
    var ids = lineIds(), allIds = Object.keys(merged.poles).sort(), sv = pvShow(), cap = 250;
    var spans = spanList(), secs = sectionRows(), exx = S.design.extras || {}, tx = [], st = [];
    Object.keys(exx).forEach(function (p) { (exx[p].plant || []).forEach(function (x, i) { tx.push({ p: p, i: i, x: x }); }); (exx[p].stays || []).forEach(function (x, i) { st.push({ p: p, i: i, x: x }); }); });
    var cons = {}; if (dm) dm.constructions.forEach(function (c) { cons[c.code] = (cons[c.code] || 0) + 1; });
    var h = exItem('data-xact="settings"', '⚙', 'Project Settings') +
      exNode('layers', '▤ Layers', null,
        exChk('lySurvey', 'Poles', $('lySurvey').checked) + exChk('lyAlign', 'Spans', $('lyAlign').checked) + exChk('lySpanLbl', 'Span lengths', $('lySpanLbl').checked) + exChk('lyGis', 'GIS positions', $('lyGis').checked) + exChk('lyExtent', 'Project extent', $('lyExtent').checked) +
        exChk('pv:hv', 'Conductors (HV)', sv.hv) + exChk('pv:lv', 'Conductors (LV)', sv.lv) + exChk('pv:earth', 'Earth wire', sv.earth) + exChk('pv:ground', 'Ground profile', sv.ground) + exChk('pv:clr', 'Clearance line', sv.clr) + exChk('pv:att', 'Attachments', sv.att) + exChk('lbl', 'Labels', !!S.labels)) +
      exNode('design', '▦ Design Data', null,
        exNode('poles', 'Poles', allIds.length, allIds.slice(0, cap).map(function (k) { return exItem('data-xp="' + esc(k) + '"', '●', esc(k), ids.indexOf(k) >= 0 ? '#' + (ids.indexOf(k) + 1) : '', isSel(k)); }).join('') + (allIds.length > cap ? '<div class="xmore">+ ' + (allIds.length - cap) + ' more: use the Poles table</div>' : '')) +
        exNode('spans', 'Spans', spans.length, spans.slice(0, cap).map(function (s) { var on = S.selSpan && !S.selected && S.selSpan.a === s.a && S.selSpan.b === s.b; return exItem('data-xs="' + esc(s.a) + '|' + esc(s.b) + '"', '↔', esc(s.a) + ' → ' + esc(s.b), s.len != null ? s.len.toFixed(2) + ' m' : '', on); }).join('')) +
        exNode('conds', 'Conductors', secs.length, secs.map(function (r) { return exItem('data-xc="' + esc(r.name) + '" data-xcp="' + esc(r.first || '') + '"', '〰', esc(r.name) + ' · ' + esc(r.conductor), esc(r.tension), S.selSection === r.name); }).join('')) +
        exNode('equip', 'Equipment', tx.length + st.length, tx.map(function (t) { return exItem('data-xe="' + esc(t.p) + '|plant|' + t.i + '"', '▣', 'Transformer · ' + esc(t.p), esc(t.x.code || '')); }).join('') + st.map(function (t) { return exItem('data-xe="' + esc(t.p) + '|stay|' + t.i + '"', '⟋', 'Stay · ' + esc(t.p), esc(t.x.wire || '')); }).join('')) +
        exNode('cons', 'Construction', Object.keys(cons).length, Object.keys(cons).sort().map(function (c) { return exItem('data-xact="reg"', '⊞', esc(c), '×' + cons[c]); }).join('')) +
        exNode('profiles', 'Profiles', S.profiles.length, S.profiles.map(function (p, i) { return exItem('data-xprof="' + i + '"', '📈', esc(p.name || 'Profile ' + (i + 1)) + (i === S.active ? '<span class="act">Active</span>' : '') + '<button class="xauto" data-xauto="' + i + '" title="Auto design this profile: constructions and conductors from photos / Street View">🪄</button>', p.poleIds.length + ' poles', false); }).join('') + exItem('data-xact="newprof"', '＋', 'New profile…'))) +
      exNode('files', '🗂 Files', S.files.length, exItem('data-xact="import"', '⇪', 'Import files…') + exItem('data-xact="imported"', '🗂', 'Review imported files…', S.files.length ? String(S.files.length) : '') + exItem('data-xact="photos"', '📷', 'Pole photos…'));
    if (ex.dataset.h !== h) { var sc = ex.parentNode.scrollTop; ex.innerHTML = h; ex.dataset.h = h; ex.parentNode.scrollTop = sc; }
  }
  $('explorer').addEventListener('toggle', function (e) { var d = e.target; if (d.dataset && d.dataset.k) { (U.exp = U.exp || {})[d.dataset.k] = d.open; saveUi(); } }, true);
  $('explorer').addEventListener('click', function (e) {
    var t = e.target.closest('[data-xp],[data-xs],[data-xc],[data-xe],[data-xprof],[data-xact]'); if (!t) return;
    var d = t.dataset;
    if (d.xp) { select(d.xp, addInfo(e)); showPole(d.xp); }
    else if (d.xs) { var k = d.xs.split('|'); selectSpan(k[0], k[1]); }
    else if (d.xc) select(d.xcp || S.selected, { segment: d.xc });
    else if (d.xe) { var q = d.xe.split('|'); S.selEquip = { pole: q[0], kind: q[1] === 'stay' ? 'stay' : 'transformer', i: +q[2] }; openSection('equip'); select(q[0]); }
    else if (d.xprof != null) { switchProfile(d.xprof); }
    else if (d.xact === 'settings') FN.settings();
    else if (d.xact === 'reg') openTab('register');
    else if (d.xact === 'newprof') $('newProfile').click();
    else if (d.xact === 'import') $('tbUpload').click();
    else if (d.xact === 'imported') $('mImported').click();
    else if (d.xact === 'photos') $('mPhotos').click();
  });
  $('explorer').addEventListener('change', function (e) {
    var c = e.target.closest('[data-xl]'); if (!c) return; var k = c.dataset.xl;
    if (/^pv:/.test(k)) { var s = U.pvShow = U.pvShow || {}; s[k.slice(3)] = c.checked; saveUi(); syncPvTools(); renderProfileView(); }
    else if (k === 'lbl') $('tbLabels').click();
    else if ($(k) && $(k).checked !== c.checked) $(k).click();
  });

  /* plan: select a profile directly, bulk new profile */
  (function () {
    $('planTools').insertAdjacentHTML('beforeend', '<select id="planProf" title="Active profile: switch or start a new one from the plan" aria-label="Profile"></select>');
    $('planProf').onchange = function () { if (this.value === 'new') { this.value = String(S.active); $('newProfile').click(); } else { switchProfile(this.value); } };
  })();
  function syncPlanProf() { var s = $('planProf'); s.innerHTML = S.profiles.map(function (p, i) { return '<option value="' + i + '"' + (i === S.active ? ' selected' : '') + '>' + esc(p.name || 'Profile ' + (i + 1)) + '</option>'; }).join('') + '<option value="new">＋ New profile…</option>'; }

  /* docked profile controls in the analysis header */
  (function () {
    $('anMin').parentNode.insertAdjacentHTML('afterbegin', '<span id="anCtl" class="rchk-row" style="display:flex;gap:8px;align-items:center;margin-right:8px"><select id="anProf" aria-label="Profile"></select><span style="color:#8fa2bb;font-size:11px">Show:</span><label class="rchk"><input type="checkbox" data-anshow="ground"> Ground</label><label class="rchk"><input type="checkbox" data-anshow="hv"> HV</label><label class="rchk"><input type="checkbox" data-anshow="lv"> LV</label><button class="btn small" id="anExpand" title="Open the profile in the main workspace">⤢</button></span>');
    $('anProf').onchange = function () { switchProfile(this.value); };
    $('anCtl').addEventListener('change', function (e) { var c = e.target.closest('[data-anshow]'); if (!c) return; var s = U.pvShow = U.pvShow || {}; s[c.dataset.anshow] = c.checked; saveUi(); syncPvTools(); renderProfileView(); });
    $('anExpand').onclick = function () { setView('profile'); };
  })();
  function syncAnCtl() {
    var on = U.an === 'profile' && U.anOpen && S.view !== 'profile' && S.view !== 'split'; $('anCtl').style.display = on ? 'flex' : 'none'; if (!on) return;
    $('anProf').innerHTML = S.profiles.map(function (p, i) { return '<option value="' + i + '"' + (i === S.active ? ' selected' : '') + '>' + esc(p.name || 'Profile ' + (i + 1)) + '</option>'; }).join('');
    var s = pvShow(); Array.prototype.forEach.call(document.querySelectorAll('[data-anshow]'), function (c) { c.checked = s[c.dataset.anshow]; });
  }

  /* data tables: Poles, Spans, Conductors, Attachments, Transformers, Stays, Warnings (+ more) */
  (function () {
    var tabs = document.querySelector('.tabs'), tools = tabs.querySelector('.tools');
    ['transformers', 'stays'].forEach(function (k) { var b = document.createElement('button'); b.setAttribute('role', 'tab'); b.dataset.tab = k; b.setAttribute('aria-selected', 'false'); b.onclick = function () { setTab(k); }; tabs.insertBefore(b, tools); });
    var main = [['poles', 'Poles'], ['spans', 'Spans'], ['sections', 'Conductors'], ['heights', 'Attachments'], ['transformers', 'Transformers'], ['stays', 'Stays'], ['issues', 'Warnings']];
    main.forEach(function (m) { var b = tabs.querySelector('[data-tab=' + m[0] + ']'); b.textContent = m[1]; tabs.insertBefore(b, tools); });
    var more = [['calc', 'Calculation Results'], ['tipsum', 'Tipload Summary'], ['register', 'Construction Register'], ['log', 'Change Log']];
    more.forEach(function (m) { tabs.querySelector('[data-tab=' + m[0] + ']').hidden = true; });
    var sel = document.createElement('select'); sel.id = 'tabMore'; sel.setAttribute('aria-label', 'More tables'); sel.innerHTML = '<option value="">More…</option>' + more.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('');
    sel.onchange = function () { if (this.value) setTab(this.value); };
    tabs.insertBefore(sel, tools);
  })();
  function syncTabMore() { var s = $('tabMore'); if (!s) return; var sec = /^(calc|tipsum|register|log)$/.test(tab); s.value = sec ? tab : ''; s.classList.toggle('on', sec); }
  function equipTable(kind) {
    var ex = S.design.extras || {}, rows = [], ids = lineIds().concat(Object.keys(ex).filter(function (k) { return lineIds().indexOf(k) < 0; }));
    ids.forEach(function (p) { var l = ex[p] && (kind === 'stays' ? ex[p].stays : ex[p].plant) || []; l.forEach(function (x, i) { rows.push({ p: p, i: i, x: x }); }); });
    if (!rows.length) return '<p class="anmsg">No ' + (kind === 'stays' ? 'stays' : 'transformers') + ' yet. Select a pole and use ' + (kind === 'stays' ? 'Add Stay' : 'Add Transformer') + ' in the ribbon.</p>';
    var head = kind === 'stays' ? '<th>Pole</th><th>Wire</th><th class="num">Attach. height (m)</th><th class="num">Direction (°)</th><th class="num">Angle (°)</th>' : '<th>Pole</th><th>Code</th><th>Arrangement</th><th class="num">Attach. height (m)</th><th class="num">Direction (°)</th>';
    return '<table class="grid"><thead><tr>' + head + '</tr></thead><tbody>' + rows.map(function (r) {
      var on = S.selEquip && S.selEquip.pole === r.p && S.selEquip.i === r.i && (S.selEquip.kind === 'stay') === (kind === 'stays');
      return '<tr data-eqrow="' + esc(r.p) + '|' + (kind === 'stays' ? 'stay' : 'plant') + '|' + r.i + '" class="' + (on ? 'sel' : '') + '"><td><b>' + esc(r.p) + '</b></td>' + (kind === 'stays' ? '<td>' + esc(r.x.wire) + '</td><td class="num">' + f2(r.x.attHt, 2) + '</td><td class="num">' + f2(r.x.dir, 0) + '</td><td class="num">' + f2(r.x.angle, 0) + '</td>' : '<td>' + esc(r.x.code) + '</td><td>' + esc(r.x.drawing || '') + '</td><td class="num">' + f2(r.x.attHt, 2) + '</td><td class="num">' + f2(r.x.dir, 0) + '</td>') + '</tr>';
    }).join('') + '</tbody></table>';
  }
  function attachPane(id) {
    var pts = dm ? dm.points.filter(function (q) { return q.pole === id; }) : [];
    if (!pts.length) return '<p class="hint">' + (project ? 'No attachment points on ' + esc(id) + ' yet. Add a construction first.' : 'Attachments come from the PNW design: link a project or start a design.') + '</p>';
    return '<table class="att"><tr><th>Construction</th><th class="num">#</th><th class="num">Height AG (m)</th></tr>' + pts.map(function (q) { return '<tr><td>' + esc(q.construction) + '</td><td class="num">' + esc(q.order) + '</td><td class="num">' + f2(q.heightAG, 3) + '</td></tr>'; }).join('') + '</table><p class="hint">Edit attachments in <button class="btn small" data-instab="design">Construction</button>.</p>';
  }
  document.addEventListener('click', function (e) {
    var r = e.target.closest('[data-eqrow]'); if (!r) return;
    var q = r.dataset.eqrow.split('|'); S.selEquip = { pole: q[0], kind: q[1] === 'stay' ? 'stay' : 'transformer', i: +q[2] }; openSection('equip'); U.right = true; applyLayout(); select(q[0]); showPole(q[0]);
  });
  function syncTitleBar() {
    var n = allIssues.filter(function (i) { return (i.level === 'error' || i.level === 'warning') && !isGap(i); }).length;
    $('bellN').hidden = !n; $('bellN').textContent = n; var u = (S.settings.createdBy || '').trim(); $('userName').textContent = u || 'Designer'; $('userIn').textContent = (u ? u.split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2) : 'D').toUpperCase();
  }

  function movePoleTo(ll) {
    var id = S.selected; if (!id) { setStatus('Move: select a pole first, then click its new position.', 'bad'); return; }
    var mf = S.files.filter(function (x) { return x.manual; })[0], it = mf && mf.items.filter(function (x) { return x.id === id; })[0];
    if (!it) { setStatus(id + ' comes from an imported survey, so it keeps its surveyed position. Only hand-made poles can be moved.', 'bad'); return; }
    var xy = fromLatLng(ll); if (!xy || !validMga(xy.e, xy.n)) { setStatus('That position is outside the valid MGA range.', 'bad'); return; }
    it.easting = Math.round(xy.e * 1000) / 1000; it.northing = Math.round(xy.n * 1000) / 1000;
    S.generated = false; recompute(); select(id); setStatus('Pole ' + id + ' moved to E ' + it.easting.toFixed(1) + ' N ' + it.northing.toFixed(1) + '.', 'good');
  }
  /* ---------- delete in the design (poles, spans, conductors), right-click menus, floating panels, header menus ---------- */
  function inDesign(id) { return !!(project && project.poles.some(function (r) { return r.ID === id; })); }
  function secsAt(a, b) { // strain sections strung across the span a–b (both poles in the section, next to each other)
    if (!project) return [];
    return project.segments.map(function (s) { return s.StrainSect; }).filter(function (n) {
      var m = project.segPoles.filter(function (r) { return r.strsection === n; }).sort(function (x, y) { return PNW.num(x.chain) - PNW.num(y.chain); }).map(function (r) { return r.id; });
      for (var i = 1; i < m.length; i++) if ((m[i - 1] === a && m[i] === b) || (m[i - 1] === b && m[i] === a)) return true; return false;
    });
  }
  function secsOn(id) { return project ? project.segPoles.filter(function (r) { return r.id === id; }).map(function (r) { return r.strsection; }).filter(function (v, i, a) { return a.indexOf(v) === i; }) : []; }
  // Removes design poles from the linked PNW project: conductors through them are cut there (the rest of each section stays).
  function delFromDesign(ids) {
    var d = ids.filter(inDesign); if (!d.length) return true;
    var ok = commit(function (p) {
      var cut = M.cutSections(p, { poles: d }), log = cut.map(function (c) { return logEntry('', c.split(' ')[0], 'Strain section', '', c, 'manual', 'Poles deleted: ' + d.join(', ')); });
      d.forEach(function (id) { M.removePole(p, id); log.push(logEntry(id, '', 'Pole', id, 'removed', 'manual')); if (S.design.extras) delete S.design.extras[id]; });
      return log;
    });
    return ok;
  }
  // Takes the span a–b out of the active profile: the poles before it stay, the poles after it become a new profile
  // (a part with one pole is dropped). Only for a profile without a linked design (a design's line is its .pnwx).
  // With a linked design only an end span can go (its end pole leaves the design); a middle span keeps the line whole.
  function spanCut(a, b) {
    var ids = project ? lineIds() : prof().poleIds, i = ids.indexOf(a), j = ids.indexOf(b);
    if (i < 0 || j < 0 || Math.abs(i - j) !== 1) return null;
    var k = Math.max(i, j), c = { A: ids.slice(0, k), B: ids.slice(k) };
    if (project) { if (c.A.length === 1) c.end = c.A[0]; else if (c.B.length === 1) c.end = c.B[0]; else return null; }
    return c;
  }
  function cutProfileSpan(a, b) {
    var c = spanCut(a, b); if (!c) return;
    var p = prof(), msg = [];
    if (c.end) { if (S.selSpan) S.selSpan = null; p.poleIds = p.poleIds.filter(function (x) { return x !== c.end; }); if (delFromDesign([c.end])) setStatus('Span ' + a + ' → ' + b + ' deleted: ' + c.end + ' left the design.', 'good'); else recompute(); return; }
    p.poleIds = c.A.length > 1 ? c.A : c.B.length > 1 ? c.B : [];
    if (c.A.length > 1 && c.B.length > 1) { var q = newProfile(uniqueProfName()); q.poleIds = c.B; q.lengths = Object.assign({}, p.lengths); S.profiles.push(q); msg.push(c.B[0] + ' → ' + c.B[c.B.length - 1] + ' is now ' + q.name); }
    if (S.selSpan) S.selSpan = null;
    S.generated = false; recompute();
    setStatus('Span ' + a + ' → ' + b + ' removed from ' + (p.name || 'the profile') + '.' + (msg.length ? ' ' + msg.join('') + '.' : ''), 'good');
  }
  function delSpan(a, b) {
    var ss = secsAt(a, b), cut = spanCut(a, b);
    if (!ss.length && !cut) { setStatus(project ? 'Span ' + a + ' → ' + b + ' is in the middle of the design line and has no conductors. Delete a pole to shorten the line, or make a new profile for each part.' : 'Span ' + a + ' → ' + b + ' is not in the active profile.', 'bad'); return; }
    var body = '';
    if (cut && cut.end) body += '<p>This is the end span of the design line: ' + esc(cut.end) + ' leaves the design (its constructions and conductors go with it).</p>';
    else if (cut) body += '<p>Remove the span from <b>' + esc(prof().name || 'the profile') + '</b>: ' + (cut.A.length > 1 && cut.B.length > 1 ? 'the line is split here and ' + esc(cut.B[0]) + ' → ' + esc(cut.B[cut.B.length - 1]) + ' (' + cut.B.length + ' poles) becomes a new profile.' : 'the end pole ' + esc(cut.A.length > 1 ? cut.B[0] : cut.A[0]) + ' leaves the profile.') + '</p>';
    if (ss.length) body += '<p>The conductors on this span (' + esc(ss.join(', ')) + ') are cut here. Each section keeps its part on either side as its own strain section; a part with one pole is removed.</p>';
    openGen('Delete span ' + a + ' → ' + b, body + '<div class="btnrow">' + (cut ? '<button class="btn danger" id="dsCut">Delete span</button>' : '') + (ss.length ? '<button class="btn danger" id="dsOk">Delete span conductors</button>' : '') + '<button class="btn" id="dsNo">Cancel</button></div>', { narrow: true });
    $('dsNo').onclick = closeGen;
    if ($('dsCut')) $('dsCut').onclick = function () { closeGen(); cutProfileSpan(a, b); };
    if (!$('dsOk')) return;
    $('dsOk').onclick = function () { closeGen(); var out; if (commit(function (p) { out = M.cutSections(p, { spans: [[a, b]] }); return out.map(function (c) { return logEntry('', c.split(' ')[0], 'Strain section', '', c, 'manual', 'Span ' + a + ' → ' + b + ' deleted'); }); })) setStatus('Span ' + a + ' → ' + b + ': ' + out.join('; ') + '.', 'good'); };
  }
  function delSection(name) {
    openGen('Delete conductor ' + name, '<p>Removes strain section <b>' + esc(name) + '</b> (its conductors on every span) from the design.</p><div class="btnrow"><button class="btn danger" id="dsOk">Delete</button><button class="btn" id="dsNo">Cancel</button></div>', { narrow: true });
    $('dsNo').onclick = closeGen;
    $('dsOk').onclick = function () { closeGen(); if (S.selSection === name) S.selSection = null; if (commit(function (p) { M.removeSection(p, name); return [logEntry('', name, 'Strain section', name, 'removed', 'manual')]; })) setStatus('Conductor ' + name + ' deleted.', 'good'); };
  }
  // Delete key: the multi-selection, the pole, the span or the conductor that is selected.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Delete' || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('genDlg').hidden) return;
    var ids = S.multi && S.multi.length > 1 ? S.multi.slice() : S.selected ? [S.selected] : [];
    if (ids.length) { e.preventDefault(); delPoles(ids); } else if (S.selSpan) { e.preventDefault(); delSpan(S.selSpan.a, S.selSpan.b); } else if (S.selSection) { e.preventDefault(); delSection(S.selSection); }
  });

  // Right-click menu
  var cm = document.createElement('div'); cm.className = 'cmenu'; cm.hidden = true; cm.setAttribute('role', 'menu'); document.body.appendChild(cm);
  function cmClose() { cm.hidden = true; cm.innerHTML = ''; }
  function cmOpen(x, y, title, items) {
    cm.innerHTML = (title ? '<div class="cmh">' + esc(title) + '</div>' : '') + items.map(function (it, i) { return it === '-' ? '<hr>' : '<button role="menuitem" data-cm="' + i + '"' + (it.danger ? ' class="danger"' : '') + (it.off ? ' disabled title="' + esc(it.off) + '"' : '') + '><span class="ic">' + (it.ic || '') + '</span>' + esc(it.t) + (it.k ? '<kbd>' + esc(it.k) + '</kbd>' : '') + '</button>'; }).join('');
    cm.hidden = false; cm.style.left = '0px'; cm.style.top = '0px';
    var r = cm.getBoundingClientRect(); cm.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px'; cm.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    cm.onclick = function (e) { var b = e.target.closest('[data-cm]'); if (!b || b.disabled) return; var it = items[+b.dataset.cm]; cmClose(); it.fn(); };
  }
  document.addEventListener('pointerdown', function (e) { if (!cm.hidden && !e.target.closest('.cmenu')) cmClose(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !cm.hidden) cmClose(); });
  window.addEventListener('blur', cmClose); window.addEventListener('resize', cmClose);
  function fireCtx(act) { var b = document.createElement('button'); b.dataset.ctx = act; b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); }
  function showDetails(id) { if (!U.right) { U.right = true; applyLayout(); saveUi(); } if (S.selected !== id) select(id); }
  function poleMenu(id, x, y) {
    if (!(S.multi && S.multi.length > 1 && S.multi.indexOf(id) >= 0) && S.selected !== id) select(id);
    var multi = S.multi && S.multi.length > 1 ? S.multi.slice() : null, k = prof().poleIds.indexOf(id), dsg = inDesign(id), tip = tipPoles().indexOf(id) >= 0;
    if (multi) return cmOpen(x, y, multi.length + ' poles selected', [
      { t: 'Create profile from these', ic: '⤳', fn: function () { FN.mkProf && FN.mkProf(); } },
      { t: 'Add a stay on each', ic: '⟋', fn: function () { runWb('mstay'); }, off: project ? '' : 'Needs a linked design' },
      '-', { t: 'Delete ' + multi.length + ' poles', ic: '🗑', k: 'Del', danger: true, fn: function () { delPoles(multi); } }]);
    var ss = secsOn(id);
    cmOpen(x, y, 'Pole ' + id, [
      { t: 'Pole details', ic: '☰', fn: function () { showDetails(id); } },
      { t: 'Street View', ic: '🛣', fn: function () { openStreetView(id); } },
      { t: 'Zoom to', ic: '⌖', k: 'Z', fn: function () { showPole(id); } },
      { t: 'Open in profile', ic: '📈', fn: function () { openProfileFor(id); } },
      k < 0 ? { t: 'Add to profile', ic: '＋', fn: function () { addToProfile(id); } } : { t: 'Remove from profile', ic: '－', fn: function () { removeFromProfile(id); }, off: dsg ? 'It is in the design: delete it instead' : '' },
      '-',
      { t: 'Add construction', ic: '▦', fn: function () { FN.construction(); }, off: project ? '' : 'Start or link a design first' },
      { t: 'Add stay', ic: '⟋', fn: function () { showDetails(id); addExtra(id, 'stay'); }, off: dsg && ((dm && dm.byPole[id]) || []).some(function (c) { return c.kingbolt != null; }) ? '' : 'Needs a construction on a design pole' },
      { t: 'Add transformer', ic: '▣', fn: function () { showDetails(id); addExtra(id, 'plant'); }, off: dsg ? '' : 'Only on poles in the design' },
      { t: 'Draw conductor from here', ic: '〰', fn: function () { $('tbCond').click(); setTimeout(function () { select(id); }, 0); }, off: project ? '' : 'Start or link a design first' },
      { t: 'AI photo', ic: '✨', fn: function () { fireCtx('photo'); } },
      { t: 'Pole strength', ic: '⚖', fn: function () { U.insTab = 'pstr'; showDetails(id); renderSelected(); }, off: dsg ? '' : 'Only on poles in the design' },
      tip ? { t: 'Tipload', ic: '⇲', fn: function () { openTip(id); } } : null,
      ss.length ? '-' : null,
    ].concat(ss.map(function (n) { return { t: 'Delete conductor ' + n, ic: '✂', danger: true, fn: function () { delSection(n); } }; })).concat(['-', { t: 'Delete pole', ic: '🗑', k: 'Del', danger: true, fn: function () { delPoles([id]); } }]).filter(Boolean));
  }
  function spanMenu(a, b, x, y, seg) {
    selectSpan(a, b); var ss = secsAt(a, b);
    if (seg && ss.indexOf(seg) < 0) ss.unshift(seg);
    cmOpen(x, y, 'Span ' + a + ' → ' + b, [
      { t: 'Span details', ic: '☰', fn: function () { U.right = true; applyLayout(); saveUi(); selectSpan(a, b); } },
      { t: 'Edit span', ic: '✎', fn: function () { runWb('spanedit'); } },
      { t: 'Show in profile', ic: '📈', fn: function () { fireCtx('spanprofile'); } },
      { t: 'Add conductor on this span', ic: '〰', fn: function () { runWb('spancond'); }, off: project ? '' : 'Start or link a design first' },
      { t: 'Street View at mid-span', ic: '🛣', fn: function () { var la = poleLL(a), lb = poleLL(b); if (la && lb) openStreetView('Span ' + a + '–' + b, L.latLng((la.lat + lb.lat) / 2, (la.lng + lb.lng) / 2)); } },
      '-'
    ].concat(ss.map(function (n) { return { t: 'Delete conductor ' + n + ' (whole section)', ic: '✂', danger: true, fn: function () { delSection(n); } }; }))
      .concat([{ t: ss.length ? 'Delete span (cut conductors here)' : 'Delete span', ic: '🗑', k: 'Del', danger: true, fn: function () { delSpan(a, b); }, off: ss.length || spanCut(a, b) ? '' : (project ? 'No conductors on this span' : 'Not a span of the active profile') }]));
  }
  function groundMenu(ll, x, y) {
    var xy = ll && fromLatLng(ll);
    cmOpen(x, y, xy ? 'E ' + xy.e.toFixed(1) + '  N ' + xy.n.toFixed(1) : 'Map', [
      { t: 'Street View here', ic: '🛣', fn: function () { openStreetView('Map point', ll); }, off: ll ? '' : 'No position here' },
      { t: 'Add pole here', ic: '●', fn: function () { openPoleDlg(null, { mode: 'coord', e: Math.round(xy.e * 1000) / 1000, n: Math.round(xy.n * 1000) / 1000 }); }, off: xy ? '' : 'No position here' },
      { t: 'Measure from here', ic: '📏', fn: function () { setTool('measure'); if (S.view === 'plan' && typeof measureAdd === 'function') measureAdd(ll); } },
      { t: 'Box select', ic: '⬚', k: 'B', fn: function () { setTool('rect'); } },
      { t: 'Fit all', ic: '⤢', fn: function () { $('tbFit').click(); } },
      '-',
      { t: 'Clear selection', ic: '⊘', k: 'Esc', fn: function () { select(null); } }
    ]);
  }
  // Plan: pole markers, spans and the empty map. (Leaflet fires contextmenu on the marker first; stop it reaching the map.)
  map.on('contextmenu', function (e) { var oe = e.originalEvent; if (oe && oe._pnwDone) return; groundMenu(e.latlng, oe.clientX, oe.clientY); });
  var _renderMap = renderMap;
  renderMap = function () {
    _renderMap.apply(this, arguments);
    Object.keys(markers).forEach(function (id) { markers[id].on('contextmenu', function (e) { L.DomEvent.stop(e); e.originalEvent._pnwDone = true; poleMenu(id, e.originalEvent.clientX, e.originalEvent.clientY); }); });
    lyAlign.eachLayer(function (l) { var t = l.getTooltip && l.getTooltip(), m = t && /^Span (.+?) → (.+?):/.exec(t.getContent ? String(t.getContent()) : ''); if (!m) return; var a = m[1].replace(/&amp;/g, '&'), b = m[2].replace(/&amp;/g, '&'); l.on('contextmenu', function (e) { L.DomEvent.stop(e); e.originalEvent._pnwDone = true; spanMenu(a, b, e.originalEvent.clientX, e.originalEvent.clientY); }); });
  };
  // 3D: pole, conductor span (from its two poles) or the ground point.
  function ctx3d(info) {
    if (info.pole && info.segment) { if (info.to && info.to !== info.pole) spanMenu(info.pole, info.to, info.x, info.y, info.segment); else poleMenu(info.pole, info.x, info.y); }
    else if (info.pole) poleMenu(info.pole, info.x, info.y);
    else groundMenu(info.e != null ? toLatLng(info.e, info.n) : null, info.x, info.y);
  }
  (function hook3d() { if (window.PNW3D && window.PNW3D.context) window.PNW3D.context(ctx3d); else setTimeout(hook3d, 300); })();

  // Floating windows: drag any dialog, Street View or DCSH pop-up by its title bar; the card keeps its place until closed.
  function dragBy(card, handle, key) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button,a,input,select,label,textarea,.combo')) return;
      var r = card.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      card.classList.add('floated'); card.style.position = 'fixed'; card.style.margin = '0'; card.style.left = r.left + 'px'; card.style.top = r.top + 'px'; card.style.right = 'auto'; card.style.bottom = 'auto'; card.style.width = r.width + 'px';
      handle.setPointerCapture(e.pointerId); e.preventDefault();
      function mv(ev) { card.style.left = Math.max(-r.width + 80, Math.min(innerWidth - 80, ev.clientX - dx)) + 'px'; card.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px'; }
      function up() { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); if (key) { U[key] = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) }; saveUi(); } }
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.dlg'), function (d) { var c = d.querySelector('.dlg-card'), h = d.querySelector('.dlg-head'); if (c && h) dragBy(c, h); });
  // A dialog that was moved opens centred again next time.
  new MutationObserver(function (ms) { ms.forEach(function (m) { var d = m.target; if (d.hidden) { var c = d.querySelector('.dlg-card'); if (c) { c.classList.remove('floated'); ['position', 'left', 'top', 'width', 'margin', 'right', 'bottom'].forEach(function (k) { c.style[k] = ''; }); } } }); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(function () { var h = $('svPanel').querySelector('.svh'); if (h && !h._drag) { h._drag = 1; dragBy($('svPanel'), h); } }).observe($('svPanel'), { childList: true });
  new MutationObserver(function () { var p = $('dcshPop'), h = p.firstElementChild; if (h && !h._drag) { h._drag = 1; dragBy(p, h); } }).observe($('dcshPop'), { childList: true });

  // Pole Details as a floating, resizable window (⧉ docks it back into the side column).
  if (U.insFloat == null) U.insFloat = true;
  var ins = $('inspector'), insHead = ins.querySelector('.phead');
  insHead.insertAdjacentHTML('beforeend', '<button class="ibtn" id="insFloat" title="Float or dock the Pole Details window" aria-label="Float or dock the Pole Details window">⧉</button>');
  function insPlace() {
    document.body.classList.toggle('ins-float', !!U.insFloat);
    // Out of the workspace when floating, so no panel or map stacks above it; back after its gutter when docked.
    if (U.insFloat && ins.parentNode !== document.body) document.body.appendChild(ins);
    if (!U.insFloat && ins.parentNode === document.body) { var gr = document.querySelector('.gutter.gr'); gr.parentNode.insertBefore(ins, gr.nextSibling); }
    if (!U.insFloat) { ['left', 'top', 'width', 'height'].forEach(function (k) { ins.style[k] = ''; }); return; }
    var w = Math.min(U.iw || 420, innerWidth - 16), h = Math.min(U.ih || Math.round(innerHeight * 0.72), innerHeight - 70);
    var x = U.ix != null ? U.ix : innerWidth - w - 16, y = U.iy != null ? U.iy : 110;
    ins.style.left = Math.max(0, Math.min(innerWidth - 120, x)) + 'px'; ins.style.top = Math.max(0, Math.min(innerHeight - 60, y)) + 'px'; ins.style.width = w + 'px'; ins.style.height = h + 'px';
  }
  $('insFloat').onclick = function () { U.insFloat = !U.insFloat; saveUi(); insPlace(); applyLayout(); setTimeout(function () { if (map && map.invalidateSize) map.invalidateSize(); if (S.view !== 'plan') renderViews(); }, 30); };
  insHead.addEventListener('pointerdown', function (e) {
    if (!U.insFloat || e.button !== 0 || e.target.closest('button,a,input,select')) return;
    var r = ins.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; insHead.setPointerCapture(e.pointerId); e.preventDefault();
    function mv(ev) { ins.style.left = Math.max(-r.width + 80, Math.min(innerWidth - 80, ev.clientX - dx)) + 'px'; ins.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px'; }
    function up() { insHead.removeEventListener('pointermove', mv); insHead.removeEventListener('pointerup', up); U.ix = parseFloat(ins.style.left); U.iy = parseFloat(ins.style.top); saveUi(); }
    insHead.addEventListener('pointermove', mv); insHead.addEventListener('pointerup', up);
  });
  if (window.ResizeObserver) new ResizeObserver(function () { if (!U.insFloat || ins.offsetWidth < 50) return; U.iw = ins.offsetWidth; U.ih = ins.offsetHeight; clearTimeout(insPlace.t); insPlace.t = setTimeout(saveUi, 300); }).observe(ins);
  var _applyLayout = applyLayout;
  // Floating: shown while a pole, span or multi-selection is picked (✕ hides it until the next pick).
  function insShow() { var any = !!(S.selected || S.selSpan || (S.multi && S.multi.length > 1)); if (U.insFloat) { $('workspace').classList.add('no-right'); ins.hidden = !(U.right && any); document.body.classList.remove('sum-fold'); } else ins.hidden = false; }
  applyLayout = function () { _applyLayout.apply(this, arguments); insShow(); };
  var _renderSelected = renderSelected;
  renderSelected = function () { if (U.insFloat && (S.selected || S.selSpan) && !U.right) { U.right = true; } _renderSelected.apply(this, arguments); insShow(); };
  insHead.querySelector('[data-close="right"]').addEventListener('click', function (e) { if (!U.insFloat) return; e.stopImmediatePropagation(); e.preventDefault(); select(null); }, true);
  insPlace();

  // Header menus: Files, Home, Design, View, Settings as drop-downs beside the project name. The toolbar row keeps the Home tools.
  RIB.sort(function (a, b) { var o = ['Files', 'Home', 'Design', 'View', 'Settings']; return o.indexOf(a[0]) - o.indexOf(b[0]); });
  var tbm = document.createElement('nav'); tbm.className = 'tb-menus'; tbm.id = 'tbMenus'; tbm.setAttribute('aria-label', 'Menus');
  document.querySelector('.titlebar .tb-file').insertAdjacentElement('afterend', tbm);
  function renderMenus() {
    tbm.innerHTML = RIB.map(function (t) {
      return '<details class="tbm"><summary>' + t[0] + ' <span class="car">▾</span></summary><div class="tbmm" role="menu">' + t[1].map(function (g) {
        return '<div class="tbmg"><div class="tbml">' + g[0] + '</div>' + g[1].map(function (d) {
          if (d[0] === 'chk') return d[1].map(function (c) { return '<label class="rchk"><input type="checkbox" data-rchk="' + c[0] + '"> ' + esc(c[1]) + '</label>'; }).join('');
          return ribBtn(d);
        }).join('') + '</div>';
      }).join('') + '</div></details>';
    }).join('');
    Array.prototype.forEach.call(tbm.querySelectorAll('details'), function (dd) { dd.addEventListener('toggle', function () { if (dd.open) Array.prototype.forEach.call(tbm.querySelectorAll('details[open]'), function (o) { if (o !== dd) o.open = false; }); }); });
    syncRibbon();
  }
  tbm.addEventListener('mouseover', function (e) { var s = e.target.closest('summary'); if (s && tbm.querySelector('details[open]') && !s.parentNode.open) { s.parentNode.open = true; } });
  document.addEventListener('click', function (e) { if (!e.target.closest('#tbMenus')) Array.prototype.forEach.call(tbm.querySelectorAll('details[open]'), function (o) { o.open = false; }); });
  tbm.addEventListener('click', function (e) {
    var b = e.target.closest('.rbt'); if (!b) return;
    Array.prototype.forEach.call(tbm.querySelectorAll('details[open]'), function (o) { o.open = false; });
    var t = $('rbody').querySelector('.rbt[data-rid="' + b.dataset.rid + '"]');
    if (t) { t.click(); return; }
    // not on the toolbar row: run it through the same handler
    var tmp = document.createElement('div'); tmp.hidden = true; tmp.innerHTML = b.outerHTML; $('rbody').appendChild(tmp); tmp.firstChild.click(); tmp.remove();
  });
  tbm.addEventListener('change', function (e) { var c = e.target.closest('[data-rchk]'); if (!c) return; var k = c.dataset.rchk; if (/^pv:/.test(k)) { var s = U.pvShow = U.pvShow || {}; s[k.slice(3)] = c.checked; saveUi(); syncPvTools(); if (S.view === 'profile' || S.view === 'split' || U.anOpen) renderProfileView(); } else if ($(k) && $(k).checked !== c.checked) $(k).click(); });
  var _syncRibbon = syncRibbon;
  syncRibbon = function () {
    _syncRibbon.apply(this, arguments);
    Array.prototype.forEach.call(document.querySelectorAll('#tbMenus .rbt'), function (b) { var t = $('rbody').querySelector('.rbt[data-rid="' + b.dataset.rid + '"]'); if (t) { b.classList.toggle('on', t.classList.contains('on')); b.disabled = t.disabled; b.title = t.title; } });
    Array.prototype.forEach.call(document.querySelectorAll('#tbMenus [data-rchk]'), function (c) { var k = c.dataset.rchk; c.checked = /^pv:/.test(k) ? pvShow()[k.slice(3)] : !!($(k) && $(k).checked); });
  };
  ribTab = 'Home'; U.rtab = 'Home'; U.ribMin = false;
  renderMenus();

  // Profiles: 🪄 on a profile (explorer) or right-click it to switch to it and run Auto design on that line only.
  function autoProfile(i) { switchProfile(i); if (+i !== S.active) return; autoDesign(); }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-xauto]'); if (!b) return; e.stopPropagation(); e.preventDefault(); autoProfile(b.dataset.xauto); }, true);
  document.addEventListener('contextmenu', function (e) {
    var t = e.target.closest('[data-xprof]'); if (!t) return; e.preventDefault(); var i = +t.dataset.xprof, p = S.profiles[i];
    cmOpen(e.clientX, e.clientY, p.name || 'Profile ' + (i + 1), [
      { t: 'Switch to this profile', ic: '📈', fn: function () { switchProfile(i); }, off: i === S.active ? 'Already active' : '' },
      { t: 'Auto design this profile', ic: '🪄', fn: function () { autoProfile(i); }, off: p.poleIds.length > 1 || i !== S.active ? '' : 'Add poles to it first' },
      { t: 'Show in profile view', ic: '📉', fn: function () { switchProfile(i); setView('profile'); } },
      { t: 'Rename…', ic: '✎', fn: function () { renameProfileDlg(i); } },
      '-', { t: 'Delete profile…', ic: '🗑', danger: true, fn: function () { delProfileDlg(i); } }]);
  });
  document.addEventListener('change', function (e) { if (e.target.id !== 'lcSet' || !e.target.value) return; var st = tipSet(), k = e.target.value; st.cases = JSON.parse(JSON.stringify(OPT_SETS[k])); st.source = k; save(); if (typeof renderTip === 'function') renderTip(); setStatus('Tipload load combinations: ' + k + '.', 'good'); });
  // one-off layout reset for the CAD workspace
  // Taller profile dock by default, so the chart and its axes fit (review 2026-11-01).
  if (U.cadv && !U.cadv2) { U.ah = Math.max(U.ah || 0, Math.round(Math.min(260, window.innerHeight * 0.26))); U.cadv2 = 1; saveUi(); }
  if (!U.cadv) { U.left = true; U.right = true; U.dock = true; U.dockMin = false; U.anOpen = true; U.tab = 'poles'; U.ah = Math.round(Math.min(260, window.innerHeight * 0.26)); U.cadv2 = 1; U.dh = Math.round(Math.min(160, window.innerHeight * 0.17)); U.cadv = 1; saveUi(); }
  renderRibbon(); updToolStatus(); syncSnap();
  syncInputs(); applyLayout(); setTab(U.tab || 'poles');
  recompute();
  if (S.files.length) { fit(); setStatus('Restored your saved project. ' + summaryText()); }
  wsReady = true; markDirty(false); renderExtras();
  setTimeout(function () { map.invalidateSize(); }, 200);
})();
