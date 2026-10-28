// Browser end-to-end helpers (Playwright). The page under test is PNW_E2E_URL (the private build serves window.PNW_ARTIFACT,
// so saves are captured through a stubbed window.claude). PNW_CDN_MODULES, if set, is a node_modules folder used to serve
// leaflet, proj4, xlsx, jszip and three offline instead of the CDNs.
const { chromium } = require('playwright');
const NM = process.env.PNW_CDN_MODULES ? process.env.PNW_CDN_MODULES.replace(/\/?$/, '/') : null;
const MAP = NM && { 'leaflet@1.9.4/dist/leaflet.js': NM + 'leaflet/dist/leaflet.js', 'proj4js/2.12.1/proj4.js': NM + 'proj4/dist/proj4.js', 'xlsx@0.18.5/dist/xlsx.full.min.js': NM + 'xlsx/dist/xlsx.full.min.js', 'jszip@3.10.1/dist/jszip.min.js': NM + 'jszip/dist/jszip.min.js', 'three@0.160.0/build/three.module.js': NM + 'three/build/three.module.js' };
exports.URL = process.env.PNW_E2E_URL;
exports.D = (process.env.PNW_FIXTURES || '/mnt/project-files').replace(/\/?$/, '/');
exports.OUT = process.env.PNW_E2E_OUT || require('os').tmpdir() + '/';
exports.open = async function (w, h, init) {
  if (!exports.URL) throw new Error('Set PNW_E2E_URL to the page to test, e.g. http://localhost:8766/index.html');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: w || 1440, height: h || 900 } });
  if (MAP) await ctx.route(/^https?:\/\/(?!localhost)/, (r) => { const u = r.request().url(), k = Object.keys(MAP).find((x) => u.includes(x)); if (k) return r.fulfill({ path: MAP[k], contentType: 'application/javascript' }); const m = u.match(/three@0\.160\.0\/examples\/jsm\/(.*)$/); if (m) return r.fulfill({ path: NM + 'three/examples/jsm/' + m[1], contentType: 'application/javascript' }); return r.abort(); });
  if (init) await ctx.addInitScript(init);
  const pg = await ctx.newPage(), logs = [];
  pg.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ' ' + m.text()); });
  await pg.goto(exports.URL); await pg.waitForTimeout(500);
  return { b, ctx, pg, logs };
};
// Console noise that is not from the page: software-GL stalls in headless Chromium and blocked web fonts.
exports.noise = (l) => /GPU stall|ERR_FAILED/.test(l);
