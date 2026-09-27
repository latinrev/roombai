// Dev-only: room selector + recharge station checks (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  log.push('rooms: ' + roomList.map((e) => e.name + '(' + e.agents.length + ')').join(', '));
  const r = [...roombas.values()].find((k) => k.mode === 'floor');
  if (r) {
    const id = r.id;
    shoo(r);
    await sleep(5500);
    log.push('shooed roomba gone: ' + !roombas.has(id) + ' mode=' + r.mode + ' x=' + Math.round(r.x) + ' d=' + Math.round(r.d) + ' leaving=' + r.leaving + ' beamT=' + r.beamT);
  }
  openRoomList();
  log.push('list rows: ' + document.querySelectorAll('.room-row').length);
  console.log('[rooms] ' + log.join(' | '));
})();
