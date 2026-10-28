// Tipload window: the PNW tipload project S1242155 gives PNW's own results, design poles get circuits from the design,
// stays and plant saved in PNW can be copied in, load combinations can be edited or pasted from a PNW report.
const { open, D, OUT, noise } = require('./lib.js');
const { execFileSync } = require('child_process');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const report = (() => { try { return execFileSync('pdftotext', ['-layout', D + 'S1242155-New P09.pdf', '-'], { encoding: 'utf8' }); } catch (e) { return ''; } })();
(async () => {
  const { b, pg, logs } = await open(1440, 900, () => { window.claude = { use: () => Promise.resolve({ save: async () => ({}) }) }; });
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050- S119850 to new pole.pnwx', 'S1242155.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.click('#tbTip'); await pg.waitForTimeout(400);
  ok(await pg.$eval('#tipDlg', (e) => !e.hidden), 'Tipload button opens the tipload window');
  if (!(await pg.$$('[data-lc$="|name"]')).length) { // website build: no built-in option set, so read it from the PNW report
    ok(!!report, 'S1242155 report text available to paste');
    await pg.fill('#lcPaste', report); await pg.click('#lcRead'); await pg.waitForTimeout(300);
    await pg.$$eval('[data-lc="2|include"]', (c) => { if (c[0] && c[0].checked) c[0].click(); }); await pg.waitForTimeout(300);
  }
  if (!(await pg.$eval('[data-pd="X T 0127-3Ph|weight"]', (i) => i.placeholder))) { // website build: no built-in plant data, enter it
    const pd = JSON.parse(require('fs').readFileSync(D + 'pnw-library/tipload options.json', 'utf8')).plant['X T 0127-3Ph'];
    for (const [k, v] of [['weight', pd.weight], ['offset', pd.offset], ['area', pd.area]].map(([k, v]) => [k, String(v)])) { await pg.fill('[data-pd="X T 0127-3Ph|' + k + '"]', v); await pg.press('[data-pd="X T 0127-3Ph|' + k + '"]', 'Tab'); await pg.waitForTimeout(200); }
  }
  const names = await pg.$$eval('[data-lc$="|name"]', (i) => i.map((x) => x.value));
  ok(names.join('|') === 'Max wind load|Everyday|Verification1', 'load combinations of v7 REGION AM-SL1 (' + names.join(', ') + ')');
  const rows = await pg.$$eval('.tip-all tr[data-tippick]', (r) => r.map((x) => x.dataset.tippick));
  ok(rows.includes('S1242155') && rows.includes('tip:S1242155.pnwx'), 'table lists the design poles and the PNW tipload project (' + rows.join(', ') + ')');
  await pg.click('.tip-all tr[data-tippick="tip:S1242155.pnwx"]'); await pg.waitForTimeout(300);
  const res = await pg.$$eval('.tip-res tbody tr', (r) => Object.fromEntries(r.map((x) => [x.cells[0].textContent, [...x.cells].slice(1).map((c) => c.textContent.trim())])));
  ok(res['Resultant load (kN)'].join() === '6.58,2.53' && res['Direction (°)'].join() === '66,45' && res['Wind direction (°)'][0] === '300', 'S1242155 as saved in PNW: 6.58 kN @ 66° (wind from 300°), 2.53 kN @ 45° (' + JSON.stringify(res['Resultant load (kN)']) + ')');
  ok(res['% Loaded (hor)'].join() === '35,24' && res['Vertical load (kN)'].join() === '18.44,18.64' && res['B&C check'].join() === '0.41,0.34', 'percent loaded, vertical load and B&C match the PNW report');
  ok(/4\.73/.test(await pg.$eval('.tip-pole', (e) => e.textContent)), 'kingbolt load 4.73 kN');
  ok(await pg.$$eval('.tip-polar line', (l) => l.length >= 4) && !!(await pg.$('.tip-curve svg path')), 'polar diagram and tipload-against-wind chart drawn');
  const box = await pg.$('#tipCurve svg'), bb = await box.boundingBox();
  await pg.mouse.move(bb.x + bb.width * 0.82, bb.y + bb.height * 0.5); await pg.waitForTimeout(150);
  ok(/Wind from \d+°/.test(await pg.$eval('#tipTt', (e) => (e.hidden ? '' : e.textContent))), 'chart hover shows the loads at that wind direction');
  await pg.screenshot({ path: OUT + 'tipload-file.png' });
  // design pole: circuits from the design, then the stay and plant saved in PNW
  await pg.click('.tip-all tr[data-tippick="S1242155"]'); await pg.waitForTimeout(300);
  const c1 = await pg.$$eval('.tip-pole table.grid', (t) => t.find((x) => /Conductor/.test(x.tHead && x.tHead.textContent)).tBodies[0].rows.length);
  ok(c1 >= 1, 'design pole has circuits from the design (' + c1 + ')');
  ok(!!(await pg.$('[data-tipuse="S1242155"]')), 'offers the stay and plant saved in PNW');
  await pg.click('[data-tipuse="S1242155"]'); await pg.waitForTimeout(400);
  const sp = await pg.$eval('.tip-pole', (e) => e.textContent);
  ok(/Stay 1/.test(sp) && /X T 0127-3Ph/.test(sp), 'stay and transformer copied from the PNW tipload');
  const before = await pg.$eval('.tip-res tbody tr:nth-child(2) td', (c) => c.textContent);
  if (!(await pg.$eval('.tip-opts', (d) => d.open))) await pg.click('.tip-opts summary');
  await pg.fill('[data-lc="0|windPole"]', '1000'); await pg.press('[data-lc="0|windPole"]', 'Tab'); await pg.waitForTimeout(300);
  const after = await pg.$eval('.tip-res tbody tr:nth-child(2) td', (c) => c.textContent);
  ok(before !== after, 'editing a load combination recalculates (' + before + ' → ' + after + ')');
  await pg.fill('[data-lc="0|windPole"]', '-5'); await pg.press('[data-lc="0|windPole"]', 'Tab'); await pg.waitForTimeout(200);
  ok(/not a valid/.test(await pg.$eval('#status', (e) => e.textContent)), 'invalid wind pressure rejected');
  ok(await pg.$eval('.tip-opts', (d) => d.open), 'load combinations stay open while editing');
  await pg.screenshot({ path: OUT + 'tipload-pole.png', fullPage: false });
  await pg.click('[data-tipgo="S1242155"]'); await pg.waitForTimeout(400);
  ok(await pg.$eval('#tipDlg', (e) => e.hidden) && /Tipload/.test(await pg.$eval('#selected', (e) => e.textContent)), 'Show pole closes the window; the inspector shows the tipload summary');
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
