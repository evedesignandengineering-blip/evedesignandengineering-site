/* Poles & Wires: pole tipload, following the method the PNW 7 manual describes (§3.4.4–3.4.7, §6, §26).
   Wind is applied from every direction in steps; for each direction the conductor tensions are found by change of state
   from the stringing tension, the loads of each conductor, the pole, plant and stays are added as vectors (moments about
   the point of contra-flexure), and the worst direction is reported. Tipload = moment / (tip height − load point below tip).
   Load combinations and options are inputs: nothing here is a utility value. Ice loading is not modelled. */
(function (root) {
  'use strict';
  var G = 9.80665, RAD = Math.PI / 180;
  var DEFAULT_OPTIONS = { step: 5, loadBelowTip: 0.3, poleWindAt: 'half', condWindage: 'cos2', tensionWindage: 'cos2', poleTop: 1, stdTemp: 15 };

  function vec(bearing, mag) { return [Math.sin(bearing * RAD) * mag, Math.cos(bearing * RAD) * mag]; }
  function bearingOf(v) { var b = Math.atan2(v[0], v[1]) / RAD; return ((b % 360) + 360) % 360; }
  function len(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1]); }
  function num(v, d) { var n = v == null || v === '' ? NaN : Number(v); return isFinite(n) ? n : d; }

  // Change of state for a level span at the ruling span (AS/NZS 7000 Appendix S): horizontal tension T2 (N) at load w2 (N/m)
  // and temperature t2, from T1 at w1 and t1. EA in N, alpha per °C.
  function changeOfState(T1, w1, t1, w2, t2, L, EA, alpha) {
    if (!(T1 > 0) || !(L > 0) || !(EA > 0)) return T1;
    var a = EA * w1 * w1 * L * L / (24 * T1 * T1) - T1 + EA * alpha * (t2 - t1), b = EA * w2 * w2 * L * L / 24;
    var T = Math.max(T1, 1);
    for (var i = 0; i < 100; i++) {
      var f = T * T * T + a * T * T - b, df = 3 * T * T + 2 * a * T;
      var n = T - f / df;
      if (!(n > 0)) n = T / 2;
      if (Math.abs(n - T) < 1e-6) { T = n; break; }
      T = n;
    }
    return T;
  }

  // Pole diameter (m) at height h above ground, linear between groundline and tip diameters (falls back to the average).
  function diamAt(pole, h) {
    var gl = num(pole.diamGL, NaN), tip = num(pole.diamTip, NaN), av = num(pole.diamAvg, 0);
    if (isFinite(gl) && isFinite(tip) && pole.height > 0) return (gl + (tip - gl) * Math.min(1, Math.max(0, h / pole.height))) / 1000;
    return av / 1000;
  }
  // Height of the wind-on-pole resultant: half way up, or the centroid of the tapered exposed area (manual §3.4.4).
  function poleWindHeight(pole, how) {
    var H = pole.height, gl = num(pole.diamGL, NaN), tip = num(pole.diamTip, NaN);
    if (how === 'centroid' && isFinite(gl) && isFinite(tip) && gl + tip > 0) return H * (gl + 2 * tip) / (3 * (gl + tip));
    return H / 2;
  }

  function wireTension(c, P, toward, temp, o) {
    var m = c.cond, w1 = m.mass * G, d = m.diam / 1000, EA = m.E * 1e9 * m.csa * 1e-6;
    var ang = (toward - c.dir) * RAD, k = Math.pow(Math.sin(ang), 2);
    var q = P > 0 ? P * d * (o.tensionWindage === 'independent' ? 1 : k) : 0;
    var w2 = Math.sqrt(w1 * w1 + q * q);
    return changeOfState(c.tension * 1000, w1, o.stdTemp, w2, temp, c.mes || c.span, EA, m.alpha) / 1000;
  }

  // One wind direction for one load case. Returns the moment vector (kN·m, about the contra-flexure point), vertical load,
  // per-circuit tensions and kingbolt loads (factored, kN).
  function atDirection(input, lc, from, o) {
    var pole = input.pole, flex = num(pole.flex, 0), wind = from != null, toward = wind ? (from + 180) % 360 : 0;
    var M = [0, 0], V = 0, parts = { conductors: [0, 0], wind: [0, 0], plant: [0, 0], fixed: [0, 0] }, kb = {}, cct = [];
    input.circuits.forEach(function (c, i) {
      if (c.include === false) return;
      var m = c.cond, d = m.diam / 1000, n = c.n || 1;
      var T = wireTension(c, wind ? lc.windCond : 0, toward, lc.temp, o);
      var F = vec(c.dir, lc.Ft * T * n);
      if (wind && lc.windCond > 0) {
        var ang = (toward - c.dir) * RAD, s = Math.sin(ang), k = o.condWindage === 'independent' ? 1 : s * s;
        var fw = lc.Wn * lc.windCond * d * (c.span / 2) * k * (c.srf == null ? 1 : c.srf) * n / 1000;
        var nb = c.dir + (s >= 0 ? 90 : -90); // normal to the conductor on the side the wind blows towards
        if (Math.abs(s) > 1e-9) { var Fw = vec(nb, fw); F = [F[0] + Fw[0], F[1] + Fw[1]]; }
      }
      var arm = c.attHt - flex;
      M[0] += F[0] * arm; M[1] += F[1] * arm; parts.conductors[0] += F[0] * arm; parts.conductors[1] += F[1] * arm;
      var key = (Math.round(c.attHt * 100) / 100).toFixed(2), k0 = kb[key] || (kb[key] = [0, 0]);
      k0[0] += F[0]; k0[1] += F[1];
      // vertical: conductor weight over half the span less the uplift from a higher adjacent attachment (both Gc)
      V += lc.Gc * n * (m.mass * G * c.span / 2 / 1000 - T * (c.vdiff || 0) / c.span);
      cct.push({ i: i, tension: T });
    });
    if (wind && lc.windPole > 0 && pole.height > 0) {
      var fp = lc.Wn * lc.windPole * (num(pole.diamAvg, 0) / 1000) * pole.height * (o.poleTop || 1) / 1000;
      var Mp = vec(toward, fp * (poleWindHeight(pole, o.poleWindAt) - flex));
      M[0] += Mp[0]; M[1] += Mp[1]; parts.wind[0] += Mp[0]; parts.wind[1] += Mp[1];
    }
    V += lc.Gs * num(pole.weight, 0) * G / 1000;
    (input.plant || []).forEach(function (p) {
      if (p.include === false) return;
      var W = num(p.weight, 0) * G / 1000, e = num(p.offset, 0) + diamAt(pole, p.attHt) / 2;
      var Md = vec(p.dir, lc.Gs * W * e);
      M[0] += Md[0]; M[1] += Md[1]; parts.plant[0] += Md[0]; parts.plant[1] += Md[1];
      V += lc.Gs * W;
      if (wind && lc.windPlant > 0 && num(p.area, 0) > 0) {
        var Mw = vec(toward, lc.Wn * lc.windPlant * p.area / 1000 * (p.attHt - flex));
        M[0] += Mw[0]; M[1] += Mw[1]; parts.plant[0] += Mw[0]; parts.plant[1] += Mw[1];
      }
      if (num(p.fixedLoad, 0) > 0) { // unfactored, applied to every load case (manual §6.1.7)
        var Mf = vec(num(p.fixedDir, p.dir), p.fixedLoad * (num(p.fixedHt, p.attHt) - flex));
        M[0] += Mf[0]; M[1] += Mf[1]; parts.fixed[0] += Mf[0]; parts.fixed[1] += Mf[1];
      }
    });
    return { M: M, V: V, kb: kb, cct: cct, parts: parts };
  }

  // Stays: the pole is a column hinged at the contra-flexure point; each stay can only pull towards its anchor (§26.3).
  // Returns the stay horizontal forces (kN) that leave the smallest residual moment.
  function solveStays(M, stays, flex) {
    var st = stays.filter(function (s) { return s.include !== false && s.attHt > flex; });
    if (!st.length) return { residual: M, H: [] };
    var u = st.map(function (s) { var v = vec(s.dir, 1); return [v[0] * (s.attHt - flex), v[1] * (s.attHt - flex)]; });
    var best = { residual: M, H: st.map(function () { return 0; }), used: [] };
    function consider(H, used) {
      if (H.some(function (h) { return h < -1e-9; })) return;
      var r = [M[0], M[1]]; H.forEach(function (h, i) { r[0] += h * u[i][0]; r[1] += h * u[i][1]; });
      if (len(r) < len(best.residual) - 1e-9) best = { residual: r, H: H, used: used };
    }
    st.forEach(function (s, i) { // one stay working
      var uu = u[i], h = -(M[0] * uu[0] + M[1] * uu[1]) / (uu[0] * uu[0] + uu[1] * uu[1]);
      var H = st.map(function () { return 0; }); H[i] = Math.max(0, h); consider(H, [i]);
    });
    if (st.length >= 2) { // both stays working: solve the 2x2 system exactly
      var a = u[0], b = u[1], det = a[0] * b[1] - a[1] * b[0];
      if (Math.abs(det) > 1e-9) consider([(-M[0] * b[1] + M[1] * b[0]) / det, (-a[0] * M[1] + a[1] * M[0]) / det], [0, 1]);
    }
    best.stays = st;
    return best;
  }

  function calcCase(input, lc, o) {
    var pole = input.pole, flex = num(pole.flex, 0), lever = pole.height - o.loadBelowTip - flex;
    var wind = lc.windPole > 0 || lc.windCond > 0 || lc.windPlant > 0;
    var dirs = []; if (wind) for (var a = 0; a < 360 - 1e-9; a += o.step) dirs.push(Math.round(a * 1000) / 1000); else dirs.push(null);
    var worst = null, curve = [];
    dirs.forEach(function (from) {
      var r = atDirection(input, lc, from, o), sv = solveStays(r.M, input.stays || [], flex);
      var load = len(sv.residual) / lever, unstayed = len(r.M) / lever;
      var stayLoads = sv.H.map(function (h, i) { var s = sv.stays[i]; return h / Math.cos(num(s.angle, 45) * RAD); });
      var V = r.V + sv.H.reduce(function (t, h, i) { return t + h * Math.tan(num(sv.stays[i].angle, 45) * RAD); }, 0);
      var res = { from: from, stays: sv.stays || [], load: load, dir: bearingOf(sv.residual), moment: len(sv.residual), unstayed: unstayed, vertical: V, stayLoads: stayLoads, raw: r };
      curve.push({ from: from, load: load, unstayed: unstayed });
      if (!worst || load > worst.load + 1e-9) worst = res;
    });
    var cap = lc.strengthClass === 'none' ? null : num(pole.strength, NaN), capV = num(pole.strengthVert, NaN), phi = num(lc.phi, 1);
    var out = {
      name: lc.name, wind: wind, load: worst.load, dir: worst.dir, windFrom: worst.from, moment: worst.moment, lever: lever,
      vertical: worst.vertical, unstayed: Math.max.apply(null, curve.map(function (c) { return c.unstayed; })), stayLoads: worst.stayLoads,
      capacity: isFinite(cap) ? cap * phi : null, capacityVert: isFinite(capV) ? capV * phi : null, curve: curve,
      kingbolt: Object.keys(worst.raw.kb).map(function (h) { var v = worst.raw.kb[h]; return { attHt: Number(h), load: len(v), dir: len(v) > 1e-9 ? bearingOf(v) : 0 }; }).sort(function (a, b) { return b.attHt - a.attHt; }),
      tensions: worst.raw.cct, parts: worst.raw.parts
    };
    out.pctHor = out.capacity ? out.load / out.capacity * 100 : null;
    out.pctVert = out.capacityVert ? out.vertical / out.capacityVert * 100 : null;
    out.bc = out.capacity && out.capacityVert ? out.load / out.capacity + out.vertical / out.capacityVert : null;
    out.pass = out.bc != null ? out.bc <= 1 : out.pctHor != null ? out.pctHor <= 100 : null;
    out.stays = (worst.stays || []).map(function (s, i) { return { dir: s.dir, attHt: s.attHt, wire: s.wire, load: worst.stayLoads[i], pct: s.strength > 0 ? worst.stayLoads[i] / s.strength * 100 : null }; });
    return out;
  }

  function calc(input, cases, options) {
    var o = Object.assign({}, DEFAULT_OPTIONS, options || {});
    if (!(o.step > 0)) o.step = 1;
    var issues = [];
    if (!(input.pole && input.pole.height > 0)) return { results: [], issues: ['No pole height above ground.'] };
    if (!(num(input.pole.diamAvg, 0) > 0)) issues.push('No average pole diameter, so there is no wind on the pole.');
    input.circuits.forEach(function (c) {
      if (!(c.cond && c.cond.mass > 0 && c.cond.diam > 0 && c.cond.E > 0 && c.cond.csa > 0)) issues.push('Conductor ' + (c.code || '?') + ' is missing mass, diameter, modulus or area.');
      if (!(c.tension > 0)) issues.push('Circuit at ' + c.attHt + ' m towards ' + c.dir + '° has no stringing tension.');
    });
    cases.forEach(function (lc) { if (lc.ice && lc.ice !== 'None') issues.push(lc.name + ': ice loading "' + lc.ice + '" is not modelled; calculated without ice.'); });
    var results = cases.filter(function (lc) { return lc.include !== false; }).map(function (lc) { return calcCase(input, lc, o); });
    return { results: results, issues: issues, options: o };
  }

  // Load combinations as printed in the "Options" block of a PNW tipload report (copy the PDF text and paste it).
  // The report is laid out in two columns, so the text is split into cells; each "Ice loading" cell starts the next
  // load combination and its name comes from the matching "Loading n / Name" pair, wherever that landed in the text.
  var LC_FIELDS = [['ice', /^Ice loading\s+(.+)$/], ['temp', /^Temperature\s+(-?[\d.]+)$/], ['windPole', /^Wind on Pole\s+([\d.]+)$/],
    ['windCond', /^Wind on Conductors\s+([\d.]+)$/], ['windPlant', /^Wind on Plant\s+([\d.]+)$/], ['Ft', /^Ft factor\s+([\d.]+)$/], ['Wn', /^Wn factor\s+([\d.]+)$/],
    ['Gs', /^Gs factor\s+([\d.]+)$/], ['Gc', /^Gc factor\s+([\d.]+)$/], ['strengthClass', /^Pole strength class\s+(.+)$/], ['phi', /^Pole Strength reduction factor\s+([\d.]+)$/]];
  function parseReportOptions(text) {
    var cells = [];
    String(text || '').replace(/\r/g, '').replace(/\u209c/g, 't').replace(/\u2099/g, 'n').replace(/\u209b/g, 's').split('\n').forEach(function (l) {
      l.split(/\s{3,}|\t/).forEach(function (c) { c = c.trim().replace(/\s+/g, ' '); if (c) cells.push(c); });
    });
    var LABEL = /^(Name|Ice loading|Temperature|Wind on Pole|Wind on Conductors|Wind on Plant|Ft factor|Wn factor|Gs factor|Gc factor|Pole strength class|Pole Strength reduction factor)$/;
    cells = cells.reduce(function (out, c, i, all) { // "label" and "value" in separate cells: join them
      if (out.skip) { out.skip = false; return out; }
      if (LABEL.test(c) && all[i + 1] != null && !LABEL.test(all[i + 1]) && !/^Loading \d+$/.test(all[i + 1])) { out.push(c + ' ' + all[i + 1]); out.skip = true; } else out.push(c);
      return out;
    }, []);
    var names = {}, blocks = [], cur = null, loading = null;
    cells.forEach(function (c) {
      var m = /^Loading (\d+)$/.exec(c);
      if (m) { loading = Number(m[1]); return; }
      m = /^Name (.+)$/.exec(c);
      if (m && loading != null) { names[loading] = m[1]; loading = null; return; }
      if (/^Ice loading /.test(c)) { cur = {}; blocks.push(cur); }
      if (!cur) return;
      LC_FIELDS.forEach(function (f) { var x = f[1].exec(c); if (x && cur[f[0]] == null) cur[f[0]] = f[0] === 'ice' || f[0] === 'strengthClass' ? x[1].trim() : Number(x[1]); });
    });
    return blocks.filter(function (b) { return b.Ft != null; }).map(function (lc, i) {
      return { name: names[i + 1] || 'Loading ' + (i + 1), ice: lc.ice || 'None', temp: num(lc.temp, 15), windPole: num(lc.windPole, 0), windCond: num(lc.windCond, 0), windPlant: num(lc.windPlant, 0),
        Ft: num(lc.Ft, 1), Wn: num(lc.Wn, 1), Gs: num(lc.Gs, 1), Gc: num(lc.Gc, 1), strengthClass: lc.strengthClass || 'Ultimate limit', phi: num(lc.phi, 1), include: true };
    });
  }

  // Input from a PNW tipload project (.pnwx with a <tipload_project> root, read by PNWModel.readPnwx).
  // conductor(code) -> {mass, diam, E, csa, alpha, cbl}; plant(code) -> {weight, offset, area} or null.
  function fromTipProject(t, conductor, plant, stayStrength) {
    var a = t.attrs || {}, pt = t.poletype || {}, notes = [];
    var pole = { id: a.title || '', height: num(a.ht, null), length: num(a.length, null), type: a.poletype || null, diamAvg: num(a.diam, num(pt.diamAvLong, null)),
      diamTip: num(pt.diamTipLong, null), diamGL: num(a.gnddiam, num(pt.diamGLLong, null)), weight: num(pt.weightTotal, null),
      strength: num(pt.limitultimate, null), strengthVert: num(pt.limitdownult, null), flex: num(a.flex, 0) };
    var circuits = (t.circuits || []).map(function (c) {
      var cond = conductor(c.Conductor), v = num(c.tensvalue, NaN), kN = null;
      if (c.tenstype === '%CBL') kN = cond && cond.cbl > 0 ? v / 100 * cond.cbl : null;
      else if (c.tenstype === 'Tension' || c.tenstype === 'kN') kN = v;
      else notes.push('Circuit ' + c.Circuit_ID + ': tension type "' + c.tenstype + '" is not supported.');
      return { include: c.Include !== 'False', code: c.Conductor, cond: cond, n: num(c.Num_Conductors, 1), dir: num(c.Angle, 0), attHt: num(c.Attach_Ht, 0), span: num(c.Span_Length, 0),
        mes: num(c.MES, num(c.Span_Length, 0)), vdiff: num(c.vertical, 0), tension: kN, srf: 1, segment: c.strsect || '', tensionText: c.tensvalue + ' ' + c.tenstype };
    });
    var stays = [1, 2].filter(function (n) { return a['stay' + n + '_wire'] && num(a['stay' + n + '_att_ht'], 0) > 0; }).map(function (n) {
      return { wire: a['stay' + n + '_wire'], attHt: num(a['stay' + n + '_att_ht'], 0), dir: num(a['stay' + n + '_dir'], 0), angle: num(a['stay' + n + '_angle'], 45), include: a['stay' + n + '_checked'] === 'True', strength: stayStrength ? stayStrength(a['stay' + n + '_wire']) : null };
    });
    var pl = [['plant1', 'plant_attht', 'plant_dir', 'plant_checked'], ['plant2', 'plant_attht2', 'plant_dir2', 'plant_checked2']].filter(function (k) { return a[k[0]] && a[k[0]].trim(); }).map(function (k, i) {
      var code = a[k[0]].trim(), db = plant ? plant(code) : null, inc = a[k[3]] === 'True';
      if (inc && !db) { notes.push('Plant ' + code + ' has no weight, offset or wind area here, so it is left out.'); inc = false; }
      return { code: code, attHt: num(a[k[1]], 0), dir: num(a[k[2]], 0), weight: db ? db.weight : null, offset: db ? db.offset : null, area: db ? db.area : null, include: inc,
        fixedLoad: i === 0 ? num(a.plant_fixedload, 0) : 0 };
    });
    return { pole: pole, circuits: circuits, stays: stays, plant: pl, notes: notes };
  }

  var api = { calc: calc, fromTipProject: fromTipProject, changeOfState: changeOfState, parseReportOptions: parseReportOptions, DEFAULT_OPTIONS: DEFAULT_OPTIONS, bearingOf: bearingOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PNWTip = api;
})(this);
