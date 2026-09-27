// Dev-only: open the in-game menu while something is nagging (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  toggleMenu();
  console.log('[menu] open=' + !menuEl.hidden + ' nag=' + (currentNag() && currentNag().status) + ' size=' + appCfg.size + ' anchor=' + appCfg.anchor);
})();
