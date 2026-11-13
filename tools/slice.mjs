// シート(4x4タイル)を1景ずつ切り出す。 usage: node tools/slice.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'source', OUT = 'docs/assets/scenes';
fs.mkdirSync(OUT, { recursive: true });
const sheets = fs.readdirSync(SRC).filter(f => f.endsWith('.png')).sort();

// 白い罫線の範囲を探す: 期待位置の近くで「ほぼ白」の列/行が続く区間
function findGaps(lineWhiteness, n, expectedStep) {
  const gaps = [];
  for (let k = 1; k < 4; k++) {
    const c = Math.round(k * expectedStep);
    let best = -1, bestV = 0;
    for (let i = c - 8; i <= c + 8; i++) if (lineWhiteness[i] > bestV) { bestV = lineWhiteness[i]; best = i; }
    let a = best, b = best;
    const th = Math.max(0.6, bestV * 0.8);
    while (a > 0 && lineWhiteness[a - 1] >= th) a--;
    while (b < n - 1 && lineWhiteness[b + 1] >= th) b++;
    gaps.push(bestV > 0.6 ? [a, b] : [c, c - 1]); // 罫線なしなら幅0
  }
  return gaps;
}

let id = 0;
const report = [];
for (const [si, f] of sheets.entries()) {
  const img = sharp(path.join(SRC, f));
  const { data, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const colW = new Float32Array(W), rowW = new Float32Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * C;
    const white = data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235 ? 1 : 0;
    colW[x] += white / H; rowW[y] += white / W;
  }
  const gx = findGaps(colW, W, W / 4), gy = findGaps(rowW, H, H / 4);
  const xs = [[0, gx[0][0]], [gx[0][1] + 1, gx[1][0]], [gx[1][1] + 1, gx[2][0]], [gx[2][1] + 1, W]];
  const ys = [[0, gy[0][0]], [gy[0][1] + 1, gy[1][0]], [gy[1][1] + 1, gy[2][0]], [gy[2][1] + 1, H]];
  report.push({ sheet: f, gx, gy });
  const INSET = 4;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const left = xs[c][0] + INSET, top = ys[r][0] + INSET;
    const width = xs[c][1] - xs[c][0] - INSET * 2, height = ys[r][1] - ys[r][0] - INSET * 2;
    const name = String(id).padStart(3, '0');
    await img.clone().extract({ left, top, width, height }).webp({ quality: 92 }).toFile(path.join(OUT, `${name}.webp`));
    id++;
  }
}
console.log(JSON.stringify(report));
console.log('scenes:', id);
