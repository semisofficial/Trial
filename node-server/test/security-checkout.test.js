const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
let notifications = 0;
// The external delivery boundary is replaced; real order/model/SQL code runs.
require.cache[require.resolve('../utils/emailNotify')] = {
  exports: { sendNewOrderNotification: async () => { notifications++; } },
};
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
const orders = require('../models/orderModel');
const app = require('../app');
let server, base;

function request() {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2);
  return { customer: { name: 'Security test customer', phone: '919999999999', address: 'Test only',
    deliveryDate: day.toISOString().slice(0, 10), deliverySlot: '12-13' },
  orderMode: 'Delivery', items: [{ id: 'fz-irachi-pathiri', qty: 10 }], idempotencyKey: randomUUID() };
}
before(async () => {
  await fixture.schema();
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close();
});

test('duplicate line items cannot exceed the per-item safety ceiling after aggregation', async () => {
  await assert.rejects(orders.createOrder({ ...request(), items: [
    { id: 'fz-irachi-pathiri', qty: 10000 }, { id: 'fz-irachi-pathiri', qty: 10 },
  ] }), error => error.code === 'INVALID_ORDER');
});

test('same checkout key replays the existing order and original price without new customer rows', async () => {
  const input = request();
  const first = await orders.createOrder(input);
  const before = (await fixture.query('SELECT count(*)::int n FROM customers')).rows[0].n;
  await fixture.query("UPDATE inventory SET selling_price=99 WHERE menu_item_id='fz-irachi-pathiri'");
  try {
    const replay = await orders.createOrder(input);
    assert.equal(replay.id, first.id);
    assert.equal(Number(replay.total), 150);
    assert.equal(Number(replay.items[0].price), 15);
    assert.equal(replay.replayed, true);
    assert.equal((await fixture.query('SELECT count(*)::int n FROM customers')).rows[0].n, before);
    assert.ok(!('checkout_key_hash' in replay));
    assert.ok(!('checkout_request_hash' in replay));
  } finally { await fixture.query("UPDATE inventory SET selling_price=15 WHERE menu_item_id='fz-irachi-pathiri'"); }
});

test('same key with a different cart is rejected, while a fresh key permits a deliberate repeat purchase', async () => {
  const input = request();
  const first = await orders.createOrder(input);
  await assert.rejects(orders.createOrder({ ...input, items: [{ id: 'fz-irachi-pathiri', qty: 20 }] }),
    error => error.code === 'IDEMPOTENCY_CONFLICT');
  const repeat = await orders.createOrder({ ...input, idempotencyKey: randomUUID() });
  assert.notEqual(first.id, repeat.id);
});

test('an accepted checkout can be retried after its offer closes', async () => {
  const offers = require('../models/offerModel');
  const offer = await offers.publishOffer({ title: 'Audit offer', items: [{ id: 'fz-irachi-pathiri', minQty: 10, price: 12 }] });
  const input = { ...request(), offerSlug: offer.slug };
  const first = await orders.createOrder(input);
  await fixture.query('UPDATE offers SET closed=true WHERE slug=$1', [offer.slug]);
  assert.equal((await orders.createOrder(input)).id, first.id);
  await assert.rejects(orders.createOrder({ ...input, idempotencyKey: randomUUID() }), /closed/);
});

test('a rolled-back checkout does not consume its key or leave a customer behind', async () => {
  const input = request();
  const before = (await fixture.query('SELECT count(*)::int n FROM customers')).rows[0].n;
  const invalid = { ...input, items: [{ id: 'does-not-exist', qty: 10 }] };
  await assert.rejects(orders.createOrder(invalid), /no longer exist/);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM customers')).rows[0].n, before);
  const first = await orders.createOrder(input);
  assert.equal((await orders.createOrder(input)).id, first.id);
});

test('HTTP checkout requires a valid key and sends no second notification on replay', async () => {
  const input = request();
  const body = JSON.stringify(input);
  const post = key => fetch(`${base}/orders`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body });
  const missing = await post();
  assert.equal(missing.status, 400);
  assert.equal((await post('invalid-key')).status, 400);
  const before = notifications;
  const firstResponse = await post(input.idempotencyKey);
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).data;
  const retryResponse = await post(input.idempotencyKey);
  assert.equal(retryResponse.status, 200);
  const retry = (await retryResponse.json()).data;
  assert.equal(retry.id, first.id);
  assert.equal(notifications - before, 1);
  assert.ok(!('checkout_key_hash' in first));
  assert.ok(!('checkout_request_hash' in first));
});

test('security migration is re-runnable and its checkout index prevents duplicate keys', async () => {
  const input = request();
  const order = await orders.createOrder(input);
  const migration = fs.readFileSync(path.join(__dirname, '../security_hardening.sql'), 'utf8');
  await fixture.database.exec(migration);
  const original = (await fixture.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0];
  assert.match(original.checkout_key_hash, /^[a-f0-9]{64}$/);
  const another = await orders.createOrder({ ...input, idempotencyKey: randomUUID() });
  await assert.rejects(fixture.query('UPDATE orders SET checkout_key_hash=$1 WHERE id=$2', [original.checkout_key_hash, another.id]), /unique/);
});

test('admin status and payment updates do not return internal checkout hashes', async () => {
  const order = await orders.createOrder(request());
  for (const updated of [await orders.updateOrderStatus(order.id, 'accepted'), await orders.updatePaymentStatus(order.id, 'paid')]) {
    assert.ok(!('checkout_key_hash' in updated));
    assert.ok(!('checkout_request_hash' in updated));
  }
});
