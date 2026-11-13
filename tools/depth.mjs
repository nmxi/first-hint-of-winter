// 各景の深度マップを Depth Anything V2 で推定する。 usage: node tools/depth.mjs [model]
import { pipeline, RawImage, env } from '@huggingface/transformers';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

env.cacheDir = '.cache';
const DIR = 'docs/assets/scenes';
const model = process.argv[2] || 'onnx-community/depth-anything-v2-base';
const estimator = await pipeline('depth-estimation', model, { dtype: 'fp32' });

const files = fs.readdirSync(DIR).filter(f => /^\d+\.webp$/.test(f)).sort();
for (const f of files) {
  const p = path.join(DIR, f);
  const { data, info } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
  const { predicted_depth } = await estimator(image);
  // predicted_depth: 相対的な逆深度(大きいほど手前)。0..255 に正規化して保存
  const d = predicted_depth.data;
  const dims = predicted_depth.dims; const h = dims.at(-2), w = dims.at(-1);
  let mn = Infinity, mx = -Infinity;
  for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const buf = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) buf[i] = Math.round(255 * (d[i] - mn) / (mx - mn || 1));
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .resize(info.width, info.height, { kernel: 'cubic' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(DIR, f.replace('.webp', '_d.png')));
  process.stdout.write('.');
}
console.log('\ndone', files.length);
