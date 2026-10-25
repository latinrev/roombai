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

const t3 = (t, environmentId, label) => listen(t, (req, res) => {
  if (req.url !== '/.well-known/t3/environment') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ environmentId, label, serverVersion: '0.1.3', orchestrationProtocolVersion: 2 }));
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
  return { cli, exec, dir };
}

// Plays DNS and Tailscale Serve: tailnet URLs reach local servers, loopback passes through, the rest is refused.
const routed = (routes) => (url, opts) => {
  const u = new URL(url);
  return globalThis.fetch((routes[u.origin] || (u.hostname === '127.0.0.1' ? u.origin : 'http://127.0.0.1:1')) + u.pathname, opts);
};

const peer = (DNSName, ip, Online = true) => ({ DNSName, Online, TailscaleIPs: [ip, 'fd7a:115c:a1e0::1'] });

test('discovery lists each online T3 peer once, prefers https, and leaves out itself', async (t) => {
  const linux = await t3(t, 'env-linux', 'joel-linux');
  const mac = await t3(t, 'env-mac', 'mac-studio');
  const offline = await t3(t, 'env-off', 'sleeping');
  const pseudo = await t3(t, 'env-funnel', 'funnel');
  const self = await t3(t, 'env-self', 'this-pc');
  const notT3 = await listen(t, (req, res) => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); });
  const hang = await listen(t, () => {});

  const { cli, exec, dir } = fakeTailscale(t, { status: {
    BackendState: 'Running',
    Self: { DNSName: 'this-pc.tail.ts.net.', Online: true, TailscaleIPs: ['100.64.0.1'] },
    Peer: {
      a: peer('joel-linux.tail.ts.net.', '100.64.0.2'),
      b: peer('mac-studio.tail.ts.net.', '100.64.0.3'),
      c: peer('sleeping.tail.ts.net.', '100.64.0.4', false),
      d: peer('', '100.64.0.5'),
      e: peer('printer.tail.ts.net.', '100.64.0.6'),
      f: peer('this-pc-wsl.tail.ts.net.', '100.64.0.7'),
      g: peer('slow.tail.ts.net.', '100.64.0.8'),
    },
  } });
  const selfFile = path.join(dir, 'server-runtime.json');
  fs.writeFileSync(selfFile, JSON.stringify({ origin: self + '/' }));

  const fetch = routed({
    'https://joel-linux.tail.ts.net': linux, 'http://100.64.0.2:3773': linux,
    'https://mac-studio.tail.ts.net': notT3, 'http://100.64.0.3:3773': mac,
    'https://sleeping.tail.ts.net': offline, 'http://100.64.0.4:3773': offline,
    'http://100.64.0.5:3773': pseudo,
    'https://printer.tail.ts.net': notT3,
    'https://this-pc.tail.ts.net': self, 'http://100.64.0.1:3773': self,
    'http://100.64.0.7:3773': self,
    'https://slow.tail.ts.net': hang,
  });
  const started = Date.now();
  const found = await discoverT3({ cli, exec, fetch, selfFile, timeoutMs: 300 });
  assert.deepEqual(found, { reason: '', servers: [
    { environmentId: 'env-linux', label: 'joel-linux', url: 'https://joel-linux.tail.ts.net' },
    { environmentId: 'env-mac', label: 'mac-studio', url: 'http://100.64.0.3:3773' },
  ] });
  assert.ok(Date.now() - started < 2e3, 'probes run in parallel and a silent peer times out');
});

test('discovery without Tailscale returns no servers and says why', async (t) => {
  const missing = await discoverT3({ cli: path.join(tmpDir(t), 'no-tailscale'), selfFile: '/nonexistent' });
  assert.deepEqual(missing, { servers: [], reason: 'Tailscale not installed' });

  const stopped = fakeTailscale(t, { status: { BackendState: 'Stopped', Peer: {} } });
  assert.deepEqual(await discoverT3({ ...stopped, selfFile: '/nonexistent' }), { servers: [], reason: 'Tailscale not running' });

  const failing = fakeTailscale(t, { status: {}, exitCode: 1 });
  assert.deepEqual(await discoverT3({ ...failing, selfFile: '/nonexistent' }), { servers: [], reason: 'Tailscale not running' });
});
