// Regression tests against Ishan's real workflow files. The files contain network asset data, so they are
// not committed to this public repo: point PNW_FIXTURES at the folder that holds them (default /mnt/project-files).
// Run: cd poles-wires/tests && npm install && npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const PNW = require('../pnw-core.js');

const DIR = process.env.PNW_FIXTURES || '/mnt/project-files';
const F = {
  qlink219: 'QLINK .xlsx',
  qlink221: 'aff63d83-5378-4872-91ed-b9de8ac00059.xlsx',
  gis: 'Export (13).xlsx',
  insp: 'POLE INSPECTIONS.csv',
  insp221: 'Asset Management Portal Dx - Data Extractor Export (1) 2.csv',
  defects: 'POLE DEFECTS.csv',
  poleList: 'pole list.xls',
  gp219: 'Ground Profile - MP219050.xlsx',
  gpNorth: 'Ground Profile - MP219050 - Across North St- Copy.xlsx',
  gp221: 'Ground Profile - MP221715.xlsx',
  pnwx219: 'Ground Profile - MP219050.pnwx',
  pnwxNewPole: 'Ground Profile - MP219050- S119850 to new pole.pnwx',
  pnwxGround: 'GROUND LINE.pnwx',
  tipload: 'S1242155.pnwx'
};
const have = Object.values(F).every((f) => fs.existsSync(path.join(DIR, f)));
const opts = { skip: have ? false : 'reference files not found in ' + DIR + ' (set PNW_FIXTURES)' };

const load = (f, role) => PNW.importFile(XLSX, f, fs.readFileSync(path.join(DIR, f)), role);
const sheetAoa = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
const readGolden = (f) => XLSX.readFile(path.join(DIR, f));
// Writes the workbook to bytes and reads it back, so the test checks what the user actually downloads.
const roundTrip = (wb) => XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });

function project(files) {
  const imported = files.map((f) => load(f));
  return { imported, ...PNW.buildPoles(imported) };
}

test('detects the role of every supplied file from its contents', opts, () => {
  const expect = { qlink219: 'survey', qlink221: 'survey', gis: 'gisPoles', insp: 'inspections', insp221: 'inspections', defects: 'defects', poleList: 'poleList', gp219: 'groundProfile', gpNorth: 'groundProfile', gp221: 'groundProfile' };
  for (const [k, role] of Object.entries(expect)) assert.equal(load(F[k]).role, role, F[k]);
  assert.equal(load('SP053196 INSPECTIONS.xlsx').role, 'inspections');
  assert.equal(load('SP053196 - SPIDA Poles.xlsx').role, 'gisPoles');
});

test('parses the LiDAR survey exactly as supplied', opts, () => {
  const s = load(F.qlink219);
  assert.equal(s.items.length, 5);
  assert.deepEqual(s.issues, []);
  const p = s.items.find((x) => x.id === 'S119846');
  assert.deepEqual([p.easting, p.northing, p.elevation], [401821.16, 6457134.92, 7.33]);
});

test('parses inspections (CSV with preamble) and keeps the latest pole length', opts, () => {
  const i = load(F.insp);
  const by = Object.fromEntries(i.items.map((x) => [x.id, x]));
  assert.equal(by.S119846.length, 12.5);
  assert.equal(by.S120776.length, 11);
  assert.equal(by.S1242155.length, 9.5);
  assert.equal(by.S119850.attrs['Bay 1 Length (m)'].value, '38'); // 2021 inspection wins over 2012
  assert.equal(by.S119846.equipNo, '1238709');
});

test('matches defects without the S prefix and GIS poles to the survey', opts, () => {
  const { poles, issues } = project([F.qlink219, F.gis, F.insp, F.defects, F.poleList]);
  assert.ok(poles.S119846.defects.length > 0, 'defects joined to S119846');
  assert.equal(Object.keys(poles).length, 5);
  for (const id of ['S119846', 'S119850', 'S120776', 'S120378', 'S1242155']) {
    assert.ok(poles[id].survey && poles[id].gis && poles[id].inList, id + ' fully matched');
  }
  assert.ok(Math.abs(poles.S120378.gis.lat - -32.0169546) < 1e-6);
  // GIS and inspection lengths agree for every pole in this set, so no conflict is reported
  assert.equal(issues.filter((x) => x.code === 'length-conflict').length, 0);
  assert.deepEqual(['S119846', 'S120776', 'S120378'].map((id) => PNW.existingLength(poles[id]).value), [12.5, 11, 11]);
});

test('orders poles along the line the same way as the reference profiles', opts, () => {
  const a = project([F.qlink219]);
  assert.deepEqual(PNW.autoOrder(a.poles, ['S120378', 'S120776', 'S119850', 'S119846']), ['S119846', 'S119850', 'S120776', 'S120378']);
  const b = project([F.qlink221]);
  assert.deepEqual(PNW.autoOrder(b.poles, Object.keys(b.poles)), ['S95931', 'S95932', 'S95934']);
});

// Reference cases: the three ground profile workbooks Ishan produced by hand.
const CASES = [
  { name: 'MP219050', files: [F.qlink219, F.gis, F.insp], ids: ['S119846', 'S119850', 'S120776', 'S120378'], lengths: { S119846: 11, S120776: 12.5, S120378: 9.5 }, golden: F.gp219 },
  { name: 'MP219050 Across North St', files: [F.qlink219, F.gis, F.insp], ids: ['S119850', 'S1242155'], lengths: {}, golden: F.gpNorth },
  { name: 'MP221715', files: [F.qlink221, F.insp221], ids: ['S95931', 'S95932', 'S95934'], lengths: { S95931: 11, S95932: 11, S95934: 11 }, comments: { S95931: 1.7, S95932: 1.7, S95934: 1.7 }, golden: F.gp221 }
];

for (const c of CASES) {
  test('ground profile matches the reference workbook cell for cell: ' + c.name, opts, () => {
    const { poles } = project(c.files);
    const built = PNW.buildProfile(poles, { name: c.name, poleIds: PNW.autoOrder(poles, c.ids), lengths: c.lengths, comments: c.comments });
    assert.equal(built.ok, true, JSON.stringify(built.issues));
    const out = roundTrip(PNW.groundProfileWorkbook(XLSX, built, []));
    const gold = readGolden(c.golden);
    assert.deepEqual(out.SheetNames, gold.SheetNames);
    const g = sheetAoa(gold, 'Groundline'), o = sheetAoa(out, 'Groundline');
    assert.equal(o.length, g.length, 'row count');
    g.forEach((row, r) => row.forEach((v, col) => assert.deepEqual(o[r][col] ?? null, v ?? null, `Groundline ${XLSX.utils.encode_cell({ r, c: col })}`)));
    // Segments: the header row is the data PNW reads. MP221715's sheet also has a hand-written attachment note block below it.
    const trim = (r) => { r = r.slice(); while (r.length && r[r.length - 1] == null) r.pop(); return r; };
    assert.deepEqual(trim(sheetAoa(out, 'Segments')[0]), trim(sheetAoa(gold, 'Segments')[0]));
  });
}

test('the reference Groundline sheet itself parses back to the same pole order and lengths', opts, () => {
  const ref = load(F.gp219);
  assert.deepEqual(ref.items.map((x) => x.id), ['S119846', 'S119850', 'S120776', 'S120378']);
  const { poles } = project([F.qlink219, F.gis]);
  const built = PNW.buildProfile(poles, { poleIds: ref.items.map((x) => x.id), lengths: { S119846: 11, S120776: 12.5, S120378: 9.5 } });
  assert.deepEqual(PNW.compareWithReference(built, ref), []);
  // Without the edited lengths the tool reports exactly the three changed poles
  const plain = PNW.buildProfile(poles, { poleIds: ref.items.map((x) => x.id) });
  assert.deepEqual([...new Set(PNW.compareWithReference(plain, ref).map((d) => d.poleId))].sort(), ['S119846', 'S120378', 'S120776']);
});

test('setting depth and height rule matches every PNW sample (9.5, 11, 12.5, 14 m)', opts, () => {
  const seen = [];
  for (const f of [F.pnwx219, F.pnwxNewPole, F.pnwxGround]) {
    for (const p of PNW.readProfilePnwx(fs.readFileSync(path.join(DIR, f), 'utf8')).poles) {
      assert.equal(PNW.settingDepth(p.length), p.sunk, f + ' ' + p.id);
      assert.equal(PNW.round(p.length - p.sunk, 2), p.height, f + ' ' + p.id);
      seen.push(p.length);
    }
  }
  assert.deepEqual([...new Set(seen)].sort((a, b) => a - b), [9.5, 11, 12.5, 14]);
});

test('PNW profile (.pnwx) ground and pole tables match the saved PNW project', opts, () => {
  const { poles } = project([F.qlink219, F.gis]);
  for (const [file, ids, lengths] of [[F.pnwx219, ['S119846', 'S119850', 'S120776', 'S120378'], { S119846: 11, S120776: 12.5, S120378: 9.5 }], [F.pnwxNewPole, ['S119850', 'S1242155'], { S1242155: 12.5 }]]) {
    const built = PNW.buildProfile(poles, { poleIds: ids, lengths });
    const gold = PNW.readProfilePnwx(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const ours = PNW.readProfilePnwx(PNW.profilePnwx(built, { title: 'x', clearance1: 5.8, clearance2: 7 }));
    assert.deepEqual(ours.ground, gold.ground, file + ' Table1');
    assert.deepEqual(ours.poles, gold.poles, file + ' Table2');
  }
});

test('chainage rule (sum of spans rounded to 0.01 m) reproduces GROUND LINE.pnwx', opts, () => {
  const gold = PNW.readProfilePnwx(fs.readFileSync(path.join(DIR, F.pnwxGround), 'utf8'));
  let chain = 0;
  gold.ground.forEach((g, i) => {
    if (i) chain = PNW.round(chain + PNW.round(PNW.dist2d(gold.ground[i - 1], g), 2), 2);
    assert.equal(chain, g.chainage);
  });
});

test('span and bearing between poles match the saved S1242155 tipload (PNW builds tipload from the profile)', opts, () => {
  const { poles } = project([F.qlink219]);
  const built = PNW.buildProfile(poles, { poleIds: ['S119850', 'S1242155'], lengths: { S1242155: 12.5 } });
  const xml = fs.readFileSync(path.join(DIR, F.tipload), 'utf8');
  const angle = +xml.match(/<Angle>([\d.]+)<\/Angle>/)[1], span = +xml.match(/<Span_Length>([\d.]+)<\/Span_Length>/)[1];
  const [a, b] = built.rows;
  assert.equal(b.span, span);
  assert.equal(PNW.round(PNW.bearing(b, a), 1), angle);
  assert.equal(b.length, 12.5); assert.equal(b.height, 10.65); assert.equal(b.sunk, 1.85); // tipload ht/length/sink
});

/* ---- synthetic edge cases, built in the same column layout as the real QLINK export ---- */
const QHEAD = 'Data Type,PICK_ID,X_COORD_BASE,Y_COORD_BASE,Z_COORD_BASE\n';
const csv = (name, body) => PNW.importFile(XLSX, name, Buffer.from(QHEAD + body));

test('reports missing values, invalid numbers and invalid coordinates', () => {
  const s = csv('q.csv', 'Structure,S1,401821.16,6457134.92,\nStructure,S2,abc,6457134.92,7\nStructure,S3,12,34,5\nStructure,,1,2,3\n');
  assert.equal(s.role, 'survey');
  const codes = s.issues.map((x) => x.poleId + ':' + x.code).sort();
  assert.deepEqual(codes, [':missing-id', 'S1:missing-value', 'S2:invalid-number', 'S3:invalid-coordinate']);
  const { poles } = PNW.buildPoles([s]);
  const built = PNW.buildProfile(poles, { poleIds: ['S1', 'S2'], lengths: { S1: 11, S2: 11 } });
  assert.equal(built.ok, false);
});

test('flags duplicate IDs and unknown pole lengths', () => {
  const s = csv('q.csv', 'Structure,S1,401821.16,6457134.92,7.3\nStructure,S1,401821.16,6457134.92,7.3\nStructure,S2,401797.92,6457155.1,7.34\nStructure,S2,401700,6457155.1,7.34\n');
  const { poles, issues } = PNW.buildPoles([s]);
  assert.equal(issues.find((x) => x.poleId === 'S1').level, 'warning');
  assert.equal(issues.find((x) => x.poleId === 'S2').level, 'error');
  const built = PNW.buildProfile(poles, { poleIds: ['S1', 'S2'] });
  assert.deepEqual(built.issues.map((x) => x.code), ['missing-length', 'missing-length']);
  assert.equal(PNW.buildProfile(poles, { poleIds: ['S1', 'S1'], lengths: { S1: 11 } }).issues[0].code, 'duplicate-id');
});

test('replacing a file and regenerating uses the new values', () => {
  const ids = ['S1', 'S2'], lengths = { S1: 11, S2: 11 };
  const v1 = csv('q.csv', 'Structure,S1,401821.16,6457134.92,7.33\nStructure,S2,401797.92,6457155.1,7.34\n');
  const v2 = csv('q.csv', 'Structure,S1,401821.16,6457134.92,8.01\nStructure,S2,401797.92,6457155.1,7.34\n');
  const a = PNW.buildProfile(PNW.buildPoles([v1]).poles, { poleIds: ids, lengths });
  const b = PNW.buildProfile(PNW.buildPoles([v2]).poles, { poleIds: ids, lengths });
  assert.equal(a.rows[0].elevation, 7.33);
  assert.equal(b.rows[0].elevation, 8.01);
  assert.equal(b.rows[1].chainage, 30.78);
});

test('rejects unsupported file types and never evaluates formulas', () => {
  assert.throws(() => PNW.importFile(XLSX, 'x.docx', Buffer.from('x')), /Unsupported file type/);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['PICK_ID', 'X_COORD_BASE', 'Y_COORD_BASE', 'Z_COORD_BASE'], ['S1', { t: 'n', f: 'WEBSERVICE("http://x")', v: 401821.16 }, 6457134.92, 7.33]]);
  ws.B2 = { t: 'n', f: 'WEBSERVICE("http://x")', v: 401821.16 };
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  const s = PNW.importFile(XLSX, 'f.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(s.items[0].easting, 401821.16); // cached value only
});
