import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recordVisit, recordDownload, recordRoombas, readStats, handleStats } from '../server/stats.js';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_community_stats.sql', import.meta.url), 'utf8'));
  return {
    prepare(query) {
      let values = [];
      return { bind(...v) { values = v; return this; },
        async first() { return sql.prepare(query).get(...values) || null; },
        async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const out = []; for (const stmt of statements) out.push(await stmt.run()); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}
const installation = () => ({ installation: crypto.randomUUID(), token: 'a'.repeat(64), sequence: 1, count: 4 });
test('browser heartbeats and reloads count one visit; online browsers expire while totals persist', async () => {
  const db = database(), a = { session: crypto.randomUUID() };
  await recordVisit(db, a, 1000); await recordVisit(db, a, 1030);
  await recordVisit(db, { session: crypto.randomUUID() }, 1040);
  assert.equal((await readStats(db, 1050)).visits, 2); assert.equal((await readStats(db, 1050)).browsingNow, 2);
  const expired = await readStats(db, 1140);
  assert.equal(expired.visits, 2); assert.equal(expired.browsingNow, 0);
});
test('download event retries count once, valid separate clicks count separately, invalid assets do not count', async () => {
  const db = database(), event = { event: crypto.randomUUID(), asset: 'windows', at: 1000 };
  await recordDownload(db, event, 1000); await recordDownload(db, event, 1001);
  await recordDownload(db, { ...event, event: crypto.randomUUID(), asset: 'mac' }, 1002);
  await assert.rejects(recordDownload(db, { ...event, asset: 'fake' }, 1003));
  await assert.rejects(recordDownload(db, event, 2000), /Expired/);
  assert.equal((await readStats(db, 2000)).downloadClicks, 2);
});
test('roombas are summed per installation, not per heartbeat; disconnected apps expire after five minutes', async () => {
  const db = database(), a = installation(), b = installation(); b.count = 7;
  await recordRoombas(db, a, 1000); await recordRoombas(db, b, 1010);
  await recordRoombas(db, { ...a, sequence: 2, count: 6 }, 1020);
  assert.equal((await readStats(db, 1100)).roombasOnline, 13);
  assert.equal((await readStats(db, 1310)).roombasOnline, 6);
  assert.equal((await readStats(db, 1320)).roombasOnline, 0);
});
test('opt-out cannot be undone by older/replayed heartbeats or a different token', async () => {
  const db = database(), a = installation(); await recordRoombas(db, a, 1000);
  await recordRoombas(db, { ...a, count: 0, sequence: 3 }, 1030);
  await recordRoombas(db, { ...a, sequence: 2 }, 1040);
  await recordRoombas(db, a, 1050);
  await assert.rejects(recordRoombas(db, { ...a, sequence: 4, token: 'b'.repeat(64) }, 1060), /credential/);
  assert.equal((await readStats(db, 1060)).roombasOnline, 0);
});
test('invalid and unreasonable roomba counts are rejected', async () => {
  const db = database();
  for (const count of [-1, 1.5, 1001, '4', Infinity]) await assert.rejects(recordRoombas(db, { ...installation(), count }, 1000));
  assert.equal((await readStats(db, 1000)).roombasOnline, 0);
});
test('public API exposes aggregates only; browser events require same-origin and bodies are bounded', async () => {
  const env = { STATS_DB: database(), SITE_ORIGIN: 'https://roombai.com' };
  const send = (body, origin, path = 'visit') => handleStats(new Request(`https://roombai.com/api/stats/${path}`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }), env);
  assert.equal((await send({ session: crypto.randomUUID() }, 'https://evil.example')).status, 403);
  assert.equal((await send({ session: crypto.randomUUID() }, env.SITE_ORIGIN)).status, 200);
  assert.equal((await send({ text: 'x'.repeat(2000) }, env.SITE_ORIGIN)).status, 413);
  assert.equal((await send(installation(), env.SITE_ORIGIN, 'roombas')).status, 403);
  const response = await handleStats(new Request('https://roombai.com/api/stats'), env);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ['browsingNow','downloadClicks','roombasOnline','since','updatedAt','visits']);
  assert.equal(data.visits, 1);
});
