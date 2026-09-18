const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
require.cache[require.resolve('../utils/emailNotify')] = { exports: { sendNewOrderNotification: async () => {} } };
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
const app = require('../app');
const orders = require('../models/orderModel');
let server, base;
function request() {
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return { customer: { name: 'Retirement test', phone: '919999999999', address: 'Test only',
    deliveryDate: day, deliverySlot: '12-13' }, orderMode: 'Delivery',
    items: [{ id: 'fz-irachi-pathiri', qty: 10 }], idempotencyKey: randomUUID() };
}
before(async () => {
  await fixture.schema();
  // Simulate the old deployed schema without depending on retired application code.
  await fixture.database.exec(`CREATE TABLE IF NOT EXISTS offers (
    slug text PRIMARY KEY, title text NOT NULL, items jsonb NOT NULL,
    starts_at timestamptz DEFAULT now(), expires_at timestamptz DEFAULT now()+interval '24 hours', closed boolean DEFAULT false);
    INSERT INTO offers(slug,title,items) VALUES ('TESTDEAL','Previous offer','[{"id":"fz-irachi-pathiri","minQty":10,"price":12}]');`);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close();
});

test('retired offer URLs do not list, publish, view or close offers', async () => {
  for (const [url, method] of [['/offers','GET'], ['/offers','POST'], ['/offers/TESTDEAL','GET'], ['/offers/TESTDEAL/close','PUT']]) {
    assert.equal((await fetch(base + url, { method })).status, 404, `${method} ${url}`);
  }
});

test('an old open offer checkout is rejected instead of silently repriced or discounted', async () => {
  const input = { ...request(), offerSlug: 'TESTDEAL' };
  const before = (await fixture.query('SELECT count(*)::int n FROM orders')).rows[0].n;
  const response = await fetch(`${base}/orders`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /regular menu/i);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM orders')).rows[0].n, before);
});

test('manual cleanup removes only offer definitions and does not recreate them on bootstrap', async () => {
  const input = request();
  const order = await orders.createOrder(input);
  // A historical discounted invoice stores its prices independently of the offer table.
  await fixture.query('UPDATE orders SET total=120 WHERE id=$1', [order.id]);
  await fixture.query('UPDATE order_items SET unit_price=12, subtotal=120 WHERE order_id=$1', [order.id]);
  const beforeOrders = (await fixture.query('SELECT * FROM orders ORDER BY id')).rows;
  const beforeLines = (await fixture.query('SELECT * FROM order_items ORDER BY id')).rows;
  const beforeStock = (await fixture.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows;
  const cleanup = fs.readFileSync(path.join(__dirname, '../remove_24_hour_offers.sql'), 'utf8');
  await fixture.database.exec(`BEGIN; ${cleanup} COMMIT;`);
  await fixture.database.exec(`BEGIN; ${cleanup} COMMIT;`);
  await fixture.schema();
  assert.equal((await fixture.query("SELECT to_regclass('public.offers') AS relation")).rows[0].relation, null);
  assert.deepEqual((await fixture.query('SELECT * FROM orders ORDER BY id')).rows, beforeOrders);
  assert.deepEqual((await fixture.query('SELECT * FROM order_items ORDER BY id')).rows, beforeLines);
  assert.deepEqual((await fixture.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows, beforeStock);
  const saved = (await orders.getOrders()).find(row => row.id === order.id);
  assert.equal(Number(saved.total), 120);
  assert.equal(Number(saved.items[0].price), 12);
  const replay = await orders.createOrder(input);
  assert.equal(replay.id, order.id);
  assert.equal(Number(replay.total), 120);
  assert.equal(Number((await orders.createOrder(request())).total), 150);
});

test('a saved pre-removal discounted checkout replays without its deleted promotion table', async () => {
  const input = request();
  const order = await orders.createOrder(input);
  // Independent fixture matching the historical canonical payload format.
  const historicalHash = createHash('sha256').update(JSON.stringify({
    customer: { name: 'Retirement test', phone: '919999999999', address: 'Test only', notes: '',
      location: null, email: null, paymentMethod: 'cod', deliveryDate: input.customer.deliveryDate, deliverySlot: '12-13' },
    orderMode: 'Delivery', offerSlug: 'TESTDEAL', items: [{ id: 'fz-irachi-pathiri', qty: 10 }],
  })).digest('hex');
  await fixture.query('UPDATE orders SET total=120, checkout_request_hash=$1 WHERE id=$2', [historicalHash, order.id]);
  await fixture.query('UPDATE order_items SET unit_price=12, subtotal=120 WHERE order_id=$1', [order.id]);
  const count = (await fixture.query('SELECT count(*)::int n FROM orders')).rows[0].n;
  const retry = await orders.createOrder({ ...input, offerSlug: 'TESTDEAL' });
  assert.equal(retry.id, order.id);
  assert.equal(Number(retry.total), 120);
  assert.equal(Number(retry.items[0].price), 12);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM orders')).rows[0].n, count);
  await assert.rejects(orders.createOrder({ ...input, offerSlug: 'TESTDEAL', items: [{ id: 'fz-irachi-pathiri', qty: 20 }] }),
    error => error.code === 'IDEMPOTENCY_CONFLICT');
});
