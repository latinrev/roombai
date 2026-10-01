// Read account allowances with the providers' existing local sign-ins. Only
// normalized percentages and reset times leave the main process.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const POLL_MS = 5 * 60e3;
const STALE_MS = 15 * 60e3;
const PROVIDERS = ['claude', 'codex'];

function resetTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  return typeof value === 'string' ? Date.parse(value) || null : null;
}

function normalizeUsage(provider, data) {
  const windows = [];
  const add = (minutes, percent, reset) => {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) return;
    windows.push({ minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      usedPercent: Math.min(100, percent), resetsAt: resetTime(reset) });
  };
  if (provider === 'claude') {
    for (const [key, minutes] of [['five_hour', 300], ['seven_day', 10080]]) {
      const window = data?.[key];
      if (window) add(minutes, window.utilization ?? window.used_percentage, window.resets_at);
    }
  } else {
    const limits = data?.rate_limit || data;
    for (const key of ['primary', 'secondary']) {
      const window = limits?.[key + '_window'] || limits?.[key];
      if (window) add(window.window_minutes ?? window.limit_window_seconds / 60,
        window.used_percent, window.reset_at ?? window.resets_at);
    }
  }
  return windows.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
}

async function readCredentials(provider) {
  const dir = provider === 'claude' ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    : process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  let data;
  try { data = JSON.parse(await fs.readFile(path.join(dir, provider === 'claude' ? '.credentials.json' : 'auth.json'), 'utf8')); }
  catch {
    if (provider !== 'claude' || process.platform !== 'darwin' || process.env.CLAUDE_CONFIG_DIR) return null;
    // Claude Code uses the login keychain on macOS instead of a JSON file.
    try {
      const raw = await new Promise((resolve, reject) => execFile('/usr/bin/security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
      data = JSON.parse(raw);
    } catch { return null; }
  }
  const token = provider === 'claude' ? data?.claudeAiOauth?.accessToken : data?.tokens?.access_token;
  return token ? { token, accountId: provider === 'codex' ? data.tokens.account_id : null } : null;
}

function createUsage({ onChange = () => {}, fetchUsage = globalThis.fetch, credentials = readCredentials,
  now = Date.now, demo = false, disabled = false } = {}) {
  const state = Object.fromEntries(PROVIDERS.map(provider => [provider,
    { state: 'loading', windows: [], updatedAt: 0, message: 'Checking usage…' }]));
  const nextCheck = {};
  const authKeys = {};
  let timer;
  let busy = false;
  let disposed = false;
  const controllers = new Set();

  function snapshot() {
    return Object.fromEntries(PROVIDERS.map(provider => {
      const entry = state[provider];
      const windows = entry.windows.filter(window => !window.resetsAt || window.resetsAt > now());
      const stale = entry.updatedAt && (now() - entry.updatedAt > STALE_MS || !windows.length);
      return [provider, { ...entry, windows,
        state: stale && entry.state === 'ready' ? 'stale' : entry.state,
        message: stale && entry.state === 'ready' ? 'Waiting for fresh usage.' : entry.message }];
    }));
  }

  function record(provider, data, timestamp = now()) {
    if (disposed || !PROVIDERS.includes(provider) || (provider === 'codex' && data?.limit_id && data.limit_id !== 'codex')) return;
    const windows = normalizeUsage(provider, data);
    if (!windows.length || timestamp < state[provider].updatedAt) return;
    state[provider] = { state: 'ready', windows, updatedAt: timestamp, message: demo ? 'Demo usage.' : '' };
    onChange();
  }

  async function check(provider) {
    if (nextCheck[provider] > now()) return;
    nextCheck[provider] = now() + POLL_MS;
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    let message = 'Usage unavailable. Retrying automatically.';
    try {
      const auth = await credentials(provider);
      if (disposed) return;
      if (!auth) {
        state[provider] = { state: 'unavailable', windows: [], updatedAt: 0,
          message: `Sign in to ${provider === 'claude' ? 'Claude Code' : 'Codex'} to see account usage.` };
        onChange();
        return;
      }
      const authKey = `${auth.accountId || ''}:${auth.token}`;
      if (authKeys[provider] && authKeys[provider] !== authKey) {
        state[provider] = { state: 'loading', windows: [], updatedAt: 0, message: 'Checking usage…' };
      }
      authKeys[provider] = authKey;
      const headers = { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' };
      if (provider === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20';
      else if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
      const response = await fetchUsage(provider === 'claude' ? 'https://api.anthropic.com/api/oauth/usage'
        : 'https://chatgpt.com/backend-api/wham/usage', { headers, signal: controller.signal, redirect: 'error' });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const retryMs = Number(retry) * 1000 || Date.parse(retry) - now() || 0;
        nextCheck[provider] = now() + Math.max(STALE_MS, retryMs);
        message = 'Usage checks rate limited. Retrying automatically.';
      } else if (response.status === 401 || response.status === 403) {
        message = `Sign in again to ${provider === 'claude' ? 'Claude Code' : 'Codex'} to refresh usage.`;
      }
      if (!response.ok) throw new Error('Usage request failed');
      const data = await response.json();
      if (!normalizeUsage(provider, data).length) {
        state[provider] = { state: 'unavailable', windows: [], updatedAt: 0, message: 'Account usage limits are not available for this sign-in.' };
        if (!disposed) onChange();
        return;
      }
      record(provider, data);
      return;
    } catch { /* Keep provider errors and credentials out of logs and IPC. */ }
    finally { clearTimeout(timeout); controllers.delete(controller); }
    if (!disposed) {
      state[provider] = { ...state[provider], state: state[provider].windows.length ? 'stale' : 'unavailable', message };
      onChange();
    }
  }

  async function refresh() {
    if (busy || disposed || disabled || demo) return;
    busy = true;
    try { await Promise.all(PROVIDERS.map(check)); } finally { busy = false; }
  }

  function start() {
    if (demo) {
      record('claude', { five_hour: { utilization: 28, resets_at: new Date(now() + 2 * 3600e3).toISOString() }, seven_day: { utilization: 43 } });
      record('codex', { primary: { used_percent: 62, window_minutes: 300, resets_at: (now() + 3600e3) / 1000 }, secondary: { used_percent: 37, window_minutes: 10080 } });
    } else if (disabled) {
      for (const provider of PROVIDERS) state[provider] = { state: 'unavailable', windows: [], updatedAt: 0, message: 'Usage checks disabled.' };
    } else {
      void refresh();
      timer = setInterval(() => { void refresh(); onChange(); }, POLL_MS);
      timer.unref?.();
    }
  }

  function dispose() { disposed = true; clearInterval(timer); for (const controller of controllers) controller.abort(); }
  return { start, dispose, snapshot, refresh, record };
}

module.exports = { createUsage, normalizeUsage };
