// 3D camera: Fit frames the whole line (centred, inside the view), wheel zoom goes to the cursor without clipping, zoom out
// keeps the line inside the far plane, standard views, focus on a pole, wire click selects a section, no idle rendering.
const { open, D, OUT, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const inside = (s) => s.screen.minX >= -1 && s.screen.maxX <= 1 && s.screen.minY >= -1 && s.screen.maxY <= 1;
const centred = (s) => Math.abs(s.screen.minX + s.screen.maxX) < 0.05 && Math.abs(s.screen.minY + s.screen.maxY) < 0.05;
(async () => {
  const { b, pg, logs } = await open(1440, 900);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(2000);
  const st = () => pg.evaluate(() => PNW3D.state());
  const box = await pg.$eval('#v3host', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const shot = (n) => pg.screenshot({ path: OUT + n + '.png', clip: { x: box[0], y: box[1], width: box[2], height: box[3] } });
  let s = await st(); ok(inside(s) && centred(s) && Math.max(s.screen.maxX, s.screen.maxY) > 0.8, 'initial fit frames the line ' + JSON.stringify(s.screen)); await shot('cam-fit');
  const r0 = s.renders; await pg.waitForTimeout(1500); s = await st(); ok(s.renders === r0, 'no frames drawn while idle (' + (s.renders - r0) + ')');
  await pg.mouse.move(box[0] + box[2] / 2, box[1] + box[3] / 2);
  const d0 = s.distance; await pg.mouse.wheel(0, -100); await pg.waitForTimeout(300); s = await st();
  ok(s.distance / d0 > 0.88 && s.distance / d0 < 0.93, 'one wheel notch zooms in about 10% (' + (100 - s.distance / d0 * 100).toFixed(1) + '%)');
  const d1 = s.distance; await pg.mouse.wheel(0, 2000); await pg.waitForTimeout(300); s = await st();
  ok(s.distance / d1 < 1.2, 'a large trackpad / fast-scroll delta is capped (' + (s.distance / d1).toFixed(2) + '×)');
  ok(s.scale && s.scale.len > 0 && s.scale.px > 40 && s.scale.px < 300 && /m at the orbit point/.test(s.scale.text), '3D scale bar: ' + (s.scale && s.scale.text + ' over ' + s.scale.px + ' px'));
  await pg.click('#v3fit'); await pg.waitForTimeout(900); s = await st();
  const lab = await pg.$$eval('.l3d', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, r.x + r.width / 2, r.y + r.height + 20]; }));
  await pg.mouse.move(lab[1][1], lab[1][2]);
  for (let i = 0; i < 30; i++) { await pg.mouse.wheel(0, -250); await pg.waitForTimeout(25); }
  await pg.waitForTimeout(800); s = await st(); ok(s.distance < 5 && s.near < 0.05, 'wheel zoom at ' + lab[1][0] + ' gets close (' + s.distance.toFixed(2) + ' m, near plane ' + s.near.toFixed(3) + ' m)'); await shot('cam-zoomed');
  for (let i = 0; i < 40; i++) { await pg.mouse.wheel(0, 400); await pg.waitForTimeout(15); }
  await pg.waitForTimeout(800); s = await st(); ok(s.far > s.distance + 100, 'zoomed out: far plane ' + s.far.toFixed(0) + ' m beyond the camera distance ' + s.distance.toFixed(0) + ' m'); await shot('cam-out');
  await pg.click('#v3fit'); await pg.waitForTimeout(900); s = await st(); ok(inside(s) && centred(s), 'Fit all after zooming ' + JSON.stringify(s.screen));
  for (const v of ['side', 'front', 'top', 'iso']) { await pg.click('[data-cam="' + v + '"]'); await pg.waitForTimeout(900); s = await st(); ok(inside(s) && centred(s) && s.view === v, v + ' view ' + JSON.stringify(s.screen)); await shot('cam-' + v); }
  await pg.evaluate(() => document.querySelector('[data-id="S120776"]').click()); await pg.waitForTimeout(900);
  await pg.click('#v3focus'); await pg.waitForTimeout(900); s = await st(); ok(s.distance < 40, 'Focus selected frames S120776 at ' + s.distance.toFixed(1) + ' m'); await shot('cam-focus');
  await pg.click('#v3reset'); await pg.waitForTimeout(900); s = await st(); ok(s.view === 'iso' && inside(s), 'Reset returns to the iso view of the whole line');
  await pg.click('[data-tab="sections"]'); await pg.waitForTimeout(300);
  await pg.click('#tableWrap tr[data-sec] td:first-child'); await pg.waitForTimeout(500); s = await st(); ok(s.selectedSection === 'SS1', 'schedule row highlights its section in 3D'); await shot('cam-section');
  await pg.click('#tbAi'); await pg.waitForTimeout(400);
  ok(await pg.$eval('#selected', (e) => !!e.querySelector('[data-instab="photo"].on') && /Analyse pole photo with AI/.test(e.textContent) && !!e.querySelector('#aiPhoto')), 'toolbar AI photo match opens the photo analysis on a pole');
  await pg.click('[data-view="plan"]'); await pg.waitForTimeout(500);
  ok(await pg.$eval('#map', (e) => { const l = e.querySelector('.leaflet-control-scale-line'); return !!l && /\d+ (m|km)/.test(l.textContent); }), 'map scale bar shown');
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
