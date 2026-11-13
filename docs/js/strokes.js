// 色画像と深度マップから「筆致」の列を作る。
// 画家の手順にならい、淡い下塗り → 重ね塗り → 形 → 細部 の順に描かれる時刻を割り当てる。

export const STRIDE = 9; // x, y, depth, size, angle, elong, seed, soft, birth
const PAPER = [244, 239, 229];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxBlur(src, W, H, r, passes = 2) {
  let a = src;
  const norm = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = y * W; let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = sum * norm;
        sum += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = sum * norm;
        sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    a = out;
  }
  return a;
}

// 深度の境界をくっきりさせる(中間の深度を持つ筆致が宙に浮くのを防ぐ)
function sharpenDepth(d, W, H, iterations = 2) {
  let a = d;
  for (let it = 0; it < iterations; it++) {
    const out = new Float32Array(a);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let mn = 1, mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = a[i + dy * W + dx]; if (v < mn) mn = v; if (v > mx) mx = v;
      }
      if (mx - mn > 0.05) out[i] = (a[i] - mn < mx - a[i]) ? mn : mx;
    }
    a = out;
  }
  return a;
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * @param {Uint8ClampedArray} rgba 色画像 (RGBA)
 * @param {Uint8ClampedArray} depthRGBA 深度画像 (RGBA, Rのみ使用。明るいほど手前)
 * @param {number} paint 描き上げにかける秒数
 */
export function buildStrokes(rgba, depthRGBA, W, H, paint, seedNum = 1) {
  const rng = mulberry32(seedNum * 7919 + 13);
  const N = W * H;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), lum = new Float32Array(N);
  let depth = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    R[i] = rgba[i * 4]; G[i] = rgba[i * 4 + 1]; B[i] = rgba[i * 4 + 2];
    lum[i] = (0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]) / 255;
    depth[i] = depthRGBA[i * 4] / 255;
  }
  depth = sharpenDepth(depth, W, H);

  const blur = (r) => [boxBlur(R, W, H, r), boxBlur(G, W, H, r), boxBlur(B, W, H, r)];
  const cWash = blur(9), cWash2 = blur(4), cMid = blur(1), cRaw = [R, G, B];

  // 構造テンソルで筆の向き(輪郭に沿う方向)を求める
  const l1 = boxBlur(lum, W, H, 1, 1);
  const jxx = new Float32Array(N), jxy = new Float32Array(N), jyy = new Float32Array(N), gm = new Float32Array(N);
  let gmSum = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = l1[i + 1] - l1[i - 1], gy = l1[i + W] - l1[i - W];
    jxx[i] = gx * gx; jxy[i] = gx * gy; jyy[i] = gy * gy;
    gm[i] = Math.sqrt(gx * gx + gy * gy); gmSum += gm[i];
  }
  const gmMean = gmSum / N + 1e-6;
  const Jxx = boxBlur(jxx, W, H, 3, 1), Jxy = boxBlur(jxy, W, H, 3, 1), Jyy = boxBlur(jyy, W, H, 3, 1);

  const HAND = -0.5; // 画家の手癖の向き(ラジアン)
  const at = (px, py) => Math.min(H - 1, Math.max(0, Math.round(py))) * W + Math.min(W - 1, Math.max(0, Math.round(px)));

  // 手前の物の縁の内側について、近くにある「奥の画素」を探しておく。
  // 視点を変えたとき手前の物の裏が見えるので、そこにも背景を塗っておくため。
  const RB = 10, idxH = new Int32Array(N), far = new Int32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = y * W + x;
    for (let k = Math.max(0, x - RB); k <= Math.min(W - 1, x + RB); k++) if (depth[y * W + k] < depth[best]) best = y * W + k;
    idxH[y * W + x] = best;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = idxH[y * W + x];
    for (let k = Math.max(0, y - RB); k <= Math.min(H - 1, y + RB); k++) { const j = idxH[k * W + x]; if (depth[j] < depth[best]) best = j; }
    far[y * W + x] = best;
  }

  function makeStroke(px, py, spec, colorSrc, srcIdx = -1) {
    const i = srcIdx >= 0 ? srcIdx : at(px, py);
    let r = colorSrc[0][i], g = colorSrc[1][i], b = colorSrc[2][i];
    const l = lum[i], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    // 紙の白を残す: ごく明るく彩度の低い所は塗らないことがある
    if (spec.leaveWhite && rng() < smooth(0.84, 0.97, l) * (1 - Math.min(1, sat * 4)) * spec.leaveWhite) return null;
    if (spec.tint) { r += (PAPER[0] - r) * spec.tint; g += (PAPER[1] - g) * spec.tint; b += (PAPER[2] - b) * spec.tint; }
    if (spec.jitter) { const j = 1 + (rng() - 0.5) * spec.jitter; r *= j; g *= j; b *= j; }
    // 向き
    const a = Jxx[i], c = Jyy[i], bxy = Jxy[i];
    const coh = Math.sqrt((a - c) * (a - c) + 4 * bxy * bxy) / (a + c + 1e-7);
    const strength = Math.min(1, coh * smooth(0.3, 2.0, gm[i] / gmMean)) * (spec.follow ?? 1);
    const tangent = 0.5 * Math.atan2(2 * bxy, a - c) + Math.PI / 2;
    const hand = HAND + (rng() - 0.5) * 1.2;
    // 画像座標は y が下向きなので、描画側(y上向き)では符号を反転
    const angle = -(strength > 0.25 ? tangent + (rng() - 0.5) * 0.3 : hand);
    return {
      px, py, d: depth[i],
      size: spec.radius * (0.75 + rng() * 0.5),
      angle, elong: 1 + spec.elong * (0.4 + 0.6 * strength),
      seed: rng(), soft: spec.soft,
      r, g, b, a: spec.alpha * (0.85 + rng() * 0.15), birth: 0,
    };
  }

  function gridLayer(spec, colorSrc) {
    const list = [];
    for (let y = spec.step / 2; y < H + spec.step / 2; y += spec.step)
      for (let x = spec.step / 2; x < W + spec.step / 2; x += spec.step) {
        const s = makeStroke(x + (rng() - 0.5) * spec.step, y + (rng() - 0.5) * spec.step, spec, colorSrc);
        if (s) list.push(s);
      }
    return list;
  }

  // 筆が画面を移動していく順(奥のものから、近くの場所を続けて)に描く時刻を割り当てる
  function schedule(list, cell, t0, t1) {
    const cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
    const cells = [];
    for (let i = 0; i < cw * ch; i++) cells.push({ items: [], d: 0, cx: i % cw, cy: (i / cw) | 0 });
    for (const s of list) {
      const c = cells[Math.min(ch - 1, Math.max(0, (s.py / cell) | 0)) * cw + Math.min(cw - 1, Math.max(0, (s.px / cell) | 0))];
      c.items.push(s); c.d += s.d;
    }
    let rest = cells.filter(c => c.items.length);
    if (!rest.length) return;
    for (const c of rest) c.d /= c.items.length;
    let cur = rest.reduce((a, b) => (b.d < a.d ? b : a), rest[0]);
    let done = 0; const total = list.length, span = t1 - t0;
    while (rest.length) {
      let minD = 1; for (const c of rest) if (c.d < minD) minD = c.d;
      let best = null, bestCost = Infinity;
      for (const c of rest) {
        const cost = Math.hypot(c.cx - cur.cx, c.cy - cur.cy) + 22 * (c.d - minD) + rng() * 0.8;
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      cur = best; rest = rest.filter(c => c !== best);
      const n = best.items.length, dur = span * n / total;
      // セル内は筆を一方向に動かしたように並べる
      const dir = rng() * Math.PI * 2, dx = Math.cos(dir), dy = Math.sin(dir);
      best.items.sort((p, q) => (p.px * dx + p.py * dy) - (q.px * dx + q.py * dy));
      for (let k = 0; k < n; k++) best.items[k].birth = t0 + span * done / total + dur * (k / n) + rng() * Math.max(0.05, dur * 0.5);
      done += n;
    }
  }

  const layers = [];
  // 1. ごく淡い下塗り
  const wash1 = gridLayer({ step: 16, radius: 25, soft: 1, alpha: 0.5, elong: 0.5, tint: 0.3, follow: 0, leaveWhite: 0.5 }, cWash);
  schedule(wash1, 48, 0.0 * paint, 0.11 * paint); layers.push(wash1);
  // 2. 色を重ねる
  const wash2 = gridLayer({ step: 9, radius: 13.5, soft: 0.75, alpha: 0.55, elong: 0.6, tint: 0.1, jitter: 0.08, follow: 0.5, leaveWhite: 0.7 }, cWash2);
  schedule(wash2, 40, 0.09 * paint, 0.25 * paint); layers.push(wash2);
  // 2.5 手前の物の裏側になる所へ、背景の色を先に塗っておく
  const under = [];
  const underSpec = { radius: 5.6, soft: 0.5, alpha: 0.92, elong: 0.4, follow: 0 };
  for (let y = 1.5; y < H; y += 3) for (let x = 1.5; x < W; x += 3) {
    const px = x + (rng() - 0.5) * 3, py = y + (rng() - 0.5) * 3, i = at(px, py);
    if (depth[i] - depth[far[i]] > 0.1) under.push(makeStroke(px, py, underSpec, cRaw, far[i]));
  }
  schedule(under, 32, 0.2 * paint, 0.4 * paint); layers.push(under);
  // 3. 形を取る
  const mid = gridLayer({ step: 4, radius: 5.4, soft: 0.35, alpha: 0.8, elong: 1.0, jitter: 0.1, leaveWhite: 0.8 }, cMid);
  schedule(mid, 32, 0.22 * paint, 0.54 * paint); layers.push(mid);
  // 4. 細部
  const detail = gridLayer({ step: 2, radius: 2.7, soft: 0.25, alpha: 0.88, elong: 0.8, jitter: 0.06, leaveWhite: 0.85 }, cRaw);
  schedule(detail, 24, 0.47 * paint, 0.83 * paint); layers.push(detail);
  // 5. 輪郭や細い枝など、変化の大きい所にだけ細筆を入れる
  const fine = [];
  const fineSpec = { radius: 1.45, soft: 0.3, alpha: 0.95, elong: 0.7, leaveWhite: 0.6 };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = Math.min(1, 0.06 + gm[y * W + x] / (gmMean * 3.2));
    if (rng() < p) { const s = makeStroke(x + rng() - 0.5, y + rng() - 0.5, fineSpec, cRaw); if (s) fine.push(s); }
  }
  schedule(fine, 24, 0.74 * paint, 1.0 * paint); layers.push(fine);

  // 描画順: 層ごと、層の中では奥から手前
  let count = 0; for (const l of layers) { l.sort((p, q) => p.d - q.d); count += l.length; }
  const data = new Float32Array(count * STRIDE), colors = new Uint8Array(count * 4);
  const half = H / 2; let k = 0;
  for (const l of layers) for (const s of l) {
    const o = k * STRIDE;
    data[o] = (s.px - W / 2) / half; data[o + 1] = -(s.py - H / 2) / half; data[o + 2] = s.d;
    data[o + 3] = s.size / half; data[o + 4] = s.angle; data[o + 5] = s.elong;
    data[o + 6] = s.seed; data[o + 7] = s.soft; data[o + 8] = s.birth;
    colors[k * 4] = Math.min(255, s.r); colors[k * 4 + 1] = Math.min(255, s.g); colors[k * 4 + 2] = Math.min(255, s.b); colors[k * 4 + 3] = s.a * 255;
    k++;
  }

  // 下塗りが各場所に届く時刻(上塗りで前の絵を覆うときに使う)
  const gcell = 16, gw = Math.ceil(W / gcell), gh = Math.ceil(H / gcell);
  const arrival = new Float32Array(gw * gh).fill(0.11 * paint);
  for (const s of wash1) {
    const i = Math.min(gh - 1, Math.max(0, (s.py / gcell) | 0)) * gw + Math.min(gw - 1, Math.max(0, (s.px / gcell) | 0));
    arrival[i] = Math.min(arrival[i], s.birth);
  }
  return { data, colors, count, aspect: W / H, arrival: { data: arrival, gw, gh } };
}
