// Read-only polling of remote T3 Code servers. Each remote thread becomes an agent record
// that carries T3's own status, so the Watcher's ack and hide apply but its transcript rules don't.
const crypto = require('crypto');
const path = require('path');
const { newAgent, firstLine, RECENT_FILE_MS } = require('./watcher');

const POLL_MS = 10e3;
const TIMEOUT_MS = 8e3;
const PROTOCOL = 2;
// A server with no good poll for this long loses its roombas. An outage is not an agent status.
const STALE_MS = 3 * POLL_MS;

// T3 awareness phase -> room status, with both waiting phases shown as waiting.
const ROOM_STATUS = { starting: 'working', running: 'working', waiting_for_input: 'waiting',
  waiting_for_approval: 'waiting', completed: 'done', failed: 'stuck' };
const LIVE_RUN = new Set(['preparing', 'starting', 'running']);
const HOLDS_COMPLETION = new Set(['subagent', 'monitor', 'background_task']);

const holdsCompletion = (thread) => (thread.pendingBackgroundTasks || []).some((task) => HOLDS_COMPLETION.has(task.kind));

// Mirrors T3's resolveThreadAwarenessPhaseV2 (packages/shared/src/agentAwareness.ts). idle, queued,
// interrupted, cancelled and rolled_back have no phase.
function phaseOf(thread) {
  const run = thread.activityRunStatus ?? thread.status;
  const request = thread.pendingRuntimeRequest;
  if (request?.kind === 'user_input' && (request.blocking !== false || !LIVE_RUN.has(run))) return 'waiting_for_input';
  if (request && request.kind !== 'user_input' && request.kind !== 'auth_refresh') return 'waiting_for_approval';
  if (run === 'preparing' || run === 'starting') return 'starting';
  if (run === 'running' || run === 'waiting') return 'running';
  if (run === 'completed') return holdsCompletion(thread) ? 'running' : 'completed';
  if (run === 'failed') return 'failed';
  return null;
}

// Mirrors T3's projectThreadAwarenessV2: a thread T3 leaves out of its awareness list idles here.
function remoteStatusOf(thread) {
  const phase = phaseOf(thread);
  if (phase === 'completed' && thread.latestRunStopRequested === true) return 'idle';
  if (thread.latestRunSilent === true && (phase === 'starting' || phase === 'running' || phase === 'completed')) return 'idle';
  if (thread.settledOverride === 'settled' && (phase === 'completed' || phase === 'failed') && !holdsCompletion(thread)) return 'idle';
  return ROOM_STATUS[phase] || 'idle';
}

const time = (value) => Date.parse(value || '') || 0;

function providerOf(thread) {
  const s = `${thread.modelSelection?.model || ''} ${thread.modelSelection?.instanceId || ''} ${thread.providerInstanceId || ''}`.toLowerCase();
  if (s.includes('claude')) return 'claude';
  if (/codex|gpt/.test(s)) return 'codex';
  return 'custom';
}

// server: { environmentId, label }. recall(id): that agent's record from earlier polls, if any.
function agentsFromShell(shell, server, now, recall = () => undefined) {
  const projects = new Map((shell?.projects || []).map((p) => [p.id, p.title || '']));
  const out = [];
  for (const t of shell?.threads || []) {
    if (!t?.id || t.archivedAt || t.deletedAt || t.lineage?.parentThreadId) continue;
    const status = remoteStatusOf(t);
    const updatedAt = time(t.updatedAt) || time(t.createdAt);
    if (status !== 'working' && status !== 'waiting' && now - updatedAt > RECENT_FILE_MS) continue;

    const id = `t3:${server.environmentId}:${t.id}`;
    const before = recall(id);
    const runId = t.latestRunId || '';
    // Idle compaction starts a silent run: it must not undo an ack or count as a turn.
    const silent = t.latestRunSilent === true;
    const newRun = Boolean(before && runId && before.runId !== runId && !silent);
    const keep = before && !newRun;
    const a = newAgent(id, providerOf(t));
    Object.assign(a, {
      host: 't3code',
      machine: server.label,
      title: firstLine(t.title, 60),
      project: projects.get(t.projectId) || '',
      remoteStatus: status,
      lastEventAt: updatedAt,
      turnStartedAt: time(t.activityRunStartedAt) || time(t.latestRunStartedAt) || updatedAt,
      completedAt: status === 'done' ? time(t.latestRunCompletedAt) || updatedAt : before?.completedAt || 0,
      error: status === 'stuck' ? firstLine(t.lastError || 'failed', 140) : '',
      lastMessage: firstLine(t.latestVisibleMessage?.text, 220),
      toolCalls: t.itemCount || 0,
      runId,
      turns: before ? before.turns + (newRun ? 1 : 0) : runId && !silent ? 1 : 0,
      acked: keep ? before.acked : false,
      hidden: keep ? before.hidden : false,
    });
    out.push(a);
  }
  return out;
}

// Every error string passes through here before it is stored, logged or shown.
function redact(message, secrets) {
  let s = String(message || 'error');
  for (const secret of secrets) if (secret) s = s.split(secret).join('[token]');
  return firstLine(s.replace(/Bearer\s+\S+/gi, 'Bearer [token]'), 140);
}

class HttpError extends Error {
  constructor(status) { super(`HTTP ${status}`); this.status = status; }
}

class IncompatibleError extends Error {}

const trimUrl = (url) => String(url).replace(/\/+$/, '');

// servers: [{ url, token }]. onAgents(url, agents) after each good poll; onStatus() when a status changes.
function createT3Remote({ servers = [], fetch = globalThis.fetch, now = Date.now, onAgents = () => {},
  onStatus = () => {}, recall } = {}) {
  const entries = servers.map((s) => ({
    url: trimUrl(s.url), token: s.token || '', env: null, timer: null, busy: null,
    lastOkAt: now(), cleared: false,
    status: { url: trimUrl(s.url), label: hostOf(s.url), state: 'connecting', error: '' },
  }));
  let stopped = false;

  function setStatus(e, state, error = '') {
    const next = { ...e.status, state, error: error && redact(error, [e.token]) };
    if (next.state === e.status.state && next.error === e.status.error && next.label === e.status.label) return;
    e.status = next;
    onStatus();
  }

  async function getJson(e, path, headers = {}) {
    const res = await fetch(e.url + path, { headers: { Accept: 'application/json', ...headers }, redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new HttpError(res.status);
    return res.json();
  }

  async function fetchAgents(e) {
    if (!e.env) {
      const env = await getJson(e, '/.well-known/t3/environment');
      if (env?.orchestrationProtocolVersion !== PROTOCOL || !env.environmentId) {
        throw new IncompatibleError(`server speaks protocol ${env?.orchestrationProtocolVersion ?? 'unknown'}, Roombai needs ${PROTOCOL}`);
      }
      e.env = { environmentId: env.environmentId, label: env.label || hostOf(e.url) };
      e.status = { ...e.status, label: e.env.label };
    }
    const shell = await getJson(e, '/api/orchestration/shell', {
      Authorization: `Bearer ${e.token}`, 'x-t3-orchestration-protocol': String(PROTOCOL), 'Accept-Encoding': 'gzip',
    });
    return agentsFromShell(shell, e.env, now(), recall);
  }

  async function poll(e) {
    try {
      const agents = await fetchAgents(e);
      if (stopped) return;
      e.lastOkAt = now();
      e.cleared = false;
      onAgents(e.url, agents);
      setStatus(e, 'ok');
    } catch (err) {
      if (stopped) return;
      if (err instanceof IncompatibleError) setStatus(e, 'incompatible', err.message);
      else if (err.status === 401 || err.status === 403) setStatus(e, 'unauthorized', 'token rejected; issue a new one');
      else if (err.status === 426) { e.env = null; setStatus(e, 'incompatible', 'server wants a different protocol'); }
      else setStatus(e, 'unreachable', err.cause?.message || err.message);
      if (!e.cleared && now() - e.lastOkAt > STALE_MS) { e.cleared = true; onAgents(e.url, []); }
    }
  }

  // One request per server at a time: a refresh during a poll waits for that poll.
  function pollOnce(e) {
    if (!e.busy) e.busy = poll(e).finally(() => { e.busy = null; });
    return e.busy;
  }

  function loop(e) {
    pollOnce(e).then(() => { if (!stopped) { e.timer = setTimeout(() => loop(e), POLL_MS); e.timer.unref?.(); } });
  }

  return {
    start() { for (const e of entries) loop(e); },
    stop() { stopped = true; for (const e of entries) clearTimeout(e.timer); },
    refresh() { return Promise.all(entries.map(pollOnce)); },
    status() { return entries.map((e) => ({ ...e.status })); },
  };
}

// http is allowed only where traffic stays on this machine or inside the tailnet (100.64.0.0/10).
function urlProblem(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'bad URL'; }
  if (u.protocol === 'https:') return '';
  if (u.protocol !== 'http:') return 'bad URL';
  const tailnet = /^100\.(\d+)\.\d+\.\d+$/.exec(u.hostname);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || (tailnet && tailnet[1] >= 64 && tailnet[1] <= 127)) return '';
  return 'use https; http is only for localhost and Tailscale 100.x addresses';
}

// t3-servers.json: [{ "url": "https://host.tailnet.ts.net", "token": "..." }]. Plaintext tokens are swapped
// for safeStorage ciphertext as they are read. mtimeMs is set when this call rewrote the file, and retry
// when a token is still plain text and a later load should try again. servers is null when the file
// can't be read or parsed, which may be a half-saved edit.
function loadT3Servers({ file, fs, safeStorage }) {
  const name = path.basename(file);
  let list;
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return { servers: [], problems: [] };
    return { servers: null, problems: [{ label: name, reason: err instanceof SyntaxError ? 'invalid JSON' : 'unreadable' }] };
  }
  if (!Array.isArray(list)) return { servers: [], problems: [{ label: name, reason: 'expected a list of servers' }] };
  let canEncrypt = false;
  try { canEncrypt = safeStorage.isEncryptionAvailable(); } catch {}
  let backend;
  try { backend = safeStorage.getSelectedStorageBackend?.(); } catch {}
  // On Linux, basic_text means no keyring answered, so a token sealed by the keyring can't be read yet.
  const keyring = canEncrypt && backend !== 'basic_text';
  const servers = [];
  const problems = [];
  let changed = false;
  let retry = false;
  for (const [i, entry] of list.entries()) {
    // A bad URL may be a pasted token, so it is never shown.
    let label = `entry ${i + 1}`;
    const reject = (reason) => problems.push({ label, reason });
    if (!entry || typeof entry !== 'object') { reject('expected an object with url and token'); continue; }
    if (typeof entry.url !== 'string') { reject('url must be a string'); continue; }
    const badUrl = urlProblem(entry.url);
    if (badUrl === 'bad URL') { reject(badUrl); continue; }
    label = hostOf(entry.url);
    if (badUrl) { reject(badUrl); continue; }
    if (entry.token !== undefined && typeof entry.token !== 'string') { reject('token must be a string'); continue; }
    let token = (entry.token || '').trim();
    if (token && canEncrypt) {
      try {
        entry.tokenEnc = safeStorage.encryptString(token).toString('base64');
        delete entry.token;
        changed = true;
      } catch {
        retry = true;
        problems.push({ label, reason: 'could not encrypt the token; it stays in plain text for now' });
      }
    } else if (!token && entry.tokenEnc) {
      try { if (canEncrypt) token = safeStorage.decryptString(Buffer.from(String(entry.tokenEnc), 'base64')); } catch {}
      if (!token) { reject(keyring ? 'token unreadable; paste it again' : 'secure storage unavailable; restart once unlocked'); continue; }
    }
    if (!token) { reject('token is empty'); continue; }
    servers.push({ url: entry.url, token });
  }
  let mtimeMs;
  if (changed) {
    const saved = writeAtomic(fs, file, JSON.stringify(list, null, 2) + '\n');
    mtimeMs = saved.mtimeMs;
    if (saved.problem) problems.push({ label: name, reason: saved.problem });
    retry ||= Boolean(saved.retry);
  }
  return { servers, problems, mtimeMs, retry };
}

// Owns the pollers for one t3-servers.json. reload() rereads it: an unchanged list keeps its pollers,
// and a file that can't be read keeps the last good list.
function createT3Servers({ file, fs, safeStorage, watcher, onStatus = () => {}, fetch, now }) {
  let remote = null;
  let key = null;
  let problems = [];
  let ownWrite = 0;
  let retryTimer = null;

  function reload() {
    clearTimeout(retryTimer);
    const loaded = loadT3Servers({ file, fs, safeStorage });
    if (loaded.retry) { retryTimer = setTimeout(reload, POLL_MS); retryTimer.unref?.(); }
    if (loaded.mtimeMs) ownWrite = loaded.mtimeMs;
    problems = loaded.problems;
    const servers = loaded.servers ?? (remote ? null : []);
    if (servers && JSON.stringify(servers) !== key) {
      const old = remote;
      old?.stop();
      const urls = new Set(servers.map((s) => trimUrl(s.url)));
      for (const s of old?.status() || []) if (!urls.has(s.url)) watcher.setRemoteAgents(s.url, []);
      key = JSON.stringify(servers);
      remote = createT3Remote({ servers, fetch, now, recall: (id) => watcher.recall(id),
        onAgents: (source, list) => watcher.setRemoteAgents(source, list), onStatus });
      remote.start();
    }
    onStatus();
  }

  return {
    reload,
    // mtime of the app's own rewrite of the file, which must not trigger a reload
    ownWrite: () => ownWrite,
    status: () => remote?.status() || [],
    problems: () => problems,
    refresh: () => remote?.refresh(),
    stop: () => { clearTimeout(retryTimer); remote?.stop(); },
  };
}

// Each step that can fail names its own problem. Without an mtime the file watcher sees this write as an
// edit, and the reload finds nothing changed.
function writeAtomic(fs, file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return { problem: 'could not save encrypted tokens; the file still holds them in plain text', retry: true };
  }
  try { fs.chmodSync(file, 0o600); } catch { return { problem: 'tokens saved encrypted, but the file could not be made owner-only' }; }
  try { return { mtimeMs: fs.statSync(file).mtimeMs }; } catch { return {}; }
}

// The machine name from a URL: the first label of a host name, or a whole IP address.
function hostOf(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return String(url); }
  return /^[\d.]+$|^\[/.test(host) ? host : host.split('.')[0];
}

module.exports = { agentsFromShell, createT3Remote, createT3Servers, loadT3Servers, redact };
