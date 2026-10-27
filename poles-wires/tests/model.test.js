// .pnwx round trip, construction register and attachment geometry, against Ishan's saved PNW projects.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../pnw-model.js');

const DIR = process.env.PNW_FIXTURES || '/mnt/project-files';
const FILES = ['Ground Profile - MP219050.pnwx', 'Ground Profile - MP219050- S119850 to new pole.pnwx', 'GROUND LINE.pnwx', 'S1242155.pnwx'];
const have = FILES.every((f) => fs.existsSync(path.join(DIR, f)));
const opts = { skip: have ? false : 'reference files not found in ' + DIR + ' (set PNW_FIXTURES)' };
const read = (f) => fs.readFileSync(path.join(DIR, f), 'latin1');

test('every saved PNW file round-trips byte for byte', opts, () => {
  for (const f of FILES) assert.equal(M.writePnwx(M.readPnwx(read(f))), read(f), f);
});

test('reads poles, segments, conductors and constructions from the MP219050 project', opts, () => {
  const p = M.readPnwx(read(FILES[0]));
  assert.equal(p.kind, 'profile');
  assert.deepEqual(p.poles.map((x) => x.ID), ['S119846', 'S119850', 'S120776', 'S120378']);
  assert.deepEqual(p.segments.map((s) => [s.StrainSect, s.Conductor, s.numconds, s.Tension, s.TensionUnits]), [['SS1', 'LI', '3', '7', '%CBL'], ['SS2', '7/14CU', '4', '7', '%CBL']]);
  assert.deepEqual(p.constructions.map((c) => c.descr), ['HV5 (0)', 'LV5 (1)', 'HV1 (3)', 'LV1 (4)', 'HV9 (6)', 'LV1 (7)', 'HV1 (8)', 'LV3 (9)']);
  const hv1 = M.constructionFrom(p.constructions[2], 'x');
  assert.equal(hv1.kingbolt, 9.07);
  assert.deepEqual(hv1.attachments, [{ x: -0.9, y: 0.512, order: 1 }, { x: 0, y: 0.912, order: 2 }, { x: 0.9, y: 0.512, order: 3 }]);
  // Table6 (segment attachments) agrees with Table8 (constructions on poles)
  for (const s of p.segPoles) {
    const c = p.constructions.find((x) => x.descr === s.constr && x.pole === s.id);
    assert.ok(c, s.id + ' ' + s.constr);
    assert.equal(c.attht, s.attht);
  }
  // embedded tipload inside the "new pole" project is read too
  const q = M.readPnwx(read(FILES[1]));
  assert.equal(q.tiploads.S1242155.kind, 'tipload');
  assert.equal(q.tiploads.S1242155.attrs.poletype, 'PO9 - 12.5m/8kN');
});

test('a controlled change alters only the edited values and survives a re-read', opts, () => {
  const src = read(FILES[0]);
  const p = M.readPnwx(src);
  M.setField(p.constructions.find((x) => x.descr === 'HV1 (3)'), 'attht', 9.1);
  M.setField(p.poles[3], 'Length', 11);
  M.setField(p.poles[0], 'remarks', 'checked');
  const out = M.writePnwx(p);
  const a = src.split('\r\n'), b = out.split('\r\n').filter((l) => l !== '      <remarks>checked</remarks>');
  const gone = a.filter((l, i) => !b.includes(l) || false);
  // only the edited lines differ (the empty <remarks> pair collapses to one line)
  const diff = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '      <remarks>' && a[i + 1] === '      </remarks>' && i === a.indexOf('      <remarks>')) { i++; continue; }
    if (a[i] !== b[j]) diff.push([a[i], b[j]]);
    j++;
  }
  assert.deepEqual(diff, [['      <Length>9.5</Length>', '      <Length>11</Length>'], ['      <attht>9.07</attht>', '      <attht>9.1</attht>']]);
  assert.ok(gone.length >= 0);
  const again = M.readPnwx(out);
  assert.equal(again.constructions.find((x) => x.descr === 'HV1 (3)').attht, '9.1');
  assert.equal(again.poles[0].remarks, 'checked');
  assert.equal(again.poles[3].Length, '11');
});

test('construction register lists each code with its source and review status', opts, () => {
  const reg = M.buildRegister(FILES.slice(0, 3).map((f) => ({ file: f, project: M.readPnwx(read(f)) })));
  const codes = [...new Set(reg.map((r) => r.code))].sort();
  // GROUND LINE.pnwx holds blank construction rows (no code); they are kept, not dropped
  assert.deepEqual(codes, ['', 'HV1', 'HV5', 'HV9', 'LV1', 'LV3', 'LV5', 'RE1']);
  for (const r of reg) assert.match(r.status, /needs engineering review/);
  const hv9 = reg.find((r) => r.code === 'HV9');
  assert.deepEqual(hv9.observedBelowTip, [{ pole: 'S120776', value: 0.54, file: FILES[0] }]);
});

test('attachment heights follow king bolt + attachment y, and wires join matching points', opts, () => {
  const p = M.readPnwx(read(FILES[0]));
  const poles = p.poles.map((x, i) => ({ id: x.ID, easting: +x.Easting, northing: +x.Northing, ground: +p.ground[i].Level }));
  const cons = {};
  p.constructions.forEach((r) => (cons[r.pole] = cons[r.pole] || []).push(M.constructionFrom(r, 'f')));
  const { points, axes } = M.attachmentPoints(poles, cons);
  assert.equal(points.length, 3 + 4 + 3 + 4 + 3 + 4 + 3 + 4);
  const top = points.find((q) => q.pole === 'S119850' && q.code === 'HV1' && q.index === 1);
  assert.equal(top.heightAG, 9.982);
  // crossarm axis is perpendicular to the line
  axes.forEach((a) => assert.ok(Math.abs(a.along[0] * a.right[0] + a.along[1] * a.right[1]) < 1e-12));
  const { wires, issues } = M.wires(points, p.segPoles, p.segments);
  assert.deepEqual(issues, []);
  assert.equal(wires.filter((w) => w.segment === 'SS1').length, 9);
  assert.equal(wires.filter((w) => w.segment === 'SS2').length, 12);
  const sag = M.illustrativeSag(37.66, p.conductors.find((c) => c.Code.toUpperCase() === 'LI'), p.segments[0]);
  assert.ok(Math.abs(sag - 0.13 * 9.80665 / 1000 * 37.66 ** 2 / (8 * 0.07 * 7.91)) < 1e-12); // w·L²/8T
});

test('editing, adding and removing constructions keeps Table8 and Table6 consistent', opts, () => {
  const src = read(FILES[0]);
  const p = M.readPnwx(src);
  M.updateConstruction(p, 3, { kingbolt: 9.0 });
  assert.equal(p.segPoles.find((s) => s.id === 'S119850' && s.strsection === 'SS1').attht, '9');
  const added = M.addConstruction(p, 'S120378', { code: 'RE1', kingbolt: 6.1, voltage: 19.1, attachments: [{ x: 0.35, y: 0, order: 1 }] });
  assert.equal(added.unique, '10'); assert.equal(added.descr, 'RE1 (10)');
  const again = M.readPnwx(M.writePnwx(p));
  const re = again.constructions.find((c) => c.unique === '10');
  assert.deepEqual([re.code, re.pole, re.attht, re.attachOutreach, re.descr, re.label], ['RE1', 'S120378', '6.1', '0.35', 'RE1 (10)', '']);
  assert.throws(() => M.removeConstruction(p, 3), /carries conductors/);
  M.removeConstruction(p, 10);
  M.updateConstruction(p, 3, { kingbolt: 9.07 });
  assert.equal(M.writePnwx(p), src); // add + remove + revert gives the original file back
});

test('rejects files that are not PNW projects', () => {
  assert.throws(() => M.readPnwx('<html><body></body></html>'), /Not a Poles 'n' Wires project/);
  assert.throws(() => M.readPnwx('<profile_project><Table1></profile_project>'), /Malformed/);
});

const LIB = path.join(DIR, 'pnw-library', 'PNW library tables.txt');
const libOpts = { skip: have && fs.existsSync(LIB) ? false : 'PNW library tables not found in ' + DIR };

test('PNW library tables give default king bolt heights that match the saved projects', libOpts, () => {
  const lib = M.parseLibrary(fs.readFileSync(LIB, 'utf8'));
  assert.deepEqual(lib.issues, []);
  assert.ok(lib.constructions.length > 50 && lib.conductors.length > 50 && lib.poles.length > 10);
  // every HV1 in the saved projects that the designer left at the default sits 0.23 below the tip
  const g = M.readPnwx(read('GROUND LINE.pnwx'));
  for (const c of g.constructions.filter((x) => x.code)) {
    const pole = g.poles.find((x) => x.ID === c.pole);
    const above = g.constructions.find((x) => x.pole === c.pole && x.code && +x.attht > +c.attht);
    const k = M.defaultKingbolt(lib, c.code, +pole.HeightAG, above ? +above.attht : null);
    assert.equal(k.value, +c.attht, c.pole + ' ' + c.code);
  }
  const mp = M.readPnwx(read(FILES[0]));
  assert.equal(M.defaultKingbolt(lib, 'HV1', +mp.poles.find((x) => x.ID === 'S119850').HeightAG).value, 9.07);
  // pole types from the GIS stock description, wood poles before self supporting ones
  assert.deepEqual(M.matchPoleType(lib, '11M;6KN').map((m) => m.pole.code), ['PO6 - 11m/6kN', 'PO18 - 11m/6kN', 'SSP1 - 11m/6 kN']);
  const po9 = lib.poles.find((p) => p.code.startsWith('PO9'));
  assert.deepEqual([po9.diamTip, po9.diamGL, po9.sinking], [315, 421, 1.85]);
  assert.equal(M.libraryConstruction(lib, 'nope'), null);
});

test('design model joins poles, ground, constructions and wires for the 3D and profile views', opts, () => {
  const p = M.readPnwx(read(FILES[0]));
  const d = M.designModel(p, { file: FILES[0], sag: true });
  assert.deepEqual(d.issues, []);
  assert.equal(d.poles.length, 4);
  assert.deepEqual(d.poles.map((x) => x.ground), p.ground.filter((g) => p.poles.some((q) => +q.Distance === +g.Chainage)).map((g) => +g.Level));
  assert.equal(d.wires.length, 21);
  assert.ok(d.wires.every((w) => w.sag > 0 && w.span > 0));
  // the HV wires carry the construction voltage, the earth/LV ones theirs
  assert.ok(d.wires.filter((w) => w.segment === 'SS1').every((w) => w.voltage > 1));
  assert.equal(M.designModel(p, {}).wires[0].sag, null); // no sag unless asked for
});

const DCSH = path.join(DIR, 'dcsh');
const dcshOpts = { skip: have && fs.existsSync(path.join(DCSH, 'DCSH standards register.json')) ? false : 'DCSH files not found in ' + DCSH };

test('DCSH register: LV3 and LV5 offsets in the saved project match drawings L03 and L05', dcshOpts, () => {
  const reg = M.parseDcshRegister(fs.readFileSync(path.join(DCSH, 'DCSH standards register.json'), 'utf8'));
  assert.deepEqual(reg.issues, []);
  const p = M.readPnwx(read(FILES[0]));
  for (const code of ['LV3', 'LV5']) {
    const row = p.constructions.find((c) => c.code === code), c = M.constructionFrom(row, 'f');
    const e = M.dcshFor(reg, code)[0];
    assert.equal(M.compareDcsh(e, c, +p.poles.find((x) => x.ID === c.pole).HeightAG).offsets, true, code);
  }
  // HV1 on S119850 sits 0.23 below the tip; its drawing has not been read, so nothing is claimed
  const hv1 = M.dcshFor(reg, 'HV1')[0];
  assert.equal(hv1.status, 'pending');
  assert.deepEqual(M.compareDcsh(hv1, M.constructionFrom(p.constructions[2], 'f'), 9.3), { kingbolt: null, offsets: null, notes: [] });
  assert.throws(() => M.parseDcshRegister('{"kind":"x"}'), /Not a DCSH standards register/);
});

test('DCSH Part 10 stringing tables: sag read from the table and scaled from the ruling span', { skip: fs.existsSync(path.join(DCSH, 'DCSH Part 10 Tensioning.txt')) ? false : 'Part 10 text not found' }, () => {
  const { tables } = M.parseStringingTables(fs.readFileSync(path.join(DCSH, 'DCSH Part 10 Tensioning.txt'), 'utf8'));
  assert.ok(tables.length >= 30);
  for (const t of tables) {
    assert.ok(t.spans.every((r) => r.sag.length === t.temps.final.length), t.title);
    assert.ok(t.spans[0].rs >= t.spanMin - 5 && t.spans[t.spans.length - 1].rs <= t.spanMax + 5, t.title);
  }
  const li = tables.find((t) => /LIBRA 10%/.test(t.title));
  const row40 = li.spans.find((r) => r.rs === 40), col = li.temps.final.indexOf(15);
  assert.equal(M.tableSag(li, 'final', 15, 40, 40).value, row40.sag[col]);
  // a 30 m span in a 40 m ruling-span section: (30/40)^2 of the ruling-span sag
  assert.ok(Math.abs(M.tableSag(li, 'final', 15, 30, 40).value - row40.sag[col] * 0.5625) < 1e-12);
  assert.match(M.tableSag(li, 'final', 15, 90, 90).reason, /outside the table/);
  assert.ok(Math.abs(M.rulingSpan([30, 40]) - Math.sqrt((27000 + 64000) / 70)) < 1e-12);
});
