// Dev-only: activity should make mess, idle roombas should clean it (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const dirtSum = () => FURNITURE.reduce((t, f) => t + f.dirt, 0).toFixed(2);
  const junk0 = floorJunk(); const dirt0 = dirtSum();
  const list = allAgents.map((a) => ({ ...a }));
  const busy = list.find((a) => roombas.has(a.id));
  busy.turns = (busy.turns || 0) + 1;
  busy.toolCalls = (busy.toolCalls || 0) + 12;
  syncAgents(list);
  await sleep(2000);
  log.push(`after 1 turn + 12 tools: junk ${junk0} -> ${floorJunk()}, furniture dirt ${dirt0} -> ${dirtSum()}`);
  const idle = list.map((a) => ({ ...a, status: 'idle' }));
  syncAgents(idle);
  const junk1 = floorJunk();
  await sleep(12000);
  log.push(`idle roombas cleaning for 12s: junk ${junk1} -> ${floorJunk()}`);
  console.log('[mess] ' + log.join(' | '));
})();
