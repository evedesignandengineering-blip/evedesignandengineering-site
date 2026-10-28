// Desktop resolutions: no page overflow, panels fit; wire click selects the section; screenshots of each layout.
const { open, D, OUT, noise } = require('./lib.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
    const { b, pg, logs } = await open(w, h);
    await pg.setInputFiles('#fileInput', ['QLINK .xlsx', 'gis-conductors/Export 15 - poles.xlsx', 'Ground Profile - MP219050.pnwx'].map((f) => D + f));
    await pg.waitForFunction(() => /Imported/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    await pg.click('[data-view="3d"]'); await pg.waitForTimeout(1200);
    await pg.click('#tableWrap tr[data-id="S120776"]'); await pg.waitForTimeout(500);
    await pg.click('[data-instab="design"]'); await pg.waitForTimeout(300);
    const m = await pg.evaluate(() => {
      const de = document.documentElement, bad = [];
      document.querySelectorAll('.panel, .toolbar, .top').forEach((el) => { const r = el.getBoundingClientRect(); if (r.right > de.clientWidth + 1) bad.push(el.id || el.className); });
      // elements wider than their scroll container inside the inspector
      const ins = document.getElementById('selected'); if (ins.scrollWidth > ins.clientWidth + 1) bad.push('inspector scrolls sideways ' + ins.scrollWidth + '>' + ins.clientWidth);
      const vh = document.querySelector('.viewhead').getBoundingClientRect().height;
      return { sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight, ch: de.clientHeight, bad, vh, ws: document.getElementById('workspace').getBoundingClientRect().bottom };
    });
    ok(m.sw <= m.cw && !m.bad.length, w + 'x' + h + ' no horizontal overflow ' + JSON.stringify(m));
    await pg.screenshot({ path: OUT + 'res-' + w + '.png' });
    if (w === 1440) {
      const s = await pg.evaluate(() => PNW3D.state()), box = await pg.$eval('#v3host', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y]; });
      await pg.click('[data-cam="side"]'); await pg.waitForTimeout(800);
      const s2 = await pg.evaluate(() => PNW3D.state());
      await pg.mouse.click(box[0] + s2.wireAt.x, box[1] + s2.wireAt.y); await pg.waitForTimeout(400);
      const s3 = await pg.evaluate(() => PNW3D.state());
      ok(s3.selectedSection === s2.wireAt.segment, 'clicking a wire selects its strain section ' + s3.selectedSection + ' (inspector tab: ' + (await pg.$eval('.instabs .on', (e) => e.textContent)) + ')');
      await pg.screenshot({ path: OUT + 'wire-select.png' });
      // collapse panels, resize the inspector by dragging its gutter
      await pg.click('#tbSide'); await pg.click('#tbDock'); await pg.waitForTimeout(400);
      const v1 = await pg.$eval('#v3host', (e) => e.clientWidth + 'x' + e.clientHeight);
      await pg.screenshot({ path: OUT + 'collapsed.png' });
      await pg.click('#tbSide'); await pg.click('#tbDock'); await pg.waitForTimeout(300);
      const g = await pg.$eval('.gutter.gr', (e) => { const r = e.getBoundingClientRect(); return [r.x + 3, r.y + r.height / 2]; });
      const w0 = await pg.$eval('#inspector', (e) => e.clientWidth);
      await pg.mouse.move(g[0], g[1]); await pg.mouse.down(); await pg.mouse.move(g[0] - 120, g[1], { steps: 5 }); await pg.mouse.up(); await pg.waitForTimeout(300);
      const w1 = await pg.$eval('#inspector', (e) => e.clientWidth);
      ok(w1 > w0 + 100, 'dragging the gutter widens the inspector ' + w0 + ' -> ' + w1 + '; collapsed viewport ' + v1);
    }
    const errs = logs.filter((l) => !noise(l)); ok(!errs.length, w + ' console clean ' + errs.join(' | '));
    await b.close();
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exitCode = fails ? 1 : 0;
})();
