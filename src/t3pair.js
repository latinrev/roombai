const { PROTOCOL, redact, trimUrl, urlProblem, writeAtomic } = require('./t3remote');

const SCOPE = 'orchestration:read';
const TIMEOUT_MS = 8e3;
const HOSTED_APP = 'https://app.t3.codes';
const OS_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const PAIRING_CODE = /^[2-9A-HJ-NP-Z]{12}$/;

// Every link T3 builds carries the credential in the fragment (older ones in ?token=). A hosted
// app.t3.codes link names the server in ?host=; a direct link is the server itself.
function parsePairingLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return { problem: 'the clipboard is empty; copy a pairing link first' };
  if (PAIRING_CODE.test(raw)) return { host: null, credential: raw };
  let u;
  try { u = new URL(raw); } catch { return { problem: 'the clipboard does not hold a T3 pairing link' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { problem: 'the clipboard does not hold a T3 pairing link' };
  const credential = new URLSearchParams(u.hash.slice(1)).get('token')?.trim() || u.searchParams.get('token')?.trim();
  if (!credential) return { problem: 'the link has no pairing token' };
  const hostParam = u.searchParams.get('host')?.trim();
  if (!hostParam) {
    if (u.origin === HOSTED_APP) return { problem: 'the link does not name a server' };
    return { host: u.origin, credential };
  }
  try { return { host: trimUrl(new URL(/^https?:\/\//i.test(hostParam) ? hostParam : `https://${hostParam}`).href), credential }; } catch {
    return { problem: 'the link names a bad server address' };
  }
}

const isLoopback = (host) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/.test(new URL(host).hostname);

// candidates: URLs of servers found on the tailnet but not connected, or asking for a reconnect.
// A link made on the server itself says localhost, so it can only mean the one candidate.
function resolveHost(host, candidates) {
  if (host && !isLoopback(host)) return { url: host };
  if (candidates.length === 1) return { url: candidates[0] };
  const where = host ? 'the link points at the server\'s own machine' : 'a bare pairing code does not say which server';
  return { problem: `${where}; make the link from its Tailscale address` };
}

function readList(fs, file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? { list } : { problem: 'fix t3-servers.json first; it is not a list' };
  } catch (err) {
    if (err.code === 'ENOENT') return { list: [] };
    return { problem: 'fix t3-servers.json first; it cannot be read' };
  }
}

async function exchange({ url, credential, fetch, platform }) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: credential,
    subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    scope: SCOPE,
    client_label: 'roombai',
    client_device_type: 'desktop',
    client_os: OS_NAME[platform] || 'Unknown',
  });
  const res = await fetch(`${url}/oauth/token`, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) return { problem: 'that pairing link is used up or expired; make a new one' };
  if (res.status === 400 && /scope/.test(json.reason || '')) return { problem: 'that pairing link cannot grant read access; make a new one' };
  if (!res.ok) return { problem: `the server refused the pairing link (HTTP ${res.status})` };
  if (json.scope !== SCOPE) return { problem: 'the server did not grant exactly read-only access; nothing was saved' };
  if (typeof json.access_token !== 'string' || !json.access_token || !(json.expires_in > 0)) return { problem: 'the server sent an unexpected answer' };
  return { token: json.access_token, expiresIn: json.expires_in };
}

// Turns a pasted pairing link into a read-only entry in t3-servers.json. The caller reloads the file,
// which encrypts the token. statuses: the configured servers, so a re-pair replaces their old entry.
async function pairT3({ text, file, fs, candidates = [], statuses = [], fetch = globalThis.fetch, now = Date.now, platform = process.platform }) {
  const parsed = parsePairingLink(text);
  if (parsed.problem) return { problem: parsed.problem };
  const secrets = [parsed.credential];
  try {
    const target = resolveHost(parsed.host, candidates);
    if (target.problem) return { problem: target.problem };
    const { url } = target;
    const badUrl = urlProblem(url);
    if (badUrl) return { problem: `the link's server address: ${badUrl}` };
    const saved = readList(fs, file);
    if (saved.problem) return { problem: saved.problem };

    const res = await fetch(`${url}/.well-known/t3/environment`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const env = res.ok ? await res.json().catch(() => null) : null;
    if (!env?.environmentId) return { problem: `no T3 server answers at ${url}` };
    if (env.orchestrationProtocolVersion !== PROTOCOL) return { problem: `the server speaks protocol ${env.orchestrationProtocolVersion ?? 'unknown'}, Roombai needs ${PROTOCOL}` };

    const got = await exchange({ url, credential: parsed.credential, fetch, platform });
    if (got.problem) return { problem: redact(got.problem, secrets) };
    secrets.push(got.token);

    const replaced = new Set([url, ...statuses.filter((s) => s.environmentId === env.environmentId).map((s) => trimUrl(s.url))]);
    const list = saved.list.filter((entry) => !(typeof entry?.url === 'string' && replaced.has(trimUrl(entry.url))));
    list.push({ url, token: got.token, expiresAt: new Date(now() + got.expiresIn * 1e3).toISOString() });
    const written = writeAtomic(fs, file, JSON.stringify(list, null, 2) + '\n');
    if (written.problem && written.retry) return { problem: 'could not save t3-servers.json; pair again with a new link' };
    return { label: env.label || new URL(url).hostname, url };
  } catch (err) {
    return { problem: redact(`could not reach the server: ${err.cause?.message || err.message}`, secrets) };
  }
}

// A discovered server is connected once a configured entry has its environmentId or its URL.
const unconnected = (discovered, statuses) =>
  discovered.filter((d) => !statuses.some((s) => s.environmentId === d.environmentId || trimUrl(s.url) === d.url));

module.exports = { pairT3, parsePairingLink, unconnected };
