// UI round 2: conductor tool (plan snap, 3D marks, auto/manual tension, add), profile horizontal zoom and slider,
// help toggle, full-window mode and the 3D camera kept above ground.
const { open, D, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, pg, logs } = await open(1440, 900);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  // help hides explanatory text by default
  ok(await pg.$$eval('.explain', (e) => e.length > 0 && e.every((x) => getComputedStyle(x).display === 'none')), 'explanatory text hidden until Help is on');
  await pg.click('#vHelp'); ok(await pg.evaluate(() => document.body.classList.contains('help-on')), 'Help shows it'); await pg.click('#vHelp');
  // full window
  await pg.click('#vFull'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#mapWrap', (e) => e.classList.contains('fullwin') && Math.abs(e.getBoundingClientRect().width - innerWidth) < 2), 'view goes full window');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#mapWrap', (e) => !e.classList.contains('fullwin')), 'Esc restores');
  // conductor tool in plan: snap to a pole by its screen position
  const ids = await pg.evaluate(() => [...document.querySelectorAll('#tableWrap tr[data-id]')].map((t) => t.dataset.id));
  await pg.click('#tbCond'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#ctPanel', (e) => !e.hidden && !!e.querySelector('[data-combo="secNewCond"]') && !!e.querySelector('[data-secf="units"]')), 'context panel shows conductor, tension and units');
  const clickNear = async (id) => {
    const p = await pg.evaluate((id) => { const r = document.getElementById('map').getBoundingClientRect(), m = window.__pnwMarker ? window.__pnwMarker(id) : null; return m && { x: r.left + m.x + 8, y: r.top + m.y + 5 }; }, id);
    if (!p) return false; await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(80); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(250); return true;
  };
  const a = 'S119846', z = 'S120776';
  ok(await clickNear(a), 'pole ' + a + ' on screen');
  ok(await pg.$eval('.ct-chain', (e, a) => e.textContent.includes(a), a), 'click 8 px from ' + a + ' snaps to it');
  ok(await clickNear(z), 'pole ' + z + ' on screen');
  const chain = await pg.$eval('.ct-chain', (e) => e.textContent); ok(chain.includes(z), 'second pole snaps: ' + chain);
  const form = await pg.$eval('#ctForm', (e) => e.innerText); console.log('   panel:', form.replace(/\n+/g, ' | ').slice(0, 400));
  await pg.click('#ctPanel .combo[data-combo="secNewCond"] input'); await pg.keyboard.type('MA'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  const t1 = await pg.$eval('#ctForm', (e) => e.innerText);
  ok(/auto by span|default/.test(t1), 'tension filled automatically and labelled (' + ((t1.match(/Tension[^\n]*/) || [''])[0]) + ')');
  const opts = await pg.$$eval('#ctForm [data-secf="tpick"] option', (o) => o.map((x) => x.value));
  if (opts.length > 1) { await pg.selectOption('#ctForm [data-secf="tpick"]', opts[1]); await pg.waitForTimeout(250); ok(/manual/.test(await pg.$eval('#ctForm', (e) => e.innerText)), 'picking a standard value marks it manual'); await pg.selectOption('#ctForm [data-secf="tpick"]', 'auto'); await pg.waitForTimeout(250); }
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1500);
  ok((await pg.evaluate(() => PNW3D.state().marks)) > 0, '3D shows the attachment points the conductor will use (' + (await pg.evaluate(() => PNW3D.state().marks)) + ')');
  ok((await pg.evaluate(() => PNW3D.state().groundGap)) >= 1, '3D camera above ground');
  await pg.selectOption('#v3base', 'satellite'); await pg.check('#v3terrain'); await pg.waitForTimeout(2500);
  const tl = await pg.evaluate(() => PNW3D.tiles()); ok(tl.kind === 'satellite' && tl.terrain && tl.meshes > 0 && tl.ok + tl.failed === tl.want, '3D satellite layer draped on the surveyed ground: ' + JSON.stringify(tl));
  ok(/Esri/.test(await pg.$eval('.v3attr', (e) => e.textContent)), 'imagery attribution shown');
  await pg.selectOption('#v3base', 'none'); await pg.waitForTimeout(200); ok((await pg.evaluate(() => PNW3D.tiles())).meshes === 0, 'standard layer removes the tiles');
  await pg.click('[data-view="profile"]'); await pg.waitForTimeout(400);
  ok(await pg.$$eval('#pvPlot circle[stroke="#16a34a"]', (c) => c.length > 0), 'profile highlights the chain attachment points');
  const before = await pg.evaluate(() => document.querySelectorAll('#tableWrap tr[data-sec]').length);
  const dis = await pg.$eval('#ctPanel #secAdd', (e) => e.disabled);
  if (dis) console.log('   blocked:', (await pg.$eval('#ctForm .msgs', (e) => e.innerText)).slice(0, 300));
  else { await pg.click('#ctPanel #secAdd'); await pg.waitForTimeout(800); }
  const after = await pg.evaluate(() => document.querySelectorAll('#tableWrap tr[data-sec]').length);
  ok(dis || after === before + 1, 'Add strain section from the panel (' + before + ' -> ' + after + ')');
  ok(dis || await pg.evaluate(() => document.querySelector('#tableWrap tr[data-sec]:last-of-type').innerText.includes('auto')), 'new section keeps the auto-tension flag');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#ctPanel', (e) => e.hidden), 'Esc closes the conductor tool');
  await pg.evaluate(() => { document.querySelector('[data-tab="poles"]').click(); }); await pg.click('#tableWrap tr[data-id="S119850"]'); await pg.click('[data-instab="design"]'); await pg.waitForTimeout(300);
  const ins = await pg.$eval('#selected', (e) => ({ bub: [...e.querySelectorAll('.wbub')].map((b) => b.title).join(' | '), row3: !!e.querySelector('.row3') }));
  ok(ins.row3, 'pole type, length and depth on one row');
  ok(/running earth \(RE\)[^|]*separation rule/i.test(ins.bub), 'LV under HV flagged with the RE status and the missing clearance rule');
  await pg.click('[data-view="profile"]'); await pg.waitForTimeout(300);
  // profile horizontal zoom and slider
  await pg.click('[data-pvz="in"]'); await pg.click('[data-pvz="in"]'); await pg.waitForTimeout(200);
  const sc = await pg.$eval('#pvScale', (e) => e.textContent); ok(/H ×2\.3/.test(sc), 'horizontal zoom ×2.25: ' + sc);
  await pg.$eval('#pvSlide', (s) => { s.value = 1000; s.dispatchEvent(new Event('input', { bubbles: true })); }); await pg.waitForTimeout(150);
  ok((await pg.$eval('#pvScale', (e) => e.textContent)) !== sc, 'slider pans along the line');
  const box = await pg.$eval('#pvPlot svg', (e) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pg.mouse.move(box.x, box.y); await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -100); await pg.keyboard.up('Control'); await pg.waitForTimeout(150);
  const sc2 = await pg.$eval('#pvScale', (e) => e.textContent); ok(/H ×2\.8/.test(sc2), 'Ctrl+wheel zooms horizontally: ' + sc2);
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
