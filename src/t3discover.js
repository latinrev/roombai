const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3773;
const PROBE_MS = 1e3;
const WELL_KNOWN = '/.well-known/t3/environment';
const CLI = {
  win32: 'C:\\Program Files\\Tailscale\\tailscale.exe',
  darwin: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
};

const tailscaleCli = (platform = process.platform) => CLI[platform] || 'tailscale';

// Linux lists funnel-ingress-node pseudo-peers with an empty DNSName; they are never T3 hosts.
function probeUrls(status) {
  const urls = [];
  for (const peer of Object.values(status?.Peer || {})) {
    if (!peer?.Online || !peer.DNSName) continue;
    urls.push(`https://${peer.DNSName.replace(/\.$/, '')}`);
    const ip4 = (peer.TailscaleIPs || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    if (ip4) urls.push(`http://${ip4}:${PORT}`);
  }
  return urls;
}

// hits: [{ url, env }] where env is a well-known answer. One server per environmentId, https first.
function mergeHits(hits, selfId) {
  const byId = new Map();
  for (const { url, env } of hits) {
    if (!env?.environmentId || env.orchestrationProtocolVersion === undefined || env.environmentId === selfId) continue;
    const prev = byId.get(env.environmentId);
    if (prev && !(url.startsWith('https:') && !prev.url.startsWith('https:'))) continue;
    byId.set(env.environmentId, { environmentId: env.environmentId, label: env.label || new URL(url).hostname.split('.')[0], url });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.url.localeCompare(b.url));
}

async function wellKnown(fetch, url, timeoutMs) {
  try {
    const res = await fetch(url + WELL_KNOWN, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function runCli(exec, cli) {
  return new Promise((resolve) => {
    exec(cli, ['status', '--json'], { timeout: 8e3, windowsHide: true, maxBuffer: 16e6 }, (err, stdout) => {
      if (err) return resolve({ reason: err.code === 'ENOENT' ? 'Tailscale not installed' : 'Tailscale not running' });
      try { resolve({ status: JSON.parse(stdout) }); } catch { resolve({ reason: 'Tailscale status unreadable' }); }
    });
  });
}

function selfOrigin(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).origin || null; } catch { return null; }
}

async function discoverT3({ cli = tailscaleCli(), exec = execFile, fetch = globalThis.fetch, timeoutMs = PROBE_MS,
  selfFile = path.join(os.homedir(), '.t3', 'userdata', 'server-runtime.json') } = {}) {
  try {
    const { status, reason } = await runCli(exec, cli);
    if (!status) return { servers: [], reason };
    if (status.BackendState && status.BackendState !== 'Running') return { servers: [], reason: 'Tailscale not running' };
    const origin = selfOrigin(selfFile);
    const urls = probeUrls(status);
    const [self, ...answers] = await Promise.all([origin ? wellKnown(fetch, origin.replace(/\/+$/, ''), timeoutMs) : null,
      ...urls.map((url) => wellKnown(fetch, url, timeoutMs))]);
    return { servers: mergeHits(urls.map((url, i) => ({ url, env: answers[i] })), self?.environmentId), reason: '' };
  } catch {
    return { servers: [], reason: 'discovery failed' };
  }
}

module.exports = { discoverT3, mergeHits, tailscaleCli };
