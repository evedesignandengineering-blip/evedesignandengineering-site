// AI photo match: the AI may list a construction once per conductor (HV1 ×3, LV1 ×4); the panel must show one construction
// per circuit, check it against the conductors counted, add only one, and show the DCSH drawing thumbnail that enlarges.
// window.claude is stubbed, so no photo leaves the machine.
const { open, D, OUT, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PHOTO = process.env.PNW_E2E_PHOTO || require('path').join(__dirname, 'pole.jpg');
const stub = () => {
  const m = (level, code, rank, confidence) => ({ level, code, rank, confidence, reasons: ['three pin insulators on one crossarm'] });
  window.claude = { use: (k) => Promise.resolve(k === 'sample' ? { json: async () => ({
    photo_quality: 'clear', components: [{ name: 'conductors', level: 'HV', count: 3, confidence: 0.9 }, { name: 'conductors', level: 'LV', count: 4, confidence: 0.9 }],
    matches: [m('HV', 'HV1', 1, 0.82), m('HV', 'HV1', 1, 0.8), m('HV', 'HV1', 1, 0.79), m('HV', 'HV5', 2, 0.35), m('LV', 'LV1', 1, 0.77), m('LV', 'LV1', 1, 0.76), m('LV', 'LV1', 1, 0.75), m('LV', 'LV1', 1, 0.74), m('LV', 'NOTACODE', 1, 0.9)],
    cautions: [] }) } : { save: async () => ({}) }) };
};
(async () => {
  const { b, pg, logs } = await open(1440, 900, stub);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.click('#tbAi'); await pg.waitForTimeout(300);
  const pole = await pg.$eval('#insTitle', (e) => e.textContent.replace('Pole ', ''));
  const before = await pg.evaluate((id) => document.querySelectorAll('#selected [data-instab="design"] .pill').length ? +document.querySelector('#selected [data-instab="design"] .pill').textContent : -1, pole);
  await pg.setInputFiles('#aiPhoto', PHOTO);
  await pg.waitForSelector('.ai-g', { timeout: 15000 });
  const g = await pg.$$eval('.ai-g', (els) => els.map((e) => ({ head: e.querySelector('.ai-gh').textContent, codes: [...e.querySelectorAll('.ai-mb > div > b')].map((x) => x.textContent), text: e.textContent })));
  ok(g.length === 2 && /^HV circuit/.test(g[0].head) && /^LV circuit/.test(g[1].head), 'grouped by circuit: ' + g.map((x) => x.head).join(' | '));
  ok(JSON.stringify(g[0].codes) === '["HV1","HV5"]', 'HV1 listed once for the three HV conductors (' + g[0].codes + ')');
  ok(JSON.stringify(g[1].codes) === '["LV1"]', 'LV1 listed once for the four LV conductors (' + g[1].codes + ')');
  ok(/3 conductors seen/.test(g[0].head) && /4 conductors seen/.test(g[1].head), 'conductor counts shown per circuit');
  ok(/listed it 3 times/.test(g[0].text) && /listed it 4 times/.test(g[1].text), 'duplicates explained');
  ok(/removed/.test(await pg.$eval('#selected', (e) => e.textContent)), 'code not in the library dropped');
  const thumbs = await pg.$$eval('.ai-g .dcsh-thumb', (els) => els.map((e) => e.dataset.dcshimg));
  ok(thumbs.includes('H01-1') && thumbs.includes('L01'), 'DCSH thumbnails beside matches: ' + thumbs.join(', '));
  await pg.screenshot({ path: OUT + 'ai-panel.png' });
  await pg.hover('.ai-g .dcsh-thumb[data-dcshimg="H01-1"]'); await pg.waitForTimeout(300);
  const pop = await pg.$eval('#dcshPop', (e) => ({ hidden: e.hidden, imgs: [...e.querySelectorAll('img')].map((i) => i.complete && i.naturalWidth > 300), text: e.textContent }));
  ok(!pop.hidden && pop.imgs.length === 2 && pop.imgs.every(Boolean) && /H01-1/.test(pop.text), 'hover enlarges the drawing beside the photo');
  await pg.screenshot({ path: OUT + 'ai-compare.png' });
  await pg.mouse.move(5, 5); await pg.waitForTimeout(200);
  ok(await pg.$eval('#dcshPop', (e) => e.hidden), 'moving away closes it');
  await pg.click('.ai-g .dcsh-thumb[data-dcshimg="L01"]'); await pg.mouse.move(5, 5); await pg.waitForTimeout(200);
  ok(await pg.$eval('#dcshPop', (e) => !e.hidden && e.classList.contains('pinned')), 'click pins it');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  ok(await pg.$eval('#dcshPop', (e) => e.hidden), 'Esc closes the pinned drawing');
  // approve LV1 as a new construction (the LV group's only option); only one construction is added
  await pg.$$eval('.ai-g', (els) => { els[1].querySelector('select[data-aitarget]').value = 'new'; });
  await (await pg.$$('.ai-g'))[1].$('[data-aiok]').then((x) => x.click()); await pg.waitForTimeout(600);
  console.log('   status: ' + await pg.$eval('#status', (e) => e.textContent));
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  const after = await pg.$eval('#selected [data-instab="design"] .pill', (e) => +e.textContent);
  ok(after === before + 1, 'approving LV1 adds exactly one construction (' + before + ' → ' + after + ')');
  await pg.click('[data-instab="photo"]'); await pg.waitForTimeout(200);
  const lv = await pg.$$eval('.ai-g', (els) => ({ btns: els[1].querySelectorAll('[data-aiok]').length, text: els[1].textContent }));
  ok(lv.btns === 0 && /already on this pole/.test(lv.text), 'LV circuit now reports LV1 already on the pole, no second approve');
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
