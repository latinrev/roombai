// Read-only polling of remote T3 Code servers. Each remote thread becomes an agent record
// that carries T3's own status, so the Watcher's ack and hide apply but its transcript rules don't.
const { newAgent, firstLine, RECENT_FILE_MS } = require('./watcher');

const POLL_MS = 10e3;
const TIMEOUT_MS = 8e3;
const PROTOCOL = 2;

// Run status -> room status, after pending requests. idle, queued, interrupted, cancelled and
// rolled_back have no awareness phase in T3, so they fall through to idle.
const RUN_STATUS = { preparing: 'working', starting: 'working', running: 'working', waiting: 'working', failed: 'stuck' };
const LIVE_RUN = new Set(['preparing', 'starting', 'running']);
const HOLDS_COMPLETION = new Set(['subagent', 'monitor', 'background_task']);

// Mirrors T3's resolveThreadAwarenessPhaseV2 and backgroundWorkHoldsCompletion
// (packages/shared/src/agentAwareness.ts), with both waiting phases shown as waiting.
function remoteStatusOf(thread) {
  const run = thread.activityRunStatus ?? thread.status;
  const request = thread.pendingRuntimeRequest;
  if (request?.kind === 'user_input' && (request.blocking !== false || !LIVE_RUN.has(run))) return 'waiting';
  if (request && request.kind !== 'user_input' && request.kind !== 'auth_refresh') return 'waiting';
  if (run === 'completed') return (thread.pendingBackgroundTasks || []).some((task) => HOLDS_COMPLETION.has(task.kind)) ? 'working' : 'done';
  return RUN_STATUS[run] || 'idle';
}

const time = (value) => Date.parse(value || '') || 0;

function providerOf(thread) {
  const s = `${thread.modelSelection?.model || ''} ${thread.modelSelection?.instanceId || ''} ${thread.providerInstanceId || ''}`.toLowerCase();
  if (s.includes('claude')) return 'claude';
  if (/codex|gpt/.test(s)) return 'codex';
  return 'custom';
}

// server: { environmentId, label }. prev: a Map-like of agents from earlier polls (id -> agent).
function agentsFromShell(shell, server, now, prev = new Map()) {
  const projects = new Map((shell?.projects || []).map((p) => [p.id, p.title || '']));
  const out = [];
  for (const t of shell?.threads || []) {
    if (!t?.id || t.archivedAt || t.deletedAt || t.lineage?.parentThreadId) continue;
    const status = remoteStatusOf(t);
    const updatedAt = time(t.updatedAt) || time(t.createdAt);
    if (status !== 'working' && status !== 'waiting' && now - updatedAt > RECENT_FILE_MS) continue;

    const id = `t3:${server.environmentId}:${t.id}`;
    const before = prev.get(id);
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
      completedAt: silent ? before?.completedAt || 0 : status === 'done' ? time(t.latestRunCompletedAt) || updatedAt : 0,
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

// servers: [{ url, token }]. onAgents(url, agents) after each good poll; onStatus() when a status changes.
function createT3Remote({ servers = [], fetch = globalThis.fetch, now = Date.now, onAgents = () => {},
  onStatus = () => {}, prev = new Map() } = {}) {
  const entries = servers.map((s) => ({
    url: String(s.url).replace(/\/+$/, ''), token: s.token || '', env: null, timer: null, busy: null,
    status: { url: String(s.url).replace(/\/+$/, ''), label: hostOf(s.url), state: 'connecting', error: '' },
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

  async function poll(e) {
    try {
      if (!e.env) {
        const env = await getJson(e, '/.well-known/t3/environment');
        if (stopped) return;
        if (env?.orchestrationProtocolVersion !== PROTOCOL || !env.environmentId) {
          return setStatus(e, 'incompatible', `server speaks protocol ${env?.orchestrationProtocolVersion ?? 'unknown'}, Roombai needs ${PROTOCOL}`);
        }
        e.env = { environmentId: env.environmentId, label: env.label || hostOf(e.url) };
        e.status = { ...e.status, label: e.env.label };
      }
      const shell = await getJson(e, '/api/orchestration/shell', {
        Authorization: `Bearer ${e.token}`, 'x-t3-orchestration-protocol': String(PROTOCOL), 'Accept-Encoding': 'gzip',
      });
      if (stopped) return;
      onAgents(e.url, agentsFromShell(shell, e.env, now(), prev));
      setStatus(e, 'ok');
    } catch (err) {
      if (stopped) return;
      if (err.status === 401 || err.status === 403) setStatus(e, 'unauthorized', 'token rejected; issue a new one');
      else if (err.status === 426) { e.env = null; setStatus(e, 'incompatible', 'server wants a different protocol'); }
      else setStatus(e, 'unreachable', err.cause?.message || err.message);
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

function hostOf(url) {
  try { return new URL(url).hostname.split('.')[0]; } catch { return String(url); }
}

module.exports = { agentsFromShell, createT3Remote, redact };
