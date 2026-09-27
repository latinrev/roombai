// Dev-only: spins the three-sided whiteboard and captures each face (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shots = [];
  const grab = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(canvas, 0, 0); shots.push(c); };
  const log = [];
  const appt = roomList.find((e) => /appointly/.test(e.key));
  if (appt) switchRoom(appt.key);
  await sleep(400);
  spinBoard(1);
  await sleep(180); grab(); // mid-spin
  for (let i = 0; i < 40 && ghFor().loading; i++) await sleep(250);
  await sleep(600); grab(); // ISSUES
  log.push('issues face: state=' + ghFor().state + ' notes=' + noteLayout().length);
  const n = noteLayout()[0];
  if (n) { showGhCard(n, true); await sleep(100); grab(); log.push('card: ' + $('tcard-status').textContent + ' / ' + $('tcard-text').textContent.slice(0, 40)); hideTodoCard(); }
  spinBoard(1); await sleep(900); grab(); // PRS
  log.push('prs face notes=' + noteLayout().length);
  switchRoom(GARAGE); spinBoard(-1); await sleep(900);
  for (let i = 0; i < 40 && ghFor().loading; i++) await sleep(250);
  await sleep(300); grab();
  log.push('garage issues state=' + ghFor().state + ' notes=' + noteLayout().length + ' repos=' + (ghFor().repos || []).map((r) => r.slug).join(','));
  const out = document.createElement('canvas'); out.width = W; out.height = H * shots.length;
  shots.forEach((c, i) => out.getContext('2d').drawImage(c, 0, i * H));
  console.log('GALLERY:' + out.toDataURL());
  console.log('[board] ' + log.join(' | '));
})();
