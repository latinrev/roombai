const assert = require('node:assert/strict');
const { test } = require('node:test');
const { t3MenuState } = require('../src/t3pair');

const DAY = 864e5;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const IDLE = { busy: false, message: '' };
const NO_DISCOVERY = { servers: [], reason: '' };

const status = (extra) => ({ url: 'https://build-box.tail.ts.net', label: 'build-box', state: 'ok', error: '', environmentId: 'env-build', expiresAt: 0, ...extra });
const found = (extra) => ({ environmentId: 'env-mac', label: "Joel's MacBook Pro", url: 'https://mac.tail.ts.net', owner: 'own', compatible: true, ...extra });
const menu = ({ statuses = [], discovery = NO_DISCOVERY, pairing = IDLE, expanded } = {}) => t3MenuState({ available: true, statuses, discovery, pairing, expanded, now: NOW });
const section = (state) => ({ toSetUp: state.toSetUp, open: state.open });

test('a connected server shows the days left on its key', () => {
  assert.deepEqual(menu({ statuses: [status({ expiresAt: NOW + 28 * DAY - 6e5 })] }), {
    available: true,
    machines: [{ key: 'https://build-box.tail.ts.net', label: 'build-box', url: 'https://build-box.tail.ts.net', state: 'connected', expiresInDays: 28, action: null }],
    toSetUp: 0,
    open: false,
    discovery: { missing: false, reason: '' },
    pairing: { busy: false, message: '' },
  });
});

test('a rejected key asks for a reconnect and keeps the token out of the state', () => {
  const state = menu({ statuses: [status({ state: 'unauthorized', error: 'token rejected; issue a new one', token: 'secret-token', expiresAt: NOW + 20 * DAY })] });
  assert.deepEqual(state.machines, [
    { key: 'https://build-box.tail.ts.net', label: 'build-box', url: 'https://build-box.tail.ts.net', state: 'unauthorized', expiresInDays: 20, action: 'reconnect' },
  ]);
  assert.equal(JSON.stringify(state).includes('secret-token'), false);
});

test('a key within 3 days of expiry asks for a reconnect while still connected', () => {
  assert.deepEqual(menu({ statuses: [status({ expiresAt: NOW + 2 * DAY })] }).machines.map((m) => [m.state, m.expiresInDays, m.action]),
    [['connected', 2, 'reconnect']]);
});

test('discovered servers not yet connected follow the configured ones', () => {
  const discovery = { servers: [found(), found({ environmentId: 'env-old', label: 'old-box', url: 'https://old.tail.ts.net', compatible: false })], reason: '' };
  assert.deepEqual(menu({ statuses: [status()], discovery }).machines, [
    { key: 'https://build-box.tail.ts.net', label: 'build-box', url: 'https://build-box.tail.ts.net', state: 'connected', action: null },
    { key: 'https://mac.tail.ts.net', label: "Joel's MacBook Pro", url: 'https://mac.tail.ts.net', state: 'found', action: 'connect' },
    { key: 'https://old.tail.ts.net', label: 'old-box', url: 'https://old.tail.ts.net', state: 'incompatible', action: null },
  ]);
});

test('a server configured at one address and found at another shows once', () => {
  const statuses = [status({ url: 'http://100.101.102.103:3773', label: "Joel's MacBook Pro", environmentId: 'env-mac', state: 'unreachable' })];
  const discovery = { servers: [found()], reason: '' };
  assert.deepEqual(menu({ statuses, discovery }).machines, [
    { key: 'http://100.101.102.103:3773', label: "Joel's MacBook Pro", url: 'http://100.101.102.103:3773', state: 'unreachable', action: null },
  ]);
});

test('a configured server still connecting matches a found one by address', () => {
  const statuses = [status({ url: 'https://mac.tail.ts.net', label: 'mac', environmentId: '', state: 'connecting' })];
  assert.deepEqual(menu({ statuses, discovery: { servers: [found()], reason: '' } }).machines.map((m) => [m.label, m.state]), [['mac', 'connecting']]);
});

test('missing Tailscale is reported with no machines', () => {
  assert.deepEqual(menu({ discovery: { servers: [], reason: 'Tailscale not found', missing: true } }), {
    available: true, machines: [], toSetUp: 0, open: false, discovery: { missing: true, reason: 'Tailscale not found' }, pairing: { busy: false, message: '' },
  });
});

test('pairing in progress and its result pass through', () => {
  assert.deepEqual(menu({ pairing: { busy: true, message: 'Pairing…' } }).pairing, { busy: true, message: 'Pairing…' });
  assert.deepEqual(menu({ pairing: { busy: false, message: 'Connected build-box', ok: true } }).pairing, { busy: false, message: 'Connected build-box', ok: true });
});

test('the section counts found and reconnect machines and opens while any need setting up', () => {
  const statuses = [status(), status({ url: 'https://old.tail.ts.net', label: 'old-box', state: 'unauthorized' })];
  const discovery = { servers: [found(), found({ environmentId: 'env-tag', label: 'tagged-old', url: 'https://tag.tail.ts.net', compatible: false })], reason: '' };
  assert.deepEqual(section(menu({ statuses, discovery })), { toSetUp: 2, open: true });
});

test('the section starts collapsed when every machine is connected or there are none', () => {
  assert.deepEqual(section(menu({ statuses: [status({ expiresAt: NOW + 28 * DAY })] })), { toSetUp: 0, open: false });
  assert.deepEqual(section(menu()), { toSetUp: 0, open: false });
});

test('the user toggle overrides the default either way', () => {
  const needy = { discovery: { servers: [found()], reason: '' } };
  assert.deepEqual(section(menu({ ...needy, expanded: false })), { toSetUp: 1, open: false });
  assert.deepEqual(section(menu({ statuses: [status()], expanded: true })), { toSetUp: 0, open: true });
});
