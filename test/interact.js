// Dev-only: scripted drag & throw, run inside the renderer via ROOM_SCRIPT.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (x, y) => ({ clientX: x * scale, clientY: y * scale, screenX: x * scale, screenY: y * scale, bubbles: true, button: 0 });
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
  async function drag(x0, y0, x1, y1, steps = 8, ms = 12) {
    move(x0, y0);
    canvas.dispatchEvent(new MouseEvent('mousedown', at(x0, y0)));
    for (let i = 1; i <= steps; i++) { move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await sleep(ms); }
    window.dispatchEvent(new MouseEvent('mouseup', at(x1, y1)));
  }
  const log = [];
  const alone = (x, y) => [...roombas.values()].every((k) => Math.abs(k.x - x) > 12 || Math.abs(baseOf(k) - y) > 14);
  // 1) fling the first roomba straight up at the ceiling
  const r = [...roombas.values()][0];
  const rx = r.x; const ry = r.d - 3;
  await drag(rx, ry, rx + 10, ry - 45, 6, 10);
  await sleep(900);
  log.push('roomba mode after fling: ' + r.mode);
  // 2) toss a floor item into the basket
  const c = clutter.find((k) => !k.spot && k.mode === 'rest' && alone(k.x, k.y));
  if (c) { await drag(c.x, c.y - 2, BASKET.x + 6, BASKET.y + 2, 10, 30); await sleep(100); log.push('basket item mode: ' + c.mode); }
  // 3) drop a sock on another roomba
  const r2 = [...roombas.values()].find((k) => k !== r && k.mode === 'floor');
  const c2 = clutter.find((k) => !k.spot && k.mode === 'rest');
  if (r2 && c2) { await drag(c2.x, c2.y - 2, r2.x, r2.d - 4, 10, 40); await sleep(100); log.push('dropped on roomba -> hat: ' + JSON.stringify(r2.hat) + ' item: ' + c2.mode); }
  console.log('[interact] ' + log.join(' | '));
})();

// 4) drop a roomba straight onto a wrecked piece of furniture: it should climb on and scrub
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(4000);
  const f = FURNITURE.find((p) => p.sx1 - p.sx0 > 20) || FURNITURE[0];
  f.dirt = 0.9; f.shown = 0.9;
  const r = [...roombas.values()].find((k) => k.mode === 'floor' && k.agent.status === 'working') || [...roombas.values()].find((k) => k.mode === 'floor');
  Object.assign(r, { mode: 'air', x: (f.sx0 + f.sx1) / 2, y: f.top - 12, vx: 0, vy: 0 });
  await sleep(2000);
  console.log('[interact] perch: ' + r.mode + ' on ' + (r.perch && r.perch.type) + ' dirt ' + f.dirt.toFixed(2) + ' (status ' + r.agent.status + ')');
})();
