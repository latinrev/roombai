const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCommunity, INTERVAL } = require('../src/community');

function setup(options = {}) {
  const calls = [], scheduled = [], cleared = []; let saved, writes = 0, count = 4;
  const app = { isPackaged: true };
  const community = createCommunity({ app, getCount: () => count,
    fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; },
    readIdentity: () => saved,
    writeIdentity: value => { writes++; saved = { ...value }; },
    timers: { setInterval(fn, delay) { scheduled.push({ fn, delay }); return scheduled.length; }, clearInterval(id) { cleared.push(id); } },
    ...options,
  });
  return { community, calls, scheduled, cleared, count: value => { count = value; }, writes: () => writes, identity: () => saved };
}

test('sharing is off by default and creates neither an identity nor network traffic', () => {
  const f = setup(); f.community.start();
  assert.equal(f.calls.length, 0); assert.equal(f.writes(), 0); assert.equal(f.scheduled.length, 0);
});
test('development/demo builds never send counts even if sharing is enabled', () => {
  for (const options of [{ app: { isPackaged: false }, enabled: true }, { disabled: true, enabled: true }]) {
    const f = setup(options); f.community.start(); f.community.setEnabled(true); f.community.dispose();
    assert.equal(f.calls.length, 0); assert.equal(f.scheduled.length, 0);
  }
});
test('opt-in sends only aggregate counts with a random identity, then refreshes every minute', () => {
  const f = setup(); f.community.setEnabled(true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.count, 4);
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['count','installation','sequence','token']);
  assert.equal(f.scheduled[0].delay, INTERVAL);
  f.count(7); f.scheduled[0].fn();
  assert.equal(f.calls[1].body.count, 7);
  assert.equal(f.calls[1].body.installation, f.calls[0].body.installation);
  assert.equal(f.calls[1].body.sequence, f.calls[0].body.sequence + 1);
  f.community.start(); assert.equal(f.scheduled.length, 1);
});
test('opt-out sends zero, stops checks, and does not resume after disposal', () => {
  const f = setup({ enabled: true }); f.community.start(); f.community.setEnabled(false);
  assert.equal(f.calls.at(-1).body.count, 0); const count = f.calls.length;
  f.scheduled[0].fn(); assert.equal(f.calls.length, count);
  assert.equal(f.cleared.length, 1);
  f.community.dispose(); f.community.setEnabled(true); assert.equal(f.calls.length, count);
});
test('restart preserves identity and increases sequence; disk/network failures never interrupt the app', async () => {
  const f = setup({ enabled: true }); f.community.start(); const stored = f.identity();
  const g = setup({ enabled: true, readIdentity: () => stored }); g.community.start();
  assert.equal(g.calls[0].body.installation, stored.id); assert.equal(g.calls[0].body.sequence, 2);
  const disk = setup({ enabled: true, writeIdentity: () => { throw new Error('read-only'); } });
  assert.doesNotThrow(() => disk.community.start()); assert.equal(disk.calls.length, 0);
  const network = setup({ enabled: true, fetchImpl: async () => { throw new Error('offline'); } });
  assert.doesNotThrow(() => network.community.start());
  await new Promise(resolve => setImmediate(resolve));
});
