// LV added under HV takes its king bolt from the HV/LV/RE separation rule when one is loaded (not 0.45 m below the HV),
// and the profile zooms out past the whole line in both directions.
const { open, D } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { b, pg } = await open(1440, 900);
  await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'gis-conductors/Export 15 - poles.xlsx', 'gis-conductors/Export 13 - LV overhead conductors.xlsx', 'gis-conductors/Export 14 - HV overhead conductors.xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
  await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(500);
  await pg.click('[data-tab="poles"]'); await pg.click('#tableWrap tr[data-id="S120776"]'); await pg.waitForTimeout(300);
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { document.querySelector('.addpole').open = true; });
  await pg.fill('#poleAddId', 'P1'); await pg.fill('#poleAddDist', '22'); await pg.fill('#poleAddLen', '11');
  await pg.click('#poleAdd'); await pg.waitForTimeout(800);
  await pg.click('[data-instab="design"]'); await pg.waitForTimeout(200);
  const add = async (code) => { await pg.click('.combo[data-combo="conAdd"] input'); await pg.keyboard.press('Control+A'); await pg.keyboard.type(code); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); return pg.$eval('#conAddKb', (e) => e.value); };
  const hv = await add('HV1'); await pg.click('#conAdd'); await pg.waitForTimeout(800);
  const re = await add('RE1');
  const lv = await add('LV1'), prev = await pg.$eval('#conAddPrev', (e) => e.innerText);
  console.log('   HV1 ' + hv + ', LV1 ' + lv);
  console.log('   RE1 ' + re);
  // PNW_RULE: path to the private separation rule JSON (also passed in PNW_E2E_EXTRA); the expected gap is read from it.
  const R = process.env.PNW_RULE ? JSON.parse(require('fs').readFileSync(process.env.PNW_RULE, 'utf8')) : null;
  const gap = R ? (R.hvToRe['H01-1'].mm + R.noRe['default'].mm) / 1000 : null;
  if (R) ok(Math.abs(+re - (+hv - R.hvToRe['H01-1'].mm / 1000)) < 0.001, 'RE1 default ' + re + ' m from the HV drawing distance');
  ok(R ? Math.abs(+lv - (+hv - gap)) < 0.001 : +lv > 0, 'LV1 default ' + lv + ' m under HV1 ' + hv + ' m' + (R ? ' = ' + gap + ' m below by the separation rule' : ''));
  await pg.click('[data-view="profile"]').catch(() => {}); await pg.waitForTimeout(500);
  const sc = () => pg.$eval('#pvScale', (e) => e.textContent);
  await pg.click('[data-pvz="fit"]'); await pg.waitForTimeout(200); const s0 = await sc();
  await pg.click('[data-pvz="out"]'); await pg.waitForTimeout(200); await pg.click('[data-pvz="out"]'); await pg.waitForTimeout(200); const s1 = await sc();
  console.log('   ' + s0 + ' -> ' + s1);
  ok(s1 !== s0 && /×0\.\d\d/.test(s1), 'zoom out goes past the whole line');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exitCode = fails ? 1 : 0;
})();
