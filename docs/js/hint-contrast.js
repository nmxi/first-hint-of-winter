const linear = (byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export function hintColor(pixels, current = '#000') {
  let brightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    brightness += 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]);
  }
  brightness /= pixels.length / 4;
  // 黒・白のコントラストが逆転する明るさの前後に幅を持たせ、ちらつきを抑える。
  return brightness < (current === '#fff' ? 0.20 : 0.16) ? '#fff' : '#000';
}

export function createHintContrast(gl, canvas, hint) {
  let lastCheck = -Infinity, pixels = new Uint8Array(0);
  let color = '#000';
  return (now) => {
    if (!hint.classList.contains('show') || now - lastCheck < 300 || gl.isContextLost()) return;
    lastCheck = now;
    const rect = hint.getBoundingClientRect(), bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !rect.width || !rect.height) return;
    const scaleX = canvas.width / bounds.width, scaleY = canvas.height / bounds.height;
    const x = Math.max(0, Math.floor((rect.left - bounds.left) * scaleX));
    const right = Math.min(canvas.width, Math.ceil((rect.right - bounds.left) * scaleX));
    const y = Math.max(0, Math.min(canvas.height - 1,
      Math.floor((bounds.bottom - (rect.top + rect.height / 2)) * scaleY)));
    const width = right - x;
    if (width <= 0) return;
    if (pixels.length !== width * 4) pixels = new Uint8Array(width * 4);
    // 描画直後の画面からラベル中央の1行だけを読む。解像度の変更にも追従する。
    gl.readPixels(x, y, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    color = hintColor(pixels, color);
    hint.style.color = color;
    hint.style.textShadow = color === '#000'
      ? '0 1px 3px rgba(255, 255, 255, 0.8)'
      : '0 1px 3px rgba(0, 0, 0, 0.8)';
  };
}
