// 景を順番に描き進める。描く → 眺める → 色を重ねる/洗い流す/雪で覆う → 次の景。
import { buildStrokes, STRIDE } from './strokes.js';
import { DEATH_LEN } from './renderer.js';

export const PAINT = 60;  // 1景を描き上げる秒数
export const HOLD = 10;   // 描き上がってから眺める秒数
const MODES = ['overpaint', 'wash', 'snow']; // 移り変わり方。この順に使う

async function loadPixels(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

export class Sequence {
  constructor(renderer, order, opts = {}) {
    this.r = renderer;
    this.order = order;
    this.idx = opts.start ?? 0;
    this.cur = null;        // 今描いている景 {gpu, strokes, t, deathMode}
    this.dying = [];        // 消えていく途中の景
    this.next = null;       // 準備済みの次の景 {idx, strokes}
    this.loading = -1;
    this.targetIdx = this.idx;
    this.want = false;      // 次へ進みたい
    this.transitions = opts.firstMode ?? 0;
    this.onChange = opts.onChange || (() => {});
  }

  async prepare(i) {
    const id = String(this.order[i]).padStart(3, '0');
    const [color, depth] = await Promise.all([
      loadPixels(`assets/scenes/${id}.webp`), loadPixels(`assets/scenes/${id}_d.png`),
    ]);
    const strokes = buildStrokes(color.data, depth.data, color.width, color.height, PAINT, this.order[i] + 1);
    return { idx: i, strokes };
  }

  async start(t0 = 0) {
    const first = await this.prepare(this.idx);
    this.cur = { gpu: this.r.createScene(first.strokes), strokes: first.strokes, t: t0, deathMode: 0 };
    this.onChange(this.idx);
    this.queue(this.idx + 1);
  }

  /** 次に描く景を決めて、裏で準備しておく */
  queue(i) {
    const n = this.order.length;
    this.targetIdx = ((i % n) + n) % n;
    if (this.next && this.next.idx === this.targetIdx) return;
    this.next = null;
    const want = this.loading = this.targetIdx;
    this.prepare(want).then((p) => { if (this.targetIdx === want) this.next = p; }).catch((e) => console.error(e));
  }

  goNext() { this.want = true; }
  goPrev() { this.queue(this.idx - 1); this.want = true; }

  update(dt) {
    if (!this.cur) return;
    this.cur.t += dt;
    for (const s of this.dying) s.t += dt;
    this.dying = this.dying.filter((s) => {
      if (s.t < s.endT) return true;
      this.r.deleteScene(s.gpu); return false;
    });
    if (this.cur.t > PAINT + HOLD) this.want = true;
    if (this.want && this.next) this.transition();
  }

  transition() {
    const old = this.cur, nx = this.next;
    const mode = MODES[this.transitions++ % MODES.length];
    const n = old.strokes.count, d = old.strokes.data, now = old.t;
    const deaths = new Float32Array(n);
    let delay = 0, last = 0;

    if (mode === 'overpaint') {
      // 次の景の下塗りが届いた所から、前の絵が覆われていく
      const { data: arr, gw, gh } = nx.strokes.arrival, asp = old.strokes.aspect;
      for (let i = 0; i < n; i++) {
        const u = (d[i * STRIDE] / asp + 1) / 2, v = (1 - d[i * STRIDE + 1]) / 2;
        const gi = Math.min(gh - 1, Math.max(0, (v * gh) | 0)) * gw + Math.min(gw - 1, Math.max(0, (u * gw) | 0));
        deaths[i] = now + arr[gi] + 2.5 + Math.random() * 5;
      }
      old.deathMode = 0;
    } else if (mode === 'wash') {
      // 水を含んだ刷毛で端から洗い流す
      const ang = Math.random() * Math.PI * 2, cx = Math.cos(ang), cy = Math.sin(ang), asp = old.strokes.aspect;
      for (let i = 0; i < n; i++) {
        const x = d[i * STRIDE] / asp, y = d[i * STRIDE + 1];
        const along = (x * cx + y * cy) / (Math.abs(cx) + Math.abs(cy)) * 0.5 + 0.5;
        deaths[i] = now + along * 5 + Math.sin(x * 5 + y * 3 + ang) * 0.5 + Math.random() * 0.9 + 0.5;
      }
      old.deathMode = 1; delay = 4.5;
    } else {
      // 雪が降り積もるように、点々と白く覆われていく
      for (let i = 0; i < n; i++) {
        const y = d[i * STRIDE + 1];
        const r = Math.random();
        deaths[i] = now + r * r * 5 + (1 - y) * 0.6;
      }
      old.deathMode = 2; delay = 5.5;
    }
    for (let i = 0; i < n; i++) if (deaths[i] > last) last = deaths[i];
    this.r.setDeaths(old.gpu, deaths);
    old.endT = last + DEATH_LEN;
    old.strokes = null; // CPU側のデータはもう不要
    this.dying.push(old);

    this.cur = { gpu: this.r.createScene(nx.strokes), strokes: nx.strokes, t: -delay, deathMode: 0 };
    this.idx = nx.idx;
    this.next = null; this.want = false;
    this.onChange(this.idx);
    this.queue(this.idx + 1);
  }

  draw(cam) {
    this.r.draw([...this.dying, this.cur].filter(Boolean), cam);
  }
}
