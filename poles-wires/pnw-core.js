/* Poles and Wires core: file roles, parsing, validation, alignment, ground profile and PNW profile exports.
   Pure functions so the same code runs in the browser (window.PNW) and in the Node regression tests.
   Mapping rules come from Ishan's own ground profile workbooks and saved PNW 7 projects; see README.md. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- constants taken from the reference files ---------- */
  // Ground profile workbook (PNW Profiler "Easting/Northing/Elevation" Excel import, manual §10.1).
  // Header text is copied exactly from Ishan's workbooks, including the "Eleveation" spelling.
  var GROUNDLINE_HEADERS = ['Easting', 'Northing', 'Eleveation', 'Pole Number', 'Height above Ground', 'Pole Length', 'Setting Depth', 'SV_comment'];
  var SEGMENT_HEADERS = ['Conductor', 'Num Conds', '%CBL', 'Std Tens', 'Table', 'Condition', 'Poles', 'Attach Hts'];
  var GROUNDLINE_COL_WIDTHS = [11, 12, 12.86, 15, 22.57, 15, null, 17.71];

  var ROLES = {
    survey: 'LiDAR structure survey (QLINK)',
    gisPoles: 'GIS pole export',
    inspections: 'Pole inspections',
    defects: 'Pole defects',
    poleList: 'Pole list',
    groundProfile: 'Reference ground profile',
    unknown: 'Not recognised'
  };

  /* ---------- small helpers ---------- */
  function norm(h) { return String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' '); }
  function round(v, dp) { if (v == null || !isFinite(v)) return v; var f = Math.pow(10, dp); return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * f) / f; }
  // Returns a finite number, null for blank / "-" placeholders, or NaN for text that is not a number.
  function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v).trim();
    if (s === '' || s === '-' || /^nan$/i.test(s)) return null;
    var n = Number(s.replace(/,/g, ''));
    return isFinite(n) ? n : NaN;
  }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function poleId(v) {
    var s = str(v).toUpperCase();
    if (/^\d+$/.test(s)) s = 'S' + s; // defect exports drop the S prefix (119846 = S119846)
    return s;
  }
  var MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  function parseDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = str(v), m = s.match(/^(\d{1,2})\/([A-Z]{3})\/(\d{2,4})$/i);
    if (m && MONTHS[m[2].toUpperCase()] != null) {
      var y = +m[3]; if (m[3].length === 2) y += y > 50 ? 1900 : 2000;
      return new Date(Date.UTC(y, MONTHS[m[2].toUpperCase()], +m[1]));
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  }

  /* ---------- reading files ---------- */
  // RFC 4180 CSV reader. Every value stays text so IDs like 000001238709 keep their zeros.
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false, i = 0, c;
    if (text.charCodeAt(0) === 0xfeff) i = 1;
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Reads one file into [{name, rows}] (rows are arrays). Formulas are never evaluated; cached values only.
  function readFile(XLSX, name, data) {
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt') {
      var text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
      return [{ name: name.replace(/\.[^.]+$/, ''), rows: parseCSV(text) }];
    }
    if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'xlsm') throw new Error('Unsupported file type .' + ext + '. Use .xlsx, .xls or .csv.');
    var wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true, cellFormula: false, cellHTML: false, bookVBA: false });
    return wb.SheetNames.map(function (sn) {
      return { name: sn, rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false }) };
    });
  }

  /* ---------- role detection ---------- */
  var SIGNATURES = [
    { role: 'survey', need: ['pick_id', 'x_coord_base', 'y_coord_base', 'z_coord_base'] },
    { role: 'gisPoles', need: ['pick id', 'geometry', 'length (m)'] },
    { role: 'inspections', need: ['dfis id', 'insp attribute description', 'insp result description'] },
    { role: 'defects', need: ['dfis id', 'defect description'] },
    { role: 'groundProfile', need: ['easting', 'northing', 'pole number'] }
  ];
  function findHeader(rows, need) {
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var h = (rows[r] || []).map(norm);
      if (need.every(function (k) { return h.indexOf(k) >= 0; })) return r;
    }
    return -1;
  }
  // Returns {role, sheet, headerRow, confidence, headers}
  function detectRole(sheets) {
    for (var s = 0; s < sheets.length; s++) {
      for (var g = 0; g < SIGNATURES.length; g++) {
        var hr = findHeader(sheets[s].rows, SIGNATURES[g].need);
        if (hr >= 0) return { role: SIGNATURES[g].role, sheet: s, headerRow: hr, confidence: 'high', headers: sheets[s].rows[hr].map(str) };
      }
    }
    // A single column of pick IDs (e.g. "pole list.xls").
    var first = sheets[0], vals = first ? first.rows.map(function (r) { return str(r[0]); }).filter(Boolean) : [];
    var oneCol = first && first.rows.every(function (r) { return r.slice(1).every(function (v) { return v == null || str(v) === ''; }); });
    if (oneCol && vals.length && vals.every(function (v) { return /^S?\d{3,}$/i.test(v); }))
      return { role: 'poleList', sheet: 0, headerRow: -1, confidence: 'medium', headers: [] };
    return { role: 'unknown', sheet: 0, headerRow: findFirstNonEmpty(first ? first.rows : []), confidence: 'none', headers: first && first.rows[0] ? first.rows[0].map(str) : [] };
  }
  function findFirstNonEmpty(rows) { for (var i = 0; i < rows.length; i++) if ((rows[i] || []).some(function (v) { return str(v) !== ''; })) return i; return -1; }
  // For a manually assigned role, find the header row for that role's signature.
  function headerFor(sheets, role) {
    var sig = SIGNATURES.filter(function (x) { return x.role === role; })[0];
    if (!sig) return { sheet: 0, headerRow: -1 };
    for (var s = 0; s < sheets.length; s++) { var hr = findHeader(sheets[s].rows, sig.need); if (hr >= 0) return { sheet: s, headerRow: hr }; }
    return { sheet: 0, headerRow: -1, missing: sig.need };
  }

  function records(sheet, headerRow) {
    var h = sheet.rows[headerRow].map(norm), out = [];
    for (var r = headerRow + 1; r < sheet.rows.length; r++) {
      var row = sheet.rows[r] || [], o = { _row: r + 1 }, any = false;
      for (var c = 0; c < h.length; c++) { if (h[c]) { o[h[c]] = row[c]; if (str(row[c]) !== '') any = true; } }
      if (any) out.push(o);
    }
    return out;
  }

  /* ---------- per-role parsers. Each returns {items, issues} ---------- */
  function issue(level, code, message, extra) { var o = { level: level, code: code, message: message }; for (var k in extra) o[k] = extra[k]; return o; }

  function parseSurvey(sheet, hr, file) {
    var items = [], issues = [];
    records(sheet, hr).forEach(function (r) {
      var id = poleId(r['pick_id']), at = { file: file, row: r._row, poleId: id };
      if (!id) { issues.push(issue('error', 'missing-id', 'Row ' + r._row + ' has no PICK_ID, so it was skipped.', at)); return; }
      var e = num(r['x_coord_base']), n = num(r['y_coord_base']), z = num(r['z_coord_base']);
      var it = {
        id: id, equipNo: str(r['equip_no']), group: str(r['equip_grp_id']), dataType: str(r['data type']),
        easting: e, northing: n, elevation: z, lidarHeight: num(r['lidar vertical height']),
        leanDeg: num(r['lean_angle_deg']), bays: num(r['no_of_bays']),
        bayAngles: [1, 2, 3, 4].map(function (i) { return num(r['bay_' + i + '_h_angle_deg']); }).filter(function (v) { return v != null && !isNaN(v); }),
        surveyed: str(r['survey date/time']), src: at
      };
      [['Easting (X_COORD_BASE)', e], ['Northing (Y_COORD_BASE)', n], ['Elevation (Z_COORD_BASE)', z]].forEach(function (p) {
        if (p[1] == null) issues.push(issue('error', 'missing-value', id + ': ' + p[0] + ' is blank.', at));
        else if (isNaN(p[1])) issues.push(issue('error', 'invalid-number', id + ': ' + p[0] + ' is not a number.', at));
      });
      if (isFinite(e) && isFinite(n) && e != null && n != null && !(e > 100000 && e < 900000 && n > 1000000 && n < 10000000))
        issues.push(issue('error', 'invalid-coordinate', id + ': ' + e + ', ' + n + ' is not a valid MGA easting/northing.', at));
      items.push(it);
    });
    return { items: items, issues: issues };
  }

  // "X: 12908556.4374, Y: -3765536.3923, Z: NaN" (Web Mercator) -> lat/lng
  function parseGeometry(g) {
    var m = str(g).match(/X:\s*(-?[\d.]+)\s*,\s*Y:\s*(-?[\d.]+)/i);
    if (!m) return null;
    var x = +m[1], y = +m[2], R = 6378137;
    return { x: x, y: y, lng: x / R * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI };
  }
  function parseGisPoles(sheet, hr, file) {
    var items = [], issues = [];
    records(sheet, hr).forEach(function (r) {
      var id = poleId(r['pick id']), at = { file: file, row: r._row, poleId: id };
      if (!id) { issues.push(issue('warning', 'missing-id', 'Row ' + r._row + ' has no Pick ID.', at)); return; }
      var geo = parseGeometry(r['geometry']), len = num(r['length (m)']);
      if (!geo) issues.push(issue('warning', 'invalid-coordinate', id + ': GIS geometry could not be read.', at));
      if (len != null && isNaN(len)) issues.push(issue('warning', 'invalid-number', id + ': Length (m) is not a number.', at));
      items.push({
        id: id, length: isNaN(len) ? null : len, description: str(r['equipment description']), material: str(r['material code']),
        stock: str(r['stock description']), species: str(r['wood species']), feeder: str(r['hv feeder id']), lvFeeder: str(r['lv feeder id']),
        equipNo: str(r['equip no']).replace(/^0+/, ''), installed: r['install date'], defectCount: str(r['defect count (sev 1, 2, 3)']),
        lat: geo && geo.lat, lng: geo && geo.lng, src: at
      });
    });
    return { items: items, issues: issues };
  }

  // Keeps the latest result for each inspection attribute per pole.
  function parseInspections(sheet, hr, file) {
    var by = {}, issues = [];
    records(sheet, hr).forEach(function (r) {
      var id = poleId(r['dfis id']); if (!id) return;
      var p = by[id] || (by[id] = { id: id, equipNo: str(r['equipment no']).replace(/^0+/, ''), description: str(r['equipment description']), group: str(r['equipment group id']), attrs: {}, count: 0, src: { file: file } });
      p.count++;
      var a = str(r['insp attribute description']); if (!a) return;
      var d = parseDate(r['insp date']), val = str(r['insp result description']) || str(r['insp result']);
      var cur = p.attrs[a];
      if (!cur || (d && (!cur.date || d > cur.date))) p.attrs[a] = { value: val, date: d };
    });
    var items = Object.keys(by).map(function (k) {
      var p = by[k], L = p.attrs['Pole Length'] || p.attrs['Pole Length (M)'];
      p.length = L ? num(L.value) : null;
      if (p.length != null && isNaN(p.length)) { issues.push(issue('warning', 'invalid-number', k + ': inspection pole length "' + L.value + '" is not a number.', { file: file, poleId: k })); p.length = null; }
      return p;
    });
    return { items: items, issues: issues };
  }

  function parseDefects(sheet, hr, file) {
    var items = [];
    records(sheet, hr).forEach(function (r) {
      var id = poleId(r['dfis id']); if (!id) return;
      items.push({ id: id, description: str(r['defect description']), part: str(r['part description']), status: str(r['grouped defect status']), severity: str(r['defect severity description']), start: str(r['defect start date']), src: { file: file, row: r._row } });
    });
    return { items: items, issues: [] };
  }

  function parsePoleList(sheet) {
    var seen = {}, items = [];
    sheet.rows.forEach(function (r) { var id = poleId(r[0]); if (id && !seen[id]) { seen[id] = 1; items.push(id); } });
    return { items: items, issues: [] };
  }

  // A previously produced ground profile workbook, used as a reference to compare against and to reuse pole order/lengths.
  function parseGroundProfile(sheet, hr, file) {
    var items = [], issues = [];
    for (var r = hr + 1; r < sheet.rows.length; r++) {
      var row = sheet.rows[r] || [];
      if (!row.some(function (v) { return str(v) !== ''; })) continue;
      items.push({ easting: num(row[0]), northing: num(row[1]), elevation: num(row[2]), id: str(row[3]) ? poleId(row[3]) : '', height: num(row[4]), length: num(row[5]), sunk: num(row[6]), comment: row[7] == null ? null : row[7], row: r + 1 });
    }
    return { items: items, issues: issues, sheetName: sheet.name };
  }

  var PARSERS = { survey: parseSurvey, gisPoles: parseGisPoles, inspections: parseInspections, defects: parseDefects, groundProfile: parseGroundProfile };

  // Full import of one file. role may be forced by the user.
  function importFile(XLSX, name, data, forcedRole) {
    var sheets = readFile(XLSX, name, data);
    var det = detectRole(sheets), role = forcedRole || det.role, loc = det;
    if (forcedRole && forcedRole !== det.role) loc = headerFor(sheets, forcedRole);
    var res = { name: name, role: role, detected: det.role, confidence: forcedRole ? 'manual' : det.confidence, sheets: sheets.map(function (s) { return { name: s.name, rows: s.rows.length, headers: (s.rows[findFirstNonEmpty(s.rows)] || []).map(str).filter(Boolean).slice(0, 40) }; }), items: [], issues: [] };
    if (role === 'unknown') { res.issues.push(issue('warning', 'unknown-file', name + ': could not tell what this file contains. Choose its role from the list.', { file: name })); return res; }
    if (role === 'poleList') { var pl = parsePoleList(sheets[loc.sheet || 0]); res.items = pl.items; return res; }
    if (loc.headerRow < 0) {
      res.issues.push(issue('error', 'missing-columns', name + ': required columns not found for ' + ROLES[role] + ' (' + (loc.missing || []).join(', ') + ').', { file: name }));
      return res;
    }
    var out = PARSERS[role](sheets[loc.sheet], loc.headerRow, name);
    res.items = out.items; res.issues = out.issues; res.sheetUsed = sheets[loc.sheet].name; res.headerRow = loc.headerRow + 1;
    return res;
  }

  /* ---------- merge into one pole set, cross-file checks ---------- */
  function buildPoles(files) {
    var poles = {}, issues = [], order = 0;
    function get(id) { return poles[id] || (poles[id] = { id: id, order: order++, survey: null, gis: null, insp: null, defects: [], inList: false }); }
    files.forEach(function (f) {
      if (f.role === 'survey') f.items.forEach(function (s) {
        var p = get(s.id);
        if (p.survey) {
          var same = p.survey.easting === s.easting && p.survey.northing === s.northing && p.survey.elevation === s.elevation;
          issues.push(issue(same ? 'warning' : 'error', 'duplicate-id', s.id + ' appears more than once in the survey' + (same ? ' with identical values; the first row is used.' : ' with different coordinates; the first row is used. Remove the wrong row and re-import.'), { poleId: s.id, file: f.name, row: s.src.row }));
          return;
        }
        p.survey = s;
      });
    });
    files.forEach(function (f) {
      if (f.role === 'gisPoles') f.items.forEach(function (g) { var p = get(g.id); if (p.gis) issues.push(issue('warning', 'duplicate-id', g.id + ' appears more than once in the GIS export; the first row is used.', { poleId: g.id, file: f.name })); else p.gis = g; });
      if (f.role === 'inspections') f.items.forEach(function (i) { var p = get(i.id); if (!p.insp) p.insp = i; else { for (var k in i.attrs) { var c = p.insp.attrs[k]; if (!c || (i.attrs[k].date && (!c.date || i.attrs[k].date > c.date))) p.insp.attrs[k] = i.attrs[k]; } p.insp.count += i.count; if (p.insp.length == null) p.insp.length = i.length; } });
      if (f.role === 'defects') f.items.forEach(function (d) { get(d.id).defects.push(d); });
      if (f.role === 'poleList') f.items.forEach(function (id) { get(id).inList = true; });
    });
    Object.keys(poles).forEach(function (id) {
      var p = poles[id];
      if (!p.survey) issues.push(issue(p.inList ? 'error' : 'warning', 'unmatched', id + ' has no LiDAR survey row, so it has no surveyed easting, northing or elevation.', { poleId: id }));
      if (p.survey && !p.gis && files.some(function (f) { return f.role === 'gisPoles'; })) issues.push(issue('info', 'unmatched', id + ' is in the survey but not in the GIS pole export.', { poleId: id }));
      var gl = p.gis && p.gis.length, il = p.insp && p.insp.length;
      if (gl != null && il != null && gl !== il) issues.push(issue('warning', 'length-conflict', id + ': GIS length ' + gl + ' m differs from inspection length ' + il + ' m. GIS is used unless you edit it.', { poleId: id }));
    });
    return { poles: poles, issues: issues };
  }

  function existingLength(p) {
    if (p.gis && p.gis.length != null) return { value: p.gis.length, source: 'GIS export' };
    if (p.insp && p.insp.length != null) return { value: p.insp.length, source: 'Inspection' };
    return { value: null, source: null };
  }

  /* ---------- geometry ---------- */
  function dist2d(a, b) { return Math.sqrt(Math.pow(b.easting - a.easting, 2) + Math.pow(b.northing - a.northing, 2)); }
  // Grid bearing from a to b, degrees clockwise from north (same convention as the PNW tipload "Angle").
  function bearing(a, b) { var d = Math.atan2(b.easting - a.easting, b.northing - a.northing) * 180 / Math.PI; return d < 0 ? d + 360 : d; }

  // Orders poles along the line: shortest nearest-neighbour chain, starting from the end that appears first in the survey file.
  function autoOrder(poles, ids) {
    var pts = ids.map(function (id) { return poles[id]; }).filter(function (p) { return p && p.survey && isFinite(p.survey.easting) && isFinite(p.survey.northing); });
    if (pts.length < 3) return pts.sort(function (a, b) { return a.order - b.order; }).map(function (p) { return p.id; });
    var best = null;
    pts.forEach(function (start) {
      var chain = [start], left = pts.filter(function (p) { return p !== start; }), len = 0;
      while (left.length) {
        var cur = chain[chain.length - 1], bi = 0, bd = Infinity;
        left.forEach(function (p, i) { var d = dist2d(cur.survey, p.survey); if (d < bd) { bd = d; bi = i; } });
        len += bd; chain.push(left.splice(bi, 1)[0]);
      }
      if (!best || len < best.len - 1e-6) best = { chain: chain, len: len };
    });
    var c = best.chain;
    if (c[c.length - 1].order < c[0].order) c = c.slice().reverse();
    return c.map(function (p) { return p.id; }).concat(ids.filter(function (id) { return !pts.some(function (p) { return p.id === id; }); }));
  }

  /* ---------- profile ---------- */
  // Setting depth rule found in every sample (ground profiles, PNW profile and tipload files): 10% of length + 0.6 m.
  function settingDepth(length) { return round(length * 0.1 + 0.6, 2); }

  // Builds the profile rows plus the issues that block or qualify the export.
  // profile = {name, poleIds:[...], lengths:{id:m}, comments:{id:text}, segments:[...]}
  function buildProfile(poles, profile) {
    var rows = [], issues = [], chain = 0, prev = null;
    if (!profile.poleIds || profile.poleIds.length < 2) issues.push(issue('error', 'too-few-poles', 'A ground profile needs at least two poles. Add poles to the alignment.', {}));
    var seen = {};
    (profile.poleIds || []).forEach(function (id, i) {
      var p = poles[id];
      if (seen[id]) { issues.push(issue('error', 'duplicate-id', id + ' is in the alignment twice.', { poleId: id })); return; }
      seen[id] = 1;
      if (!p) { issues.push(issue('error', 'unmatched', id + ' is not in any imported file.', { poleId: id })); return; }
      var s = p.survey;
      var row = { id: id, easting: s ? s.easting : null, northing: s ? s.northing : null, elevation: s ? s.elevation : null, length: null, lengthSource: null, height: null, sunk: null, span: null, chainage: null, bearing: null, comment: profile.comments && profile.comments[id] != null ? profile.comments[id] : null };
      if (!s) issues.push(issue('error', 'missing-survey', id + ': no LiDAR survey row, so there is no surveyed easting, northing or elevation. Import the QLINK file that contains it or remove the pole.', { poleId: id }));
      else ['easting', 'northing', 'elevation'].forEach(function (k) { if (s[k] == null || isNaN(s[k])) issues.push(issue('error', 'missing-value', id + ': ' + k + ' is missing or invalid in the survey.', { poleId: id })); });
      var edited = profile.lengths && profile.lengths[id] != null;
      var L = edited ? { value: num(profile.lengths[id]), source: 'Edited' } : existingLength(p);
      if (L.value == null || isNaN(L.value) || L.value <= 0) issues.push(issue('error', 'missing-length', id + ': pole length is unknown. Enter the pole length.', { poleId: id }));
      else { row.length = L.value; row.lengthSource = L.source; row.sunk = settingDepth(L.value); row.height = round(L.value - row.sunk, 2); }
      if (prev && isFinite(prev.easting) && isFinite(row.easting) && prev.easting != null && row.easting != null) {
        row.span = round(dist2d(prev, row), 2);
        chain = round(chain + row.span, 2); // PNW sums spans rounded to 0.01 m (matches 113.05 in the MP219050 project)
        row.bearing = bearing(prev, row);
        if (row.span === 0) issues.push(issue('error', 'zero-span', id + ' is at the same position as ' + prev.id + '.', { poleId: id }));
      }
      row.chainage = i === 0 ? 0 : (row.span == null ? null : chain);
      rows.push(row); prev = row;
    });
    (profile.segments || []).forEach(function (sg, i) { issues = issues.concat(validateSegment(sg, i, rows)); });
    return { name: profile.name, rows: rows, issues: issues, ok: !issues.some(function (x) { return x.level === 'error'; }) };
  }

  /* ---------- circuit segments (optional, user-entered design data) ---------- */
  // segment = {conductor, numConds, cbl, kN, table, temps, poles:[{id, attachHt}]}
  function validateSegment(sg, i, rows) {
    var out = [], tag = 'Segment ' + (i + 1) + (sg.conductor ? ' (' + sg.conductor + ')' : '');
    if (!str(sg.conductor)) out.push(issue('error', 'segment', tag + ': enter the PNW conductor code.', {}));
    if (!(num(sg.numConds) > 0)) out.push(issue('error', 'segment', tag + ': enter the number of conductors.', {}));
    var t = [sg.cbl, sg.kN, sg.table].filter(function (v) { return str(v) !== ''; });
    if (!t.length) out.push(issue('error', 'segment', tag + ': enter one stringing tension (%CBL, kN or table).', {}));
    var ps = (sg.poles || []).filter(function (p) { return p && p.id; });
    if (ps.length < 2) out.push(issue('error', 'segment', tag + ': a segment needs at least two poles.', {}));
    ps.forEach(function (p) {
      if (!rows.some(function (r) { return r.id === p.id; })) out.push(issue('error', 'segment', tag + ': pole ' + p.id + ' is not in this profile.', { poleId: p.id }));
      var h = num(p.attachHt), r = rows.filter(function (x) { return x.id === p.id; })[0];
      if (h == null || isNaN(h)) out.push(issue('error', 'segment', tag + ': attachment height missing at ' + p.id + '.', { poleId: p.id }));
      else if (r && r.height != null && h > r.height) out.push(issue('warning', 'segment', tag + ': attachment height ' + h + ' m at ' + p.id + ' is above the pole top (' + r.height + ' m).', { poleId: p.id }));
    });
    return out;
  }

  /* ---------- ground profile workbook ---------- */
  function groundlineAoa(built) {
    return [GROUNDLINE_HEADERS.slice()].concat(built.rows.map(function (r) {
      return [r.easting, r.northing, r.elevation, r.id, r.height, r.length, r.sunk, r.comment == null || r.comment === '' ? null : r.comment];
    }));
  }
  function segmentsAoa(segments) {
    var aoa = [SEGMENT_HEADERS.slice()];
    (segments || []).forEach(function (sg) {
      (sg.poles || []).filter(function (p) { return p && p.id; }).forEach(function (p, i) {
        aoa.push(i === 0
          ? [str(sg.conductor), num(sg.numConds), str(sg.cbl) === '' ? null : num(sg.cbl), str(sg.kN) === '' ? null : num(sg.kN), str(sg.table) || null, str(sg.temps) || null, p.id, num(p.attachHt)]
          : [null, null, null, null, null, null, p.id, num(p.attachHt)]);
      });
    });
    return aoa;
  }
  function groundProfileWorkbook(XLSX, built, segments) {
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(groundlineAoa(built));
    ws['!cols'] = GROUNDLINE_COL_WIDTHS.map(function (w) { return w ? { wch: w } : {}; });
    XLSX.utils.book_append_sheet(wb, ws, 'Groundline');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(segmentsAoa(segments)), 'Segments');
    return wb;
  }

  // Compares generated rows with a reference ground profile (by pole number and position).
  function compareWithReference(built, ref) {
    var diffs = [], fields = [['easting', 'Easting'], ['northing', 'Northing'], ['elevation', 'Eleveation'], ['height', 'Height above Ground'], ['length', 'Pole Length'], ['sunk', 'Setting Depth']];
    var refPoles = ref.items.filter(function (x) { return x.id; });
    var genIds = built.rows.map(function (r) { return r.id; }), refIds = refPoles.map(function (r) { return r.id; });
    if (genIds.join('|') !== refIds.join('|')) diffs.push({ kind: 'order', message: 'Pole order differs. Generated: ' + genIds.join(', ') + '. Reference: ' + refIds.join(', ') + '.' });
    built.rows.forEach(function (r) {
      var x = refPoles.filter(function (q) { return q.id === r.id; })[0];
      if (!x) { diffs.push({ kind: 'missing', poleId: r.id, message: r.id + ' is not in the reference.' }); return; }
      fields.forEach(function (f) { if (round(r[f[0]], 3) !== round(x[f[0]], 3)) diffs.push({ kind: 'value', poleId: r.id, field: f[1], generated: r[f[0]], reference: x[f[0]], message: r.id + ' ' + f[1] + ': generated ' + r[f[0]] + ', reference ' + x[f[0]] + '.' }); });
    });
    refPoles.forEach(function (x) { if (genIds.indexOf(x.id) < 0) diffs.push({ kind: 'extra', poleId: x.id, message: x.id + ' is in the reference but not in the generated profile.' }); });
    return diffs;
  }

  /* ---------- PNW .pnwx profile project (XML), structure copied from Ishan's saved PNW 7.18.1 projects ---------- */
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function netNum(v) { return v == null || !isFinite(v) ? '0' : String(round(v, 6)); }
  function pnwDate(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + h + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + ' ' + ap;
  }
  function el(ind, tag, val) {
    var pad = new Array(ind + 1).join(' ');
    if (val === '' || val == null) return pad + '<' + tag + '>\r\n' + pad + '</' + tag + '>'; // how .NET DataSet writes empty strings
    return pad + '<' + tag + '>' + xmlEsc(val) + '</' + tag + '>';
  }
  // opts: {title, createdBy, option, clearance1, clearance2, now}
  function profilePnwx(built, opts) {
    opts = opts || {};
    var now = opts.now || new Date(), L = [];
    L.push('<profile_project saved="' + pnwDate(now) + '" currentoption="' + xmlEsc(opts.option || '') + '" title="' + xmlEsc(opts.title || built.name || '') + '" created_by="' + xmlEsc(opts.createdBy || '') + '" ground_type="1" first_saved="' + pnwDate(now) + '" pnw_version="7.18.1" profile_version="1.1.0.595" remarks="">');
    L.push('  <Table1>');
    built.rows.forEach(function (r) {
      L.push('    <Table1>', el(6, 'Distance', '0'), el(6, 'Slope', '0'), el(6, 'Chainage', netNum(r.chainage)), el(6, 'Level', netNum(r.elevation)),
        el(6, 'Clearance1', netNum(opts.clearance1)), el(6, 'Clearance2', netNum(opts.clearance2)), el(6, 'Easting', netNum(r.easting)), el(6, 'Northing', netNum(r.northing)), el(6, 'Comment', ''), '    </Table1>');
    });
    L.push('  </Table1>', '  <Table2>');
    built.rows.forEach(function (r) {
      L.push('    <Table2>', el(6, 'ID', r.id), el(6, 'Distance', netNum(r.chainage)), el(6, 'HeightAG', netNum(r.height)), el(6, 'Length', netNum(r.length)), el(6, 'Sunk', netNum(r.sunk)),
        el(6, 'Easting', netNum(r.easting)), el(6, 'Northing', netNum(r.northing)), el(6, 'structure', ''), el(6, 'strOrient', '0'), el(6, 'foundationCode', ''), el(6, 'soilCode', ''),
        el(6, 'glDiameter', '0'), el(6, 'poleMountPlant', ''), el(6, 'numConstructions', '0'), el(6, 'constrCode', ''), el(6, 'attachHt', ''), el(6, 'constrOrient', ''), el(6, 'constrVoltage', ''),
        el(6, 'remarks', r.comment || ''), el(6, 'plantAttachHt', '0'), el(6, 'plantOrient', '0'), el(6, 'plantisNew', 'False'), el(6, 'colour', '0'), el(6, 'dwghdl', '0'), el(6, 'photo', ''),
        el(6, 'stayed', 'False'), el(6, 'staydir', '0'), el(6, 'stayht', '0'), el(6, 'stayangle', '0'), el(6, 'diam', '0'), el(6, 'externalTiploadCalc', 'False'), el(6, 'New', 'False'),
        el(6, 'EastingPrevious', '0'), el(6, 'NorthingPrevious', '0'), el(6, 'staycode', ''), '    </Table2>');
    });
    L.push('  </Table2>');
    ['Table3', 'Table4', 'Table5', 'Table6', 'Table7', 'Table8', 'Table9', 'Table10', 'Table11', 'SegLengths'].forEach(function (t) { L.push('  <' + t + ' />'); });
    L.push('</profile_project>');
    return L.join('\r\n');
  }

  // Reads Table1/Table2 back out of a .pnwx profile (used for regression checks and for reference comparison).
  function readProfilePnwx(xml) {
    function blocks(tag) { var re = new RegExp('<' + tag + '>\\s*(<(?:Distance|ID)>[\\s\\S]*?)</' + tag + '>', 'g'), out = [], m; while ((m = re.exec(xml))) out.push(m[1]); return out; }
    function field(b, f) { var m = b.match(new RegExp('<' + f + '>([^<]*)</' + f + '>')); return m ? m[1].trim() : null; }
    return {
      ground: blocks('Table1').map(function (b) { return { chainage: +field(b, 'Chainage'), level: +field(b, 'Level'), easting: +field(b, 'Easting'), northing: +field(b, 'Northing'), clearance1: +field(b, 'Clearance1'), clearance2: +field(b, 'Clearance2') }; }),
      poles: blocks('Table2').map(function (b) { return { id: field(b, 'ID'), distance: +field(b, 'Distance'), height: +field(b, 'HeightAG'), length: +field(b, 'Length'), sunk: +field(b, 'Sunk'), easting: +field(b, 'Easting'), northing: +field(b, 'Northing') }; }),
      attrs: (xml.match(/^<profile_project([^>]*)>/) || [])[1] || ''
    };
  }

  return {
    GROUNDLINE_HEADERS: GROUNDLINE_HEADERS, SEGMENT_HEADERS: SEGMENT_HEADERS, ROLES: ROLES,
    num: num, round: round, poleId: poleId, parseCSV: parseCSV, parseDate: parseDate, parseGeometry: parseGeometry,
    readFile: readFile, detectRole: detectRole, importFile: importFile, buildPoles: buildPoles, existingLength: existingLength,
    dist2d: dist2d, bearing: bearing, autoOrder: autoOrder, settingDepth: settingDepth, buildProfile: buildProfile,
    groundlineAoa: groundlineAoa, segmentsAoa: segmentsAoa, groundProfileWorkbook: groundProfileWorkbook, compareWithReference: compareWithReference,
    profilePnwx: profilePnwx, readProfilePnwx: readProfilePnwx, pnwDate: pnwDate
  };
});
