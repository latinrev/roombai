const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

const ENDPOINT = 'https://roombai.com/api/stats/roombas';
const INTERVAL = 60_000;

function createCommunity({ app, getCount, enabled = false, disabled = false, fetchImpl = fetch,
  timers = { setInterval, clearInterval }, readIdentity, writeIdentity }) {
  const available = Boolean(app.isPackaged) && !disabled;
  let sharing = Boolean(enabled), timer, identity, disposed = false;
  const file = () => path.join(app.getPath('userData'), 'community.json');
  readIdentity ||= () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; } };
  writeIdentity ||= value => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const temporary = file() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file());
  };
  function nextIdentity() {
    identity ||= readIdentity();
    if (!identity || !/^[a-f0-9-]{36}$/.test(identity.id || '') || !/^[a-f0-9]{64}$/.test(identity.token || '') || !Number.isSafeInteger(identity.sequence) || identity.sequence < 0 || identity.sequence >= Number.MAX_SAFE_INTEGER) {
      identity = { id: randomUUID(), token: randomBytes(32).toString('hex'), sequence: 0 };
    }
    identity.sequence++;
    // Save before sending so restarting cannot replay an older count.
    writeIdentity(identity);
    return identity;
  }
  async function send(count) {
    if (!available) return;
    try {
      const { id, token, sequence } = nextIdentity();
      await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation: id, token, sequence, count }), signal: AbortSignal.timeout(8000) });
    } catch { /* Counts are optional; offline analytics must never interrupt the room. */ }
  }
  function heartbeat() {
    if (disposed || !sharing || !available) return;
    try {
      const count = getCount();
      if (Number.isInteger(count) && count >= 0 && count <= 1000) void send(count);
    } catch { /* Reading a count must not interrupt the app either. */ }
  }
  function start() {
    if (disposed || !available || !sharing || timer) return;
    heartbeat();
    timer = timers.setInterval(heartbeat, INTERVAL);
    timer?.unref?.();
  }
  function setEnabled(value) {
    if (disposed || !available) return;
    const previous = sharing; sharing = Boolean(value);
    if (sharing) start();
    else {
      if (timer) timers.clearInterval(timer);
      timer = null;
      if (previous && identity) void send(0);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer) timers.clearInterval(timer);
    timer = null;
    if (sharing && identity) void send(0); // Best effort; server expires missed check-ins after five minutes.
  }
  return { start, setEnabled, dispose, available: () => available };
}
module.exports = { createCommunity, INTERVAL };
