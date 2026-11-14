export function isPhone(nav, screen, coarsePointer) {
  if (nav.userAgentData?.mobile || /iPhone|iPod|Android.*Mobile/i.test(nav.userAgent)) return true;
  if (/iPad|Tablet/i.test(nav.userAgent)) return false;
  // PC表示モードではmobileがfalseになる場合もあるため、タッチと実画面の寸法で補う。
  return nav.maxTouchPoints > 0 && coarsePointer &&
    Math.min(screen.width, screen.height) > 0 && Math.min(screen.width, screen.height) <= 700;
}

export function setupTiltControls(camera) {
  const button = document.getElementById('tilt');
  const status = document.getElementById('tilt-status');
  const phone = isPhone(navigator, window.screen, window.matchMedia('(pointer: coarse)').matches);
  button.hidden = !phone;
  if (!phone) return;

  // スマホの表示判定とセンサー対応判定を分け、非対応時にも理由を示す。
  if (!camera.tiltSupported) {
    button.disabled = true;
    button.textContent = window.isSecureContext
      ? 'このブラウザでは傾きを利用できません'
      : '傾きの利用にはHTTPSが必要です';
    status.textContent = button.title = window.isSecureContext
      ? 'このブラウザでは傾きを利用できません。SafariまたはChromeで開いてください。'
      : '傾きを利用するにはHTTPSのURLで開いてください。';
    return;
  }

  button.textContent = camera.tiltNeedsPermission ? '傾きで視点を動かす' : '傾きの基準を合わせる';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const enabled = await camera.enableTilt();
      button.textContent = enabled ? '傾きの基準を合わせる' : '傾きの許可を再試行';
      status.textContent = enabled
        ? '端末を傾けると視点が動きます。'
        : '傾きへのアクセスが許可されませんでした。ブラウザの設定を確認してください。';
    } catch (e) {
      button.textContent = '傾きの許可を再試行';
      status.textContent = '傾きを利用できませんでした。ブラウザの設定を確認してください。';
      console.error(e);
    } finally {
      button.disabled = false;
    }
  });
}
