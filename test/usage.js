// Dev-only visual/interaction checks, run using ROOM_SCRIPT in demo mode.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await sleep(500);
  window.bridge.setOption('snoozing', true);
  const count = roombaCountGeom();
  assert(count.label === String(allAgents.length), 'roomba total must match all rooms');
  assert(roofRoombaCountAt(count.x + 3, ROOF_Y + 3), 'roomba count hover target');
  assert(roofButtonAt(count.x + 3, ROOF_Y + 3) === null, 'roomba count overlaps dismiss');
  assert(count.x + count.w < signGeom().lx, 'roomba count overlaps room selector');
  for (const provider of ['claude', 'codex']) {
    assert(usageWindows(provider).length === 2, `${provider} demo windows missing`);
    assert(usageTitle(provider).includes('Demo usage.'), 'demo usage must be labeled');
    assert(usageTitle(provider).includes(`${provider === 'claude' ? 72 : 38}% left`), `${provider} must show allowance left`);
    const box = ROOF_USAGE[provider];
    assert(roofUsageAt(box.x + 3, ROOF_Y + 3) === provider, `${provider} hover target`);
    assert(roofButtonAt(box.x + 3, ROOF_Y + 3) === null, `${provider} overlaps a button`);
    appCfg.usage[provider] = { state: 'ready', windows: [{ minutes: 300, usedPercent: 100 }], updatedAt: Date.now() };
    assert(usageTitle(provider).includes('0% left'), 'exhausted allowance must show zero left');
    appCfg.usage[provider].windows[0].usedPercent = 0;
    assert(usageTitle(provider).includes('100% left'), 'unused allowance must show 100% left');
    assert(pixelTextWidth(`${PROVIDER[provider].name} 100%`) + 4 <= box.w, `${provider} 100% overflows`);
  }
  const originalName = room.name;
  room.name = 'a-very-long-project-name-that-will-be-truncated';
  assert(count.x + count.w < signGeom().lx, 'roomba count overlaps long project name');
  assert(signGeom().rx + 7 < ROOF_USAGE.claude.x, 'room selector overlaps usage');
  room.name = originalName;
  const saved = appCfg.usage.claude;
  appCfg.usage.claude = { state: 'unavailable', windows: [], message: 'Sign in to Claude Code to see account usage.' };
  assert(usageWindows('claude').length === 0 && usageTitle('claude').includes('Sign in'), 'unavailable usage');
  appCfg.usage.claude = { ...saved, state: 'stale' };
  assert(usageTitle('claude').includes('Last known allowance'), 'stale usage');
  appCfg.usage.claude = saved;
  for (const size of [2, 3, 4]) {
    window.bridge.setOption('scale', size);
    await sleep(100);
    assert(canvas.getBoundingClientRect().width === W * scale, 'canvas scale');
  }
  window.bridge.setOption('scale', 3);
  console.log('[usage] PASS: roomba total, remaining percentages, hover targets, 0%/100% left, long project names, unavailable/stale states, all sizes');
})();
