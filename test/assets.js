// Dev-only: renders real app states into site/assets/*.png for the landing page (run via ROOM_SCRIPT, --demo).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const save = (name, x = 0, y = 0, w = W, h = H) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    console.log(`ASSET:${name}:` + c.toDataURL());
  };
  const tidy = () => { for (const f of FURNITURE) { f.dirt = 0; f.shown = 0; } clutter.length = 0; };
  const wreck = () => { for (const f of FURNITURE) { f.dirt = 0.95; f.shown = 0.95; } };
  const fake = {
    state: 'ok', at: Date.now(), loading: false,
    repos: [{ slug: 'you/webshop', issues: [42, 41, 38, 35, 31, 29, 27].map((n, i) => ({ number: n, title: 'Issue ' + n, url: '', updatedAt: new Date().toISOString(), labels: [{ name: 'x', color: ['#d73a4a', '#a2eeef', '#fbca04', '#0e8a16'][i % 4] }], comments: i % 2 })),
      prs: [{ number: 44, ci: 'pending', review: '' }, { number: 43, ci: 'pass', review: 'APPROVED' }, { number: 39, ci: 'fail', review: 'CHANGES_REQUESTED', draft: true }].map((p) => ({ ...p, title: 'PR', url: '', updatedAt: new Date().toISOString() })) }],
  };

  // pretend agents living in the pictured projects (the real watcher feed is ignored while capturing)
  const t0 = Date.now();
  const pretend = [
    ['c:/code/webshop', 'claude', 'working'], ['c:/code/webshop', 'codex', 'working'], ['c:/code/webshop', 'codex', 'done'],
    ['c:/code/api-gateway', 'codex', 'working'], ['c:/code/api-gateway', 'claude', 'waiting'],
    ['c:/code/blog', 'claude', 'working'], ['c:/code/blog', 'codex', 'idle'],
    ['c:/code/mobile-app', 'codex', 'working'], ['c:/code/mobile-app', 'claude', 'stuck'],
  ].map(([cwd, provider, status], i) => ({ id: 'shot:' + i, provider, host: i % 3 ? 'cli' : 't3code', cwd, project: cwd.split('/').pop(), title: 'Pretend task ' + i, status, since: t0, lastEventAt: t0, turns: 1, toolCalls: 0 }));
  const realSync = syncAgents;
  syncAgents = () => realSync(pretend);
  realSync(pretend);
  for (const a of pretend) snoozed.set(a.id, Date.now() + 3.6e6); // calm captures; the alert shot turns one back on

  // four generated project rooms, tidy
  const keys = ['c:/code/webshop', 'c:/code/api-gateway', 'c:/code/blog', 'c:/code/mobile-app'];
  for (let i = 0; i < keys.length; i++) {
    switchRoom(keys[i]); tidy(); await sleep(900); save('room-' + (i + 1));
  }
  // same room, clean vs wrecked
  switchRoom('c:/code/blog'); tidy(); await sleep(900); save('clean');
  wreck(); for (let i = 0; i < 14; i++) spawnClutter(false); await sleep(900); save('wrecked');
  // the whiteboard's three faces
  switchRoom('c:/code/webshop'); tidy();
  ghData.set(room.key, fake);
  for (const [i, name] of [[0, 'board-todo'], [1, 'board-issues'], [2, 'board-prs']]) {
    boardFace = i; spin = null; await sleep(500); save(name, BOARD.x - 3, BOARD.y - 4, BOARD.w + 12, BOARD.h + 12);
  }
  boardFace = 0;
  // the garage and its recharge station
  switchRoom(GARAGE); await sleep(1200); save('garage');
  snoozed.delete('shot:8'); snoozed.delete('shot:4');
  switchRoom('c:/code/mobile-app'); tidy(); await sleep(2600); save('alert');
  save('station', STATION.x - 4, 26, STATION.w + 8, 48);
  save('roof', 0, ROOF_Y - 2, W, 13);
  console.log('[assets] done');
})();
