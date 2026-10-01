const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createUsage, normalizeUsage } = require('../src/usage');
const { Watcher } = require('../src/watcher');

const base = Date.parse('2026-10-01T12:00:00Z');
const claude = { five_hour: { utilization: 28, resets_at: '2026-10-01T15:00:00Z' }, seven_day: { utilization: 3, resets_at: '2026-10-08T09:00:00Z' } };
const codex = { rate_limit: { primary_window: { used_percent: 97, limit_window_seconds: 604800, reset_at: (base + 86400e3) / 1000 }, secondary_window: null } };
const response = (data, status = 200, retry = null) => ({ ok: status === 200, status, json: async () => data, headers: { get: () => retry } });
const credentials = async provider => ({ token: `private-${provider}`, accountId: provider === 'codex' ? 'private-account' : null });

test('normalizes real account response shapes, weekly-only limits, and zero usage', () => {
  assert.deepEqual(normalizeUsage('claude', claude).map(w => [w.minutes, w.usedPercent]), [[300, 28], [10080, 3]]);
  assert.deepEqual(normalizeUsage('codex', codex), [{ minutes: 10080, usedPercent: 97, resetsAt: base + 86400e3 }]);
  assert.equal(normalizeUsage('claude', { five_hour: { utilization: 0 } })[0].usedPercent, 0);
  assert.deepEqual(normalizeUsage('claude', { five_hour: { utilization: null }, seven_day: { utilization: NaN } }), []);
});

test('requests both providers with their existing auth and exposes only normalized data', async () => {
  const requests = [];
  const usage = createUsage({ credentials, now: () => base, fetchUsage: async (url, options) => {
    requests.push({ url, options });
    return response(url.includes('anthropic') ? claude : codex);
  } });
  await usage.refresh();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(requests[1].options.headers['ChatGPT-Account-Id'], 'private-account');
  assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.signal));
  assert.equal(usage.snapshot().claude.state, 'ready');
  assert.equal(usage.snapshot().codex.windows[0].usedPercent, 97);
  assert.ok(!JSON.stringify(usage.snapshot()).includes('private'));
  await usage.refresh();
  assert.equal(requests.length, 2, 'checks are cached for five minutes');
  usage.dispose();
});

test('missing sign-ins and API-key accounts do not display an invented percentage', async () => {
  let requests = 0;
  const usage = createUsage({ now: () => base, credentials: async () => null, fetchUsage: async () => { requests++; } });
  await usage.refresh();
  assert.equal(requests, 0);
  for (const entry of Object.values(usage.snapshot())) {
    assert.equal(entry.state, 'unavailable');
    assert.deepEqual(entry.windows, []);
    assert.match(entry.message, /Sign in/);
  }
  usage.dispose();
});

test('network failure preserves last known usage and hides expired windows', async () => {
  let time = base;
  let fail = false;
  const usage = createUsage({ now: () => time, credentials, fetchUsage: async () => {
    if (fail) throw new Error('private-provider-error');
    return response(claude);
  } });
  await usage.refresh();
  fail = true; time += 5 * 60e3;
  await usage.refresh();
  assert.equal(usage.snapshot().claude.state, 'stale');
  assert.equal(usage.snapshot().claude.windows[0].usedPercent, 28);
  assert.ok(!JSON.stringify(usage.snapshot()).includes('private-provider-error'));
  time += 4 * 3600e3;
  assert.equal(usage.snapshot().claude.windows.length, 1);
  usage.dispose();
});

test('429 respects backoff and HTTP-date Retry-After without hammering the provider', async () => {
  let time = base;
  let calls = 0;
  const usage = createUsage({ now: () => time, credentials, fetchUsage: async () => {
    calls++;
    return response({}, 429, new Date(base + 3600e3).toUTCString());
  } });
  await usage.refresh();
  assert.equal(calls, 2);
  time += 20 * 60e3;
  await usage.refresh();
  assert.equal(calls, 2);
  time = base + 3600e3;
  await usage.refresh();
  assert.equal(calls, 4);
  usage.dispose();
});

test('authentication failure offers a useful recovery message', async () => {
  const usage = createUsage({ now: () => base, credentials, fetchUsage: async () => response({}, 401) });
  await usage.refresh();
  assert.equal(usage.snapshot().claude.state, 'unavailable');
  assert.match(usage.snapshot().claude.message, /Sign in again to Claude Code/);
  usage.dispose();
});

test('new sign-in cannot inherit the previous account allowance after a failed request', async () => {
  let time = base;
  let token = 'first';
  const usage = createUsage({ now: () => time, credentials: async () => ({ token }),
    fetchUsage: async () => token === 'first' ? response(claude) : response({}, 401) });
  await usage.refresh();
  token = 'second'; time += 5 * 60e3;
  await usage.refresh();
  assert.deepEqual(usage.snapshot().claude.windows, []);
  usage.dispose();
});

test('Codex transcript updates ignore older sessions and model-specific buckets', () => {
  const usage = createUsage({ now: () => base });
  const watcher = new Watcher();
  watcher.on('usage', (provider, data, timestamp) => usage.record(provider, data, timestamp));
  const emit = (percent, offset = 0, limitId = 'codex') => watcher.onCodex({}, 'session.jsonl', {
    type: 'event_msg', timestamp: new Date(base + offset).toISOString(),
    payload: { type: 'token_count', rate_limits: { limit_id: limitId, primary: { used_percent: percent, window_minutes: 300 } } },
  });
  emit(31); emit(10, -60000); emit(99, 1000, 'codex-other-model');
  assert.equal(usage.snapshot().codex.windows[0].usedPercent, 31);
  emit(32, 2000);
  assert.equal(usage.snapshot().codex.windows[0].usedPercent, 32);
  usage.dispose();
});

test('demo and disabled runs do not read credentials or make network requests', () => {
  for (const flags of [{ demo: true }, { disabled: true }]) {
    const usage = createUsage({ ...flags, now: () => base, credentials: async () => assert.fail('credentials read'),
      fetchUsage: async () => assert.fail('network request') });
    usage.start();
    assert.equal(usage.snapshot().claude.state, flags.demo ? 'ready' : 'unavailable');
    usage.dispose();
  }
});

test('disposing ignores late request completion', async () => {
  let complete;
  let changes = 0;
  const pending = new Promise(resolve => { complete = resolve; });
  const usage = createUsage({ credentials, now: () => base, onChange: () => changes++, fetchUsage: () => pending });
  const refresh = usage.refresh();
  await new Promise(resolve => setImmediate(resolve));
  usage.dispose();
  complete(response(claude));
  await refresh;
  assert.equal(changes, 0);
});
