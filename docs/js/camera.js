// カーソル(タッチ・端末の傾き)に応じて視点の向きをなめらかに変える。

const MAX_YAW = 0.15, MAX_PITCH = 0.10;
const clamp = (n) => Math.max(-1, Math.min(1, n));
const angleDelta = (angle, base) => ((angle - base + 540) % 360) - 180;

export class Camera {
  constructor(el, fixed) {
    this.yaw = 0; this.pitch = 0;
    this.tx = 0; this.ty = 0;          // 目標(-1..1)
    this.fixed = fixed || null;         // 検証用に固定する場合 {x, y}
    this.lastInput = -1e9;
    this.time = 0;
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.base = null;
    this.tiltSupported = window.isSecureContext && typeof window.DeviceOrientationEvent !== 'undefined';
    this.tiltNeedsPermission = this.tiltSupported &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function';
    this.tiltEnabled = this.tiltSupported && !this.tiltNeedsPermission;

    el.addEventListener('pointermove', (e) => {
      // タッチ操作でジャイロの視点を上書きしない。
      if (e.pointerType === 'touch') return;
      this.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.ty = (e.clientY / window.innerHeight) * 2 - 1;
      this.lastInput = this.time;
    }, { passive: true });

    window.addEventListener('deviceorientation', (e) => {
      if (!this.tiltEnabled || !Number.isFinite(e.gamma) || !Number.isFinite(e.beta)) return;
      if (!this.base) this.base = { g: e.gamma, b: e.beta };
      const x = angleDelta(e.gamma, this.base.g) / 25;
      const y = angleDelta(e.beta, this.base.b) / 25;
      // 端末座標を画面の向きに合わせる。
      const angle = (window.screen?.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
      this.tiltX = clamp(x * Math.cos(angle) + y * Math.sin(angle));
      this.tiltY = clamp(y * Math.cos(angle) - x * Math.sin(angle));
    }, { passive: true });
    const reset = () => this.recenterTilt();
    if (window.screen?.orientation?.addEventListener) {
      window.screen.orientation.addEventListener('change', reset);
    } else {
      window.addEventListener('orientationchange', reset);
    }
  }

  recenterTilt() {
    this.base = null;
    this.tiltX = this.tiltY = null;
  }

  async enableTilt() {
    if (!this.tiltSupported) return false;
    // iOSではボタンのclickから直接呼び出す。
    if (this.tiltNeedsPermission && !this.tiltEnabled) {
      this.tiltEnabled = await window.DeviceOrientationEvent.requestPermission() === 'granted';
    }
    if (this.tiltEnabled) this.recenterTilt();
    return this.tiltEnabled;
  }

  update(dt) {
    this.time += dt;
    let x = this.tx, y = this.ty;
    if (this.fixed) { x = this.fixed.x; y = this.fixed.y; }
    else {
      if (this.tiltX != null && this.time - this.lastInput >= 4) { x = this.tiltX; y = this.tiltY; }
      // 触れていないときも、ゆっくり息をするように揺れる
      if (!this.reduced) {
        x += Math.sin(this.time * 0.23) * 0.16;
        y += Math.sin(this.time * 0.17 + 1.3) * 0.10;
      }
    }
    const amp = this.reduced ? 0.35 : 1;
    const k = this.fixed ? 1 : 1 - Math.exp(-dt * 3.2);
    // カーソルが右なら右から覗き込む(手前のものが左へずれる)
    this.yaw += (x * MAX_YAW * amp - this.yaw) * k;
    this.pitch += (-y * MAX_PITCH * amp - this.pitch) * k;
  }
}
