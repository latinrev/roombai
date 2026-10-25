const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROTOCOL, fetchEnvironment } = require('./t3remote');

const PORT = 3773;
const PROBE_MS = 1e3;
const NOT_FOUND = { reason: 'Tailscale not found', missing: true };
// Apps launched from the macOS Finder get a PATH without Homebrew, so its two prefixes are listed too.
const FIXED_CLI = {
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'],
};

const tailscaleClis = (platform = process.platform) => [...(FIXED_CLI[platform] || []), 'tailscale'];

// Only this user's machines and the tagged machines of their tailnet. A tagged node carries the
// tagged-devices UserID, so its MagicDNS suffix shows whose tailnet it is in. A node shared in by
// someone else has another UserID or suffix. ShareeNode marks nodes of people this user shared a
// node with. Linux lists funnel-ingress-node pseudo-peers with an empty DNSName; they are never T3 hosts.
function probeUrls(status) {
  const urls = [];
  const suffix = status?.MagicDNSSuffix ? `.${status.MagicDNSSuffix}` : null;
  const ownTagged = (peer) => peer.Tags?.length > 0 && suffix !== null && peer.DNSName.replace(/\.$/, '').endsWith(suffix);
  for (const peer of Object.values(status?.Peer || {})) {
    if (!peer?.Online || !peer.DNSName || peer.ShareeNode) continue;
    const owner = peer.UserID === status.Self?.UserID ? 'own' : ownTagged(peer) ? 'tagged' : null;
    if (!owner) continue;
    urls.push({ url: `https://${peer.DNSName.replace(/\.$/, '')}`, owner });
    const ip4 = (peer.TailscaleIPs || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    if (ip4) urls.push({ url: `http://${ip4}:${PORT}`, owner });
  }
  return urls;
}

// hits: [{ url, owner, env }] with env from fetchEnvironment. One server per environmentId, https first.
function mergeHits(hits, selfId) {
  const byId = new Map();
  for (const { url, owner, env } of hits) {
    if (!env || env.environmentId === selfId) continue;
    const prev = byId.get(env.environmentId);
    if (prev && !(url.startsWith('https:') && !prev.url.startsWith('https:'))) continue;
    byId.set(env.environmentId, { environmentId: env.environmentId, label: env.label, url, owner, compatible: env.protocol === PROTOCOL });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.url.localeCompare(b.url));
}

function runCli(exec, cli) {
  return new Promise((resolve) => {
    exec(cli, ['status', '--json'], { timeout: 8e3, windowsHide: true, maxBuffer: 16e6 }, (err, stdout) => {
      if (err) return resolve(err.code === 'ENOENT' ? NOT_FOUND : { reason: 'Tailscale not running' });
      try { resolve({ status: JSON.parse(stdout) }); } catch { resolve({ reason: 'Tailscale status unreadable' }); }
    });
  });
}

async function tailscaleStatus(exec, clis) {
  let last = NOT_FOUND;
  for (const cli of clis) {
    last = await runCli(exec, cli);
    if (!last.missing) return last;
  }
  return last;
}

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// T3 keeps its id in <T3CODE_HOME or ~/.t3>/userdata/environment-id. An older server that never
// wrote that file still names its origin in server-runtime.json, so that origin is asked instead.
async function selfEnvironmentId(t3Home, fetch, timeoutMs) {
  const id = readText(path.join(t3Home, 'userdata', 'environment-id')).trim();
  if (id) return id;
  let origin;
  try { origin = JSON.parse(readText(path.join(t3Home, 'userdata', 'server-runtime.json'))).origin; } catch { return ''; }
  if (typeof origin !== 'string' || !origin) return '';
  return (await fetchEnvironment(fetch, origin, timeoutMs).catch(() => null))?.environmentId || '';
}

async function discoverT3({ clis = tailscaleClis(), exec = execFile, fetch = globalThis.fetch, timeoutMs = PROBE_MS,
  t3Home = process.env.T3CODE_HOME || path.join(os.homedir(), '.t3') } = {}) {
  try {
    const { status, ...why } = await tailscaleStatus(exec, clis);
    if (!status) return { servers: [], ...why };
    if (status.BackendState && status.BackendState !== 'Running') return { servers: [], reason: 'Tailscale not running' };
    const probes = probeUrls(status);
    const [selfId, ...answers] = await Promise.all([selfEnvironmentId(t3Home, fetch, timeoutMs),
      ...probes.map(({ url }) => fetchEnvironment(fetch, url, timeoutMs).catch(() => null))]);
    return { servers: mergeHits(probes.map((probe, i) => ({ ...probe, env: answers[i] })), selfId), reason: '' };
  } catch {
    return { servers: [], reason: 'discovery failed' };
  }
}

module.exports = { discoverT3 };
