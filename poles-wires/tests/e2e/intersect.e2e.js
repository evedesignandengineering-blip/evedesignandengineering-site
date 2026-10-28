// Intersecting profiles, sag and middle-button pan. The branch "S119850 to new pole" shares S119850 with MP219050:
// it must be drawn with the design (plan and 3D), the shared pole once, carrying both lines' constructions with each
// crossarm across its own line. Conductors sag by default. Pole panels show height above ground, not x / y.
const { open, D, OUT, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, pg, logs } = await open(1440, 900);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx', 'Ground Profile - MP219050- S119850 to new pole.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(600);
  ok(/intersecting line/.test(await pg.$eval('#sidePanel', (e) => e.textContent)), 'second project recognised as an intersecting line');
  ok(await pg.$$eval('#map path[stroke="#7c3aed"]', (els) => els.length >= 1), 'plan shows the intersecting line');
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1500);
  const st = await pg.evaluate(() => PNW3D.state());
  const lab = await pg.$$eval('.l3d', (els) => els.map((e) => e.textContent));
  ok(lab.filter((t) => t === 'S119850').length === 1 && lab.some((t) => /^sag \d/.test(t)), 'shared pole S119850 drawn once, sag labelled (' + lab.join(', ') + ')');
  ok(st.wires > 18, 'branch conductors drawn too (' + st.wires + ' wires)');
  const sag = await pg.evaluate(() => { const w = window.__pwDebug ? null : null; return document.getElementById('sagNote').textContent; });
  ok(/Sag shown: SS1: w·L²\/8T at 7 %CBL/.test(sag), 'sag on by default: ' + sag);
  ok(await pg.$eval('#sagMode', (e) => e.value === 'auto'), 'sag mode defaults to DCSH table, else w·L²/8T');
  await pg.click('[data-cam="side"]'); await pg.waitForTimeout(900);
  const before = await pg.evaluate(() => PNW3D.state().target);
  const box = await pg.$eval('#v3host', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await pg.mouse.move(box[0], box[1]); await pg.mouse.down({ button: 'middle' }); await pg.mouse.move(box[0] + 120, box[1] + 40, { steps: 6 }); await pg.mouse.up({ button: 'middle' }); await pg.waitForTimeout(500);
  const after = await pg.evaluate(() => PNW3D.state());
  ok(Math.hypot(after.target[0] - before[0], after.target[1] - before[1], after.target[2] - before[2]) > 1 && after.view === 'side' || Math.hypot(after.target[0] - before[0], after.target[2] - before[2]) > 1, 'middle-button drag pans the 3D view');
  // the branch-only pole opens a read-only card that can switch the design
  await pg.evaluate(() => document.querySelector('[data-id="S1242155"]') && document.querySelector('[data-id="S1242155"]').click()); await pg.waitForTimeout(300);
  await pg.click('[data-instab="design"]').catch(() => {}); await pg.waitForTimeout(300);
  const cons = await pg.$eval('#selected', (e) => e.textContent);
  ok(!/x \(m\)|y \(m\)/.test(cons.replace(/Edit attachment offsets[\s\S]*/, '')), 'design pane shows height above ground without x / y');
  await pg.click('[data-tab="heights"]'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#tableWrap thead', (e) => /Height AG/.test(e.textContent) && !/x \(m\)|y \(m\)/.test(e.textContent)), 'Heights table without x / y columns');
  await pg.click('[data-view="plan"]'); await pg.waitForTimeout(400);
  const c0 = await pg.evaluate(() => { const m = document.querySelector('#map .leaflet-map-pane').style.transform; return m; });
  const mb = await pg.$eval('#map', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await pg.mouse.move(mb[0], mb[1]); await pg.mouse.down({ button: 'middle' }); await pg.mouse.move(mb[0] + 80, mb[1] + 30, { steps: 5 }); await pg.mouse.up({ button: 'middle' }); await pg.waitForTimeout(300);
  ok(c0 !== await pg.evaluate(() => document.querySelector('#map .leaflet-map-pane').style.transform), 'middle-button drag pans the map');
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
