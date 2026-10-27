/* Poles and Wires design model: lossless .pnwx reading/writing, construction register and attachment geometry.
   Separate from the rendering code so the rules can change without touching the 3D view.
   Field meanings follow the PNW 7 manual (§4.6 Constructions, §7.9.3, §9) and Ishan's saved projects. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PNWModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- lossless XML tree ----------
     Every token (tags, text, whitespace, CDATA) is kept, so an unchanged document serialises back byte for byte
     and fields this tool does not understand are never dropped. */
  function parseXml(text) {
    var re = /<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g, m, rootNode = { tag: '#document', children: [] }, stack = [rootNode];
    while ((m = re.exec(text))) {
      var t = m[0], top = stack[stack.length - 1];
      if (t[0] !== '<' || t.indexOf('<![CDATA[') === 0 || t.indexOf('<?') === 0 || t.indexOf('<!--') === 0) { top.children.push(t); continue; }
      if (t[1] === '/') {
        var name = t.slice(2, -1).trim();
        if (top.tag !== name) throw new Error('Malformed .pnwx: </' + name + '> does not close <' + top.tag + '>.');
        top.close = t; stack.pop(); continue;
      }
      var tag = t.slice(1).match(/^[^\s/>]+/)[0];
      var node = { tag: tag, open: t, children: [], close: null, self: /\/>$/.test(t) };
      top.children.push(node);
      if (!node.self) stack.push(node);
    }
    if (stack.length !== 1) throw new Error('Malformed .pnwx: <' + stack[stack.length - 1].tag + '> is not closed.');
    return rootNode;
  }
  function serialize(node) {
    if (typeof node === 'string') return node;
    if (node.tag === '#document') return node.children.map(serialize).join('');
    if (node.self) return node.open;
    return node.open + node.children.map(serialize).join('') + node.close;
  }
  function els(node, tag) { return (node.children || []).filter(function (c) { return typeof c !== 'string' && (!tag || c.tag === tag); }); }
  function el(node, tag) { return els(node, tag)[0] || null; }
  function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // Leaf text. .NET writes an empty string as an open tag, newline + indent, close tag.
  function text(node) {
    if (!node) return null;
    var t = node.children.filter(function (c) { return typeof c === 'string'; }).join('');
    return /^\s*$/.test(t) && /\n/.test(t) ? '' : unesc(t);
  }
  function indentOf(parent, node) {
    var i = parent.children.indexOf(node), prev = i > 0 ? parent.children[i - 1] : '';
    var m = typeof prev === 'string' ? prev.match(/[ \t]*$/) : null;
    return m ? m[0] : '';
  }
  function setText(parent, node, value) {
    if (value === '' || value == null) node.children = ['\r\n' + indentOf(parent, node)];
    else node.children = [esc(value)];
  }
  function attrs(node) {
    var o = {}, re = /([\w:.-]+)="([^"]*)"/g, m;
    while ((m = re.exec(node.open))) o[m[1]] = unesc(m[2]);
    return o;
  }
  function setAttr(node, name, value) {
    var re = new RegExp('(\\s' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=")[^"]*(")');
    node.open = re.test(node.open) ? node.open.replace(re, '$1' + esc(value).replace(/"/g, '&quot;') + '$2') : node.open.replace(/\s*(\/?)>$/, ' ' + name + '="' + esc(value).replace(/"/g, '&quot;') + '"$1>');
  }
  // A DataSet record: wrapper <TableN> holding repeated <TableN> rows of leaf fields.
  function rows(rootEl, table) {
    var wrap = el(rootEl, table); if (!wrap) return [];
    return els(wrap, table).map(function (r) { return record(r); });
  }
  function record(r) {
    var o = {}; els(r).forEach(function (f) { o[f.tag] = text(f); });
    Object.defineProperty(o, '_el', { value: r, enumerable: false });
    return o;
  }
  function setField(rec, field, value) {
    var f = el(rec._el, field);
    if (!f) throw new Error('Field ' + field + ' not found in ' + rec._el.tag + '.');
    setText(rec._el, f, value == null ? '' : String(value));
    rec[field] = value == null ? '' : String(value);
  }
  function numOr(v, d) { var n = v == null || v === '' ? NaN : Number(v); return isFinite(n) ? n : d; }
  function list(v) { return v == null || v === '' ? [] : String(v).split(';').map(Number); }

  /* ---------- .pnwx project ---------- */
  function readPnwx(xml) {
    var doc = parseXml(String(xml)), top = els(doc)[0];
    if (!top || (top.tag !== 'profile_project' && top.tag !== 'tipload_project')) throw new Error('Not a Poles \'n\' Wires project: the root element is <' + (top && top.tag) + '>.');
    var p = { kind: top.tag === 'profile_project' ? 'profile' : 'tipload', attrs: attrs(top) };
    Object.defineProperty(p, '_doc', { value: doc, enumerable: false });
    Object.defineProperty(p, '_root', { value: top, enumerable: false });
    if (p.kind === 'tipload') {
      p.circuits = rows(top, 'ccts').length ? els(el(top, 'ccts'), 'cct').map(record) : [];
      p.poletype = (rows(top, 'poletype')[0]) || null;
      return p;
    }
    p.ground = rows(top, 'Table1');
    p.poles = rows(top, 'Table2');
    p.segments = rows(top, 'Table3');
    p.conductors = rows(top, 'Table4');
    p.segPoles = rows(top, 'Table6');
    p.conditions = rows(top, 'Table7');
    p.constructions = rows(top, 'Table8');
    p.segLengths = rows(top, 'SegLengths');
    p.poletypes = rows(top, 'poletypes');
    p.tiploads = {};
    els(top).forEach(function (n) {
      var m = n.tag.match(/^pole_(.+)$/); if (!m) return;
      var cd = n.children.filter(function (c) { return typeof c === 'string' && c.indexOf('<![CDATA[') === 0; })[0];
      if (cd) { try { p.tiploads[m[1]] = readPnwx(cd.slice(9, -3)); } catch (e) { p.tiploads[m[1]] = { error: e.message }; } }
    });
    return p;
  }
  function writePnwx(p) {
    // re-embed edited tiploads (their CDATA) before writing
    Object.keys(p.tiploads || {}).forEach(function (id) {
      var t = p.tiploads[id]; if (!t || !t._doc) return;
      var n = els(p._root, 'pole_' + id)[0]; if (!n) return;
      n.children = n.children.map(function (c) { return typeof c === 'string' && c.indexOf('<![CDATA[') === 0 ? '<![CDATA[' + serialize(t._doc) + ']]>' : c; });
    });
    return serialize(p._doc);
  }

  /* ---------- constructions ---------- */
  // Plain construction instance from a Table8 row (attht = king bolt height above ground, manual §7.9.3).
  function constructionFrom(row, sourceFile) {
    var y = list(row.attachHt), x = list(row.attachOutreach), order = list(row.attachOrder);
    return {
      unique: row.unique, code: row.code || '', descr: row.descr || '', pole: row.pole, segment: row.segment || '', label: row.label || '',
      voltage: numOr(row.voltage, null), kingbolt: numOr(row.attht, null), isNew: row.New === 'True',
      attachments: y.map(function (yy, i) { return { x: x[i], y: yy, order: order[i] != null ? order[i] : i + 1 }; }),
      source: { kind: 'imported', file: sourceFile || '', table: 'Table8', unique: row.unique }
    };
  }

  // Register of construction types seen in imported PNW files. One entry per code + attachment layout.
  // DCSH links stay empty until the DCSH documents are supplied; everything is marked for engineering review.
  function buildRegister(projects) {
    var reg = {}, order = [];
    projects.forEach(function (pp) {
      (pp.project.constructions || []).forEach(function (row) {
        var c = constructionFrom(row, pp.file), key = c.code + '|' + JSON.stringify(c.attachments);
        var pole = (pp.project.poles || []).filter(function (x) { return x.ID === c.pole; })[0];
        var below = pole && c.kingbolt != null ? Math.round((numOr(pole.HeightAG, NaN) - c.kingbolt) * 1000) / 1000 : null;
        if (!reg[key]) {
          reg[key] = { id: key, code: c.code, voltage: c.voltage, attachments: c.attachments, phases: c.attachments.length, sources: [], observedBelowTip: [],
            dcsh: { document: '', drawing: '', page: '' }, referencePoint: 'King bolt (PNW construction reference, manual §4.6.1)',
            direction: 'x = horizontal outreach (negative = left), y = vertical above king bolt, metres',
            defaultBelowTip: null, conditions: '',
            status: c.code ? 'PNW data only: DCSH reference not linked, needs engineering review' : 'Blank construction in the PNW file (no code, no attachment points): kept unchanged, needs engineering review' };
          order.push(key);
        }
        reg[key].sources.push(pp.file + ' · ' + c.pole + ' · ' + c.descr);
        if (below != null && isFinite(below)) reg[key].observedBelowTip.push({ pole: c.pole, value: below, file: pp.file });
      });
    });
    var byCode = {};
    order.forEach(function (k) { (byCode[reg[k].code] = byCode[reg[k].code] || []).push(k); });
    order.forEach(function (k) { if (byCode[reg[k].code].length > 1) reg[k].conflict = 'Code ' + reg[k].code + ' appears with different attachment layouts in the imported files.'; });
    return order.map(function (k) { return reg[k]; });
  }

  /* ---------- editing constructions inside a .pnwx (Table8, kept consistent with Table6) ---------- */
  function fmtNum(v) { return String(Math.round(Number(v) * 1e6) / 1e6); }
  // fields: {code, kingbolt, voltage, attachments:[{x,y,order}]}
  function updateConstruction(p, unique, fields) {
    var row = p.constructions.filter(function (r) { return r.unique === String(unique); })[0];
    if (!row) throw new Error('Construction ' + unique + ' is not in this project.');
    var oldDescr = row.descr;
    if (fields.code != null) { setField(row, 'code', fields.code); setField(row, 'descr', fields.code + ' (' + row.unique + ')'); }
    if (fields.kingbolt != null) setField(row, 'attht', fmtNum(fields.kingbolt));
    if (fields.voltage != null) setField(row, 'voltage', fmtNum(fields.voltage));
    if (fields.attachments) {
      setField(row, 'attachHt', fields.attachments.map(function (a) { return fmtNum(a.y); }).join(';'));
      setField(row, 'attachOutreach', fields.attachments.map(function (a) { return fmtNum(a.x); }).join(';'));
      setField(row, 'attachOrder', fields.attachments.map(function (a) { return String(a.order); }).join(';'));
    }
    p.segPoles.forEach(function (s) {
      if (s.id !== row.pole || s.constr !== oldDescr) return;
      if (fields.kingbolt != null) setField(s, 'attht', fmtNum(fields.kingbolt));
      if (row.descr !== oldDescr) setField(s, 'constr', row.descr);
    });
    return row;
  }
  // Adds a construction to a pole by copying the layout of an existing Table8 row, so every field PNW writes is present.
  function addConstruction(p, pole, fields) {
    var wrap = el(p._root, 'Table8');
    if (!wrap || !els(wrap, 'Table8').length) throw new Error('This project has no construction rows to copy the PNW layout from.');
    var tmpl = els(wrap, 'Table8')[0], copy = parseXml(serialize(tmpl)).children[0];
    var unique = String(p.constructions.reduce(function (m, r) { return Math.max(m, numOr(r.unique, -1)); }, -1) + 1);
    var last = wrap.children.lastIndexOf(els(wrap, 'Table8').slice(-1)[0]);
    var ws = wrap.children[last - 1];
    wrap.children.splice(last + 1, 0, typeof ws === 'string' ? ws : '\r\n    ', copy);
    var row = record(copy);
    // the copied row's parent indentation is the wrapper; fix empty-string indentation against it
    setFieldIn(copy, row, 'unique', unique); setFieldIn(copy, row, 'pole', pole); setFieldIn(copy, row, 'segment', fields.segment || ''); setFieldIn(copy, row, 'label', '');
    setFieldIn(copy, row, 'New', fields.isNew ? 'True' : 'False');
    p.constructions.push(row);
    updateConstruction(p, unique, { code: fields.code || '', kingbolt: fields.kingbolt, voltage: fields.voltage != null ? fields.voltage : 0, attachments: fields.attachments || [] });
    return row;
  }
  function setFieldIn(node, row, field, value) { var f = el(node, field); if (f) { setText(node, f, value); row[field] = value; } }
  function removeConstruction(p, unique) {
    var row = p.constructions.filter(function (r) { return r.unique === String(unique); })[0];
    if (!row) return;
    if (p.segPoles.some(function (s) { return s.id === row.pole && s.constr === row.descr; })) throw new Error(row.descr + ' on ' + row.pole + ' carries conductors; detach the segment in PNW before removing it.');
    var wrap = el(p._root, 'Table8'), i = wrap.children.indexOf(row._el);
    wrap.children.splice(i - (typeof wrap.children[i - 1] === 'string' ? 1 : 0), typeof wrap.children[i - 1] === 'string' ? 2 : 1);
    p.constructions.splice(p.constructions.indexOf(row), 1);
  }

  /* ---------- geometry ----------
     poles: [{id, easting, northing, ground, height, sunk}] in line order.
     constructions: {poleId: [construction]}.  Returns attachment points with provenance. */
  function unit(dx, dy) { var l = Math.sqrt(dx * dx + dy * dy) || 1; return [dx / l, dy / l]; }
  function crossarmAxes(poles) {
    // Line direction at each pole: along the span at end poles, bisector of the two spans otherwise.
    // Crossarm (+x outreach) is to the right when looking along increasing chainage. PNW assumes one orientation for
    // all constructions (manual §4.6.1); which side is "left" is a drafting convention, so this is flagged in the UI.
    return poles.map(function (p, i) {
      var a = poles[i - 1], b = poles[i + 1], d;
      if (a && b) { var u1 = unit(p.easting - a.easting, p.northing - a.northing), u2 = unit(b.easting - p.easting, b.northing - p.northing); d = unit(u1[0] + u2[0], u1[1] + u2[1]); }
      else if (b) d = unit(b.easting - p.easting, b.northing - p.northing);
      else if (a) d = unit(p.easting - a.easting, p.northing - a.northing);
      else d = [0, 1];
      return { along: d, right: [d[1], -d[0]] };
    });
  }
  function attachmentPoints(poles, constructions) {
    var axes = crossarmAxes(poles), out = [];
    poles.forEach(function (p, i) {
      (constructions[p.id] || []).forEach(function (c) {
        if (c.kingbolt == null) return;
        c.attachments.forEach(function (a, k) {
          out.push({
            pole: p.id, construction: c.descr || c.code, code: c.code, index: k, order: a.order,
            easting: p.easting + axes[i].right[0] * a.x, northing: p.northing + axes[i].right[1] * a.x,
            heightAG: Math.round((c.kingbolt + a.y) * 1000) / 1000, elevation: p.ground + c.kingbolt + a.y,
            provenance: { kingbolt: c.kingbolt, kingboltSource: c.source ? c.source.kind : 'unknown', x: a.x, y: a.y, rule: 'height = king bolt + attachment y (PNW manual §7.9.3)' }
          });
        });
      });
    });
    return { points: out, axes: axes };
  }

  // Wires of a strain section: between attachment point n on consecutive poles (manual §4.6.2 note 2).
  // segPoles: Table6-style [{strsection, id, constr}], keyed by construction descr.
  function wires(points, segPoles, segments) {
    var bySeg = {}, out = [], issues = [];
    segPoles.forEach(function (r) { if (r.include === 'False') return; (bySeg[r.strsection] = bySeg[r.strsection] || []).push(r); });
    Object.keys(bySeg).forEach(function (ss) {
      var seg = (segments || []).filter(function (s) { return s.StrainSect === ss; })[0] || {};
      var list = bySeg[ss];
      for (var i = 1; i < list.length; i++) {
        var A = points.filter(function (p) { return p.pole === list[i - 1].id && p.construction === list[i - 1].constr; }).sort(byOrder);
        var B = points.filter(function (p) { return p.pole === list[i].id && p.construction === list[i].constr; }).sort(byOrder);
        if (!A.length || !B.length) { issues.push({ level: 'warning', code: 'wire', message: ss + ': no attachment points for ' + (A.length ? list[i].id + ' ' + list[i].constr : list[i - 1].id + ' ' + list[i - 1].constr) + ', span not drawn.' }); continue; }
        var n = Math.min(A.length, B.length, numOr(seg.numconds, Infinity));
        if (A.length !== B.length) issues.push({ level: 'warning', code: 'wire', message: ss + ' ' + list[i - 1].id + '→' + list[i].id + ': constructions have ' + A.length + ' and ' + B.length + ' attachment points; ' + n + ' wires drawn.' });
        for (var k = 0; k < n; k++) out.push({ segment: ss, conductor: seg.Conductor || '', phase: k + 1, from: A[k], to: B[k], voltage: null });
      }
    });
    return { wires: out, issues: issues };
  }
  function byOrder(a, b) { return a.order - b.order; }

  // Mid-span sag from the stringing tension only (w·L²/8T). No temperature, creep or ruling-span change of state,
  // so it is illustrative and is labelled that way; PNW's own sag results are not reproduced.
  function illustrativeSag(span, conductor, segment) {
    if (!conductor || !segment) return null;
    var mass = numOr(conductor.Mass_kg_m, NaN), cbl = numOr(conductor.CBL_kN, NaN), t = numOr(segment.Tension, NaN), units = segment.TensionUnits;
    var T = units === '%CBL' ? t / 100 * cbl : units === 'kN' ? t : NaN;
    if (!(mass > 0) || !(T > 0) || !(span > 0)) return null;
    return mass * 9.80665 / 1000 * span * span / (8 * T);
  }


  // ---------- PNW library tables (copied from the Poles 'n' Wires library screens, tab separated) ----------
  // Sections start with a line such as "construction:", "conductors:", "poles:", "stays:"; the next line is the header row.
  var LIB_SECTIONS = { construction: 'constructions', constructions: 'constructions', conductors: 'conductors', conductor: 'conductors',
    poles: 'poles', pole: 'poles', stays: 'stays', stay: 'stays', plant: 'plant', species: 'species', 'soil type': 'soils', soil: 'soils' };
  function parseLibrary(textIn) {
    var out = { constructions: [], conductors: [], poles: [], stays: [], plant: [], species: [], soils: [], issues: [] };
    var sec = null, header = null;
    String(textIn).replace(/\r/g, '').split('\n').forEach(function (line, i) {
      var m = /^\s*([a-z ]+?)\s*:\s*$/i.exec(line);
      if (m && LIB_SECTIONS[m[1].toLowerCase()]) { sec = LIB_SECTIONS[m[1].toLowerCase()]; header = null; return; }
      if (!sec || !line.trim()) return;
      var cells = line.split('\t');
      if (!header) { header = cells.map(function (h) { return h.trim(); }); return; }
      var r = { _line: i + 1 };
      header.forEach(function (h, k) { if (h) r[h] = cells[k] == null ? '' : cells[k].trim(); });
      if (!r.Code && !r[header[0]]) return;
      out[sec].push(r);
    });
    out.constructions = out.constructions.map(function (r) {
      return { code: r.Code, description: r.Description || '', belowTip: numOr(r['Default distance below tip'], null),
        belowSupercct: numOr(r['Def. distance below supercct'], null), attachHeight: numOr(r['Def. attachment height'], null),
        voltageLL: numOr(r['Voltage Line-Line'], null), voltageLG: numOr(r['Voltage Line-Ground'], null), remarks: r.Remarks || '',
        set: r['Set Name'] || '', referenceFile: r['Reference file'] || '', attachments: r.Attachments || '', line: r._line };
    });
    out.poles = out.poles.map(function (r) {
      var m = /(\d+(?:\.\d+)?)\s*m\s*\/\s*(\d+(?:\.\d+)?)\s*kN/i.exec(r.Code + ' ' + r.Description);
      return { code: r.Code, description: r.Description || '', length: numOr(r.Length, null), sinking: numOr(r['Default Sinking'], null),
        height: numOr(r['Default Height'], null), material: r.Material || '', diamTip: numOr(r['Diameter: tip'], null),
        diamGL: numOr(r['Diameter: groundline'], null), diamButt: numOr(r['Diameter: butt'], null), kN: m ? Number(m[2]) : null,
        selfSupporting: /self supporting/i.test(r.Description || ''), line: r._line };
    });
    out.conductors = out.conductors.map(function (r) {
      return { code: r.Code, name: r['Name 1'] || '', name2: r['Name 2'] || '', material: r.Material || '', mass: numOr(r['Mass kg/m'], null),
        diameter: numOr(r['Nom. Diam mm'], null), cbl: numOr(r['CBL kN'], null), line: r._line };
    });
    if (!out.constructions.length && !out.poles.length && !out.conductors.length) out.issues.push('No PNW library sections found (expected lines such as "construction:" followed by a header row).');
    var seen = {};
    out.constructions.forEach(function (c) { if (seen[c.code]) out.issues.push('Construction ' + c.code + ' is listed twice (lines ' + seen[c.code] + ' and ' + c.line + ').'); seen[c.code] = c.line; });
    return out;
  }
  function libraryConstruction(lib, code) {
    if (!lib || !code) return null;
    var u = String(code).toUpperCase();
    return lib.constructions.filter(function (c) { return String(c.code).toUpperCase() === u; })[0] || null;
  }
  // King bolt height above ground from the library defaults (PNW construction model, manual §4.6): the top construction sits
  // "default distance below tip" under the tip; one under another construction sits "distance below supercircuit" under it
  // (checked against every construction in the saved GROUND LINE project).
  function defaultKingbolt(lib, code, heightAG, aboveKingbolt) {
    var c = libraryConstruction(lib, code);
    if (!c) return null;
    if (aboveKingbolt != null && c.belowSupercct > 0)
      return { value: Math.round((aboveKingbolt - c.belowSupercct) * 1000) / 1000, below: c.belowSupercct, source: 'PNW library ' + c.code + ' default distance below supercircuit' };
    if (c.belowTip == null || !(heightAG > 0)) return null;
    return { value: Math.round((heightAG - c.belowTip) * 1000) / 1000, below: c.belowTip, source: 'PNW library ' + c.code + ' default distance below tip' };
  }
  // Match a GIS stock description such as "11M;6KN" to library poles of that length and strength.
  function matchPoleType(lib, stock, length) {
    if (!lib) return [];
    var m = /(\d+(?:\.\d+)?)\s*M\b[^0-9]*(\d+(?:\.\d+)?)\s*KN/i.exec(stock || '');
    var L = m ? Number(m[1]) : length, kN = m ? Number(m[2]) : null;
    if (!(L > 0)) return [];
    return lib.poles.filter(function (p) { return p.length === L && (kN == null || p.kN === kN); })
      .sort(function (a, b) { return (a.selfSupporting - b.selfSupporting) || a.code.localeCompare(b.code); })
      .map(function (p) { return { pole: p, basis: kN == null ? 'length only' : 'length and strength from stock description' }; });
  }

  // ---------- one view model for plan / 3D / profile, built from a PNW project ----------
  // Ground level at each pole is the Table1 level at the pole's chainage. Pole diameters come from the PNW library pole
  // type when one can be matched (opts.poleType(id, length) -> library pole), otherwise they stay unknown.
  function groundAt(p, chain) {
    var best = null;
    (p.ground || []).forEach(function (g) { var d = Math.abs(numOr(g.Chainage, NaN) - chain); if (d < 0.02 && (!best || d < best.d)) best = { d: d, level: numOr(g.Level, null) }; });
    return best ? best.level : null;
  }
  function designModel(p, opts) {
    opts = opts || {};
    var issues = [], poles = [], cons = {}, list = [];
    (p.poles || []).forEach(function (r) {
      var chain = numOr(r.Distance, null), g = chain == null ? null : groundAt(p, chain);
      if (g == null) issues.push({ level: 'warning', code: 'ground', poleId: r.ID, message: r.ID + ': no ground level at chainage ' + r.Distance + ' in the project ground line.' });
      var len = numOr(r.Length, null), type = opts.poleType ? opts.poleType(r.ID, len) : null;
      poles.push({ id: r.ID, chainage: chain, easting: numOr(r.Easting, NaN), northing: numOr(r.Northing, NaN), ground: g, length: len,
        height: numOr(r.HeightAG, null), sunk: numOr(r.Sunk, null), isNew: r.New === 'True',
        diamTip: type ? type.diamTip : null, diamGL: type ? type.diamGL : null, poleType: type ? type.code : null });
    });
    (p.constructions || []).forEach(function (row) {
      var c = constructionFrom(row, opts.file);
      (cons[c.pole] = cons[c.pole] || []).push(c); list.push(c);
    });
    var usable = poles.filter(function (q) { return isFinite(q.easting) && isFinite(q.northing) && q.ground != null; });
    var ap = attachmentPoints(usable, cons), w = wires(ap.points, p.segPoles || [], p.segments || []);
    var volt = {}; list.forEach(function (c) { volt[c.pole + '|' + c.descr] = c.voltage; });
    w.wires.forEach(function (x) {
      x.code = x.from.code; x.voltage = volt[x.from.pole + '|' + x.from.construction];
      x.span = Math.sqrt(Math.pow(x.to.easting - x.from.easting, 2) + Math.pow(x.to.northing - x.from.northing, 2));
      var cond = (p.conductors || []).filter(function (c) { return String(c.Code).toUpperCase() === String(x.conductor).toUpperCase(); })[0];
      var seg = (p.segments || []).filter(function (s) { return s.StrainSect === x.segment; })[0];
      x.sag = opts.sag ? illustrativeSag(x.span, cond, seg) : null;
    });
    return { poles: usable, allPoles: poles, constructions: list, byPole: cons, points: ap.points, axes: ap.axes, wires: w.wires, issues: issues.concat(w.issues) };
  }

  // ---------- DCSH Part 10 stringing tables (text extracted from the PDF) ----------
  // Each table: title line "URBAN (20m – 70m) 7/3.0 AAC LIBRA 10%", three temperature rows (new initial, new next day,
  // existing final), then per ruling span a TENSION (Kg), TIME (s) and SAG (m) row.
  var TITLE = /^\s*(URBAN|OUTER URBAN|RURAL)\s*\(\s*(\d+)\s*m?\s*[–-]\s*(\d+)\s*m?\s*\)\s*(.+?)\s*$/;
  function nums(str) { var m = String(str).match(/-?\d+(?:\.\d+)?/g); return m ? m.map(Number) : []; }
  function parseStringingTables(textIn) {
    var lines = String(textIn).replace(/\r/g, '').split('\n'), tables = [], issues = [], cur = null, page = null, legacy = false;
    function close() {
      if (!cur) return;
      var n = cur.temps.length ? cur.temps[0].length : 0;
      if (cur.temps.length < 3 || !cur.spans.length) issues.push('Page ' + cur.page + ': "' + cur.title + '" could not be read completely; skipped.');
      else if (cur.spans.some(function (r) { return r.sag.length !== n || r.tension.length !== n; })) issues.push('Page ' + cur.page + ': "' + cur.title + '" has rows of different lengths; skipped.');
      else tables.push({ id: 'p' + cur.page + ' ' + cur.title, title: cur.title, page: cur.page, legacy: cur.legacy, area: cur.area, spanMin: cur.spanMin, spanMax: cur.spanMax,
        temps: { initial: cur.temps[0], nextDay: cur.temps[1], final: cur.temps[2] }, spans: cur.spans });
      cur = null;
    }
    lines.forEach(function (line) {
      var pg = /(\d+)\s+of\s+\d+\s+Last printed/.exec(line); if (pg) page = Number(pg[1]) + 1; // footer of the previous page
      if (/^\s*Information Section\s*$/.test(line)) legacy = true;
      var t = TITLE.exec(line);
      if (t && !/^\s*\S+\s+[A-Z]\s/.test(line)) { close(); cur = { title: line.trim().replace(/\s+/g, ' '), area: t[1], spanMin: +t[2], spanMax: +t[3], page: page, legacy: legacy, temps: [], spans: [] }; return; }
      if (!cur) return;
      var rs = /^\s*(\d+)\s+TENSION\s*\(Kg\)\s+(.*)$/.exec(line);
      if (rs) {
        var last = cur.spans[cur.spans.length - 1];
        // ruling spans only increase within a table; a drop means an unlabelled table follows, which is not read
        if ((last && +rs[1] <= last.rs) || +rs[1] > cur.spanMax + 5) { issues.push('Page ' + page + ': a table without a readable title follows "' + cur.title + '"; it was not read.'); close(); return; }
        cur.spans.push({ rs: +rs[1], tension: nums(rs[2]), sag: [] }); return;
      }
      var sg = /SAG\s*\(m\)\s+(.*)$/.exec(line);
      if (sg && cur.spans.length) { cur.spans[cur.spans.length - 1].sag = nums(sg[1]); return; }
      if (cur.spans.length || /TIME|TENSION|SAG/.test(line)) return;
      var v = nums(line.replace(/\(deg C\)/g, ''));
      if (v.length >= 8 && !/[A-Za-z]{3,}/.test(line.replace(/\(deg C\)|Next Day|New Conductor|Initial|Existing|Conductor|Final/g, '')) && v.every(function (x, i) { return !i || x > v[i - 1]; })) cur.temps.push(v);
    });
    close();
    return { tables: tables, issues: issues };
  }
  // Ruling span of a strain section: sqrt(sum L^3 / sum L).
  function rulingSpan(spans) {
    var a = 0, b = 0; spans.forEach(function (l) { a += l * l * l; b += l; });
    return b > 0 ? Math.sqrt(a / b) : null;
  }
  // Sag of one span from a stringing table: the table sag at the ruling span (linear between tabulated ruling spans)
  // for the chosen condition/temperature, scaled by (span / ruling span)^2.
  function tableSag(table, condition, temp, span, rs) {
    if (!table || !(span > 0) || !(rs > 0)) return { value: null, reason: 'no table, span or ruling span' };
    var col = (table.temps[condition] || []).indexOf(temp);
    if (col < 0) return { value: null, reason: temp + ' °C is not a column of the ' + condition + ' row' };
    var rows = table.spans, lo = null, hi = null;
    rows.forEach(function (r) { if (r.rs <= rs && (!lo || r.rs > lo.rs)) lo = r; if (r.rs >= rs && (!hi || r.rs < hi.rs)) hi = r; });
    if (!lo || !hi) return { value: null, reason: 'ruling span ' + rs.toFixed(1) + ' m is outside the table (' + rows[0].rs + '–' + rows[rows.length - 1].rs + ' m)' };
    var sRs = lo === hi ? lo.sag[col] : lo.sag[col] + (hi.sag[col] - lo.sag[col]) * (rs - lo.rs) / (hi.rs - lo.rs);
    return { value: sRs * (span / rs) * (span / rs), atRulingSpan: sRs, reason: '' };
  }

  // ---------- DCSH standards register (JSON kept with the project files, never in this repo) ----------
  var DCSH_STATUS = { verified: 'Offsets match the DCSH drawing', partial: 'Partly covered by the DCSH drawing', pending: 'DCSH drawing not read yet', unsupported: 'Not supported by DCSH' };
  function parseDcshRegister(textIn) {
    var j = JSON.parse(textIn);
    if (!j || j.kind !== 'dcsh-register' || !Array.isArray(j.entries)) throw new Error('Not a DCSH standards register (expected "kind": "dcsh-register").');
    var issues = [];
    j.entries.forEach(function (e, i) {
      if (!e.id || !e.drawing) issues.push('Entry ' + (i + 1) + ' has no id or drawing number.');
      if (!DCSH_STATUS[e.status]) issues.push((e.id || 'Entry ' + (i + 1)) + ': unknown status "' + e.status + '".');
      if (e.attachments && !e.attachments.every(function (a) { return isFinite(a.x) && isFinite(a.y); })) issues.push(e.id + ': attachment offsets must be numbers.');
    });
    return { source: j.source || '', entries: j.entries, issues: issues };
  }
  function dcshFor(reg, code) {
    if (!reg || !code) return [];
    return reg.entries.filter(function (e) { return String(e.pnwCode || '').toUpperCase() === String(code).toUpperCase(); });
  }
  // Compare a construction (king bolt position and attachment offsets) with its DCSH entry. Tolerance 5 mm.
  function compareDcsh(entry, c, heightAG) {
    var out = { kingbolt: null, offsets: null, notes: [] };
    if (entry.kingboltBelowTip != null && heightAG > 0 && c.kingbolt != null) {
      var below = Math.round((heightAG - c.kingbolt) * 1000) / 1000;
      out.kingbolt = Math.abs(below - entry.kingboltBelowTip) <= 0.005;
      if (!out.kingbolt) out.notes.push('King bolt is ' + below + ' m below the tip; ' + entry.drawing + ' shows ' + entry.kingboltBelowTip + ' m when it is the top construction.');
    }
    if (entry.attachments) {
      var a = c.attachments.slice().sort(function (p, q) { return p.order - q.order; }), b = entry.attachments.slice().sort(function (p, q) { return p.order - q.order; });
      out.offsets = a.length === b.length && a.every(function (p, i) { return Math.abs(p.x - b[i].x) <= 0.005 && Math.abs(p.y - b[i].y) <= 0.005; });
      if (!out.offsets) out.notes.push('Attachment offsets differ from ' + entry.drawing + ' (' + b.map(function (p) { return p.x + ', ' + p.y; }).join(' / ') + ').');
    }
    return out;
  }

  return {
    parseXml: parseXml, serialize: serialize, readPnwx: readPnwx, writePnwx: writePnwx, setField: setField, setAttr: setAttr,
    updateConstruction: updateConstruction, addConstruction: addConstruction, removeConstruction: removeConstruction,
    constructionFrom: constructionFrom, buildRegister: buildRegister, crossarmAxes: crossarmAxes, attachmentPoints: attachmentPoints,
    wires: wires, illustrativeSag: illustrativeSag,
    parseLibrary: parseLibrary, libraryConstruction: libraryConstruction, defaultKingbolt: defaultKingbolt, matchPoleType: matchPoleType,
    groundAt: groundAt, designModel: designModel,
    parseStringingTables: parseStringingTables, rulingSpan: rulingSpan, tableSag: tableSag,
    DCSH_STATUS: DCSH_STATUS, parseDcshRegister: parseDcshRegister, dcshFor: dcshFor, compareDcsh: compareDcsh
  };
});
