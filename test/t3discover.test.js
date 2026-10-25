const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { discoverT3 } = require('../src/t3discover');

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  return `http://127.0.0.1:${server.address().port}`;
}

const t3 = (t, environmentId, label, extra = {}) => listen(t, (req, res) => {
  if (req.url !== '/.well-known/t3/environment') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ environmentId, label, serverVersion: '0.1.3', orchestrationProtocolVersion: 2, ...extra }));
});

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roombai-discover-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A stand-in for the tailscale CLI: a node script that prints a status fixture, run as a real child process.
function fakeTailscale(t, { status, exitCode = 0 }) {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  const cli = path.join(dir, 'tailscale.js');
  fs.writeFileSync(cli, `process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(dir, 'status.json'))}));process.exitCode=${exitCode};`);
  const exec = (file, args, opts, cb) => execFile(process.execPath, [file, ...args], opts, cb);
  return { clis: [cli], exec, dir };
}

// Plays DNS and Tailscale Serve: tailnet URLs reach local servers, loopback passes through, the rest is refused.
const routed = (routes) => (url, opts) => {
  const u = new URL(url);
  return globalThis.fetch((routes[u.origin] || (u.hostname === '127.0.0.1' ? u.origin : 'http://127.0.0.1:1')) + u.pathname, opts);
};

const ME = 101;
const TAGGED = 2147455655;
const peer = (DNSName, ip, Online = true, extra = {}) => ({ DNSName, Online, UserID: ME, TailscaleIPs: [ip, 'fd7a:115c:a1e0::1'], ...extra });

test('discovery lists each online T3 peer of this user or tagged in their tailnet once, prefers https, and leaves out itself', async (t) => {
  const linux = await t3(t, 'env-linux', 'joel-linux');
  const mac = await t3(t, 'env-mac', 'mac-studio');
  const offline = await t3(t, 'env-off', 'sleeping');
  const pseudo = await t3(t, 'env-funnel', 'funnel');
  const self = await t3(t, 'env-self', 'this-pc');
  const shared = await t3(t, 'env-shared', 'friends-box');
  const runner = await t3(t, 'env-runner', 'ci-runner');
  const broken = await t3(t, 'env-bad', 42);
  const garbled = await t3(t, '', 'nameless');
  const older = await t3(t, 'env-old', 'old-t3', { orchestrationProtocolVersion: 1 });
  const notT3 = await listen(t, (req, res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); });
  const hang = await listen(t, () => {});

  const { clis, exec, dir } = fakeTailscale(t, { status: {
    BackendState: 'Running',
    MagicDNSSuffix: 'tail.ts.net',
    Self: { DNSName: 'this-pc.tail.ts.net.', Online: true, UserID: ME, TailscaleIPs: ['100.64.0.1'] },
    Peer: {
      a: peer('joel-linux.tail.ts.net.', '100.64.0.2'),
      b: peer('mac-studio.tail.ts.net.', '100.64.0.3'),
      c: peer('sleeping.tail.ts.net.', '100.64.0.4', false),
      d: peer('', '100.64.0.5'),
      e: peer('printer.tail.ts.net.', '100.64.0.6'),
      f: peer('this-pc-wsl.tail.ts.net.', '100.64.0.7'),
      g: peer('slow.tail.ts.net.', '100.64.0.8'),
      h: peer('friends-box.other.ts.net.', '100.64.0.9', true, { UserID: 202 }),
      i: peer('coworker.tail.ts.net.', '100.64.0.10', true, { UserID: 303 }),
      l: peer('guest-laptop.other.ts.net.', '100.64.0.13', true, { ShareeNode: true, UserID: 404 }),
      m: peer('ci-runner.tail.ts.net.', '100.64.0.14', true, { UserID: TAGGED, Tags: ['tag:server'] }),
      n: peer('their-runner.other.ts.net.', '100.64.0.15', true, { UserID: TAGGED, Tags: ['tag:server'] }),
      j: peer('odd.tail.ts.net.', '100.64.0.11'),
      k: peer('old-t3.tail.ts.net.', '100.64.0.12'),
    },
  } });
  fs.mkdirSync(path.join(dir, 'userdata'));
  fs.writeFileSync(path.join(dir, 'userdata', 'environment-id'), 'env-self\n');

  const fetch = routed({
    'https://joel-linux.tail.ts.net': linux, 'http://100.64.0.2:3773': linux,
    'https://mac-studio.tail.ts.net': notT3, 'http://100.64.0.3:3773': mac,
    'https://sleeping.tail.ts.net': offline, 'http://100.64.0.4:3773': offline,
    'http://100.64.0.5:3773': pseudo,
    'https://printer.tail.ts.net': notT3,
    'https://this-pc.tail.ts.net': self, 'http://100.64.0.1:3773': self,
    'http://100.64.0.7:3773': self,
    'https://slow.tail.ts.net': hang,
    'https://friends-box.other.ts.net': shared, 'https://coworker.tail.ts.net': shared, 'https://guest-laptop.other.ts.net': shared,
    'https://ci-runner.tail.ts.net': runner, 'https://their-runner.other.ts.net': shared,
    'https://odd.tail.ts.net': broken, 'http://100.64.0.11:3773': garbled,
    'https://old-t3.tail.ts.net': older,
  });
  const started = Date.now();
  const found = await discoverT3({ clis, exec, fetch, t3Home: dir, timeoutMs: 300 });
  assert.deepEqual(found, { reason: '', servers: [
    { environmentId: 'env-runner', label: 'ci-runner', url: 'https://ci-runner.tail.ts.net', compatible: true },
    { environmentId: 'env-linux', label: 'joel-linux', url: 'https://joel-linux.tail.ts.net', compatible: true },
    { environmentId: 'env-mac', label: 'mac-studio', url: 'http://100.64.0.3:3773', compatible: true },
    { environmentId: 'env-bad', label: 'odd', url: 'https://odd.tail.ts.net', compatible: true },
    { environmentId: 'env-old', label: 'old-t3', url: 'https://old-t3.tail.ts.net', compatible: false },
  ] });
  assert.ok(Date.now() - started < 2e3, 'probes run in parallel and a silent peer times out');
});

test('without an environment-id file, the server named in server-runtime.json is left out', async (t) => {
  const self = await t3(t, 'env-self', 'this-pc');
  const { clis, exec, dir } = fakeTailscale(t, { status: {
    BackendState: 'Running', Self: { UserID: ME }, Peer: { a: peer('this-pc-wsl.tail.ts.net.', '100.64.0.7') },
  } });
  fs.mkdirSync(path.join(dir, 'userdata'));
  fs.writeFileSync(path.join(dir, 'userdata', 'server-runtime.json'), JSON.stringify({ origin: self + '/' }));
  const fetch = routed({ 'https://this-pc-wsl.tail.ts.net': self });
  assert.deepEqual(await discoverT3({ clis, exec, fetch, t3Home: dir, timeoutMs: 300 }), { servers: [], reason: '' });
});

test('discovery without Tailscale returns no servers and says why', async (t) => {
  const missing = path.join(tmpDir(t), 'no-tailscale');
  assert.deepEqual(await discoverT3({ clis: [missing, missing + '-2'], t3Home: '/nonexistent' }), { servers: [], reason: 'Tailscale not found' });

  const stopped = fakeTailscale(t, { status: { BackendState: 'Stopped', Peer: {} } });
  assert.deepEqual(await discoverT3({ ...stopped, t3Home: '/nonexistent' }), { servers: [], reason: 'Tailscale not running' });

  const failing = fakeTailscale(t, { status: {}, exitCode: 1 });
  assert.deepEqual(await discoverT3({ ...failing, t3Home: '/nonexistent' }), { servers: [], reason: 'Tailscale not running' });
});

test('a missing fixed install path falls through to tailscale on PATH', async (t) => {
  const linux = await t3(t, 'env-linux', 'joel-linux');
  const onPath = fakeTailscale(t, { status: { BackendState: 'Running', Self: { UserID: ME }, Peer: { a: peer('joel-linux.tail.ts.net.', '100.64.0.2') } } });
  const exec = (file, args, opts, cb) => (file === 'tailscale' ? onPath.exec(onPath.clis[0], args, opts, cb) : execFile(file, args, opts, cb));
  const found = await discoverT3({ clis: [path.join(tmpDir(t), 'Tailscale.exe'), 'tailscale'], exec,
    fetch: routed({ 'https://joel-linux.tail.ts.net': linux }), t3Home: '/nonexistent', timeoutMs: 300 });
  assert.deepEqual(found.servers.map((s) => s.label), ['joel-linux']);
});
