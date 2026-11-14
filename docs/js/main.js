import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { shuffleScenes } from './shuffle.js';
import { createHintContrast } from './hint-contrast.js';
import { Sequence, PAINT } from './sequence.js';

const canvas = document.getElementById('paper');
const label = document.getElementById('count');
const hint = document.getElementById('hint');
const q = new URLSearchParams(location.search);

// 検証用のパラメータ: ?scene=3&t=30&freeze&mx=0.5&my=0&speed=4&mode=1
const num = (k, d) => (q.has(k) && !Number.isNaN(parseFloat(q.get(k))) ? parseFloat(q.get(k)) : d);
const debug = {
  scene: num('scene', 0), t: num('t', 0), freeze: q.has('freeze'), speed: num('speed', 1),
  cam: q.has('mx') || q.has('my') ? { x: num('mx', 0), y: num('my', 0) } : null,
};

async function main() {
  let renderer;
  try { renderer = new Renderer(canvas); }
  catch (e) {
    document.body.classList.add('nogl');
    hint.textContent = 'この作品の表示には WebGL2 に対応したブラウザが必要です。';
    hint.classList.add('show');
    console.error(e); return;
  }
  const { order: scenes } = await (await fetch('assets/scenes.json')).json();
  // scene指定の検証では元の順番を保つ。
  const order = q.has('scene') ? scenes : shuffleScenes(scenes);
  const camera = new Camera(canvas, debug.cam);
  const tiltButton = document.getElementById('tilt');
  const isPhone = navigator.userAgentData?.mobile ?? /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
  if (!debug.cam && isPhone && camera.tiltSupported) {
    tiltButton.hidden = false;
    tiltButton.textContent = camera.tiltNeedsPermission ? '傾きで視点を動かす' : '傾きの基準を合わせる';
    tiltButton.addEventListener('click', async () => {
      tiltButton.disabled = true;
      try {
        const enabled = await camera.enableTilt();
        tiltButton.textContent = enabled ? '傾きの基準を合わせる' : '傾きの許可を再試行';
        document.getElementById('tilt-status').textContent = enabled
          ? '端末を傾けると視点が動きます。'
          : '傾きへのアクセスが許可されませんでした。ブラウザの設定を確認してください。';
      } catch (e) {
        tiltButton.textContent = '傾きの許可を再試行';
        document.getElementById('tilt-status').textContent = '傾きを利用できませんでした。ブラウザの設定を確認してください。';
        console.error(e);
      } finally {
        tiltButton.disabled = false;
      }
    });
  }
  const pad = (n) => String(n).padStart(2, '0');
  const seq = new Sequence(renderer, order, {
    start: Math.max(0, Math.min(order.length - 1, debug.scene | 0)),
    firstMode: num('mode', 0) | 0,
    onChange: (i) => { label.textContent = `${pad(i + 1)} / ${pad(order.length)}`; },
  });
  await seq.start(debug.t);
  document.body.classList.add('ready');

  // 操作: クリック/タップ・スペース・→ で次の景、← で前の景、長押しで早送り
  let held = false, holdTimer = 0, down = null, fast = false;
  const hideHint = () => hint.classList.remove('show');
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    held = true;
    holdTimer = setTimeout(() => { if (held) fast = true; }, 350);
  });
  const release = (e) => {
    if (!held) return;
    held = false; clearTimeout(holdTimer);
    const wasFast = fast; fast = false;
    if (!wasFast && down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10) { seq.goNext(); hideHint(); }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); seq.goNext(); hideHint(); }
    else if (e.code === 'ArrowLeft') { seq.goPrev(); hideHint(); }
  });
  window.addEventListener('resize', () => renderer.resize());

  setTimeout(() => hint.classList.add('show'), 2500);
  setTimeout(hideHint, 11000);

  const updateHintContrast = createHintContrast(renderer.gl, canvas, hint);
  let last = performance.now(), slow = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    // 描画が重い端末では、解像度を段階的に下げて滑らかさを保つ
    slow = dt > 0.034 ? slow + dt : Math.max(0, slow - dt * 2);
    if (slow > 2 && (renderer.scale || 1) > 0.5 && !document.hidden) { renderer.scale = (renderer.scale || 1) * 0.75; slow = 0; }
    renderer.resize();
    camera.update(dt);
    if (!debug.freeze) seq.update(dt * debug.speed * (fast ? 8 : 1));
    seq.draw(camera);
    updateHintContrast(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__art = { seq, camera, renderer, PAINT }; // 検証用
}

main();
