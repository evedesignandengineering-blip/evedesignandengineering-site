/* Streaming .xlsx reader for very large workbooks (e.g. region-wide QLINK exports of 100 MB+).
   SheetJS turns each sheet's XML into one string; past ~512 MB of XML that silently gives an empty sheet.
   This reader inflates each sheet a chunk at a time (fflate) and returns the same [{name, rows}] shape as
   PNW.readFile (rows = arrays from column A, blank rows dropped, cached values only, dates as Date). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('fflate'));
  else root.XLSXStream = factory(root.fflate);
})(typeof self !== 'undefined' ? self : this, function (fflate) {
  'use strict';
  var CHUNK = 4 * 1024 * 1024;

  // Central directory: name -> {off, csize, method}
  function entries(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not an .xlsx (zip) file');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), out = {}, td = new TextDecoder('utf-8');
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      out[td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/^\/+/, '')] = { off: off, csize: csize, method: method };
      p += 46 + nl + xl + cl;
    }
    return { list: out, dv: dv };
  }
  function lookup(z, name) { var l = z.list; if (l[name]) return l[name]; var lc = name.toLowerCase(); for (var k in l) if (k.toLowerCase() === lc) return l[k]; return null; }
  // Calls onText(str) for each decoded piece of one entry; returns false if the entry is missing.
  function stream(u8, z, name, onText) {
    var e = lookup(z, name); if (!e) return false;
    var start = e.off + 30 + z.dv.getUint16(e.off + 26, true) + z.dv.getUint16(e.off + 28, true), end = start + e.csize;
    var td = new TextDecoder('utf-8'), i;
    if (e.method === 0) { for (i = start; i < end; i += CHUNK) onText(td.decode(u8.subarray(i, Math.min(end, i + CHUNK)), { stream: true })); onText(td.decode()); return true; }
    if (e.method !== 8) throw new Error('unsupported zip compression in ' + name);
    var inf = new fflate.Inflate(function (chunk, final) { onText(td.decode(chunk, { stream: !final })); });
    for (i = start; i < end; i += CHUNK) inf.push(u8.subarray(i, Math.min(end, i + CHUNK)), i + CHUNK >= end);
    return true;
  }
  function text(u8, z, name) { var s = []; return stream(u8, z, name, function (t) { s.push(t); }) ? s.join('') : null; }

  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unesc(s) {
    if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, function (m, g) { return g[0] === '#' ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : +g.slice(1)) : (ENT[g] != null ? ENT[g] : m); })
      .replace(/_x([0-9A-F]{4})_/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  // Text of <t> runs inside one <si> or <is> (rich text joins the runs; phonetic <rPh> is skipped).
  function siText(x) { x = x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g, m; while ((m = re.exec(x))) out += m[1] || ''; return unesc(out); }

  // Splits a streamed document into complete <tag ...>...</tag> (or self-closed) elements.
  function elements(tag, onEl) {
    var buf = '', open = '<' + tag, close = '</' + tag + '>';
    function isOpen(s, i) { var c = s.charAt(i + open.length); return c === ' ' || c === '>' || c === '/' || c === '\t' || c === '\r' || c === '\n'; }
    return function (t) {
      buf += t; var pos = 0;
      for (;;) {
        var a = buf.indexOf(open, pos); while (a >= 0 && !isOpen(buf, a)) a = buf.indexOf(open, a + 1);
        if (a < 0) { pos = Math.max(pos, buf.length - open.length); break; }
        var gt = buf.indexOf('>', a); if (gt < 0) { pos = a; break; }
        if (buf.charAt(gt - 1) === '/') { onEl(buf.slice(a, gt + 1), true); pos = gt + 1; continue; }
        var b = buf.indexOf(close, gt); if (b < 0) { pos = a; break; }
        onEl(buf.slice(a, b + close.length), false); pos = b + close.length;
      }
      buf = buf.slice(pos);
    };
  }

  // Copies a string cut out of a big XML chunk so the chunk itself can be freed (V8 keeps the parent of a substring alive).
  function own(s) { return s.length > 12 ? (s + ' ').slice(0, -1) : s; }

  function sharedStrings(u8, z, path) {
    var out = [];
    stream(u8, z, path, elements('si', function (x, empty) { out.push(empty ? '' : own(siText(x))); }));
    return out;
  }
  var DATE_IDS = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 30: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 57: 1 };
  function dateStyles(xml) {
    var custom = {}, out = [];
    if (!xml) return out;
    xml.replace(/<numFmt\b[^>]*>/g, function (t) { var code = unesc(attr(t, 'formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''); custom[attr(t, 'numFmtId')] = /[dmyhs]/i.test(code) && !/^general$/i.test(code); return t; });
    var xfs = /<cellXfs\b[\s\S]*?<\/cellXfs>/.exec(xml);
    if (xfs) xfs[0].replace(/<xf\b[^>]*>/g, function (t) { var id = +attr(t, 'numFmtId') || 0; out.push(!!(DATE_IDS[id] || custom[id])); return t; });
    return out;
  }
  // Local-time date with the serial's wall-clock fields, like SheetJS cellDates.
  function serialDate(v, date1904) { var u = new Date(Math.round(((date1904 ? v + 1462 : v) - 25569) * 864e5)); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds()); }
  function colIndex(ref) { var n = 0; for (var i = 0; i < ref.length; i++) { var c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; }

  function read(data) {
    var u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ? data.buffer : data, data.byteOffset || 0, data.byteLength);
    var z = entries(u8), rels = {}, wbRels = text(u8, z, 'xl/_rels/workbook.xml.rels') || '', wb = text(u8, z, 'xl/workbook.xml');
    if (!wb) throw new Error('no workbook in this .xlsx');
    wbRels.replace(/<Relationship\b[^>]*>/g, function (t) { var tg = attr(t, 'Target') || ''; rels[attr(t, 'Id')] = { type: attr(t, 'Type') || '', path: tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg.replace(/^\.\//, '') }; return t; });
    var ssPath = 'xl/sharedStrings.xml', stPath = 'xl/styles.xml';
    Object.keys(rels).forEach(function (k) { if (/sharedStrings$/.test(rels[k].type)) ssPath = rels[k].path; if (/styles$/.test(rels[k].type)) stPath = rels[k].path; });
    var ss = sharedStrings(u8, z, ssPath), isDate = dateStyles(text(u8, z, stPath)), d1904 = /date1904="(1|true)"/.test(wb);
    var sheets = [];
    wb.replace(/<sheet\b[^>]*>/g, function (t) { var rid = attr(t, 'r:id') || (/\sr[^\s=]*:id="([^"]*)"/.exec(t) || [])[1]; if (rels[rid]) sheets.push({ name: unesc(attr(t, 'name') || ''), path: rels[rid].path }); return t; });
    return sheets.map(function (sh) {
      var rows = [], width = 0, next = 0, minCol = 1e9;
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, attRe = /\s(r|t|s)="([^"]*)"/g, vRe = /<v>([\s\S]*?)<\/v>/, isRe = /<is>([\s\S]*?)<\/is>/;
      stream(u8, z, sh.path, elements('row', function (x, empty) {
        var rAt = /^<row\b[^>]*?\sr="(\d+)"/.exec(x), rn = rAt ? +rAt[1] - 1 : next; next = rn + 1;
        if (empty) return;
        var row = [], any = false, col = 0, m, am; cellRe.lastIndex = 0;
        while ((m = cellRe.exec(x))) {
          var ref = null, t = 'n', s = null, body = m[2] || '', v = null;
          attRe.lastIndex = 0;
          while ((am = attRe.exec(m[1]))) { if (am[1] === 'r') ref = am[2]; else if (am[1] === 't') t = am[2]; else s = am[2]; }
          if (ref) col = colIndex(ref);
          if (t === 'inlineStr') { var is = isRe.exec(body); v = is ? own(siText(is[1])) : null; }
          else {
            var vm = vRe.exec(body);
            if (vm) {
              var raw = vm[1];
              if (t === 's') v = ss[+raw] != null ? ss[+raw] : '';
              else if (t === 'str' || t === 'e') v = own(unesc(raw));
              else if (t === 'b') v = raw === '1';
              else if (t === 'd') v = new Date(raw);
              else { v = +raw; if (s != null && isDate[+s] && isFinite(v)) v = serialDate(v, d1904); }
            }
          }
          if (v !== null) { row[col] = v; any = true; if (col < minCol) minCol = col; }
          col++;
        }
        if (!any) return;
        for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
        if (row.length > width) width = row.length;
        rows[rn] = row;
      }));
      // Same as sheet_to_json(header:1, defval:null, blankrows:false): blank rows dropped, cells padded to the used width.
      var out = [];
      for (var r = 0; r < rows.length; r++) { var w = rows[r]; if (!w) continue; while (w.length < width) w.push(null); out.push(minCol > 0 && minCol < 1e9 ? w.slice(minCol) : w); }
      return { name: sh.name, rows: out };
    });
  }
  return { read: read };
});
