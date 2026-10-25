const { HttpError, IncompatibleError, PROTOCOL, fetchEnvironment, redact, sealToken, trimUrl, urlProblem, writeAtomic } = require('./t3remote');

const SCOPE = 'orchestration:read';
const TIMEOUT_MS = 8e3;
const HOSTED_APP = 'https://app.t3.codes';
const OS_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
// T3 draws codes from 23456789ABCDEFGHJKLMNPQRSTUVWXYZ, so a code typed in lower case can only mean its upper-case form.
const PAIRING_CODE = /^[2-9A-HJ-NP-Z]{12}$/;
const NOT_A_LINK = { problem: 'the clipboard does not hold a T3 pairing link' };

// Every link T3 builds is a /pair page with the credential in the fragment (older ones in ?token=).
// A hosted app.t3.codes link names the server in ?host=; a direct link is the server itself.
function parsePairingLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return { problem: 'the clipboard is empty; copy a pairing link first' };
  if (PAIRING_CODE.test(raw.toUpperCase())) return { host: null, credential: raw.toUpperCase() };
  let u;
  try { u = new URL(raw); } catch { return NOT_A_LINK; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.pathname.replace(/\/+$/, '') !== '/pair') return NOT_A_LINK;
  const credential = new URLSearchParams(u.hash.slice(1)).get('token')?.trim() || u.searchParams.get('token')?.trim();
  if (!credential) return { problem: 'the link has no pairing token' };
  const hostParam = u.searchParams.get('host')?.trim();
  if (!hostParam) {
    if (u.origin === HOSTED_APP) return { problem: 'the link does not name a server' };
    return { host: u.origin, credential };
  }
  try { return { host: new URL(/^https?:\/\//i.test(hostParam) ? hostParam : `https://${hostParam}`).origin, credential }; } catch {
    return { problem: 'the link names a bad server address' };
  }
}

const isLoopback = (host) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/.test(new URL(host).hostname);

// findCandidates resolves to the URLs of servers found on the tailnet but not connected, or asking
// for a reconnect. A link made on the server itself says localhost, so it can only mean the one
// candidate. That is a guess: the link may have come from a machine Roombai never found.
async function resolveHost(host, findCandidates) {
  if (host && !isLoopback(host)) return { url: host, guessed: false };
  const candidates = await findCandidates();
  if (candidates.length === 1) return { url: candidates[0], guessed: true };
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

async function exchange({ url, guessed, credential, fetch, platform }) {
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
  if (res.status === 401) {
    return { problem: guessed ? 'this link may belong to another machine; make it from that machine\'s T3 or paste the full link'
      : 'that pairing link is used up or expired; make a new one' };
  }
  if (res.status === 400 && /scope/.test(json.reason || '')) return { problem: 'that pairing link cannot grant read access; make a new one' };
  if (!res.ok) return { problem: `the server refused the pairing link (HTTP ${res.status})` };
  if (json.scope !== SCOPE) return { problem: 'the server did not grant exactly read-only access; nothing was saved' };
  if (typeof json.access_token !== 'string' || !json.access_token || !(json.expires_in > 0)) return { problem: 'the server sent an unexpected answer' };
  return { token: json.access_token, expiresIn: json.expires_in };
}

const inFlight = new Map();

// Turns a pasted pairing link into a read-only entry in t3-servers.json, with the token sealed when
// safeStorage can encrypt. statuses: the configured servers, so a re-pair replaces their old entry.
// Pasting a link that is still being exchanged shares that exchange, so it cannot report "used up".
function pairT3(options) {
  const parsed = parsePairingLink(options.text);
  if (parsed.problem) return Promise.resolve({ problem: parsed.problem });
  if (!inFlight.has(parsed.credential)) {
    inFlight.set(parsed.credential, pairOnce(parsed, options).finally(() => inFlight.delete(parsed.credential)));
  }
  return inFlight.get(parsed.credential);
}

async function pairOnce({ host, credential }, { file, fs, safeStorage, findCandidates = async () => [], statuses = [], fetch = globalThis.fetch,
  now = Date.now, platform = process.platform }) {
  const secrets = [credential];
  try {
    const target = await resolveHost(host, findCandidates);
    if (target.problem) return { problem: target.problem };
    const { url } = target;
    const badUrl = urlProblem(url);
    if (badUrl) return { problem: `the link's server address: ${badUrl}` };
    // Checked before the credential is spent; save() reads the file again for the write.
    const early = readList(fs, file);
    if (early.problem) return { problem: early.problem };

    let env;
    try { env = await fetchEnvironment(fetch, url, TIMEOUT_MS); } catch (err) {
      if (err instanceof HttpError || err instanceof IncompatibleError) return { problem: `no T3 server answers at ${url}` };
      throw err;
    }
    if (env.protocol !== PROTOCOL) return { problem: `the server speaks protocol ${env.protocol}, Roombai needs ${PROTOCOL}` };

    const got = await exchange({ url, guessed: target.guessed, credential, fetch, platform });
    if (got.problem) return { problem: redact(got.problem, secrets) };
    secrets.push(got.token);
    const expiresAt = new Date(now() + got.expiresIn * 1e3).toISOString();
    return save({ file, fs, safeStorage, statuses, url, env, token: got.token, expiresAt });
  } catch (err) {
    return { problem: redact(`could not reach the server: ${err.cause?.message || err.message}`, secrets) };
  }
}

// Synchronous from read to rename, so an entry another pairing or a hand edit added meanwhile stays.
function save({ file, fs, safeStorage, statuses, url, env, token, expiresAt }) {
  const tokenEnc = sealToken(safeStorage, token);
  if (tokenEnc === null) return { problem: 'the key could not be encrypted, so nothing was saved; pair again with a new link' };
  const saved = readList(fs, file);
  if (saved.problem) return { problem: 't3-servers.json became unreadable while pairing; fix it, then pair again with a new link' };
  const replaced = new Set([url, ...statuses.filter((s) => s.environmentId === env.environmentId).map((s) => trimUrl(s.url))]);
  const list = saved.list.filter((entry) => !(typeof entry?.url === 'string' && replaced.has(trimUrl(entry.url))));
  list.push(tokenEnc ? { url, expiresAt, tokenEnc } : { url, expiresAt, token });
  const written = writeAtomic(fs, file, JSON.stringify(list, null, 2) + '\n');
  if (written.problem && written.retry) return { problem: 'could not save t3-servers.json; pair again with a new link' };
  return { label: env.label, url };
}

// A discovered server is connected once a configured entry has its environmentId or its URL.
const unconnected = (discovered, statuses) =>
  discovered.filter((d) => !statuses.some((s) => s.environmentId === d.environmentId || trimUrl(s.url) === d.url));

module.exports = { pairT3, parsePairingLink, unconnected };
