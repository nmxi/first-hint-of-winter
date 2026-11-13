// 検証用: 早送りで全景を一巡させ、順番・エラー・メモリを確認する。 usage: node tools/soak.mjs
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:8123/?speed=40');
await page.waitForFunction('window.__art');
const seen = [];
let heap0 = 0;
for (let i = 0; i < 130; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => ({ idx: __art.seq.idx, dying: __art.seq.dying.length, heap: performance.memory?.usedJSHeapSize || 0, scale: __art.renderer.scale || 1 }));
  if (seen.at(-1)?.idx !== s.idx) seen.push(s);
  if (i === 10) heap0 = s.heap;
  if (seen.length > 56) break;
}
const idxs = seen.map((s) => s.idx);
const inOrder = idxs.every((v, i) => i === 0 || v === (idxs[i - 1] + 1) % 52);
console.log('visited', idxs.length, 'in order:', inOrder, 'max dying:', Math.max(...seen.map((s) => s.dying)));
console.log('heap MB early/late:', (heap0 / 1e6).toFixed(1), (seen.at(-1).heap / 1e6).toFixed(1), 'scale:', seen.at(-1).scale);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
