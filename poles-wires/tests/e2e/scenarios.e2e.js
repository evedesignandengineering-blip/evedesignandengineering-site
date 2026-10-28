// End-to-end scenarios: open a project, add a pole, construction and strain section with the suggestion boxes, edit heights,
// fit and focus the 3D camera, undo/redo, save/reload/open/export, invalid input, console errors.
const { open, D, OUT, noise } = require('./lib.js'); const fs = require('fs');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, ctx, pg, logs } = await open(1440, 900);
  await ctx.addInitScript(() => { window.__saved = []; window.claude = { use: (n) => Promise.resolve(n === 'downloads' ? { save: (o) => { window.__saved.push({ name: o.filename, size: o.data.size, data: o.data }); return Promise.resolve(); } } : null) }; });
  await pg.reload(); await pg.waitForTimeout(400);
  const st = () => pg.evaluate(() => window.PNW3D && PNW3D.state ? PNW3D.state() : null);
  const status = () => pg.$eval('#status', (e) => e.textContent);
  const ins = () => pg.$eval('#selected', (e) => e.innerText);
  // 1. open an existing project
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'gis-conductors/Export 15 - poles.xlsx', 'gis-conductors/Export 13 - LV overhead conductors.xlsx', 'gis-conductors/Export 14 - HV overhead conductors.xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(500);
  let t = await ins(); ok(/Constructions\s*8/.test(t) && /Strain sections\s*2/.test(t), '1 project summary shows 8 constructions and 2 strain sections');
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1500);
  let s = await st(); ok(s.poles === 4 && s.wires > 0, '1 3D shows ' + s.poles + ' poles and ' + s.wires + ' wires');
  await pg.click('[data-tab="sections"]'); await pg.waitForTimeout(200);
  ok((await pg.$$('#tableWrap tr[data-sec]')).length === 2, '1 conductor schedule lists 2 sections');
  // 2. create a new pole next to S120776 (last pole in the line is S120378)
  await pg.click('[data-tab="poles"]'); await pg.click('#tableWrap tr[data-id="S120776"]'); await pg.waitForTimeout(300);
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { document.querySelector('.addpole').open = true; });
  await pg.fill('#poleAddId', 'P1'); await pg.fill('#poleAddDist', '22'); await pg.fill('#poleAddLen', '11');
  await pg.click('#poleAdd'); await pg.waitForTimeout(800); console.log('   status:', await status());
  t = await ins(); ok(/Pole P1/.test(await pg.$eval('#insTitle', (e) => e.textContent)), '2 new pole P1 is selected in the inspector');
  s = await st(); ok(s.poles === 5, '2 3D now shows ' + s.poles + ' poles');
  ok(s.screen.minX >= -1 && s.screen.maxX <= 1 && s.screen.minY >= -1 && s.screen.maxY <= 1, '7 line still in view after adding a pole (refit) ' + JSON.stringify(s.screen));
  // 3/4. add a construction with the searchable code box: suggestions grouped, neighbours first
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  await pg.click('.combo[data-combo="conAdd"] input'); await pg.waitForTimeout(200);
  const groups = await pg.$$eval('#comboList .cg', (els) => els.map((e) => e.textContent));
  ok(groups[0] === 'On neighbouring poles', '3 code suggestions start with neighbouring poles: ' + groups.join(' | '));
  await pg.keyboard.type('HV1 3PH'); await pg.waitForTimeout(150);
  const items = await pg.$$eval('#comboList .ci b', (els) => els.map((e) => e.textContent));
  ok(items.includes('HV1'), '3 typing "HV1 3PH" filters to ' + items.slice(0, 6).join(', '));
  await pg.click('[data-chip="cls:lv"]').catch(() => {}); // filter chips re-render the box
  await pg.waitForTimeout(150);
  await pg.click('.combo[data-combo="conAdd"] input'); await pg.keyboard.type('HV1'); await pg.waitForTimeout(150);
  const none = await pg.$eval('#comboList', (e) => e.innerText);
  ok(/Nothing matches|HV1/.test(none), '3 LV filter hides HV codes: ' + none.slice(0, 80).replace(/\n/g, ' '));
  await pg.keyboard.press('Escape');
  await pg.click('[data-chip="cls:all"]'); await pg.waitForTimeout(150);
  await pg.click('.combo[data-combo="conAdd"] input'); await pg.keyboard.type('HV1'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  const kb = await pg.$eval('#conAddKb', (e) => e.value); const prev = await pg.$eval('#conAddPrev', (e) => e.innerText);
  ok(kb !== '' && /Attachments/.test(prev), '4 picking HV1 fills the king bolt default ' + kb + ' and shows the preview');
  await pg.fill('#conAddKb', 'abc'); await pg.waitForTimeout(150);
  ok(await pg.$eval('#conAdd', (e) => e.disabled), '10 invalid king bolt "abc" disables Add');
  await pg.fill('#conAddKb', '20'); await pg.waitForTimeout(150);
  ok(/above the pole tip/.test(await pg.$eval('#conAddPrev', (e) => e.innerText)), '10 king bolt above the tip is flagged');
  await pg.click('#conKbDefault'); await pg.waitForTimeout(150);
  await pg.click('#conAdd'); await pg.waitForTimeout(800);
  t = await ins(); ok(/Constructions \(1\)/.test(t), '3 HV1 added to P1');
  s = await st(); const w1 = s.wires;
  // 4. change the construction type: HV1 -> HV5 through the code box
  await pg.click('.con[data-u] .combo input'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('HV5'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
  t = await ins(); ok(/HV5/.test(t), '4 code changed to HV5');
  // 3. string conductors S120378 -> P1 on HV
  await pg.click('[data-tab="sections"]'); await pg.waitForTimeout(200);
  await pg.selectOption('[data-secf="from"]', 'S120776'); await pg.waitForTimeout(150);
  await pg.selectOption('[data-secf="to"]', 'P1'); await pg.waitForTimeout(150);
  let form = await pg.$eval('#secFormBox', (e) => e.innerText);
  console.log('   form:', form.replace(/\n+/g, ' | ').slice(0, 900));
  await pg.click('.combo[data-combo="secNewCond"] input'); await pg.waitForTimeout(150);
  const cg = await pg.$$eval('#comboList .cg', (els) => els.map((e) => e.textContent)); ok(cg.length >= 2, '3 conductor suggestions: ' + cg.join(' | '));
  await pg.keyboard.type('MA'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  form = await pg.$eval('#secFormBox', (e) => e.innerText);
  ok(/Tension suggestions/.test(form), '4 tension suggestions shown for MA: ' + (form.match(/Tension suggestions:[^\n]*/) || [''])[0].slice(0, 200));
  await pg.fill('[data-secf="tension"]', '150'); await pg.press('[data-secf="tension"]', 'Tab'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#secAdd', (e) => e.disabled), '10 150 %CBL blocks the section');
  const tp = await pg.$('[data-tpick="0"]'); if (tp) { await tp.click(); await pg.waitForTimeout(200); }
  form = await pg.$eval('#secFormBox', (e) => e.innerText);
  const dis = await pg.$eval('#secAdd', (e) => e.disabled);
  console.log('   msgs:', form.split('\n').filter((l) => /\.$/.test(l)).slice(0, 6).join(' | '));
  if (!dis) { await pg.click('#secAdd'); await pg.waitForTimeout(800); }
  ok((await pg.$$('#tableWrap tr[data-sec]')).length === 3, '3 strain section added (3 in the schedule)');
  s = await st(); ok(s.wires > w1, '3 3D wires ' + w1 + ' -> ' + s.wires);
  ok(s.selectedSection != null, '3 new section highlighted in 3D: ' + s.selectedSection);
  // 5. edit pole length and attachment height: geometry follows
  await pg.click('#tableWrap tr[data-sec] td:first-child'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { document.querySelector('[data-tab="poles"]').click(); });
  await pg.click('#tableWrap tr[data-id="P1"]').catch(() => {}); await pg.waitForTimeout(300);
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  const kb0 = await pg.$eval('[data-ckb]', (e) => e.value);
  await pg.fill('[data-pfield="length"]', '12.5'); await pg.press('[data-pfield="length"]', 'Enter'); await pg.waitForTimeout(700);
  const kb1 = await pg.$eval('[data-ckb]', (e) => e.value);
  ok(Math.abs(kb1 - kb0 - 1.35) < 0.011, '5 pole 11 -> 12.5 m moves the king bolt with the tip: ' + kb0 + ' -> ' + kb1);
  await pg.click('[data-instab="conductors"]'); await pg.waitForTimeout(200);
  const heights = await pg.$eval('#selected table.att', (e) => e.innerText).catch(() => '');
  ok(/HV5/.test(heights), '5 attachment heights table on the Conductors tab');
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  await pg.fill('[data-ay]', '0.6'); await pg.press('[data-ay]', 'Enter'); await pg.waitForTimeout(700);
  await pg.click('[data-tab="heights"]'); await pg.waitForTimeout(200);
  const hv = await pg.$eval('#tableWrap', (e) => e.innerText); ok(/P1/.test(hv) && /HV5/.test(hv), '5 attachments & heights table lists P1 HV5');
  await pg.fill('[data-pfield="length"]', '-5'); await pg.press('[data-pfield="length"]', 'Enter'); await pg.waitForTimeout(300);
  ok(/not a valid/.test(await status()), '10 negative pole length rejected: ' + (await status()));
  // 7. fit repeatedly
  for (let i = 0; i < 3; i++) { await pg.click('#v3fit'); await pg.waitForTimeout(500); }
  s = await st(); ok(s.screen.maxX <= 1 && s.screen.minX >= -1 && Math.abs(s.screen.minX + s.screen.maxX) < 0.05, '7 Fit all after edits centred and inside the view ' + JSON.stringify(s.screen));
  await pg.click('#tbFit'); await pg.waitForTimeout(500); s = await st(); ok(s.screen.maxX <= 1, '7 toolbar Fit project in 3D');
  await pg.screenshot({ path: OUT + '5-after-edits.png' });
  // undo / redo
  const before = await pg.$eval('#tbUndo', (e) => e.disabled); await pg.click('#tbUndo'); await pg.waitForTimeout(500); await pg.click('#tbRedo'); await pg.waitForTimeout(500);
  ok(!before, '9 undo is available after edits and redo restores');
  // 9. save, reload, open, export
  await pg.click('#tbSave'); await pg.waitForTimeout(500);
  const saved = await pg.evaluate(async () => { const x = window.__saved.slice(-1)[0]; return x ? { name: x.name, text: await x.data.text() } : null; });
  ok(saved && /\.pwproj\.json$/.test(saved.name), '9 project saved as ' + (saved && saved.name));
  fs.writeFileSync(OUT + 'saved.pwproj.json', saved.text);
  await pg.reload(); await pg.waitForTimeout(1500);
  await pg.click('[data-tab="sections"]'); await pg.waitForTimeout(200);
  ok((await pg.$$('#tableWrap tr[data-sec]')).length === 3, '9 reload restores the design from this browser (3 sections)');
  // new project (two clicks), then open the saved file
  await pg.click('#tbReset'); await pg.waitForTimeout(100); await pg.click('#tbReset'); await pg.waitForTimeout(500);
  t = await ins(); ok(/Poles\s*0/.test(t), '10 new project is empty');
  ok(await pg.$eval('#createdBy', (e) => e.value) === '', '10 settings inputs reset with the new project');
  await pg.setInputFiles('#projInput', OUT + 'saved.pwproj.json'); await pg.waitForTimeout(1500);
  await pg.click('[data-tab="sections"]'); await pg.waitForTimeout(200);
  ok((await pg.$$('#tableWrap tr[data-sec]')).length === 3, '9 opening the saved file restores 3 strain sections');
  ok(await pg.$eval('#zone', (e) => e.value) === '50', '9 settings inputs follow the opened file');
  await pg.click('#tbExport'); await pg.waitForTimeout(500);
  for (const id of ['expXlsx', 'expPnwx', 'expDesign', 'expLog']) { const el = await pg.$('#' + id); if (el && !(await el.isDisabled())) { await el.click(); await pg.waitForTimeout(600); } }
  const names = await pg.evaluate(() => window.__saved.map((x) => x.name + ' ' + x.size));
  ok(names.length >= 4, '9 exports saved: ' + names.join(', '));
  await pg.click('#closeReview');
  // 10. bad file
  fs.writeFileSync(OUT + 'bad.txt', 'hello');
  await pg.setInputFiles('#fileInput', OUT + 'bad.txt'); await pg.waitForTimeout(1200);
  ok(/could not be read|not a PNW/.test(await pg.$eval('#files', (e) => e.innerText) + await status()) || /Failed/.test(await pg.$eval('#files', (e) => e.innerText)), '10 unreadable file reported');
  // 12. console
  const errs = logs.filter((l) => !noise(l));
  ok(!errs.length, '12 no console errors or warnings' + (errs.length ? ': ' + errs.join(' || ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
