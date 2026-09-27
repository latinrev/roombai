// Watches agent transcripts (Codex / t3code, Claude Code) plus a tiny local HTTP
// endpoint, and boils everything down to a list of agents with a status.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const HOME = os.homedir();
const CODEX_DIR = path.join(HOME, '.codex', 'sessions');
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects');

const RECENT_FILE_MS = 12 * 3600e3; // only look at transcripts touched in the last 12h
const WAITING_TOOL_MS = 90e3; // a tool call with no result this long probably needs approval
const STUCK_SILENCE_MS = 6 * 60e3; // turn open but nothing happening for this long
const DONE_FRESH_MS = 30 * 60e3; // "done" stays shiny this long unless acknowledged
const FORGET_MS = 90 * 60e3; // idle agents older than this leave the room
const CLAUDE_SETTLE_MS = 8e3; // quiet time after an assistant text reply before we call it done

const PORT = 47770;

function newAgent(id, provider) {
  return {
    id,
    provider, // 'codex' | 'claude' | 'custom'
    host: 'cli', // 't3code' | 'cli' | ...
    title: '',
    project: '',
    turnOpen: false,
    turnStartedAt: 0,
    completedAt: 0,
    lastEventAt: 0,
    pending: new Map(), // tool call id -> started ts
    error: '',
    lastMessage: '',
    lastPrompt: '',
    turns: 0, // activity counters: the room turns these into mess
    toolCalls: 0,
    cwd: '',
    sessionId: '',
    hookWaitingAt: 0,
    acked: false,
    hidden: false,
    manualStatus: null,
    lastAssistantTextAt: 0,
  };
}

function firstLine(s, n = 90) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

class Watcher extends EventEmitter {
  constructor({ demo = false } = {}) {
    super();
    this.agents = new Map();
    this.files = new Map(); // path -> { offset, rest, agentId, kind }
    this.demo = demo;
    this.lastSnapshot = '';
  }

  start() {
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), 2500);
    this.tickTimer = setInterval(() => this.publish(), 1000);
    this.startServer();
    if (this.demo) this.startDemo();
  }

  stop() {
    clearInterval(this.scanTimer);
    clearInterval(this.tickTimer);
    clearInterval(this.demoTimer);
    this.server && this.server.close();
  }

  // ---------- discovery ----------
  scan() {
    const now = Date.now();
    for (const f of this.codexFiles(now)) this.readFile(f, 'codex');
    for (const f of this.claudeFiles(now)) this.readFile(f, 'claude');
  }

  codexFiles(now) {
    const out = [];
    for (let back = 0; back < 2; back++) {
      const d = new Date(now - back * 86400e3);
      const dir = path.join(CODEX_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
      out.push(...listRecent(dir, now));
    }
    return out;
  }

  claudeFiles(now) {
    const out = [];
    let projects = [];
    try { projects = fs.readdirSync(CLAUDE_DIR); } catch { return out; }
    for (const p of projects) out.push(...listRecent(path.join(CLAUDE_DIR, p), now));
    return out;
  }

  readFile(file, kind) {
    let st = this.files.get(file);
    if (!st) {
      st = { offset: 0, rest: '', agentId: null, kind };
      this.files.set(file, st);
    }
    let size;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size < st.offset) { st.offset = 0; st.rest = ''; }
    if (size === st.offset) return;
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const len = size - st.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.offset);
      st.offset = size;
      const text = st.rest + buf.toString('utf8');
      const lines = text.split('\n');
      st.rest = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        if (kind === 'codex') this.onCodex(st, file, j);
        else this.onClaude(st, file, j);
      }
    } catch { /* file busy; next scan */ } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    }
  }

  agentFor(st, file, provider, id) {
    id = id || st.agentId || path.basename(file, '.jsonl');
    st.agentId = id;
    let a = this.agents.get(id);
    if (!a) { a = newAgent(id, provider); this.agents.set(id, a); }
    return a;
  }

  // ---------- Codex (CLI, VS Code, t3code) ----------
  onCodex(st, file, j) {
    const p = j.payload || {};
    const ts = Date.parse(j.timestamp) || Date.now();
    if (j.type === 'session_meta') {
      const a = this.agentFor(st, file, 'codex', 'codex:' + (p.id || p.session_id));
      a.project = path.basename(p.cwd || '') || a.project;
      if (p.cwd) a.cwd = p.cwd;
      a.sessionId = p.id || p.session_id;
      a.host = codexHost(p.originator);
      a.lastEventAt = Math.max(a.lastEventAt, ts);
      return;
    }
    const a = this.agentFor(st, file, 'codex');
    a.lastEventAt = Math.max(a.lastEventAt, ts);

    if (j.type === 'event_msg') {
      switch (p.type) {
        case 'task_started':
          a.turns++; a.turnOpen = true; a.turnStartedAt = ts; a.pending.clear(); a.error = ''; a.acked = false; a.hidden = false;
          break;
        case 'task_complete':
          a.turnOpen = false; a.completedAt = ts; a.pending.clear(); a.acked = false;
          if (p.last_agent_message) a.lastMessage = firstLine(p.last_agent_message, 220);
          break;
        case 'turn_aborted':
          a.turnOpen = false; a.pending.clear(); a.completedAt = 0;
          break;
        case 'error':
        case 'stream_error':
          a.error = firstLine(p.message || 'error', 140);
          break;
        case 'agent_message':
          if (p.message) a.lastMessage = firstLine(p.message, 220);
          break;
      }
      if (/approval_request|request_user_input|elicitation/.test(p.type || '')) a.hookWaitingAt = ts;
    } else if (j.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') {
        const text = (p.content || []).map((c) => c.text || '').join(' ');
        const kinds = (p.internal_chat_message_metadata_passthrough || {}).content_item_kinds || [];
        const real = kinds.includes('user.text') || (!/^\s*[#<]/.test(text) && text.length < 4000);
        if (real && text.trim()) {
          a.lastPrompt = firstLine(text);
          if (!a.title) a.title = firstLine(text, 60);
        }
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
        a.pending.set(p.call_id || p.id || String(ts), ts);
        a.toolCalls++;
      } else if (/_output$/.test(p.type || '')) {
        a.pending.delete(p.call_id || p.id);
        a.hookWaitingAt = 0;
      }
    }
  }

  // ---------- Claude Code ----------
  onClaude(st, file, j) {
    const a = this.agentFor(st, file, 'claude', 'claude:' + path.basename(file, '.jsonl'));
    if (j.type === 'ai-title' && j.aiTitle) { a.title = firstLine(j.aiTitle, 60); return; }
    if (j.type === 'summary' && j.summary && !a.title) { a.title = firstLine(j.summary, 60); return; }
    if (j.isSidechain) return;
    if (j.cwd) { a.project = path.basename(j.cwd); a.cwd = j.cwd; }
    a.sessionId = path.basename(file, '.jsonl');
    if (j.entrypoint) a.host = claudeHost(j.entrypoint);
    const ts = Date.parse(j.timestamp) || 0;
    if (!ts) return;
    a.lastEventAt = Math.max(a.lastEventAt, ts);
    const content = j.message && j.message.content;

    if (j.type === 'user' && !j.isMeta) {
      const items = Array.isArray(content) ? content : [{ type: 'text', text: String(content || '') }];
      let isPrompt = false;
      for (const c of items) {
        if (c.type === 'tool_result') { a.pending.delete(c.tool_use_id); a.hookWaitingAt = 0; }
        else if (c.type === 'text' && c.text && !/^\s*<(command|local-command|system)/.test(c.text)) {
          isPrompt = true;
          a.lastPrompt = firstLine(c.text);
          if (!a.title) a.title = firstLine(c.text, 60);
        }
      }
      if (isPrompt) {
        a.turns++; a.turnOpen = true; a.turnStartedAt = ts; a.pending.clear(); a.error = ''; a.acked = false; a.hidden = false; a.lastAssistantTextAt = 0;
      }
    } else if (j.type === 'assistant' && Array.isArray(content)) {
      a.turnOpen = true;
      let sawText = false;
      for (const c of content) {
        if (c.type === 'tool_use') { a.pending.set(c.id, ts); a.toolCalls++; a.lastAssistantTextAt = 0; }
        if (c.type === 'text' && c.text) { sawText = true; a.lastMessage = firstLine(c.text, 220); }
      }
      if (sawText && a.pending.size === 0) a.lastAssistantTextAt = ts;
      if (j.message.stop_reason === 'end_turn') this.finishClaude(a, ts);
      if (j.isApiErrorMessage || j.error) a.error = firstLine(a.lastMessage || 'API error', 140);
    } else if (j.type === 'system' && j.subtype === 'turn_duration') {
      this.finishClaude(a, ts);
    }
  }

  finishClaude(a, ts) {
    if (!a.turnOpen) return;
    a.turnOpen = false; a.completedAt = ts; a.pending.clear(); a.acked = false; a.lastAssistantTextAt = 0;
  }

  // ---------- status ----------
  statusOf(a, now) {
    if (a.manualStatus) return a.manualStatus;
    // Claude: an assistant text reply followed by silence means the turn ended.
    if (a.provider === 'claude' && a.turnOpen && a.lastAssistantTextAt && a.pending.size === 0 &&
        now - a.lastEventAt > CLAUDE_SETTLE_MS) {
      this.finishClaude(a, a.lastEventAt);
    }
    if (!a.turnOpen) {
      if (a.completedAt && !a.acked && now - a.completedAt < DONE_FRESH_MS) return 'done';
      return 'idle';
    }
    if (a.error) return 'stuck';
    if (a.hookWaitingAt) return 'waiting';
    let oldest = Infinity;
    for (const t of a.pending.values()) oldest = Math.min(oldest, t);
    if (now - oldest > WAITING_TOOL_MS) return 'waiting';
    if (now - a.lastEventAt > STUCK_SILENCE_MS) return 'stuck';
    return 'working';
  }

  snapshot() {
    const now = Date.now();
    const list = [];
    for (const a of this.agents.values()) {
      if (a.hidden) continue;
      const status = this.statusOf(a, now);
      if (status === 'idle' && now - a.lastEventAt > FORGET_MS) continue;
      if (!a.lastEventAt) continue;
      list.push({
        id: a.id,
        provider: a.provider,
        host: a.host,
        title: a.title || a.lastPrompt || '(untitled)',
        project: a.project,
        cwd: a.cwd,
        sessionId: a.sessionId,
        status,
        since: status === 'done' ? a.completedAt : a.turnStartedAt || a.lastEventAt,
        lastEventAt: a.lastEventAt,
        turns: a.turns,
        toolCalls: a.toolCalls,
        detail: status === 'stuck' && a.error ? a.error : a.lastMessage || a.lastPrompt,
      });
    }
    list.sort((x, y) => x.id.localeCompare(y.id));
    return list;
  }

  publish() {
    const snap = this.snapshot();
    const key = JSON.stringify(snap.map((s) => [s.id, s.status, s.title, s.detail]));
    if (key !== this.lastSnapshot) {
      this.lastSnapshot = key;
    }
    this.emit('agents', snap);
  }

  ack(id) {
    const a = this.agents.get(id);
    if (!a) return;
    a.acked = true;
    if (a.manualStatus === 'done') a.manualStatus = 'idle';
    this.publish();
  }

  hide(id) {
    const a = this.agents.get(id);
    if (a) { a.hidden = true; this.publish(); }
  }

  // ---------- HTTP: generic events + Claude Code hooks ----------
  startServer() {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let j = {};
        try { j = body ? JSON.parse(body) : {}; } catch {}
        const url = req.url || '';
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(this.snapshot()));
        }
        if (url.startsWith('/hook/claude')) this.onClaudeHook(j);
        else if (url.startsWith('/event')) this.onGenericEvent(j);
        res.writeHead(204); res.end();
        this.publish();
      });
    });
    this.server.on('error', () => {}); // port taken: just run without it
    this.server.listen(PORT, '127.0.0.1');
  }

  onClaudeHook(j) {
    if (!j.session_id) return;
    const a = this.agents.get('claude:' + j.session_id) || (() => {
      const n = newAgent('claude:' + j.session_id, 'claude');
      this.agents.set(n.id, n);
      return n;
    })();
    const now = Date.now();
    a.lastEventAt = now;
    if (j.cwd) { a.project = path.basename(j.cwd); a.cwd = j.cwd; }
    a.sessionId = j.session_id;
    switch (j.hook_event_name) {
      case 'UserPromptSubmit':
        a.turnOpen = true; a.turnStartedAt = now; a.acked = false; a.hidden = false; a.error = ''; a.hookWaitingAt = 0;
        if (j.prompt && !a.title) a.title = firstLine(j.prompt, 60);
        break;
      case 'Notification':
        if (a.turnOpen || /permission/i.test(j.message || '')) { a.turnOpen = true; a.hookWaitingAt = now; }
        break;
      case 'PreToolUse':
      case 'PostToolUse':
        a.turnOpen = true; a.hookWaitingAt = 0;
        break;
      case 'Stop':
        this.finishClaude(a, now); a.hookWaitingAt = 0;
        break;
    }
  }

  // POST /event {id, title, project, status: working|waiting|stuck|done|idle, provider?}
  onGenericEvent(j) {
    if (!j.id) return;
    const id = 'custom:' + j.id;
    let a = this.agents.get(id);
    if (!a) { a = newAgent(id, j.provider || 'custom'); this.agents.set(id, a); }
    const now = Date.now();
    if (j.title) a.title = firstLine(j.title, 60);
    if (j.project) a.project = j.project;
    if (j.detail) a.lastMessage = firstLine(j.detail, 220);
    if (j.status) {
      if (j.status !== a.manualStatus && j.status !== 'done') a.turnStartedAt = now;
      if (j.status === 'done') { a.completedAt = now; a.acked = false; }
      a.manualStatus = j.status;
      a.hidden = false;
    }
    a.lastEventAt = now;
  }

  // ---------- demo ----------
  startDemo() {
    const names = [
      ['Fix flaky login test', 'appointly'], ['Refactor payment webhooks', 'appointly'],
      ['Write onboarding copy', 'portfolio'], ['Migrate DB to v3 schema', 'nota'],
      ['Add dark mode', 'lovemenot'], ['Investigate memory leak', 'POReady'],
    ];
    const providers = ['codex', 'claude', 'codex', 'claude', 'codex', 'claude'];
    const statuses = ['working', 'working', 'working', 'waiting', 'stuck', 'done'];
    names.forEach(([t, p], i) => this.onGenericEvent({ id: 'demo' + i, title: t, project: p, provider: providers[i], status: statuses[i], detail: 'Demo agent — pretend it is doing ' + t.toLowerCase() + '.' }));
    this.demoTimer = setInterval(() => {
      const i = Math.floor(Math.random() * names.length);
      const s = ['working', 'working', 'working', 'done', 'stuck', 'waiting'][Math.floor(Math.random() * 6)];
      this.onGenericEvent({ id: 'demo' + i, status: s });
      this.publish();
    }, 9000);
  }
}

// Which app a session lives in, so "Jump to it" knows where to send you.
function codexHost(originator = '') {
  if (/t3code/i.test(originator)) return 't3code';
  if (/desktop/i.test(originator)) return 'codex-app'; // the ChatGPT / Codex desktop app
  if (/vscode/i.test(originator)) return 'vscode';
  return 'cli';
}

function claudeHost(entrypoint = '') {
  if (/vscode/i.test(entrypoint)) return 'vscode';
  if (/^sdk-ts$/i.test(entrypoint)) return 't3code'; // t3code drives Claude through the TypeScript SDK
  return 'cli';
}

function listRecent(dir, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const f = path.join(dir, n);
    try {
      if (now - fs.statSync(f).mtimeMs < RECENT_FILE_MS) out.push(f);
    } catch {}
  }
  return out;
}

module.exports = { Watcher, PORT };
