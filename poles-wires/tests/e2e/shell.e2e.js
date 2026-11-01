// Smoke test for the CAD-shell layout on the website build: import, profile zoom-out, 3D, built-in separation rule, Auto design review.
const { open, D, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, pg, logs } = await open(1440, 900);
  ok(await pg.$('#rtabs') && await pg.$('.titlebar'), 'CAD shell layout loads');
  await pg.waitForFunction(() => window.PNW_DCSH_IMG, null, { timeout: 15000 });
  const img = await pg.evaluate(() => new Promise((r) => { const k = Object.keys(window.PNW_DCSH_IMG), i = new Image(); i.onload = () => r(k.length + ' drawings, ' + i.naturalWidth + ' px'); i.onerror = () => r('error'); i.src = window.PNW_DCSH_IMG[k[0]].src; }));
  ok(/^1\d drawings, \d{3,} px/.test(img), 'DCSH drawing images load after the page: ' + img);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  ok(/Imported/.test(await pg.$eval('#status', (e) => e.textContent)), 'files import');
  await pg.click('[data-view="profile"]'); await pg.waitForTimeout(600);
  ok(!!(await pg.$('#pvPlot svg')), 'profile draws');
  await pg.click('[data-pvz="out"]'); await pg.waitForTimeout(200); await pg.click('[data-pvz="out"]'); await pg.waitForTimeout(200);
  console.log('   ' + await pg.$eval('#pvScale', (e) => e.textContent));
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1500);
  ok(await pg.evaluate(() => !!(window.PNW3D && PNW3D.state && PNW3D.state().poles > 0)), '3D draws poles');
  ok(await pg.evaluate(() => !!window.PNW_HVLV), 'separation rule built in');
  ok(await pg.evaluate(() => ['library', 'dcsh', 'stringing'].every((k) => window.PNW_BUILTIN && window.PNW_BUILTIN[k])), 'PNW library, DCSH register and Part 10 tables built in');
  await pg.evaluate(() => document.getElementById('tbAuto').click());
  await pg.waitForSelector('#adApply, #adProg', { timeout: 15000 }); await pg.waitForSelector('#adApply', { timeout: 60000 });
  ok(/Needs you/.test(await pg.$eval('#genBody', (e) => e.innerText)), 'Auto design review opens (no photos: listed under Needs you)');
  const bad = logs.filter((l) => !noise(l) && !/supabase|Failed to fetch|tile|openstreetmap|arcgis|ERR_/i.test(l));
  ok(!bad.length, 'console clean ' + bad.join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
