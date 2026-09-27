// Dev-only: drag the roof anywhere — up the main screen, then onto the second screen (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ev = (sx, sy) => ({ clientX: 20 * scale, clientY: (ROOF_Y + 4) * scale, screenX: sx, screenY: sy, bubbles: true, button: 0 });
  const where = () => `(${window.screenX},${window.screenY}) scale=${scale}`;
  await sleep(500);
  const log = ['start ' + where()];
  canvas.dispatchEvent(new MouseEvent('mousedown', ev(1000, 1000)));
  for (let i = 1; i <= 10; i++) { window.dispatchEvent(new MouseEvent('mousemove', ev(1000 - i * 40, 1000 - i * 50))); await sleep(40); }
  await sleep(200); log.push('up-left ' + where());
  for (let i = 1; i <= 30; i++) { window.dispatchEvent(new MouseEvent('mousemove', ev(600 + i * 100, 500 - i * 10))); await sleep(40); }
  await sleep(300); log.push('second screen ' + where());
  window.dispatchEvent(new MouseEvent('mouseup', ev(3600, 200)));
  console.log('[drag] ' + log.join(' | '));
})();
