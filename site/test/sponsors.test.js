import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { checkout, fulfill, webhook, catalog, validateSponsor, handle, TERM } from '../server/sponsors.js';

// Execute the production SQL against SQLite, with D1's atomic batch semantics.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../sponsor-migrations/0001_sponsors.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      let params = [];
      return { bind(...p) { params = p; return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out = []; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}
function stripeMock() {
  const sessions = new Map(); let creates = 0;
  return { sessions, get creates() { return creates; }, checkout: { sessions: {
    async create(params, options) {
      const id = `cs_${options.idempotencyKey}`;
      if (!sessions.has(id)) {
        creates++;
        sessions.set(id, { id, metadata: params.metadata, amount_total: params.line_items[0].price_data.unit_amount,
          currency: 'usd', mode: 'payment', payment_status: 'unpaid', status: 'open', url: `https://checkout.stripe.com/${id}`, payment_intent: `pi_${creates}` });
      }
      return sessions.get(id);
    },
    async retrieve(id) { return sessions.get(id); },
  } } };
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2n8AAAAASUVORK5CYII=';
const form = (extra = {}) => ({ id: crypto.randomUUID(), token: 'a'.repeat(64), slot: 'left-1-1', company: 'Test company', website: 'https://example.com', logo: png, agreed: true, ...extra });
const origin = 'https://roombai.com';
const paid = session => ({ ...session, status: 'complete', payment_status: 'paid' });
const readOrder = (db, id) => db.prepare('SELECT * FROM sponsor_orders WHERE id = ?').bind(id).first();

test('server prices override browser input and one reservation excludes a competing buyer', async () => {
  const db = database(), stripe = stripeMock(), a = form({ amount: 1 });
  const result = await checkout(db, stripe, a, origin, 1000);
  assert.match(result.url, /^https:\/\/checkout.stripe.com/);
  assert.equal((await readOrder(db, a.id)).amount, 4900);
  await assert.rejects(checkout(db, stripe, form(), origin, 1000), /Someone else/);
  assert.equal(stripe.creates, 1);
  await checkout(db, stripe, a, origin, 1001);
  assert.equal(stripe.creates, 1);
});
test('all 20 positions use the correct row prices and expose no management secrets', async () => {
  const db = database(), data = await catalog(db, false, 1000);
  assert.equal(data.slots.length, 20);
  for (const slot of data.slots) assert.equal(slot.amount, [4900,2900,1900,900][slot.row - 1]);
  assert.equal(JSON.stringify(data).includes('owner_hash'), false);
});

test('checkout rejects a key from the wrong payment environment before making Stripe requests', async () => {
  const db = database();
  for (const liveMode of [false, true]) {
    const wrongMode = liveMode ? 'test' : 'live';
    const env = { SPONSORS_DB: db, SPONSORS_ENABLED: 'true', STRIPE_LIVE_MODE: String(liveMode),
      STRIPE_RESTRICTED_KEY: `rk_${wrongMode}_fixture`, STRIPE_WEBHOOK_SECRET: 'whsec_fixture', SITE_ORIGIN: origin };
    const response = await handle(new Request(`${origin}/api/sponsors/checkout`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(form()),
    }), env);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /configured environment/);
  }
});
test('unpaid checkout stays hidden; confirmed payment gets exactly 30 days and replay cannot extend it', async () => {
  const db = database(), stripe = stripeMock(), a = form();
  await checkout(db, stripe, a, origin, 1000);
  const session = [...stripe.sessions.values()][0];
  await fulfill(db, { ...session, status: 'complete' }, 1100);
  assert.equal((await readOrder(db, a.id)).status, 'processing');
  assert.equal((await catalog(db, true, 1100)).slots[0].sponsor, null);
  await fulfill(db, paid(session), 1200);
  await fulfill(db, paid(session), 1600);
  assert.equal((await readOrder(db, a.id)).ends_at, 1200 + TERM);
  assert.ok((await catalog(db, true, 1200)).slots[0].sponsor);
  assert.equal((await catalog(db, true, 1200 + TERM)).slots[0].sponsor, null);
});
test('late expiration/failure cannot erase a paid placement', async () => {
  const db = database(), stripe = stripeMock(), a = form();
  await checkout(db, stripe, a, origin, 1000); const session = [...stripe.sessions.values()][0];
  await fulfill(db, paid(session), 1100);
  await webhook(db, { type: 'checkout.session.expired', data: { object: session } }, 1200);
  await webhook(db, { type: 'checkout.session.async_payment_failed', data: { object: session } }, 1200);
  assert.equal((await readOrder(db, a.id)).status, 'active');
});
test('expired unpaid sessions free their square; delayed paid sessions are reconciled before resale', async () => {
  const db = database(), stripe = stripeMock(), a = form();
  await checkout(db, stripe, a, origin, 1000);
  const session = [...stripe.sessions.values()][0]; session.status = 'expired';
  await checkout(db, stripe, form(), origin, 4000);
  assert.equal((await readOrder(db, a.id)).status, 'expired');
  const b = form({ slot: 'right-1-1' }); await checkout(db, stripe, b, origin, 4000);
  const bSession = [...stripe.sessions.values()][2]; Object.assign(bSession, paid(bSession));
  await assert.rejects(checkout(db, stripe, form({ slot: b.slot }), origin, 7000), /Someone else/);
  assert.equal((await readOrder(db, b.id)).status, 'active');
});
test('renewal needs ownership and extends the remaining paid period exactly once', async () => {
  const db = database(), stripe = stripeMock(), a = form();
  await checkout(db, stripe, a, origin, 1000); await fulfill(db, paid([...stripe.sessions.values()][0]), 1100);
  await assert.rejects(checkout(db, stripe, form({ renewOrder: a.id, token: 'b'.repeat(64) }), origin, 2000), /renewal link/);
  const b = form({ renewOrder: a.id }); await checkout(db, stripe, b, origin, 2000);
  await fulfill(db, paid([...stripe.sessions.values()][1]), 2100);
  assert.equal((await readOrder(db, b.id)).ends_at, 1100 + 2 * TERM);
  assert.equal((await catalog(db, true, 2100)).slots[0].sponsor.logo, `/api/sponsors/logo/${b.id}`);
});
test('wrong totals, fake logos and unsafe links are rejected', async () => {
  assert.throws(() => validateSponsor(form({ website: 'javascript:alert(1)' })), /HTTPS/);
  assert.throws(() => validateSponsor(form({ logo: 'data:image/svg+xml;base64,AAA' })), /logo/);
  assert.throws(() => validateSponsor(form({ agreed: false })), /terms/);
  const db = database(), stripe = stripeMock(), a = form(); await checkout(db, stripe, a, origin, 1000);
  await assert.rejects(fulfill(db, { ...paid([...stripe.sessions.values()][0]), amount_total: 1 }), /price/);
});
test('refunds hide paid logos and duplicates cannot restore them', async () => {
  const db = database(), stripe = stripeMock(), a = form(); await checkout(db, stripe, a, origin, 1000);
  const session = paid([...stripe.sessions.values()][0]); await fulfill(db, session, 1100);
  await webhook(db, { type: 'charge.refunded', data: { object: { payment_intent: session.payment_intent, refunded: true } } });
  await fulfill(db, session, 1200);
  assert.equal((await catalog(db, true, 1200)).slots[0].sponsor, null);
});
test('checkout is disabled without credentials, and unsigned or wrong-environment webhooks fail', async () => {
  const db = database();
  const response = await handle(new Request(`${origin}/api/sponsors/checkout`, { method: 'POST' }), { SPONSORS_DB: db });
  assert.equal(response.status, 503);
  const env = { SPONSORS_DB: db, STRIPE_RESTRICTED_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_LIVE_MODE: 'false' };
  const request = (body, signature = '') => new Request(`${origin}/api/sponsors/webhook`, { method: 'POST', body, headers: { 'stripe-signature': signature } });
  assert.equal((await handle(request('{}'), env)).status, 400);
  const payload = JSON.stringify({ id: 'evt_test', livemode: true, type: 'checkout.session.completed', data: { object: {} } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
  assert.equal((await handle(request(payload, signature), env)).status, 400);
});
test('verified webhook processes payment even when new sales are paused', async () => {
  const db = database(), stripe = stripeMock(), a = form(); await checkout(db, stripe, a, origin, 1000);
  const env = { SPONSORS_DB: db, STRIPE_RESTRICTED_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_LIVE_MODE: 'false', SPONSORS_ENABLED: 'false' };
  const payload = JSON.stringify({ id: 'evt_paid', livemode: false, type: 'checkout.session.completed', data: { object: paid([...stripe.sessions.values()][0]) } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
  const response = await handle(new Request(`${origin}/api/sponsors/webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }), env);
  assert.equal(response.status, 200); assert.equal((await readOrder(db, a.id)).status, 'active');
});

test('an ambiguous old checkout is never resold after Stripe idempotency retention', async () => {
  const db = database(), stripe = stripeMock(), a = form();
  stripe.checkout.sessions.create = async () => { throw Object.assign(new Error('network'), { type: 'StripeConnectionError' }); };
  await assert.rejects(checkout(db, stripe, a, origin, 1000), /network/);
  await assert.rejects(checkout(db, stripe, a, origin, 1000 + 24 * 3600), /operator review/);
  await assert.rejects(checkout(db, stripe, form(), origin, 1000 + 24 * 3600), /operator review/);
  assert.equal((await catalog(db, true, 1000 + 24 * 3600)).slots[0].reserved, true);
});

test('management and moderation require their own secrets; removal prevents pending publication', async () => {
  const db = database(), stripe = stripeMock(), a = form(); await checkout(db, stripe, a, origin, 1000);
  const env = { SPONSORS_DB: db, STRIPE_RESTRICTED_KEY: 'rk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', SPONSOR_ADMIN_TOKEN: 'b'.repeat(64) };
  const wrong = await handle(new Request(`${origin}/api/sponsors/order/${a.id}`, { headers: { Authorization: `Bearer ${'c'.repeat(64)}` } }), env);
  assert.equal(wrong.status, 404);
  const remove = token => handle(new Request(`${origin}/api/sponsors/admin/remove`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ slot: a.slot }) }), env);
  assert.equal((await remove('c'.repeat(64))).status, 403);
  assert.equal((await remove(env.SPONSOR_ADMIN_TOKEN)).status, 200);
  await fulfill(db, paid([...stripe.sessions.values()][0]), 1100);
  assert.equal((await readOrder(db, a.id)).status, 'removed');
  const slot = (await catalog(db, true, 1100)).slots[0];
  assert.equal(slot.sponsor, null); assert.equal(slot.reserved, false);
});
