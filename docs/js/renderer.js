// WebGL2 で筆致を描く。筆致はいったん透明なバッファに重ね、最後に紙の質感と合成する。
import { STRIDE } from './strokes.js';

export const DEATH_LEN = 6.0; // 消え始めてから完全に消えるまでの最長秒数

const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}`;

const STROKE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPos;    // x, y, 深度(1が手前)
layout(location=2) in vec4 aShape;  // 大きさ, 向き, 伸び, 乱数
layout(location=3) in vec2 aMisc;   // 柔らかさ, 描かれる時刻
layout(location=4) in vec4 aColor;
layout(location=5) in float aDeath; // 消え始める時刻
uniform float uTime;
uniform int uDeathMode;
uniform vec2 uCam;      // yaw, pitch
uniform vec2 uScale;
uniform float uDepthScale, uCamDist, uPivot;
out vec2 vUv;
out vec4 vColor;
out vec3 vParams; // 柔らかさ, 乱数, 濡れ具合

void main(){
  float age = uTime - aMisc.y;
  float dAge = uTime - aDeath;
  if (age <= 0.0 || dAge > ${DEATH_LEN.toFixed(1)}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float seed = aShape.w;
  float grow = 1.0 - exp(-age * 3.5);          // 置いた絵具がにじんで広がる
  float sizeMul = mix(0.3, 1.0, grow);
  float alpha = smoothstep(0.0, 0.35, age);
  float soft = mix(min(1.0, aMisc.x + 0.35), aMisc.x, grow); // 濡れている間は輪郭が柔らかい
  float wet = exp(-age * 0.7);
  vec3 col = aColor.rgb;
  vec2 drift = vec2(0.0);

  if (dAge > 0.0) {
    if (uDeathMode == 0) {            // 上から塗られて覆われる
      alpha *= 1.0 - smoothstep(0.0, 5.0, dAge);
    } else if (uDeathMode == 1) {     // 水で洗い流される
      float k = clamp(dAge / 4.0, 0.0, 1.0);
      sizeMul *= 1.0 + 1.8 * k;
      soft = mix(soft, 1.0, min(1.0, k * 2.5));
      alpha *= (1.0 - k) * (1.0 - k);
      drift = vec2(sin(seed * 40.0) * 0.03 * k, -0.12 * k * k);
    } else {                          // 雪に覆われる
      float k = clamp(dAge / 1.8, 0.0, 1.0);
      col = mix(col, vec3(0.975, 0.975, 0.99), k);
      sizeMul *= 1.0 + 0.35 * k;
      soft = mix(soft, 1.0, k);
      alpha *= 1.0 - smoothstep(2.6, 6.0, dAge);
    }
  }

  // 深度を使って立体に置き、視点を回す。正面から見たときに元の絵と一致するよう逆投影しておく
  float z = (aPos.z - uPivot) * uDepthScale;
  float s0 = uCamDist / (uCamDist - z);
  vec3 P = vec3(aPos.xy / s0, z);
  float cy = cos(uCam.x), sy = sin(uCam.x), cp = cos(uCam.y), sp = sin(uCam.y);
  P = vec3(cy * P.x - sy * P.z, P.y, sy * P.x + cy * P.z);
  P = vec3(P.x, cp * P.y - sp * P.z, sp * P.y + cp * P.z);
  float s = uCamDist / (uCamDist - P.z);
  vec2 center = P.xy * s + drift;

  float ca = cos(aShape.y), sa = sin(aShape.y);
  vec2 q = aCorner * vec2(aShape.z, 1.0) * aShape.x * sizeMul * (s / s0);
  vec2 off = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
  gl_Position = vec4((center + off) * uScale, 0.0, 1.0);
  vUv = aCorner;
  vColor = vec4(col, aColor.a * alpha);
  vParams = vec3(soft, seed, wet);
}`;

const STROKE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
in vec3 vParams;
out vec4 outColor;
${NOISE}
void main(){
  float soft = vParams.x, seed = vParams.y, wet = vParams.z;
  vec2 p = vUv;
  float len = length(p);
  float n = vnoise(p * 2.2 + seed * 61.7);
  float n2 = vnoise(p * 5.5 + seed * 17.3);
  float r = len + (n - 0.5) * 0.42 + (n2 - 0.5) * 0.14;   // ゆがんだ輪郭
  float hard = 1.0 - smoothstep(0.55, 0.71, r);
  float gauss = exp(-r * r * 3.4) * (1.0 - smoothstep(0.75, 1.0, len));
  float body = mix(hard, gauss, soft);
  float ring = smoothstep(0.36, 0.62, r) * hard;            // 縁に絵具がたまる
  float streak = vnoise(vec2(p.y * 7.0 + seed * 9.1, p.x * 0.9 + seed * 3.0)); // 筆の毛のすじ
  float a = body * (0.82 + 0.34 * ring * (1.0 - soft));
  a *= mix(1.0, 0.72 + 0.56 * streak, 0.55 * (1.0 - soft));
  a = clamp(a * vColor.a, 0.0, 1.0);
  vec3 c = vColor.rgb * mix(1.0, 0.86, wet);                // 濡れている絵具は少し濃い
  outColor = vec4(c * a, a);
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
out vec2 vUv;
void main(){ vUv = aCorner * 0.5 + 0.5; gl_Position = vec4(aCorner, 0.0, 1.0); }`;

const PAPER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uDpr;
uniform vec2 uRes;
out vec4 outColor;
${NOISE}
void main(){
  vec2 px = gl_FragCoord.xy / uDpr;
  float g1 = vnoise(px * 0.85), g2 = vnoise(px * 0.27 + 31.0), g3 = vnoise(px * 0.06 + 7.0);
  float fiber = vnoise(vec2(px.x * 0.05, px.y * 0.9) + 90.0);
  float grain = g1 * 0.45 + g2 * 0.3 + g3 * 0.15 + fiber * 0.1;  // 紙目(0..1)
  vec2 c = vUv - 0.5;
  float vig = 1.0 - dot(c, c) * 0.22;
  vec3 paper = vec3(0.957, 0.937, 0.898) * (0.93 + 0.10 * grain) * vig;

  vec4 t = texture(uTex, vUv);
  float a = t.a;
  vec3 col = a > 0.001 ? t.rgb / a : vec3(1.0);
  // 薄い所は紙目の凹みにだけ絵具が残る(かすれ)
  float a2 = clamp(a * mix(0.55 + 0.9 * grain, 1.0, a * a), 0.0, 1.0);
  a2 *= 0.93 + 0.07 * grain;
  // 顔料の粒状感と、紙を通した明るさ
  col *= 0.95 + 0.09 * g1;
  col = mix(col, vec3(0.957, 0.937, 0.898), 0.05);
  outColor = vec4(mix(paper, col * vig, a2), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 が使えません');
    this.stroke = program(gl, STROKE_VS, STROKE_FS);
    this.paper = program(gl, QUAD_VS, PAPER_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.fbo = gl.createFramebuffer();
    this.tex = gl.createTexture();
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const gl = this.gl, c = this.canvas;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2) * (this.scale || 1);
    const w = Math.max(2, Math.round(c.clientWidth * this.dpr)), h = Math.max(2, Math.round(c.clientHeight * this.dpr));
    if (c.width === w && c.height === h && this.sized) return;
    c.width = w; c.height = h; this.sized = true;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** 筆致の列をGPUに載せる */
  createScene(strokes) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, strokes.data, gl.STATIC_DRAW);
    const B = STRIDE * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 12); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, B, 28); gl.vertexAttribDivisor(3, 1);

    const cbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf);
    gl.bufferData(gl.ARRAY_BUFFER, strokes.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 0, 0); gl.vertexAttribDivisor(4, 1);

    const dbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strokes.count).fill(1e9), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(5, 1);
    gl.bindVertexArray(null);
    return { vao, buf, cbuf, dbuf, count: strokes.count, aspect: strokes.aspect };
  }

  setDeaths(scene, deaths) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, scene.dbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, deaths);
  }

  deleteScene(scene) {
    const gl = this.gl;
    gl.deleteVertexArray(scene.vao); gl.deleteBuffer(scene.buf); gl.deleteBuffer(scene.cbuf); gl.deleteBuffer(scene.dbuf);
  }

  /** 画像の高さ(=2単位)を画面に収める倍率 */
  fit(aspect) {
    const ca = this.canvas.width / this.canvas.height;
    let s = Math.min(1, ca / aspect) * 0.9;                 // 全体が入る大きさ
    if (ca < aspect) s = Math.max(s, 0.6);                    // 縦長の画面では左右を少し切って大きく見せる
    return [s / ca, s];
  }

  /** @param items [{gpu, t, deathMode}] 古い景から順に */
  draw(items, cam) {
    const gl = this.gl, { width: w, height: h } = this.canvas;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const { p, u } = this.stroke;
    gl.useProgram(p);
    gl.uniform2f(u.uCam, cam.yaw, cam.pitch);
    gl.uniform1f(u.uDepthScale, 0.9); gl.uniform1f(u.uCamDist, 4.0); gl.uniform1f(u.uPivot, 0.42);
    for (const it of items) {
      if (it.t <= 0) continue;
      const sc = this.fit(it.gpu.aspect);
      gl.uniform2f(u.uScale, sc[0], sc[1]);
      gl.uniform1f(u.uTime, it.t);
      gl.uniform1i(u.uDeathMode, it.deathMode | 0);
      gl.bindVertexArray(it.gpu.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, it.gpu.count);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.useProgram(this.paper.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.paper.u.uTex, 0);
    gl.uniform1f(this.paper.u.uDpr, this.dpr);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
