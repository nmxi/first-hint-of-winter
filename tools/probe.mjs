// usage: node tools/probe.mjs  -- measures fps/build time and captures transitions
import puppeteer from 'puppeteer-core';
const S = process.argv[2];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const mode of [0, 1, 2]) {
  await page.goto(`http://localhost:8123/?scene=${9 + mode * 9}&t=69&mode=${mode}&mx=0&my=0`);
  await page.waitForFunction('window.__art');
  for (const [i, ms] of [[0, 4500], [1, 3500], [2, 6000]]) { await wait(ms); await page.screenshot({ path: `${S}/tr_${mode}_${i}.png` }); }
  const info = await page.evaluate(() => ({ idx: __art.seq.idx, dying: __art.seq.dying.length, t: __art.seq.cur.t, count: __art.seq.cur.gpu.count }));
  console.log('mode', mode, JSON.stringify(info));
}
// fps and build time
await page.goto('http://localhost:8123/?scene=3&t=65');
await page.waitForFunction('window.__art');
const perf = await page.evaluate(async () => {
  const m = await import('./js/strokes.js');
  const img = new Image(); img.src = 'assets/scenes/000.webp'; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const t0 = performance.now(); const s = m.buildStrokes(d.data, d.data, c.width, c.height, 60, 1); const build = performance.now() - t0;
  let frames = 0; const start = performance.now();
  await new Promise((r) => { const f = () => { frames++; performance.now() - start < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  const gl = __art.renderer.gl; const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { buildMs: Math.round(build), strokes: s.count, fps: Math.round(frames / 3), gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
});
console.log(JSON.stringify(perf));
await browser.close();
