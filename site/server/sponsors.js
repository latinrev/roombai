import StripeClient from 'stripe';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const PRICES = [4900, 2900, 1900, 900];
export const TERM = 30 * 24 * 60 * 60;
const HOLD = 35 * 60;
const MAX_BODY = 100_000;
const ORDER_ID = /^[0-9a-f-]{36}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
const nowSeconds = () => Math.floor(Date.now() / 1000);
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function stripeClient(env) {
  const mode = env.STRIPE_LIVE_MODE === 'true' ? 'live' : 'test';
  if (!new RegExp(`^(?:rk|sk)_${mode}_`).test(env.STRIPE_RESTRICTED_KEY || '')) {
    fail(503, 'Payment credentials do not match the configured environment.');
  }
  return new StripeClient(env.STRIPE_RESTRICTED_KEY, { httpClient: StripeClient.createFetchHttpClient(), maxNetworkRetries: 2 });
}
export function validateSponsor(body) {
  if (!ORDER_ID.test(body.id || '') || !TOKEN.test(body.token || '')) fail(400, 'Please reload the form and try again.');
  const company = String(body.company || '').trim();
  if (company.length < 2 || company.length > 60 || /[\x00-\x1f]/.test(company)) fail(400, 'Use a company name between 2 and 60 characters.');
  let url;
  try { url = new URL(body.website); } catch { fail(400, 'Enter a full https:// website address.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || /\.(localhost|local|internal)$/.test(url.hostname) || url.href.length > 500) fail(400, 'Enter a public HTTPS website address without login details.');
  if (typeof body.logo !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(body.logo) || body.logo.length > 90_000) fail(400, 'Choose a smaller logo.');
  const bytes = Uint8Array.from(atob(body.logo.slice(22)), c => c.charCodeAt(0));
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !png.every((b, i) => bytes[i] === b)) fail(400, 'The logo must be a PNG image.');
  const view = new DataView(bytes.buffer);
  if (view.getUint32(12) !== 0x49484452 || view.getUint32(16) < 1 || view.getUint32(16) > 256 || view.getUint32(20) < 1 || view.getUint32(20) > 256) fail(400, 'The logo must be at most 256 by 256 pixels.');
  if (body.agreed !== true) fail(400, 'Please accept the placement terms.');
  return { company, website: url.href, logo: body.logo };
}
async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) fail(413, 'Request too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Request body is missing.');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); fail(413, 'Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
const orderById = (db, id) => db.prepare('SELECT * FROM sponsor_orders WHERE id = ?').bind(id).first();
async function release(db, id, status) {
  await db.batch([
    db.prepare("UPDATE sponsor_orders SET status = ? WHERE id = ? AND status IN ('creating','open','processing')").bind(status, id),
    db.prepare("UPDATE sponsor_slots SET reserved_order = NULL WHERE reserved_order = ? AND EXISTS (SELECT 1 FROM sponsor_orders WHERE id = ? AND status = ?)").bind(id, id, status),
  ]);
}
export async function fulfill(db, session, now = nowSeconds()) {
  const id = session.metadata?.sponsor_order;
  if (!id) return;
  const order = await orderById(db, id);
  if (!order || (order.session_id && order.session_id !== session.id)) fail(409, 'Checkout does not match the reservation.');
  if (session.mode !== 'payment' || session.amount_total !== order.amount || session.currency !== order.currency) fail(409, 'Payment does not match the placement price.');
  if (session.payment_status !== 'paid') {
    if (session.status === 'complete') await db.prepare("UPDATE sponsor_orders SET status = 'processing' WHERE id = ? AND status IN ('creating','open')").bind(id).run();
    return;
  }
  const unplaced = reason => console.error(JSON.stringify({ area: 'sponsor-paid-unplaced', order: id, session: session.id, reason }));
  if (order.suspended) { await release(db, id, 'removed'); if (order.status !== 'active') unplaced('suspended'); return; }
  // Only the first fulfillment can set the term. Duplicate / out-of-order events cannot extend it.
  const previous = order.renews_order ? await orderById(db, order.renews_order) : null;
  const start = Math.max(now, previous?.ends_at || 0);
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const [placed] = await db.batch([
    db.prepare(`UPDATE sponsor_orders SET status = 'active', session_id = ?, payment_intent = ?, starts_at = ?, ends_at = ?
      WHERE id = ? AND status IN ('creating','open','processing') AND suspended = 0
      AND EXISTS (SELECT 1 FROM sponsor_slots WHERE id = ? AND reserved_order = ?)`).bind(session.id, intent, start, start + TERM, id, order.slot_id, id),
    db.prepare(`UPDATE sponsor_slots SET active_order = ?, reserved_order = NULL WHERE id = ? AND reserved_order = ?
      AND EXISTS (SELECT 1 FROM sponsor_orders WHERE id = ? AND status = 'active')`).bind(id, order.slot_id, id, id),
  ]);
  // A duplicate event for an already-active order changes nothing; anything else is paid money without a square.
  if (!placed.meta.changes && order.status !== 'active') unplaced(`status:${order.status}`);
}
async function syncOrder(db, stripe, order, now, origin) {
  if (!['creating', 'open', 'processing'].includes(order.status)) return;
  // Creation may have succeeded at Stripe just before a network failure. Retry the same
  // idempotency key before its 24h retention expires; never free an ambiguous reservation.
  let session;
  if (order.session_id) session = await stripe.checkout.sessions.retrieve(order.session_id);
  else {
    if (now - order.created_at >= 23 * 3600) fail(503, 'This reservation needs operator review before it can be released.');
    try {
      session = await stripe.checkout.sessions.create(sessionParams(order, origin), { idempotencyKey: `sponsor:${order.id}` });
      await db.prepare('UPDATE sponsor_orders SET session_id = ?, checkout_url = ? WHERE id = ?').bind(session.id, session.url, order.id).run();
    } catch (error) {
      if (error.type === 'StripeInvalidRequestError') { await release(db, order.id, 'failed'); return; }
      throw error;
    }
  }
  if (session.status === 'expired') await release(db, order.id, 'expired');
  else await fulfill(db, session, now);
}
export async function catalog(db, enabled, now = nowSeconds()) {
  const { results } = await db.prepare(`SELECT s.*, o.company, o.website, o.ends_at, o.status, o.suspended
    FROM sponsor_slots s LEFT JOIN sponsor_orders o ON o.id = s.active_order ORDER BY s.side, s.row_number, s.id`).all();
  return { enabled, currency: 'usd', days: 30, slots: results.map(s => {
    const active = s.status === 'active' && !s.suspended && s.ends_at > now;
    return { id: s.id, row: s.row_number, side: s.side, amount: PRICES[s.row_number - 1], reserved: !!s.reserved_order,
      sponsor: active ? { company: s.company, website: s.website, logo: `/api/sponsors/logo/${s.active_order}`, endsAt: s.ends_at } : null };
  }) };
}
function sessionParams(order, origin) {
  return {
    mode: 'payment', client_reference_id: order.id,
    integration_identifier: 'roombai_sponsors_qzmrplvk',
    metadata: { sponsor_order: order.id, terms_version: '2026-09-27', terms_accepted_at: String(order.created_at) },
    payment_intent_data: { metadata: { sponsor_order: order.id } },
    expires_at: order.checkout_expires,
    line_items: [{ quantity: 1, price_data: { currency: order.currency, unit_amount: order.amount,
      product_data: { name: 'Roombai sponsorship — 30 days', description: `${order.slot_id} · ${order.company} · One-time payment, no auto-renewal` } } }],
    success_url: `${origin}/sponsor/?order=${order.id}`,
    cancel_url: `${origin}/sponsor/?order=${order.id}&canceled=1`,
  };
}
export async function checkout(db, stripe, body, origin, now = nowSeconds()) {
  const details = validateSponsor(body);
  const ownerHash = await hash(body.token);
  let order = await orderById(db, body.id);
  if (order && !sameHash(order.owner_hash, ownerHash)) fail(409, 'Please start a new checkout.');
  if (!order) {
    let renewal = null;
    if (body.renewOrder) {
      renewal = await orderById(db, body.renewOrder);
      if (!renewal || !sameHash(renewal.owner_hash, ownerHash) || renewal.suspended || renewal.status !== 'active' || renewal.slot_id !== body.slot) fail(403, 'This renewal link is no longer valid.');
    }
    const slot = await db.prepare('SELECT * FROM sponsor_slots WHERE id = ?').bind(body.slot).first();
    if (!slot) fail(400, 'Choose an available square.');
    if (slot.reserved_order) {
      const pending = await orderById(db, slot.reserved_order);
      if (pending && pending.checkout_expires <= now) await syncOrder(db, stripe, pending, now, origin);
    }
    const queries = await db.batch([
      db.prepare(`UPDATE sponsor_slots SET reserved_order = ? WHERE id = ? AND reserved_order IS NULL
        AND (active_order IS NULL OR active_order = ? OR NOT EXISTS
          (SELECT 1 FROM sponsor_orders WHERE id = active_order AND status = 'active' AND suspended = 0 AND ends_at > ?))`)
        .bind(body.id, body.slot, renewal?.id || '', now),
      db.prepare(`INSERT INTO sponsor_orders (id,slot_id,owner_hash,company,website,logo,amount,created_at,checkout_expires,renews_order)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sponsor_slots WHERE id = ? AND reserved_order = ?)`)
        .bind(body.id, body.slot, ownerHash, details.company, details.website, details.logo, PRICES[slot.row_number - 1], now, now + HOLD, renewal?.id || null, body.slot, body.id),
    ]);
    if (!queries[0].meta.changes) fail(409, 'Someone else has this square. Choose another or try again later.');
    order = await orderById(db, body.id);
  }
  if (order.status !== 'creating' && order.status !== 'open') fail(409, 'This checkout has finished. Check your placement status.');
  if (order.session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.session_id);
    if (session.status !== 'open') { await syncOrder(db, stripe, order, now, origin); fail(409, 'This checkout has finished. Check your placement status.'); }
    return { url: session.url, order: order.id };
  }
  if (now - order.created_at >= 23 * 3600) fail(503, 'This reservation needs operator review. Contact @joeldev_ before paying again.');
  try {
    const session = await stripe.checkout.sessions.create(sessionParams(order, origin), { idempotencyKey: `sponsor:${order.id}` });
    await db.prepare("UPDATE sponsor_orders SET session_id = ?, checkout_url = ?, status = CASE WHEN status = 'creating' THEN 'open' ELSE status END WHERE id = ?")
      .bind(session.id, session.url, order.id).run();
    return { url: session.url, order: order.id };
  } catch (error) {
    if (error.type === 'StripeInvalidRequestError') await release(db, order.id, 'failed');
    throw error;
  }
}
export async function webhook(db, event, now = nowSeconds()) {
  const object = event.data.object;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    // Acknowledge mismatches so Stripe stops retrying; they need operator review, not redelivery.
    try { await fulfill(db, object, now); }
    catch (error) {
      if (error.status !== 409) throw error;
      console.error(JSON.stringify({ area: 'sponsor-paid-unplaced', order: object.metadata?.sponsor_order, session: object.id, reason: error.message }));
    }
  }
  if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) && object.metadata?.sponsor_order) {
    const order = await orderById(db, object.metadata.sponsor_order);
    if (order && (!order.session_id || order.session_id === object.id)) await release(db, order.id, event.type.endsWith('expired') ? 'expired' : 'failed');
  }
  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const intent = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
    if (intent && (event.type === 'charge.dispute.created' || object.refunded)) {
      await db.prepare("UPDATE sponsor_orders SET suspended = 1 WHERE payment_intent = ?").bind(intent).run();
      if (object.metadata?.sponsor_order) await db.prepare('UPDATE sponsor_orders SET suspended = 1 WHERE id = ?').bind(object.metadata.sponsor_order).run();
    }
  }
}
async function authorizedOrder(request, db, id) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (!TOKEN.test(token) || !ORDER_ID.test(id)) fail(404, 'Placement not found. Open your saved management link.');
  const order = await orderById(db, id);
  if (!order || !sameHash(order.owner_hash, await hash(token))) fail(404, 'Placement not found. Open your saved management link.');
  return order;
}
export async function handle(request, env) {
  try {
    const db = env.SPONSORS_DB;
    if (!db) fail(503, 'Sponsor checkout is being set up. Please check back soon.');
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/sponsors\/?/, '');
    const enabled = env.SPONSORS_ENABLED === 'true' && !!env.STRIPE_RESTRICTED_KEY && !!env.STRIPE_WEBHOOK_SECRET;
    if (request.method === 'GET' && path === '') {
      // Public traffic triggers reconciliation, so let at most one request per minute reach Stripe.
      const turn = env.STRIPE_RESTRICTED_KEY && await db.prepare(`INSERT INTO sponsor_limits(key,count,expires) VALUES ('reconcile',1,?)
        ON CONFLICT(key) DO UPDATE SET count = 1, expires = excluded.expires WHERE sponsor_limits.expires <= ? RETURNING count`)
        .bind(nowSeconds() + 60, nowSeconds()).first();
      if (turn) {
        const { results } = await db.prepare(`SELECT o.* FROM sponsor_orders o JOIN sponsor_slots s ON s.reserved_order = o.id
          WHERE o.checkout_expires <= ? LIMIT 20`).bind(nowSeconds()).all();
        await Promise.all(results.map(async o => {
          try { await syncOrder(db, stripeClient(env), o, nowSeconds(), env.SITE_ORIGIN); }
          catch (error) { console.error(JSON.stringify({ area: 'sponsor-reconciliation', type: error.type || error.name })); }
        }));
      }
      return json(await catalog(db, enabled));
    }
    if (request.method === 'GET' && path.startsWith('logo/')) {
      const row = await db.prepare(`SELECT o.logo FROM sponsor_orders o JOIN sponsor_slots s ON s.active_order = o.id
        WHERE o.id = ? AND o.status = 'active' AND o.suspended = 0 AND o.ends_at > ?`).bind(path.slice(5), nowSeconds()).first();
      if (!row) return new Response('Not found', { status: 404 });
      const bytes = Uint8Array.from(atob(row.logo.slice(22)), c => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
    }
    if (request.method === 'POST' && path === 'admin/remove') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
      if (!env.SPONSOR_ADMIN_TOKEN || !TOKEN.test(token) || !sameHash(await hash(token), await hash(env.SPONSOR_ADMIN_TOKEN))) fail(403, 'Unauthorized.');
      const body = JSON.parse(await readBody(request));
      if (typeof body.slot !== 'string') fail(400, 'Missing slot.');
      await db.prepare('UPDATE sponsor_orders SET suspended = 1 WHERE slot_id = ?').bind(body.slot).run();
      return json({ removed: true });
    }
    if (!env.STRIPE_RESTRICTED_KEY || !env.STRIPE_WEBHOOK_SECRET) fail(503, 'Sponsor checkout is not open yet. Please check back soon.');
    const stripe = stripeClient(env);
    if (request.method === 'POST' && path === 'webhook') {
      let event;
      try { event = await stripe.webhooks.constructEventAsync(await readBody(request), request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, undefined, StripeClient.createSubtleCryptoProvider()); }
      catch { fail(400, 'Invalid webhook signature.'); }
      if (event.livemode !== (env.STRIPE_LIVE_MODE === 'true')) fail(400, 'Wrong payment environment.');
      await webhook(db, event);
      return json({ received: true });
    }
    if (request.method === 'GET' && path.startsWith('order/')) {
      let order = await authorizedOrder(request, db, path.slice(6));
      await syncOrder(db, stripe, order, nowSeconds(), env.SITE_ORIGIN);
      order = await orderById(db, order.id);
      return json({ id: order.id, slot: order.slot_id, company: order.company, website: order.website, logo: order.logo,
        status: order.suspended ? 'removed' : order.status, endsAt: order.ends_at, amount: order.amount, currency: order.currency,
        checkoutUrl: order.status === 'open' ? order.checkout_url : null });
    }
    if (request.method === 'POST' && path === 'checkout') {
      if (!enabled) fail(503, 'Sponsor checkout is not open yet. Please check back soon.');
      if (request.headers.get('origin') !== url.origin || url.origin !== env.SITE_ORIGIN) fail(403, 'Open checkout on roombai.com.');
      const bucket = Math.floor(nowSeconds() / 600);
      const ipHash = await hash(`${request.headers.get('cf-connecting-ip') || 'local'}:${bucket}`);
      const limit = await db.prepare(`INSERT INTO sponsor_limits(key,count,expires) VALUES (?,1,?)
        ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`).bind(ipHash, nowSeconds() + 1200).first();
      if (limit.count > 12) fail(429, 'Too many checkout attempts. Please try again in 10 minutes.');
      await db.prepare('DELETE FROM sponsor_limits WHERE expires < ?').bind(nowSeconds()).run();
      let body;
      try { body = JSON.parse(await readBody(request)); } catch (e) { if (e.status) throw e; fail(400, 'Invalid form data.'); }
      return json(await checkout(db, stripe, body, env.SITE_ORIGIN));
    }
    fail(404, 'Not found.');
  } catch (error) {
    if (!error.status) console.error(JSON.stringify({ area: 'sponsors', type: error.type || error.name }));
    return json({ error: error.status ? error.message : 'Checkout is temporarily unavailable. Please try again shortly.' }, error.status || 503);
  }
}
