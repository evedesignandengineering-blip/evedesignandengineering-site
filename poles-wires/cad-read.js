/* DGN V8 + DXF readers -> normalised element list.
 * Element: {kind:'cell'|'line'|'text', name, level, origin:[x,y], points:[[x,y]...],
 *           length, color, weight, model:'design'|'sheet', text}
 * DGN V8 support is reverse-engineered (MicroStation CONNECT files saved by the WP DQM workspace).
 */
(function (G) {
  const S = G.SOW = G.SOW || {};

  // ------------------------------------------------------------------ CFB
  function CFB(buf) {
    const d = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const u8 = buf;
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) throw new Error('Not a MicroStation V8 DGN (OLE container signature missing). V7 DGN files are not supported - save as V8 or DXF.');
    const ss = 1 << d.getUint16(30, true), mss = 1 << d.getUint16(32, true);
    const nfat = d.getUint32(44, true), dirStart = d.getUint32(48, true), cutoff = d.getUint32(56, true);
    const miniFatStart = d.getUint32(60, true), nMiniFat = d.getUint32(64, true);
    let difat = d.getUint32(68, true); const nDifat = d.getUint32(72, true);
    const sec = n => u8.subarray((n + 1) * ss, (n + 2) * ss);
    let fatSecs = [];
    for (let i = 0; i < 109; i++) fatSecs.push(d.getUint32(76 + 4 * i, true));
    for (let k = 0; k < nDifat; k++) {
      const s = sec(difat), v = new DataView(s.buffer, s.byteOffset, s.byteLength);
      for (let i = 0; i < ss / 4 - 1; i++) fatSecs.push(v.getUint32(i * 4, true));
      difat = v.getUint32(ss - 4, true);
    }
    fatSecs = fatSecs.slice(0, nfat);
    const fat = new Uint32Array(fatSecs.length * ss / 4);
    fatSecs.forEach((fs, i) => { const s = sec(fs); fat.set(new Uint32Array(s.slice().buffer), i * ss / 4); });
    const chain = start => {
      const parts = []; let s = start, guard = 0;
      while (s < 0xFFFFFFF0 && guard++ <= fat.length) { parts.push(sec(s)); s = fat[s]; }
      return concat(parts);
    };
    const dir = chain(dirStart), dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    const ents = [];
    for (let i = 0; i < dir.length / 128; i++) {
      const o = i * 128, nl = dv.getUint16(o + 64, true);
      let name = ''; for (let k = 0; k < Math.max(nl - 2, 0); k += 2) name += String.fromCharCode(dv.getUint16(o + k, true));
      ents.push({ name, type: dir[o + 66], left: dv.getInt32(o + 68, true), right: dv.getInt32(o + 72, true), child: dv.getInt32(o + 76, true),
        start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) });
    }
    const root = ents[0];
    const ministream = root.start < 0xFFFFFFF0 ? chain(root.start).subarray(0, root.size) : new Uint8Array(0);
    let minifat = new Uint32Array(0);
    if (nMiniFat) { const mf = chain(miniFatStart); minifat = new Uint32Array(mf.slice().buffer); }
    const paths = {};
    const walk = (i, prefix) => {
      if (i < 0 || i >= ents.length) return; const e = ents[i];
      walk(e.left, prefix); walk(e.right, prefix);
      const p = prefix + '/' + e.name; paths[p] = e;
      if (e.type === 1) walk(e.child, p);
    };
    walk(root.child, '');
    this.paths = paths;
    this.read = p => {
      const e = paths[p];
      if (e.size < cutoff) {
        const parts = []; let s = e.start;
        while (s < 0xFFFFFFF0) { parts.push(ministream.subarray(s * mss, (s + 1) * mss)); s = minifat[s]; }
        return concat(parts).subarray(0, e.size);
      }
      return chain(e.start).subarray(0, e.size);
    };
  }
  function concat(parts) {
    let n = 0; parts.forEach(p => n += p.length);
    const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
  }

  // ------------------------------------------------------------------ helpers
  const dvOf = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
  function records(d) {
    const out = [], v = dvOf(d); let o = 0;
    while (o + 12 <= d.length) {
      const sz = v.getUint32(o + 8, true) * 2 + 4; if (sz <= 4) break;
      out.push(d.subarray(o, o + sz)); o += sz;
    }
    return out;
  }
  function stringLinkages(e) {
    // <xx 10 d2 56> <01 00 00 00> <len u32> [ff fe 01 00] <ascii>
    const res = [], v = dvOf(e);
    for (let i = 0; i + 12 < e.length; i++) {
      if (e[i + 1] === 0x10 && e[i + 2] === 0xd2 && e[i + 3] === 0x56 && e[i + 4] === 1 && e[i + 5] === 0 && e[i + 6] === 0 && e[i + 7] === 0) {
        let p = i + 8; const n = v.getUint32(p, true); p += 4;
        if (!(n > 0 && n < 512)) continue;
        let s = e.subarray(p, p + n);
        if (s[0] === 0xff && s[1] === 0xfe && s[2] === 1 && s[3] === 0) s = s.subarray(4);
        let t = ''; for (const c of s) { if (c === 0) break; if (c < 32 || c > 126) { t = null; break; } t += String.fromCharCode(c); }
        if (t) res.push(t);
      }
    }
    return res;
  }
  function utf16Strings(d) {
    const out = []; let cur = '';
    for (let i = 0; i + 1 < d.length; i += 1) {
      const c = d[i], z = d[i + 1];
      if (z === 0 && ((c >= 0x20 && c <= 0x7e) || c === 0xb0)) { cur += String.fromCharCode(c); i += 1; }
      else { if (cur.trim().length >= 2) out.push(cur.trim()); cur = ''; }
    }
    if (cur.trim().length >= 2) out.push(cur.trim());
    return out;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const plen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };
  S.util = { dist, plen };

  // ------------------------------------------------------------------ DGN
  S.readDGN = async function (buf, inflate) {
    const cfb = new CFB(buf);
    const dec = async raw => { try { return await inflate(raw.subarray(16)); } catch (e) { return null; } };
    // levels
    const levels = {};
    for (const p of Object.keys(cfb.paths)) {
      if (!/^\/Dgn\^Nm\/\$\d+$/.test(p)) continue;
      const d = await dec(cfb.read(p)); if (!d) continue;
      for (const e of records(d)) {
        if (e[4] !== 95 || e.length < 60) continue;
        const v = dvOf(e); if (v.getUint32(16, true) !== 1) continue;
        const id = v.getUint32(36, true), nm = stringLinkages(e);
        if (nm.length && !(id in levels)) levels[id] = nm[0];
      }
    }
    // models
    const models = {};
    for (const p of Object.keys(cfb.paths)) {
      const m = /^\/Dgn-Md\/(#\w+)\/Dgn\^G(A?)\/\$\d+$/.exec(p); if (!m) continue;
      const md = models[m[1]] = models[m[1]] || { graphic: [], tables: [] };
      const d = await dec(cfb.read(p)); if (!d) continue;
      if (m[2]) md.tables.push(utf16Strings(d)); else md.graphic.push(...records(d));
    }
    // UOR detection from line elements
    const xs = [];
    for (const md of Object.values(models)) for (const e of md.graphic) if (e[4] === 3 && e.length >= 140) { const x = Math.abs(dvOf(e).getFloat64(108, true)); if (x > 1e4) xs.push(x); }
    let uor = 1000;
    for (const s of [1000, 10000, 100, 1, 1e5]) { if (xs.length && xs.filter(x => x / s >= 1e5 && x / s <= 1e6).length > xs.length * 0.3) { uor = s; break; } }
    const scanXY = (e, start) => {
      const v = dvOf(e);
      for (let k = start; k + 16 <= e.length; k += 4) {
        const x = v.getFloat64(k, true), y = v.getFloat64(k + 8, true);
        if (x >= 1e5 * uor && x <= 1e6 * uor && y >= 5.5e6 * uor && y <= 8.5e6 * uor) return [x / uor, y / uor];
      }
      return null;
    };
    const decode = e => {
      const v = dvOf(e), t = e[4], lid = v.getUint32(16, true);
      const el = { t, levelId: lid, level: levels[lid] || ('L' + lid), complex: !!(e[7] & 0x40), color: e[56], weight: e[52] };
      try {
        if (t === 3) { el.points = [[v.getFloat64(108, true) / uor, v.getFloat64(116, true) / uor], [v.getFloat64(124, true) / uor, v.getFloat64(132, true) / uor]]; }
        else if (t === 4 || t === 6) {
          const n = v.getUint32(108, true);
          if (n > 0 && n < 5000) { el.points = []; for (let i = 0; i < n; i++) el.points.push([v.getFloat64(116 + 16 * i, true) / uor, v.getFloat64(124 + 16 * i, true) / uor]); }
        } else if (t === 12 || t === 14) el.components = v.getUint32(108, true);
        else if (t === 16) {
          const sweep = v.getFloat64(116, true), r = v.getFloat64(124, true), st = v.getFloat64(140, true);
          const cx = v.getFloat64(148, true), cy = v.getFloat64(156, true);
          el.points = [st, st + sweep].map(a => [(cx + r * Math.cos(a)) / uor, (cy + r * Math.sin(a)) / uor]);
          el.length = Math.abs(sweep) * r / uor; el.origin = [cx / uor, cy / uor];
        } else if (t === 15) el.origin = scanXY(e, 100);
        else if (t === 2 || t === 35) {
          el.origin = scanXY(e, 100); const nm = stringLinkages(e); el.name = nm[0] || '';
          if (t === 2) el.components = v.getUint32(108, true);
        } else if (t === 17) {
          const n = v.getUint16(114, true);
          el.origin = [v.getFloat64(156, true) / uor, v.getFloat64(164, true) / uor];
          let s = ''; for (let i = 174; i < 174 + n && i < e.length; i++) s += String.fromCharCode(e[i]);
          el.text = s.replace(/\0/g, '').trim();
        }
      } catch (err) { /* truncated element */ }
      if (el.points && el.length == null) el.length = plen(el.points);
      return el;
    };
    const modelEls = recs => {
      const out = []; let stack = [];
      for (const e of recs) {
        const el = decode(e);
        const opens = (el.t === 2 || el.t === 12 || el.t === 14 || el.t === 7) && el.components > 0;
        if (el.complex && stack.length) {
          const hdr = stack[stack.length - 1]; hdr.children.push(el); hdr._left--;
          if (opens) { el.children = []; el._left = el.components; stack.push(el); }
          while (stack.length && stack[stack.length - 1]._left <= 0) stack.pop();
          continue;
        }
        stack = [];
        if (opens) { el.children = []; el._left = el.components; stack.push(el); }
        out.push(el);
      }
      const finish = el => {
        delete el._left; const k = el.children; if (!k) return;
        k.forEach(finish);
        const desc = []; const walk = x => { (x.children || []).forEach(c => { desc.push(c); walk(c); }); }; walk(el);
        if (el.t === 2 && el.levelId === 0) { const c = desc.find(c => c.levelId !== 0); if (c) el.level = c.level; }
        if (el.t === 2) { el.color = Math.max(...desc.map(c => c.color || 0), el.color || 0); el.weight = Math.max(...desc.map(c => c.weight || 0), 0); el.childColors = desc.map(c => c.color); }
        if (el.t === 12 || el.t === 14) {
          el.length = k.reduce((a, c) => a + (c.length || 0), 0);
          el.points = []; k.forEach(c => (c.points || []).forEach(p => el.points.push(p)));
        }
        if (el.t === 7) el.text = k.map(c => c.text || '').join('\n');
        if (el.t === 2) el.texts = desc.filter(c => c.t === 17).map(c => c.text);
      };
      out.forEach(finish);
      return out;
    };
    // pick design (most MGA-located cells/lines) and sheet models
    const score = {};
    for (const [id, md] of Object.entries(models)) score[id] = md.graphic.filter(e => (e[4] === 2 || e[4] === 35 || e[4] === 3) && scanXY(e, 100)).length;
    const ids = Object.keys(models).sort((a, b) => score[b] - score[a]);
    const designId = ids[0];
    const sheetId = ids.slice(1).sort((a, b) => models[b].graphic.length - models[a].graphic.length)[0];
    const norm = (els, model) => els.map(el => toNorm(el, model)).filter(Boolean);
    return {
      format: 'DGN V8', uor, levels,
      elements: norm(modelEls(models[designId].graphic), 'design').concat(sheetId ? norm(modelEls(models[sheetId].graphic), 'sheet') : []),
      tables: (sheetId ? models[sheetId].tables : []).concat(models[designId].tables),
    };
  };

  function toNorm(el, model) {
    const base = { level: el.level, color: el.color, weight: el.weight, model };
    if (el.t === 2 || el.t === 35) return Object.assign(base, { kind: 'cell', name: el.name || '', origin: el.origin, texts: el.texts || [], childColors: el.childColors || [] });
    if ([3, 4, 6, 12, 14, 16].includes(el.t) && el.points && el.points.length) return Object.assign(base, { kind: 'line', points: el.points, length: el.length || 0, closed: el.t === 6 || el.t === 14 });
    if (el.t === 17 || el.t === 7) return Object.assign(base, { kind: 'text', text: el.text || '', origin: el.origin || (el.children && el.children[0] && el.children[0].origin) });
    if (el.t === 36) return Object.assign(base, { kind: 'duct' });
    return null;
  }

  // ------------------------------------------------------------------ DXF
  S.readDXF = function (text) {
    const L = text.split(/\r?\n/);
    const pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i], 10), L[i + 1].trim()]);
    let sec = null, cur = null, block = null; const ents = [], blocks = {};
    for (let i = 0; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0 && v === 'SECTION') { sec = pairs[i + 1][1]; i++; cur = null; continue; }
      if (c === 0 && v === 'ENDSEC') { sec = null; cur = null; continue; }
      if (!sec) continue;
      if (c === 0) {
        cur = { type: v, g: [] };
        if (sec === 'BLOCKS') { if (v === 'BLOCK') { block = cur; cur.ents = []; } else if (v === 'ENDBLK') { if (block) blocks[gf(block, 2)] = block; block = null; } else if (block) block.ents.push(cur); }
        else if (sec === 'ENTITIES') ents.push(cur);
        continue;
      }
      if (cur) cur.g.push([c, v]);
    }
    function gf(e, code) { const p = e.g.find(x => x[0] === code); return p ? p[1] : undefined; }
    function ga(e, code) { return e.g.filter(x => x[0] === code).map(x => x[1]); }
    const num = (e, c) => parseFloat(gf(e, c) || '0');
    const out = [];
    const mtext = e => (ga(e, 3).join('') + (gf(e, 1) || '')).replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
    for (const e of ents) {
      const level = gf(e, 8) || '0', color = parseInt(gf(e, 62) || '256', 10);
      const base = { level: level.replace(/_\d+$/, ''), color, weight: parseInt(gf(e, 370) || '-1', 10), model: 'design' };
      if (e.type === 'INSERT') {
        const name = gf(e, 2) || ''; const b = blocks[name];
        const kidsColors = b ? b.ents.map(k => parseInt(gf(k, 62) || '256', 10)) : [];
        out.push(Object.assign(base, { kind: 'cell', name: name.replace(/_\d+$/, ''), origin: [num(e, 10), num(e, 20)], childColors: kidsColors,
          texts: b ? b.ents.filter(k => k.type === 'TEXT' || k.type === 'MTEXT').map(k => k.type === 'MTEXT' ? mtext(k) : gf(k, 1)) : [] }));
      } else if (e.type === 'LINE') {
        const pts = [[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]];
        out.push(Object.assign(base, { kind: 'line', points: pts, length: plen(pts) }));
      } else if (e.type === 'LWPOLYLINE') {
        const xs = ga(e, 10).map(parseFloat), ys = ga(e, 20).map(parseFloat), bul = [];
        // bulges (code 42) follow their vertex
        let vi = -1; e.g.forEach(([c, v]) => { if (c === 10) vi++; if (c === 42) bul[vi] = parseFloat(v); });
        const pts = xs.map((x, i) => [x, ys[i]]);
        let L = 0;
        for (let i = 1; i < pts.length; i++) {
          const ch = dist(pts[i - 1], pts[i]), b = bul[i - 1] || 0;
          if (!b) L += ch; else { const th = 4 * Math.atan(Math.abs(b)); L += ch / 2 / Math.sin(th / 2) * th; }
        }
        out.push(Object.assign(base, { kind: 'line', points: pts, length: L }));
      } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
        out.push(Object.assign(base, { kind: 'text', text: e.type === 'MTEXT' ? mtext(e) : gf(e, 1) || '', origin: [num(e, 10), num(e, 20)] }));
      } else if (e.type === 'MLINE') out.push(Object.assign(base, { kind: 'duct' }));
    }
    return { format: 'DXF', uor: 1, levels: {}, elements: out, tables: [] };
  };
})(typeof window !== 'undefined' ? window : globalThis);

