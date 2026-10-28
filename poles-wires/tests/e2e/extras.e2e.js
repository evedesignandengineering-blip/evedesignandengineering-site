// Stays and transformers (defaults from DCSH and the PNW tipload fields), selected-pole glow, AI panel minimise / close,
// and a Street View snip pasted into the AI photo panel. window.claude is stubbed, so no image leaves the machine.
const { open, D, OUT, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const stub = () => {
  window.claude = { use: (k) => Promise.resolve(k === 'sample' ? { json: async () => ({ photo_quality: 'ok', components: [{ name: 'conductors', level: 'HV', count: 3, confidence: 0.9 }],
    matches: [{ level: 'HV', code: 'HV5', rank: 1, confidence: 0.8, reasons: [] }], cautions: [] }) } : { save: async () => ({}) }) };
};
(async () => {
  const { b, pg, logs } = await open(1440, 900, stub);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'Export (13).xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.querySelector('#tableWrap [data-id="S119846"]').click()); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => PNW3D.state().glow), 'selected pole glows in 3D');
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(300);
  await pg.click('[data-xadd="stay"]'); await pg.waitForTimeout(300);
  const st = await pg.$$eval('.xrow', (r) => [...r[0].querySelectorAll('input,select')].map((i) => i.value));
  ok(st[0] === '19/2.00SCG' && Math.abs(+st[1] - 7.84) < 0.001 && +st[3] === 45, 'stay defaults: PNW library wire, 300 mm below the top king bolt (8.14 − 0.30), 45° (' + st.join(', ') + ')');
  ok(+st[2] > 90 && +st[2] < 180, 'stay points away from the line (bearing ' + st[2] + '°; the line runs north-west)');
  await pg.click('[data-xadd="plant"]'); await pg.waitForTimeout(300);
  const pl = await pg.$$eval('.xrow', (r) => [...r[1].querySelectorAll('input,select')].map((i) => i.value));
  ok(pl[1] === 'H11-1' && Math.abs(+pl[2] - (9.3 - 1.86)) < 0.001, 'termination pole gets the H11-1 transformer hanger 1.86 m below the tip (' + pl.join(', ') + ')');
  await pg.selectOption('.xrow:nth-of-type(2) select[data-xf$="drawing"]', 'H10-1').catch(async () => { await pg.$$eval('select[data-xf$="drawing"]', (s) => { s[0].value = 'H10-1'; s[0].dispatchEvent(new Event('change', { bubbles: true })); }); });
  await pg.waitForTimeout(300);
  ok(Math.abs(+(await pg.$eval('input[data-xf="plant|0|attHt"]', (i) => i.value)) - (9.3 - 3.115)) < 0.001, 'switching to H10-1 moves the hanger to 3.115 m below the tip');
  await pg.fill('input[data-xf="stays|0|angle"]', '95'); await pg.press('input[data-xf="stays|0|angle"]', 'Enter'); await pg.waitForTimeout(300);
  ok(/valid stay angle/.test(await pg.$eval('#status', (e) => e.textContent)), 'invalid stay angle rejected');
  let s3 = await pg.evaluate(() => PNW3D.state()); ok(s3.stays === 1 && s3.plant === 1, 'stay and transformer drawn in 3D');
  await pg.click('#tbUndo'); await pg.waitForTimeout(300); s3 = await pg.evaluate(() => PNW3D.state()); ok(s3.plant === 1, 'undo steps back one change');
  // AI: paste a snip, then minimise and close
  await pg.click('[data-instab="photo"]'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#selected', (e) => /google\.com\/maps\/@\?api=1&map_action=pano&viewpoint=-3\d\.\d+,11\d\.\d+/.test([...e.querySelectorAll('a')].map((a) => a.href).join(' '))), 'Street View link at the pole position');
  await pg.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 400; c.getContext('2d').fillRect(0, 0, 300, 400);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([blob], 'snip.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await pg.waitForSelector('.ai-g', { timeout: 15000 });
  await pg.click('[data-aimin]'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#selected', (e) => !!e.querySelector('.con.ai.min') && !e.querySelector('.ai-g') && /HV: HV5/.test(e.textContent)), 'minimise collapses the AI panel to a one-line summary');
  await pg.click('[data-aimin]'); await pg.waitForTimeout(200);
  ok(await pg.$$eval('.ai-g', (g) => g.length === 1), 'expand shows the results again');
  await pg.click('[data-aiclose]'); await pg.waitForTimeout(200);
  ok(await pg.$eval('#selected', (e) => !e.querySelector('.ai-g') && !!e.querySelector('#aiPhoto')), 'close clears the AI results');
  ok(!logs.filter((l) => !noise(l)).length, 'console clean ' + logs.filter((l) => !noise(l)).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
