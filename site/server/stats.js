const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/;
const ASSETS = new Set(['windows', 'mac', 'linux', 'portable', 'deb']);
export const BROWSER_TTL = 90;
export const ROOMBA_TTL = 300;
const nowSeconds = () => Math.floor(Date.now() / 1000);
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(value, message = 'Invalid event.') { if (!value) throw new RequestError(400, message); }
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function readEvent(request) {
  const reader = request.body?.getReader();
  check(reader, 'Event body required.');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 1024) { await reader.cancel(); throw new RequestError(413, 'Event too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const body = JSON.parse(new TextDecoder().decode(bytes)); check(body && typeof body === 'object'); return body; }
  catch (e) { if (e.status) throw e; throw new RequestError(400, 'Invalid event JSON.'); }
}
export async function recordVisit(db, body, now = nowSeconds()) {
  check(ID.test(body.session));
  const id = await hash(body.session);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO community_visitors(id,last_seen) VALUES (?,?)').bind(id, now),
    db.prepare('UPDATE community_totals SET visits = visits + (SELECT 1 - counted FROM community_visitors WHERE id = ?) WHERE id = 1').bind(id),
    db.prepare('UPDATE community_visitors SET counted = 1, last_seen = ? WHERE id = ?').bind(now, id),
  ]);
}
export async function recordDownload(db, body, now = nowSeconds()) {
  check(ID.test(body.event) && ASSETS.has(body.asset));
  check(Number.isInteger(body.at) && Math.abs(now - body.at) <= 300, 'Expired download event.');
  const id = await hash(body.event);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO community_downloads(id,asset,created_at) VALUES (?,?,?)').bind(id, body.asset, now),
    db.prepare('UPDATE community_totals SET downloads = downloads + (SELECT 1 - counted FROM community_downloads WHERE id = ?) WHERE id = 1').bind(id),
    db.prepare('UPDATE community_downloads SET counted = 1 WHERE id = ?').bind(id),
  ]);
}
export async function recordRoombas(db, body, now = nowSeconds()) {
  check(ID.test(body.installation) && TOKEN.test(body.token));
  check(Number.isSafeInteger(body.sequence) && body.sequence > 0);
  check(Number.isInteger(body.count) && body.count >= 0 && body.count <= 1000);
  const id = await hash(body.installation), token = await hash(body.token);
  // Ownership and increasing sequence prevent another client or an older in-flight
  // heartbeat from overwriting a count, including the final opt-out/quit heartbeat.
  const result = await db.prepare(`INSERT INTO community_installations(id,token_hash,sequence,roombas,last_seen) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET sequence = excluded.sequence, roombas = excluded.roombas, last_seen = excluded.last_seen
    WHERE token_hash = excluded.token_hash AND sequence < excluded.sequence`)
    .bind(id, token, body.sequence, body.count, now).run();
  if (!result.meta.changes) {
    const row = await db.prepare('SELECT token_hash FROM community_installations WHERE id = ?').bind(id).first();
    if (row?.token_hash !== token) throw new RequestError(403, 'Invalid installation credential.');
  }
}
export async function readStats(db, now = nowSeconds()) {
  return db.prepare(`SELECT visits, downloads AS downloadClicks, since,
    (SELECT COUNT(*) FROM community_visitors WHERE last_seen > ?) AS browsingNow,
    (SELECT COALESCE(SUM(roombas),0) FROM community_installations WHERE last_seen > ?) AS roombasOnline,
    ? AS updatedAt FROM community_totals WHERE id = 1`).bind(now - BROWSER_TTL, now - ROOMBA_TTL, now).first();
}
async function cleanup(db, now) {
  await db.batch([
    db.prepare('DELETE FROM community_visitors WHERE last_seen < ?').bind(now - 86400),
    db.prepare('DELETE FROM community_downloads WHERE created_at < ?').bind(now - 86400),
    db.prepare('DELETE FROM community_installations WHERE last_seen < ?').bind(now - 30 * 86400),
    db.prepare('DELETE FROM community_limits WHERE expires < ?').bind(now),
  ]);
}
export async function handleStats(request, env, context) {
  try {
    const db = env.STATS_DB;
    if (!db) throw new RequestError(503, 'Community counters are not available yet.');
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/stats\/?/, '');
    const now = nowSeconds();
    if (request.method === 'GET' && !path) {
      const stats = await readStats(db, now);
      if (!stats) throw new RequestError(503, 'Community counters are not available yet.');
      return json(stats);
    }
    if (request.method !== 'POST' || !['visit', 'download', 'roombas'].includes(path)) return json({ error: 'Not found.' }, 404);
    if (path !== 'roombas' && (request.headers.get('origin') !== url.origin || url.origin !== env.SITE_ORIGIN)) throw new RequestError(403, 'Invalid origin.');
    // The desktop client sends no Origin. Other websites may not submit browser events.
    if (path === 'roombas' && request.headers.has('origin')) throw new RequestError(403, 'Desktop events only.');
    if (/bot\b|crawler|spider|preview/i.test(request.headers.get('user-agent') || '')) return json({ accepted: false });
    const bucket = Math.floor(now / 60);
    const rateKey = await hash(`${request.headers.get('cf-connecting-ip') || 'local'}:${path}:${bucket}`);
    const rate = await db.prepare(`INSERT INTO community_limits(id,count,expires) VALUES (?,1,?)
      ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count`).bind(rateKey, now + 120).first();
    if (rate.count > (path === 'download' ? 60 : 300)) throw new RequestError(429, 'Please try again shortly.');
    const body = await readEvent(request);
    if (path === 'visit') await recordVisit(db, body, now);
    if (path === 'download') await recordDownload(db, body, now);
    if (path === 'roombas') await recordRoombas(db, body, now);
    // First request per IP/type/minute triggers small, indexed retention cleanup.
    if (rate.count === 1) {
      const work = cleanup(db, now).catch(() => console.error('community-retention-failed'));
      if (context?.waitUntil) context.waitUntil(work); else await work;
    }
    return json({ accepted: true });
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ area: 'community-stats', type: error.name }));
    return json({ error: error.status ? error.message : 'Community counters are temporarily unavailable.' }, error.status || 503);
  }
}
