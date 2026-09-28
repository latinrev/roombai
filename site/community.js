const number = new Intl.NumberFormat();
const status = document.getElementById('community-status');
const tracked = !navigator.globalPrivacyControl && navigator.doNotTrack !== '1';
const SESSION_KEY = 'roombai:visit';
let temporarySession, busy = false;
function readSession() {
  const now = Date.now(); let session;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = temporarySession; }
  if (!session?.id || now - session.seen > 30 * 60_000 || now - session.started > 24 * 3600_000) {
    session = { id: crypto.randomUUID(), started: now };
  }
  session.seen = now;
  temporarySession = session;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Browsers blocking storage get an in-memory session. */ }
  return session.id;
}
const sessionId = () => navigator.locks ? navigator.locks.request(SESSION_KEY, readSession) : Promise.resolve(readSession());
async function heartbeat() {
  if (!tracked) return;
  await fetch('/api/stats/visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: await sessionId() }), signal: AbortSignal.timeout(8000),
  });
}
async function refresh() {
  if (document.hidden || busy) return;
  busy = true;
  try {
    try { await heartbeat(); } catch { /* The public totals can still be read if a tracker is blocked. */ }
    const response = await fetch('/api/stats', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Stats unavailable');
    const data = await response.json();
    for (const key of ['visits', 'browsingNow', 'roombasOnline', 'downloadClicks']) {
      if (!Number.isSafeInteger(data[key]) || data[key] < 0) throw new Error('Invalid stats');
    }
    for (const el of document.querySelectorAll('[data-community]')) el.textContent = number.format(data[el.dataset.community]);
    document.getElementById('community-since').textContent = new Date(data.since * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });
    status.textContent = 'The Roombai community · live';
    status.dataset.online = 'true';
  } catch {
    // A failed request isn't a zero, and stale online counts aren't live counts.
    for (const el of document.querySelectorAll('[data-community]')) el.textContent = '—';
    status.textContent = 'Live counters temporarily unavailable';
    status.dataset.online = 'false';
  } finally { busy = false; }
}
function downloadClick(event) {
  if (!tracked || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
  const link = event.target.closest('a[data-download-asset]');
  if (!link) return;
  const url = new URL(link.href, location.href);
  if (url.hostname !== 'github.com' || !url.pathname.startsWith('/latinrev/roombai/releases/download/')) return;
  const data = JSON.stringify({ event: crypto.randomUUID(), asset: link.dataset.downloadAsset, at: Math.floor(Date.now() / 1000) });
  try { window.umami?.track('download', { platform: link.dataset.downloadAsset })?.catch?.(() => {}); } catch { /* Umami is optional. */ }
  // Send without delaying navigation. This counts a click, not a completed download.
  try {
    const queued = navigator.sendBeacon?.('/api/stats/download', new Blob([data], { type: 'application/json' }));
    if (!queued) void fetch('/api/stats/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
  } catch { /* Downloading should work even if tracking is blocked. */ }
}
document.addEventListener('click', downloadClick, true);
document.addEventListener('auxclick', downloadClick, true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
void refresh();
setInterval(() => { void refresh(); }, 30000);
