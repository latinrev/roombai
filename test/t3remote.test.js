const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test } = require('node:test');
const { createT3Remote, createT3Servers, loadT3Servers } = require('../src/t3remote');
const { Watcher } = require('../src/watcher');

const TOKEN = 'secret-token-abc123';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function thread(id, fields) {
  return {
    id, projectId: 'p1', title: `Thread ${id}`, providerInstanceId: 'claudeAgent',
    modelSelection: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' },
    status: 'idle', latestRunId: `run-${id}`, latestRunCompletedAt: null, lastError: null,
    pendingRuntimeRequest: null, latestVisibleMessage: { role: 'assistant', text: `Message from ${id}`, updatedAt: iso(60e3) },
    itemCount: 4, lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    archivedAt: null, deletedAt: null, createdAt: iso(3600e3), updatedAt: iso(60e3), ...fields,
  };
}

function fixture() {
  return {
    schemaVersion: 1, snapshotSequence: 7,
    projects: [{ id: 'p1', title: 'garden-app', workspaceRoot: '/srv/garden-app' }, { id: 'p2', title: 'billing', workspaceRoot: '/srv/billing' }],
    threads: [
      thread('run', { status: 'running', title: 'Add seed catalog', latestRunStartedAt: iso(120e3), modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' }, providerInstanceId: 'codex' }),
      thread('ask', { status: 'running', title: 'Approve migration', projectId: 'p2', pendingRuntimeRequest: { id: 'r1', kind: 'approval', createdAt: iso(30e3) } }),
      thread('done', { status: 'completed', title: 'Fix watering timer', latestRunCompletedAt: iso(5 * 60e3) }),
      thread('fail', { status: 'failed', title: 'Deploy preview', lastError: 'provider exited' }),
      thread('old', { status: 'idle', title: 'Old idea', updatedAt: iso(13 * 3600e3) }),
      thread('child', { status: 'running', title: 'Delegated review', lineage: { parentThreadId: 'run', relationshipToParent: 'subagent', rootThreadId: 'run' } }),
      thread('fork', { status: 'running', title: 'Try another layout', lineage: { parentThreadId: 'done', relationshipToParent: 'fork', rootThreadId: 'done' } }),
      thread('gone', { status: 'running', title: 'Archived work', archivedAt: iso(10e3) }),
    ],
    archivedThreads: [thread('arch', { status: 'completed', archivedAt: iso(10e3) })],
  };
}

async function t3Server(t, { shell = fixture, protocol = 2, shellStatus = 200 } = {}) {
  const state = { shell, protocol, shellStatus, requests: [] };
  const server = http.createServer((req, res) => {
    state.requests.push({ url: req.url, headers: req.headers });
    if (req.url === '/.well-known/t3/environment') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ environmentId: 'env-1', label: 'build-box', serverVersion: '0.1.3', orchestrationProtocolVersion: state.protocol }));
    }
    if (req.url === '/api/orchestration/shell') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(`bad token ${req.headers.authorization}`); }
      if (state.shellStatus !== 200) { res.writeHead(state.shellStatus); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      return res.end(zlib.gzipSync(JSON.stringify(state.shell())));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  t.after(() => server.listening && state.close());
  return state;
}

function connect(t, server, { token = TOKEN, now } = {}) {
  const watcher = new Watcher();
  const remote = createT3Remote({ servers: [{ url: server.url, token }], recall: (id, at) => watcher.recall(id, at), now,
    onAgents: (source, list) => watcher.setRemoteAgents(source, list, now?.()) });
  t.after(() => remote.stop());
  const room = () => watcher.snapshot().map(({ id, status, title, project, machine, provider }) => ({ id, status, title, project, machine, provider }));
  const statuses = () => watcher.snapshot().map((a) => [a.id.replace('t3:env-1:', ''), a.status]);
  return { watcher, remote, room, statuses };
}

test('remote threads become roombas with the right status, project and machine', async (t) => {
  const server = await t3Server(t);
  const { remote, room } = connect(t, server);
  await remote.refresh();
  assert.deepEqual(room(), [
    { id: 't3:env-1:ask', status: 'waiting', title: 'Approve migration', project: 'billing', machine: 'build-box', provider: 'claude' },
    { id: 't3:env-1:done', status: 'done', title: 'Fix watering timer', project: 'garden-app', machine: 'build-box', provider: 'claude' },
    { id: 't3:env-1:fail', status: 'stuck', title: 'Deploy preview', project: 'garden-app', machine: 'build-box', provider: 'claude' },
    { id: 't3:env-1:fork', status: 'working', title: 'Try another layout', project: 'garden-app', machine: 'build-box', provider: 'claude' },
    { id: 't3:env-1:run', status: 'working', title: 'Add seed catalog', project: 'garden-app', machine: 'build-box', provider: 'codex' },
  ]);
  assert.deepEqual(remote.status(), [{ url: server.url, label: 'build-box', state: 'ok', error: '' }]);
  const shellRequest = server.requests.find((r) => r.url === '/api/orchestration/shell');
  assert.equal(shellRequest.headers['x-t3-orchestration-protocol'], '2');
  assert.match(shellRequest.headers['accept-encoding'], /gzip/);
});

test('a thread that disappears leaves the room, and an ack survives the next poll', async (t) => {
  const server = await t3Server(t);
  const { watcher, remote, room } = connect(t, server);
  await remote.refresh();
  watcher.ack('t3:env-1:done');
  server.shell = () => ({ ...fixture(), threads: fixture().threads.filter((t) => t.id !== 'run') });
  await remote.refresh();
  assert.deepEqual(room().map((a) => [a.id, a.status]), [['t3:env-1:ask', 'waiting'], ['t3:env-1:done', 'idle'], ['t3:env-1:fail', 'stuck'], ['t3:env-1:fork', 'working']]);
  server.shell = () => ({ ...fixture(), threads: [thread('done', { status: 'running', title: 'Fix watering timer', latestRunId: 'run-2' })] });
  await remote.refresh();
  assert.deepEqual(room().map((a) => [a.id, a.status]), [['t3:env-1:done', 'working']], 'a new run clears the ack');
});

test('a rejected token reports unauthorized without the token text, and keeps the last good roombas', async (t) => {
  const server = await t3Server(t);
  const { remote, room } = connect(t, server, { token: 'wrong-' + TOKEN });
  await remote.refresh();
  const [status] = remote.status();
  assert.equal(status.state, 'unauthorized');
  assert.ok(!JSON.stringify(status).includes(TOKEN), 'token never appears in status');
  assert.deepEqual(room(), []);
  await server.close();

  const good = await t3Server(t);
  const ok = connect(t, good);
  await ok.remote.refresh();
  good.shellStatus = 500;
  await ok.remote.refresh();
  assert.equal(ok.remote.status()[0].state, 'unreachable');
  assert.equal(ok.room().length, 5, 'last good poll stays in the room');
});

test('protocol 3 or a 426 reports incompatible', async (t) => {
  const server = await t3Server(t, { protocol: 3 });
  const { remote, room } = connect(t, server);
  await remote.refresh();
  assert.equal(remote.status()[0].state, 'incompatible');
  assert.ok(!server.requests.some((r) => r.url === '/api/orchestration/shell'), 'no shell request to an incompatible server');
  assert.deepEqual(room(), []);
  await server.close();

  const upgraded = await t3Server(t, { shellStatus: 426 });
  const other = connect(t, upgraded);
  await other.remote.refresh();
  assert.equal(other.remote.status()[0].state, 'incompatible');
});

test('an unreachable server reports unreachable', async (t) => {
  const server = await t3Server(t);
  await server.close();
  const { remote } = connect(t, server);
  await remote.refresh();
  assert.equal(remote.status()[0].state, 'unreachable');
  assert.ok(remote.status()[0].error.length > 0);
});

test('remote status follows T3 awareness phases, not transcript timing', async (t) => {
  const userInput = (blocking) => ({ id: 'q1', kind: 'user_input', blocking, createdAt: iso(10e3) });
  const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: [
    thread('a-live-run', { status: 'completed', activityRunStatus: 'running', activityRunStartedAt: iso(20e3) }),
    thread('b-ask-after-run', { status: 'completed', pendingRuntimeRequest: userInput(false) }),
    thread('c-ask-during-run', { status: 'running', pendingRuntimeRequest: userInput(false) }),
    thread('d-ask-blocking', { status: 'running', pendingRuntimeRequest: userInput(true) }),
    thread('e-permission', { status: 'running', pendingRuntimeRequest: { id: 'p1', kind: 'permission', createdAt: iso(10e3) } }),
    thread('f-auth-refresh', { status: 'running', pendingRuntimeRequest: { id: 'r1', kind: 'auth_refresh', createdAt: iso(10e3) } }),
    thread('g-subagent', { status: 'completed', pendingBackgroundTasks: [{ id: 'b1', kind: 'subagent' }] }),
    thread('h-command', { status: 'completed', pendingBackgroundTasks: [{ id: 'b2', kind: 'command' }] }),
    thread('i-starting', { status: 'starting' }),
    thread('j-queued', { status: 'queued' }),
    thread('k-interrupted', { status: 'interrupted' }),
    thread('l-quiet-run', { status: 'running', updatedAt: iso(20 * 60e3), latestRunStartedAt: iso(25 * 60e3) }),
    thread('m-stopped', { status: 'completed', latestRunStopRequested: true }),
    thread('n-settled', { status: 'completed', settledOverride: 'settled' }),
    thread('o-settled-failed', { status: 'failed', settledOverride: 'settled' }),
    thread('p-settled-subagent', { status: 'completed', settledOverride: 'settled', pendingBackgroundTasks: [{ id: 'b3', kind: 'subagent' }] }),
    thread('q-settled-failed-monitor', { status: 'failed', settledOverride: 'settled', pendingBackgroundTasks: [{ id: 'b4', kind: 'monitor' }] }),
    thread('r-silent-starting', { status: 'starting', latestRunSilent: true }),
    thread('s-silent-ask', { status: 'running', latestRunSilent: true, pendingRuntimeRequest: { id: 'p2', kind: 'permission', createdAt: iso(10e3) } }),
  ] }) });
  const { watcher, remote, statuses } = connect(t, server);
  await remote.refresh();
  assert.deepEqual(statuses(), [
    ['a-live-run', 'working'], ['b-ask-after-run', 'waiting'], ['c-ask-during-run', 'working'], ['d-ask-blocking', 'waiting'],
    ['e-permission', 'waiting'], ['f-auth-refresh', 'working'], ['g-subagent', 'working'], ['h-command', 'done'],
    ['i-starting', 'working'], ['j-queued', 'idle'], ['k-interrupted', 'idle'], ['l-quiet-run', 'working'],
    ['m-stopped', 'idle'], ['n-settled', 'idle'], ['o-settled-failed', 'idle'], ['p-settled-subagent', 'working'],
    ['q-settled-failed-monitor', 'stuck'], ['r-silent-starting', 'idle'], ['s-silent-ask', 'waiting'],
  ]);
  const live = watcher.snapshot().find((a) => a.id === 't3:env-1:a-live-run');
  assert.ok(Math.abs(live.since - (Date.now() - 20e3)) < 5e3, 'since is the activity run start');
});

test('a silent compaction run idles without a turn, and keeps the ack and the hide', async (t) => {
  const finished = iso(5 * 60e3);
  const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: [
    thread('fresh', { status: 'completed', latestRunCompletedAt: finished }),
    thread('seen', { status: 'completed', latestRunCompletedAt: finished }),
    thread('tucked', { status: 'completed', latestRunCompletedAt: finished }),
  ] }) });
  const { watcher, remote } = connect(t, server);
  const room = () => watcher.snapshot().map((a) => [a.id.replace('t3:env-1:', ''), a.status, a.turns]);
  const fresh = [];
  watcher.on('agents', (list) => {
    const status = list.find((a) => a.id === 't3:env-1:fresh')?.status;
    if (status && status !== fresh.at(-1)) fresh.push(status);
  });
  await remote.refresh();
  watcher.ack('t3:env-1:seen');
  watcher.hide('t3:env-1:tucked');
  assert.deepEqual(room(), [['fresh', 'done', 1], ['seen', 'idle', 1]]);

  const compacting = (id, fields) => thread(id, { latestRunId: `compact-${id}`, latestRunSilent: true, ...fields });
  const ids = ['fresh', 'seen', 'tucked'];
  server.shell = () => ({ projects: fixture().projects, threads: [
    ...ids.map((id) => compacting(id, { status: 'running', latestRunStartedAt: iso(2e3), updatedAt: iso(1e3) })),
    compacting('stale', { status: 'running', updatedAt: iso(13 * 3600e3) }),
  ] });
  await remote.refresh();
  assert.deepEqual(room(), [['fresh', 'idle', 1], ['seen', 'idle', 1]], 'a silent run is not work, and an old one stays out');

  server.shell = () => ({ projects: fixture().projects, threads: ids.map((id) => compacting(id, { status: 'completed', latestRunCompletedAt: iso(1e3) })) });
  await remote.refresh();
  assert.deepEqual(room(), [['fresh', 'idle', 1], ['seen', 'idle', 1]], 'ack and hide survive, no new turn');
  assert.deepEqual(fresh, ['done', 'idle'], 'no done, working, done flip');

  server.shell = () => ({ projects: fixture().projects, threads: [thread('seen', { status: 'running', latestRunId: 'run-2' })] });
  await remote.refresh();
  assert.deepEqual(room(), [['seen', 'working', 2]], 'a real run clears the ack and counts');
});

for (const outage of ['returns 500', 'closes']) {
  test(`a server that ${outage} for 30 seconds loses its roombas, and never shows stuck`, async (t) => {
    let clock = Date.now();
    const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: [thread('run', { status: 'running' })] }) });
    const { watcher, remote, statuses } = connect(t, server, { now: () => clock });
    const seen = new Set();
    watcher.on('agents', (list) => { for (const a of list) seen.add(a.status); });
    await remote.refresh();
    assert.deepEqual(statuses(), [['run', 'working']]);

    if (outage === 'closes') await server.close(); else server.shellStatus = 500;
    clock += 25e3;
    await remote.refresh();
    assert.equal(remote.status()[0].state, 'unreachable');
    assert.deepEqual(statuses(), [['run', 'working']], 'a short outage keeps the last good poll');

    clock += 6e3;
    await remote.refresh();
    assert.deepEqual(statuses(), [], 'roombas leave once the server is stale');
    assert.equal(remote.status()[0].state, 'unreachable', 'the tray still says why');
    assert.deepEqual([...seen], ['working']);
  });
}

test('an ack, a hide and the turn count survive an outage that empties the room', async (t) => {
  let clock = Date.now();
  const finished = iso(5 * 60e3);
  const threads = (run) => ['fresh', 'seen', 'tucked'].map((id) => thread(id, { status: run ? 'running' : 'completed', latestRunId: run || `run-${id}`, latestRunCompletedAt: finished }));
  const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: threads() }) });
  const { watcher, remote } = connect(t, server, { now: () => clock });
  const room = () => watcher.snapshot().map((a) => [a.id.replace('t3:env-1:', ''), a.status, a.turns]);
  await remote.refresh();
  watcher.ack('t3:env-1:seen');
  watcher.hide('t3:env-1:tucked');

  server.shellStatus = 500;
  clock += 31e3;
  await remote.refresh();
  assert.deepEqual(room(), [], 'the stale server leaves the room');

  server.shellStatus = 200;
  clock += 10e3;
  await remote.refresh();
  assert.deepEqual(room(), [['fresh', 'done', 1], ['seen', 'idle', 1]], 'the same run comes back acked and hidden');

  server.shell = () => ({ projects: fixture().projects, threads: threads('run-2') });
  await remote.refresh();
  assert.deepEqual(room(), [['fresh', 'working', 2], ['seen', 'working', 2], ['tucked', 'working', 2]], 'a new run resets them');
});

test('a server back after more than 12 hours starts its roombas fresh', async (t) => {
  let clock = Date.now();
  const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: [thread('long', { status: 'running' })] }) });
  const { watcher, remote } = connect(t, server, { now: () => clock });
  const room = () => watcher.snapshot().map((a) => [a.id.replace('t3:env-1:', ''), a.status, a.turns]);
  await remote.refresh();
  watcher.hide('t3:env-1:long');
  assert.deepEqual(room(), []);

  server.shellStatus = 500;
  clock += 31e3;
  await remote.refresh();
  server.shellStatus = 200;
  clock += 13 * 3600e3;
  await remote.refresh();
  assert.deepEqual(room(), [['long', 'working', 1]], 'the hide from before the outage is forgotten');
});

// Stands in for Electron's safeStorage: "enc:" ciphertext, and a token named "boom" fails to encrypt.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => { if (text === 'boom') throw new Error('keychain locked'); return Buffer.from('enc:' + text); },
  decryptString: (buf) => { const text = buf.toString(); if (!text.startsWith('enc:')) throw new Error('bad ciphertext'); return text.slice(4); },
};

function configFile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roombai-t3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 't3-servers.json');
  if (contents !== undefined) fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents), { mode: 0o644 });
  return file;
}

test('t3-servers.json: good entries load and get encrypted, bad ones become problem lines', (t) => {
  const file = configFile(t, [
    { url: 'https://build-box.tail0784c2.ts.net/', token: ' plain-token ' },
    { url: 'https://stored.tail0784c2.ts.net', tokenEnc: Buffer.from('enc:stored-token').toString('base64') },
    { url: 'http://100.101.1.2:3773', token: 'tailnet-token' },
    { url: 'http://localhost:3773', token: 'boom' },
    { url: 'not a url', token: 'x' },
    { url: ['https://box.ts.net'], token: 'x' },
    { url: 'ftp://files.ts.net', token: 'x' },
    { url: 'http://build-box.example.com', token: 'x' },
    { url: 'http://100.12.1.2', token: 'x' },
    { url: 'https://numbers.ts.net', token: 42 },
    { url: 'https://blank.ts.net', token: '' },
    { url: 'https://garbled.ts.net', tokenEnc: 'bm90LWVuY3J5cHRlZA==' },
    'just a string',
  ]);
  const loaded = loadT3Servers({ file, fs, safeStorage });
  assert.deepEqual(loaded.servers, [
    { url: 'https://build-box.tail0784c2.ts.net/', token: 'plain-token' },
    { url: 'https://stored.tail0784c2.ts.net', token: 'stored-token' },
    { url: 'http://100.101.1.2:3773', token: 'tailnet-token' },
    { url: 'http://localhost:3773', token: 'boom' },
  ]);
  assert.deepEqual(loaded.problems, [
    { label: 'localhost', reason: 'could not encrypt the token; it stays in plain text for now' },
    { label: 'entry 5', reason: 'bad URL' },
    { label: 'entry 6', reason: 'url must be a string' },
    { label: 'entry 7', reason: 'bad URL' },
    { label: 'build-box', reason: 'use https; http is only for localhost and Tailscale 100.x addresses' },
    { label: '100.12.1.2', reason: 'use https; http is only for localhost and Tailscale 100.x addresses' },
    { label: 'numbers', reason: 'token must be a string' },
    { label: 'blank', reason: 'token is empty' },
    { label: 'garbled', reason: 'token unreadable; paste it again' },
    { label: 'entry 13', reason: 'expected an object with url and token' },
  ]);
  assert.equal(loaded.retry, true, 'the plain text token is retried later');

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.slice(0, 4), [
    { url: 'https://build-box.tail0784c2.ts.net/', tokenEnc: Buffer.from('enc:plain-token').toString('base64') },
    { url: 'https://stored.tail0784c2.ts.net', tokenEnc: Buffer.from('enc:stored-token').toString('base64') },
    { url: 'http://100.101.1.2:3773', tokenEnc: Buffer.from('enc:tailnet-token').toString('base64') },
    { url: 'http://localhost:3773', token: 'boom' },
  ], 'tokens are encrypted in place; one that fails to encrypt stays as it was');
  assert.equal(saved.length, 13, 'rejected entries stay in the file for the user to fix');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(loaded.mtimeMs, fs.statSync(file).mtimeMs);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['t3-servers.json'], 'no temp file left behind');

  const again = loadT3Servers({ file, fs, safeStorage });
  assert.deepEqual(again.servers, loaded.servers);
  assert.equal(again.mtimeMs, undefined, 'an already encrypted file is not rewritten');
  assert.equal(again.retry, true, 'until the last token encrypts');
});

test('t3-servers.json: a missing file is empty, broken JSON is unreadable, a non-list is one problem', (t) => {
  assert.deepEqual(loadT3Servers({ file: configFile(t), fs, safeStorage }), { servers: [], problems: [] });
  assert.deepEqual(loadT3Servers({ file: configFile(t, '[{ "url": '), fs, safeStorage }),
    { servers: null, problems: [{ label: 't3-servers.json', reason: 'invalid JSON' }] });
  assert.deepEqual(loadT3Servers({ file: configFile(t, { url: 'https://a.ts.net' }), fs, safeStorage }),
    { servers: [], problems: [{ label: 't3-servers.json', reason: 'expected a list of servers' }] });
});

test('t3-servers.json: without secure storage, plaintext tokens work and stored ones wait for it', (t) => {
  const file = configFile(t, [
    { url: 'https://plain.ts.net', token: 'plain-token' },
    { url: 'https://stored.ts.net', tokenEnc: Buffer.from('enc:stored-token').toString('base64') },
  ]);
  const before = fs.readFileSync(file, 'utf8');
  const expected = {
    servers: [{ url: 'https://plain.ts.net', token: 'plain-token' }],
    problems: [{ label: 'stored', reason: 'secure storage unavailable; restart once unlocked' }],
    mtimeMs: undefined,
    retry: false,
  };
  assert.deepEqual(loadT3Servers({ file, fs, safeStorage: { isEncryptionAvailable: () => false } }), expected);
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // Linux with no keyring: encryption "works" with a fixed key, and keyring ciphertext can't be read.
  const basicText = { ...safeStorage, getSelectedStorageBackend: () => 'basic_text', decryptString: () => { throw new Error('no keyring'); } };
  const loaded = loadT3Servers({ file, fs, safeStorage: basicText });
  assert.deepEqual(loaded.problems, expected.problems);
});

test('t3-servers.json: a reload with broken JSON keeps the running servers and shows the problem', async (t) => {
  const server = await t3Server(t);
  const file = configFile(t, [{ url: server.url, token: TOKEN }]);
  const watcher = new Watcher();
  const servers = createT3Servers({ file, fs, safeStorage, watcher });
  t.after(() => servers.stop());
  const room = () => watcher.snapshot().map((a) => a.id.replace('t3:env-1:', ''));
  servers.reload();
  await servers.refresh();
  assert.deepEqual(room(), ['ask', 'done', 'fail', 'fork', 'run']);

  fs.writeFileSync(file, '[{ "url": ');
  servers.reload();
  assert.deepEqual(servers.problems(), [{ label: 't3-servers.json', reason: 'invalid JSON' }]);
  await servers.refresh();
  assert.deepEqual(room(), ['ask', 'done', 'fail', 'fork', 'run'], 'a half-saved file keeps the roombas');
  assert.deepEqual(servers.status().map((s) => s.state), ['ok']);

  fs.writeFileSync(file, '[]');
  servers.reload();
  assert.deepEqual([servers.status(), servers.problems(), room()], [[], [], []], 'an empty list removes the server');
});

test('t3-servers.json: each failed save step names its own problem, and a failed rewrite is retried', async (t) => {
  const failing = (step) => ({ ...fs, [step]: () => { throw new Error(`${step} failed`); } });
  const plain = [{ url: 'https://box.ts.net', token: 'plain-token' }];
  const encrypted = [{ url: 'https://box.ts.net', tokenEnc: Buffer.from('enc:plain-token').toString('base64') }];
  const load = (file, step) => {
    const { problems, retry } = loadT3Servers({ file, fs: failing(step), safeStorage });
    return { problems, retry, saved: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };

  assert.deepEqual(load(configFile(t, plain), 'renameSync'), {
    problems: [{ label: 't3-servers.json', reason: 'could not save encrypted tokens; the file still holds them in plain text' }],
    retry: true, saved: plain,
  });
  assert.deepEqual(load(configFile(t, plain), 'chmodSync'), {
    problems: [{ label: 't3-servers.json', reason: 'tokens saved encrypted, but the file could not be made owner-only' }],
    retry: false, saved: encrypted,
  });
  assert.deepEqual(load(configFile(t, plain), 'statSync'), { problems: [], retry: false, saved: encrypted });

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const file = configFile(t, plain);
  let renames = 0;
  const flaky = { ...fs, renameSync: (...args) => { if (renames++ === 0) throw new Error('busy'); return fs.renameSync(...args); } };
  const servers = createT3Servers({ file, fs: flaky, safeStorage, watcher: new Watcher(), fetch: () => new Promise(() => {}) });
  t.after(() => servers.stop());
  servers.reload();
  assert.equal(servers.problems().length, 1);
  t.mock.timers.tick(10e3);
  assert.deepEqual([servers.problems(), JSON.parse(fs.readFileSync(file, 'utf8'))], [[], encrypted], 'the next tick saves it');
});
