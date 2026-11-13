// 確認用: 指定した景の色と深度を並べた画像を作る。 usage: node tools/montage.mjs out.png 0 5 12 ...
import sharp from 'sharp';
const [out, ...ids] = process.argv.slice(2);
const W = 376, H = 248, comps = [];
for (const [i, id] of ids.entries()) {
  const n = String(id).padStart(3, '0');
  comps.push({ input: await sharp(`docs/assets/scenes/${n}.webp`).resize(W, H, { fit: 'fill' }).png().toBuffer(), left: i * W, top: 0 });
  comps.push({ input: await sharp(`docs/assets/scenes/${n}_d.png`).resize(W, H, { fit: 'fill' }).png().toBuffer(), left: i * W, top: H });
}
await sharp({ create: { width: W * ids.length, height: H * 2, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
