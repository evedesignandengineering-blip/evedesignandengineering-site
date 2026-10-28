// Tipload engine against Ishan's S1242155 PNW tipload report (PNW v7.18 / tipload 2.0.0.1149, option set v7 REGION AM-SL1).
// The load combinations and the derived plant data are private: they are read from PNW_FIXTURES, not stored in this repo.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../pnw-model.js');
const T = require('../pnw-tipload.js');

const DIR = process.env.PNW_FIXTURES || '/mnt/project-files';
const need = ['S1242155.pnwx', 'pnw-library/PNW library tables.txt', 'pnw-library/tipload options.json'];
const opts = { skip: need.every((f) => fs.existsSync(path.join(DIR, f))) ? false : 'reference files not found in ' + DIR + ' (set PNW_FIXTURES)' };
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

function s1242155() {
  const lib = M.parseLibrary(read('pnw-library/PNW library tables.txt')), set = JSON.parse(read('pnw-library/tipload options.json'));
  const cond = (code) => { const c = lib.conductors.find((x) => x.code === code); return c && { mass: c.mass, diam: c.diameter, E: c.modElast, csa: c.csa, alpha: Number(c.expCoeff), cbl: c.cbl }; };
  const inp = T.fromTipProject(M.readPnwx(read('S1242155.pnwx')), cond, (code) => set.plant[code], (w) => (lib.stays.find((s) => s.code === w) || {}).strength);
  return { inp, set };
}

test('reproduces the S1242155 PNW tipload results', opts, () => {
  const { inp, set } = s1242155();
  const r = T.calc(inp, set.cases.filter((c) => c.include), set.options);
  assert.deepEqual(r.issues, []);
  const [mw, ed] = r.results;
  assert.equal(mw.name, 'Max wind load');
  assert.equal(mw.load.toFixed(2), '6.58'); assert.equal(Math.round(mw.dir), 66); assert.equal(mw.windFrom, 300); assert.equal(mw.moment.toFixed(1), '68.1');
  assert.equal(mw.capacity, 18.8); assert.equal(Math.round(mw.pctHor), 35); assert.equal(mw.vertical.toFixed(2), '18.44'); assert.equal(Math.round(mw.pctVert), 6); assert.equal(mw.bc.toFixed(2), '0.41'); assert.equal(mw.unstayed.toFixed(2), '6.58');
  assert.equal(mw.kingbolt[0].attHt, 10.19); assert.equal(mw.kingbolt[0].load.toFixed(2), '4.73'); assert.equal(Math.round(mw.kingbolt[0].dir + 1e-9), 47);
  assert.equal(ed.name, 'Everyday');
  assert.equal(ed.load.toFixed(2), '2.53'); assert.equal(Math.round(ed.dir), 45); assert.equal(ed.moment.toFixed(2), '26.19'); assert.equal(ed.capacity.toFixed(1), '10.7');
  assert.equal(Math.round(ed.pctHor), 24); assert.equal(ed.vertical.toFixed(2), '18.64'); assert.equal(Math.round(ed.pctVert), 10); assert.equal(ed.bc.toFixed(2), '0.34');
  assert.equal(mw.pass, true); assert.equal(ed.pass, true);
});

test('a stay opposing the load takes it and the unstayed load is still reported', opts, () => {
  const { inp, set } = s1242155();
  inp.stays[0].include = true; // the stay in S1242155 (223.2°, 9.89 m, 45°) is saved but not included
  const mw = T.calc(inp, set.cases.filter((c) => c.include), set.options).results[0];
  assert.ok(mw.load < 6.58 && mw.load > 0, 'stayed load ' + mw.load);
  assert.equal(mw.unstayed.toFixed(2), '6.58');
  assert.ok(mw.stays[0].load > 0);
  assert.ok(mw.vertical > 18.44);
});

test('change of state: tension rises under wind and falls when hot', () => {
  const EA = 59e9 * 124e-6, w = 0.34 * 9.80665;
  assert.equal(Math.round(T.changeOfState(500, w, 15, w, 15, 50, EA, 2.3e-5)), 500);
  assert.ok(T.changeOfState(500, w, 15, 3 * w, 15, 50, EA, 2.3e-5) > 500);
  assert.ok(T.changeOfState(500, w, 15, w, 75, 50, EA, 2.3e-5) < 500);
});

test('reads load combinations from a PNW tipload report', () => {
  const txt = ['Load Combinations                                         SRF formula                           AS7000', 'Loading 1', 'Name                                 Max wind load',
    '                                                          Ice loading                           None', '                                                          Temperature                           15',
    'General                                                   Wind on Pole                          800', '                                                          Wind on Conductors                    600',
    '                                                          Wind on Plant                         1000', 'Database name                        x                    Fₜ factor                             1.2',
    '                                     y                    Wₙ factor                             1', 'Include                              Yes                  Gₛ factor                             1.1',
    'reports                                                   Gc factor                             1.2', '                                                          Pole strength class                   Ultimate limit',
    'Default conductor                    4B95                 Pole Strength reduction factor        0.9'].join('\n');
  assert.deepEqual(T.parseReportOptions(txt), [{ name: 'Max wind load', ice: 'None', temp: 15, windPole: 800, windCond: 600, windPlant: 1000, Ft: 1.2, Wn: 1, Gs: 1.1, Gc: 1.2, strengthClass: 'Ultimate limit', phi: 0.9, include: true }]);
});
