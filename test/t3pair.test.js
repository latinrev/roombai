const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pairT3 } = require('../src/t3pair');
const { createT3Servers, describeServer } = require('../src/t3remote');
const { Watcher } = require('../src/watcher');

const DAY = 864e5;
const CRED = 'K7M2Q9XRT4WZ';

// A T3 server with one-time pairing credentials, as /oauth/token and the shell route behave.
async function t3Server(t, { environmentId = 'env-1', label = 'build-box', scope = (asked) => asked } = {}) {
  const state = { credentials: new Set([CRED]), tokens: new Set(), forms: [] };
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/.well-known/t3/environment') return json(200, { environmentId, label, orchestrationProtocolVersion: 2 });
    if (req.url === '/oauth/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = Object.fromEntries(new URLSearchParams(body));
      state.forms.push(form);
      if (!state.credentials.delete(form.subject_token)) return json(401, { _tag: 'EnvironmentAuthInvalidError', code: 'auth_invalid', reason: 'invalid_credential' });
      const token = `access-${state.tokens.size + 1}-${environmentId}`;
      state.tokens.add(token);
      return json(200, { access_token: token, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 30 * 86400, scope: scope(form.scope) });
    }
    if (req.url === '/api/orchestration/shell') {
      if (!state.tokens.has((req.headers.authorization || '').replace('Bearer ', ''))) return json(401, { code: 'auth_invalid' });
      return json(200, { projects: [], threads: [] });
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  state.local = `http://127.0.0.1:${server.address().port}`;
  return state;
}

// Plays DNS and Tailscale Serve, so a tailnet https name reaches a local server.
const routed = (routes) => (url, opts) => {
  const u = new URL(url);
  return globalThis.fetch((routes[u.origin] || u.origin) + u.pathname, opts);
};

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from('enc:' + text),
  decryptString: (buf) => buf.toString().slice(4),
};

function configFile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roombai-pair-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 't3-servers.json');
  if (contents !== undefined) fs.writeFileSync(file, JSON.stringify(contents));
  return file;
}

function servers(t, file, fetch) {
  const s = createT3Servers({ file, fs, safeStorage, watcher: new Watcher(), fetch });
  t.after(() => s.stop());
  return s;
}

const BOX = 'https://build-box.tail.ts.net';

for (const [name, link] of [
  ['a direct link', `${BOX}/pair#token=${CRED}`],
  ['a hosted app link', `https://app.t3.codes/pair?host=${encodeURIComponent(BOX)}&label=build-box#token=${CRED}`],
  ['an old link with the token in the query', `${BOX}/pair?token=${CRED}`],
]) {
  test(`pairing with ${name} stores an encrypted read-only key and polls ok`, async (t) => {
    const server = await t3Server(t);
    const fetch = routed({ [BOX]: server.local });
    const file = configFile(t);
    const before = Date.now();
    assert.deepEqual(await pairT3({ text: ` ${link}\n`, file, fs, fetch, platform: 'win32' }), { label: 'build-box', url: BOX });
    assert.deepEqual(server.forms, [{
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: CRED,
      subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'orchestration:read', client_label: 'roombai', client_device_type: 'desktop', client_os: 'Windows',
    }]);

    const s = servers(t, file, fetch);
    s.reload();
    await s.refresh();
    const [entry] = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(entry), ['url', 'expiresAt', 'tokenEnc']);
    assert.equal(entry.url, BOX);
    assert.equal(Buffer.from(entry.tokenEnc, 'base64').toString(), 'enc:access-1-env-1');
    const expiresAt = Date.parse(entry.expiresAt);
    assert.ok(expiresAt >= before + 30 * DAY && expiresAt <= Date.now() + 30 * DAY, 'expiresAt is 30 days out');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(s.status().map((st) => describeServer(st)), [{ text: 'build-box: ok (key expires in 30 d)', reconnect: false }]);
  });
}

test('a link made on the server itself pairs with the one server found on the tailnet', async (t) => {
  const server = await t3Server(t);
  const fetch = routed({ [BOX]: server.local });
  const file = configFile(t);
  const local = `http://localhost:3773/pair#token=${CRED}`;
  assert.deepEqual(await pairT3({ text: local, file, fs, fetch, candidates: [] }),
    { problem: 'the link points at the server\'s own machine; make the link from its Tailscale address' });
  assert.deepEqual(await pairT3({ text: CRED, file, fs, fetch, candidates: [BOX, 'https://other.tail.ts.net'] }),
    { problem: 'a bare pairing code does not say which server; make the link from its Tailscale address' });
  assert.equal(fs.existsSync(file), false, 'nothing saved and no credential spent');
  assert.deepEqual(server.forms, []);
  assert.deepEqual(await pairT3({ text: local, file, fs, fetch, candidates: [BOX] }), { label: 'build-box', url: BOX });
});

test('a server that grants more than read access is refused and nothing is stored', async (t) => {
  const server = await t3Server(t, { scope: () => 'orchestration:read orchestration:write' });
  const file = configFile(t, [{ url: 'https://kept.ts.net', token: 'keep-me' }]);
  const result = await pairT3({ text: `${BOX}/pair#token=${CRED}`, file, fs, fetch: routed({ [BOX]: server.local }) });
  assert.deepEqual(result, { problem: 'the server did not grant exactly read-only access; nothing was saved' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ url: 'https://kept.ts.net', token: 'keep-me' }]);
});

test('a used pairing link gives a clear problem without the credential', async (t) => {
  const server = await t3Server(t);
  const fetch = routed({ [BOX]: server.local });
  const file = configFile(t);
  const link = `${BOX}/pair#token=${CRED}`;
  assert.ok((await pairT3({ text: link, file, fs, fetch })).label);
  const saved = fs.readFileSync(file, 'utf8');
  const again = await pairT3({ text: link, file, fs, fetch });
  assert.deepEqual(again, { problem: 'that pairing link is used up or expired; make a new one' });
  assert.equal(fs.readFileSync(file, 'utf8'), saved, 'the first pairing stays');
});

test('bad links and bad hosts are refused before any credential is sent', async (t) => {
  const server = await t3Server(t);
  const file = configFile(t);
  const fetch = routed({ [BOX]: server.local });
  const problems = [];
  for (const text of ['', 'hello there', 'ftp://box.ts.net/pair#token=X', `${BOX}/pair`, `https://app.t3.codes/pair#token=${CRED}`,
    `http://build-box.example.com/pair#token=${CRED}`, `http://100.12.1.2:3773/pair#token=${CRED}`, `https://unknown.invalid/pair#token=${CRED}`]) {
    problems.push((await pairT3({ text, file, fs, fetch })).problem);
  }
  assert.deepEqual(problems.slice(0, 7), [
    'the clipboard is empty; copy a pairing link first',
    'the clipboard does not hold a T3 pairing link',
    'the clipboard does not hold a T3 pairing link',
    'the link has no pairing token',
    'the link does not name a server',
    'the link\'s server address: use https; http is only for localhost and Tailscale 100.x addresses',
    'the link\'s server address: use https; http is only for localhost and Tailscale 100.x addresses',
  ]);
  assert.match(problems[7], /^could not reach the server: /);
  assert.ok(!problems.join(' ').includes(CRED), 'no problem line shows the credential');
  assert.deepEqual(server.forms, []);

  fs.writeFileSync(file, '[{ "url": ');
  assert.deepEqual(await pairT3({ text: `${BOX}/pair#token=${CRED}`, file, fs, fetch }), { problem: 'fix t3-servers.json first; it cannot be read' });
  assert.deepEqual(server.forms, [], 'a broken config does not spend the credential');
});

test('the tray line shows the key expiry and asks for a reconnect near expiry or on a rejected key', async (t) => {
  const server = await t3Server(t);
  server.tokens.add('good');
  const at = (days) => new Date(Date.now() + days * DAY + 60e3).toISOString();
  const names = ['fresh', 'soon', 'rejected', 'manual'];
  const url = (name) => `https://${name}.tail.ts.net`;
  const fetch = routed(Object.fromEntries(names.map((n) => [url(n), server.local])));
  const file = configFile(t, [
    { url: url('fresh'), token: 'good', expiresAt: at(12) },
    { url: url('soon'), token: 'good', expiresAt: at(2) },
    { url: url('rejected'), token: 'revoked', expiresAt: at(20) },
    { url: url('manual'), token: 'good' },
  ]);
  const s = servers(t, file, fetch);
  s.reload();
  await s.refresh();
  assert.deepEqual(s.status().map((st) => [st.url, describeServer(st)]), [
    [url('fresh'), { text: 'build-box: ok (key expires in 12 d)', reconnect: false }],
    [url('soon'), { text: 'build-box: ok (key expires in 2 d)', reconnect: true }],
    [url('rejected'), { text: 'build-box: unauthorized (token rejected; issue a new one)', reconnect: true }],
    [url('manual'), { text: 'build-box: ok', reconnect: false }],
  ]);
  assert.deepEqual(describeServer({ label: 'x', state: 'ok', error: '', expiresAt: Date.now() + 5 * 36e5 }), { text: 'x: ok (key expires in 5 h)', reconnect: true });

  // Reconnecting the rejected server through another address of the same environment replaces its entry.
  const result = await pairT3({ text: `${url('fresh')}/pair#token=${CRED}`, file, fs, fetch, statuses: s.status() });
  assert.deepEqual(result, { label: 'build-box', url: url('fresh') });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map((e) => e.url), [url('fresh')], 'one entry per environment');
});
