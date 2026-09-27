// Dev-only: roll the room up into its roof bar (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1000);
  window.bridge.setOption('collapsed', true);
  await sleep(1500);
  console.log('[roll] collapsed=' + appCfg.collapsed + ' window ' + window.innerWidth + 'x' + window.innerHeight + ' viewTop=' + viewTop);
})();
