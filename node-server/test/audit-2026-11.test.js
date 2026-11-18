// Regression tests for the 2026-11-18 audit repairs: public stock exposure,
// generic order deletion, and checkout price-change confirmation.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
require.cache[require.resolve('../utils/emailNotify')] = { exports: { sendNewOrderNotification: async () => null } };
process.env.WHATSAPP_NOTIFICATIONS_ENABLED = 'false';
process.env.ADMIN_PASSWORD = 'audit-test-password';
process.env.SESSION_SECRET = 'audit-test-secret-at-least-thirty-two-characters';
const orders = require('../models/orderModel');
const inventory = require('../models/inventoryModel');
const app = require('../app');
let server, base, cookie;

before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty,stock_group_id)
    VALUES ('aud-fz','frozen','Audit Frozen','1 piece',1,1,'aud-fz'),('aud-fr','fried','Audit Fried','1 piece',1,1,'aud-fz')`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    VALUES ('aud-fz',10,40,true),('aud-fr',12,0,true)`);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(`${base}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fixture.close();
});

function checkout(items, mode = 'Pickup') {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2);
  return { customer: { name: 'Audit customer', phone: '9876543210', address: 'Test', mode,
    deliveryDate: day.toISOString().slice(0, 10), deliverySlot: '12-13' }, items };
}
const post = (body, key = randomUUID()) => fetch(`${base}/orders`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
const orderCount = async () => Number((await fixture.query('SELECT count(*) AS n FROM orders')).rows[0].n);

test('public menu and inventory omit stock counts and stock-group ids; admin views keep them', async () => {
  const menu = (await (await fetch(`${base}/menu`)).json()).data.find((item) => item.id === 'aud-fr');
  assert.equal(Number(menu.price), 12);
  assert.equal(menu.available, true);
  assert.equal('stock' in menu, false);
  assert.equal('stockGroupId' in menu, false);

  const publicInventory = (await (await fetch(`${base}/inventory`)).json()).data.find((row) => row.menu_item_id === 'aud-fr');
  assert.deepEqual(Object.keys(publicInventory).sort(), ['available', 'menu_item_id', 'selling_price']);

  const adminMenu = (await (await fetch(`${base}/menu/admin`, { headers: { cookie } })).json()).data.find((item) => item.id === 'aud-fr');
  assert.equal(adminMenu.stockGroupId, 'aud-fz');
  assert.equal(Number(adminMenu.stock), 40);
  const adminInventory = (await (await fetch(`${base}/inventory/admin`, { headers: { cookie } })).json()).data
    .find((row) => row.menu_item_id === 'aud-fr');
  assert.equal(adminInventory.stock_group_id, 'aud-fz');
});

test('checkout with a stale shown price is refused with the new price and saves nothing', async () => {
  await inventory.updateInventory('aud-fz', { price: 11 });
  const before = await orderCount();
  const response = await post(checkout([{ id: 'aud-fz', qty: 2, price: 10 }]));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'PRICE_CHANGED');
  assert.deepEqual(body.priceChanges, [{ id: 'aud-fz', name: 'Audit Frozen', price: 11, previousPrice: 10 }]);
  assert.equal(await orderCount(), before);

  const confirmed = await post(checkout([{ id: 'aud-fz', qty: 2, price: 11 }]));
  assert.equal(confirmed.status, 201);
  assert.equal(Number((await confirmed.json()).data.total), 22, 'server price is still authoritative');
});

test('older pages without shown prices are still accepted at the server price', async () => {
  const response = await post(checkout([{ id: 'aud-fz', qty: 1 }]));
  assert.equal(response.status, 201);
  assert.equal(Number((await response.json()).data.total), 11);
});

test('a retry of an already-saved order replays even if the price changed afterwards', async () => {
  const key = randomUUID();
  const body = checkout([{ id: 'aud-fr', qty: 1, price: 12 }]);
  const first = await post(body, key);
  assert.equal(first.status, 201);
  const saved = (await first.json()).data;
  await inventory.updateInventory('aud-fr', { price: 15 });
  const retry = await post(body, key);
  assert.equal(retry.status, 200);
  const replay = (await retry.json()).data;
  assert.equal(replay.id, saved.id);
  assert.equal(Number(replay.total), 12);
});

test('invalid shown prices are rejected as invalid input', async () => {
  const response = await post(checkout([{ id: 'aud-fz', qty: 1, price: 'abc' }]));
  assert.equal(response.status, 400);
});

test('generic DELETE removes pending/declined orders only; accepted and completed orders are refused', async () => {
  const del = (id) => fetch(`${base}/orders/${id}`, { method: 'DELETE', headers: { cookie } });
  const make = () => orders.createOrder({ customer: checkout([]).customer, items: [{ id: 'aud-fz', qty: 1 }], orderMode: 'Pickup' });
  const revenue = async () => Number((await fixture.query('SELECT COALESCE(SUM(revenue),0) AS r FROM sales_summary')).rows[0].r);

  const pending = await make();
  assert.equal((await del(pending.id)).status, 200);

  const accepted = await make();
  await orders.updateOrderStatus(accepted.id, 'accepted');
  const refusedAccepted = await del(accepted.id);
  assert.equal(refusedAccepted.status, 409);
  assert.equal((await refusedAccepted.json()).code, 'ORDER_NOT_DELETABLE');

  const completed = await make();
  await orders.updateOrderStatus(completed.id, 'accepted');
  await orders.updateOrderStatus(completed.id, 'completed');
  const revenueBefore = await revenue();
  assert.equal((await del(completed.id)).status, 409);
  assert.equal(await revenue(), revenueBefore, 'sales totals are untouched');
  assert.equal((await fixture.query('SELECT 1 FROM orders WHERE id=$1', [completed.id])).rows.length, 1);

  await orders.updateOrderStatus(accepted.id, 'declined');
  assert.equal((await del(accepted.id)).status, 200);
  assert.equal((await del('SK-missing')).status, 404);
});
