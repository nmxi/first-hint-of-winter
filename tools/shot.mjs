// 検証用: ヘッドレスChromeでスクリーンショットを撮る。
// usage: node tools/shot.mjs out.png "?scene=0&t=30&freeze" [width height] [waitMs]
import puppeteer from 'puppeteer-core';

const [out, query = '', w = '1280', h = '800', wait = '1500'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(`http://localhost:8123/${query}`);
await page.waitForFunction('window.__art', { timeout: 20000 }).catch(() => logs.push('timeout waiting for __art'));
await new Promise((r) => setTimeout(r, +wait));
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close();
