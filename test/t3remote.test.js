const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { test } = require('node:test');
const { createT3Remote } = require('../src/t3remote');
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
      thread('child', { status: 'running', title: 'Delegated review', lineage: { parentThreadId: 'run', relationshipToParent: 'delegate', rootThreadId: 'run' } }),
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
  const remote = createT3Remote({ servers: [{ url: server.url, token }], prev: watcher.agents, now,
    onAgents: (source, list) => watcher.setRemoteAgents(source, list) });
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
  assert.deepEqual(room().map((a) => [a.id, a.status]), [['t3:env-1:ask', 'waiting'], ['t3:env-1:done', 'idle'], ['t3:env-1:fail', 'stuck']]);
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
  assert.equal(ok.room().length, 4, 'last good poll stays in the room');
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
  ] }) });
  const { watcher, remote, statuses } = connect(t, server);
  await remote.refresh();
  assert.deepEqual(statuses(), [
    ['a-live-run', 'working'], ['b-ask-after-run', 'waiting'], ['c-ask-during-run', 'working'], ['d-ask-blocking', 'waiting'],
    ['e-permission', 'waiting'], ['f-auth-refresh', 'working'], ['g-subagent', 'working'], ['h-command', 'done'],
    ['i-starting', 'working'], ['j-queued', 'idle'], ['k-interrupted', 'idle'], ['l-quiet-run', 'working'],
  ]);
  const live = watcher.snapshot().find((a) => a.id === 't3:env-1:a-live-run');
  assert.ok(Math.abs(live.since - (Date.now() - 20e3)) < 5e3, 'since is the activity run start');
});

test('a silent compaction run keeps the ack, the hide, the finish time and the turn count', async (t) => {
  const finished = iso(5 * 60e3);
  const server = await t3Server(t, { shell: () => ({ projects: fixture().projects, threads: [
    thread('fresh', { status: 'completed', latestRunCompletedAt: finished }),
    thread('seen', { status: 'completed', latestRunCompletedAt: finished }),
    thread('tucked', { status: 'completed', latestRunCompletedAt: finished }),
  ] }) });
  const { watcher, remote } = connect(t, server);
  const room = () => watcher.snapshot().map((a) => [a.id.replace('t3:env-1:', ''), a.status, a.turns, a.since]);
  await remote.refresh();
  watcher.ack('t3:env-1:seen');
  watcher.hide('t3:env-1:tucked');
  assert.deepEqual(room().map((a) => a.slice(0, 3)), [['fresh', 'done', 1], ['seen', 'idle', 1]]);

  const compacted = (id, fields = {}) => thread(id, { status: 'completed', latestRunId: `compact-${id}`, latestRunSilent: true, latestRunCompletedAt: iso(1e3), ...fields });
  server.shell = () => ({ projects: fixture().projects, threads: ['fresh', 'seen', 'tucked'].map((id) => compacted(id)) });
  await remote.refresh();
  assert.deepEqual(room().map((a) => a.slice(0, 3)), [['fresh', 'done', 1], ['seen', 'idle', 1]], 'ack and hide survive, no new turn');
  assert.equal(room()[0][3], Date.parse(finished), 'done keeps the real run finish time');

  server.shell = () => ({ projects: fixture().projects, threads: [thread('seen', { status: 'running', latestRunId: 'run-2' })] });
  await remote.refresh();
  assert.deepEqual(room().map((a) => a.slice(0, 3)), [['seen', 'working', 2]], 'a real run clears the ack and counts');
});
