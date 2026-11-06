const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');

const fixture = testDatabase();
const orders = require('../models/orderModel');
const sales = require('../models/salesModel');
const { COMPLETED_ORDERS_QUERY } = require('../utils/invoiceQueries');
let serial = 0;

before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty,stock_group_id)
    VALUES ('sum-fry','fried','Summary Fry','1 piece',1,1,'sum-fry'),
           ('sum-main','mains','Summary Main','1 plate',1,1,NULL)`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    VALUES ('sum-fry',20,50,true),('sum-main',100,NULL,true)`);
});
after(() => fixture.close());

function customer() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  return { name: `Summary ${++serial}`, phone: '9876543210', address: 'Test',
    deliveryDate: date.toISOString().slice(0, 10), deliverySlot: '12-13' };
}

async function completed(items, createdAt) {
  const order = await orders.createOrder({ customer: customer(), items, orderMode: 'Pickup' });
  if (createdAt) await fixture.query('UPDATE orders SET created_at=$1 WHERE id=$2', [createdAt, order.id]);
  await orders.updateOrderStatus(order.id, 'accepted');
  await orders.updateOrderStatus(order.id, 'completed');
  return order;
}

async function day(date) {
  return (await sales.getSalesSummary()).find((row) => row.date === date);
}

test('sales summary dates are plain IST calendar days', async () => {
  // 18:30 UTC on 9 Feb is 00:00 IST on 10 Feb.
  await completed([{ id: 'sum-main', qty: 1 }], '2026-02-09T18:30:00Z');
  const row = await day('2026-02-10');
  assert.ok(row, 'counted on the IST date');
  assert.equal(typeof row.date, 'string');
  assert.equal(Number(row.orders_count), 1);
  assert.equal(Number(row.revenue), 100);
});

test('deleting a mistaken completed order subtracts it from that day only and keeps stock', async () => {
  const keep = await completed([{ id: 'sum-main', qty: 2 }], '2026-03-05T06:00:00Z');
  const wrong = await completed([{ id: 'sum-fry', qty: 5 }], '2026-03-05T07:00:00Z');
  assert.deepEqual([Number((await day('2026-03-05')).orders_count), Number((await day('2026-03-05')).revenue)], [2, 300]);
  const stockBefore = Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='sum-fry'")).rows[0].stock);

  assert.deepEqual(await orders.deleteCompletedOrder(wrong.id), { deleted: true });
  const after = await day('2026-03-05');
  assert.equal(Number(after.orders_count), 1);
  assert.equal(Number(after.revenue), 200, '₹300 − ₹100 wrong order');
  assert.equal(Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='sum-fry'")).rows[0].stock), stockBefore,
    'stock is not restored for a deleted completed order');
  assert.ok((await orders.getOrders()).some((row) => row.id === keep.id));
});

test('bulk delete of paid + synced orders keeps the daily totals', async () => {
  const order = await completed([{ id: 'sum-main', qty: 3 }], '2026-04-01T06:00:00Z');
  await orders.updatePaymentStatus(order.id, 'paid');
  await fixture.query('UPDATE orders SET synced_at=now() WHERE id=$1', [order.id]);
  assert.equal(await orders.deletePaidSyncedOrders(), 1);
  const row = await day('2026-04-01');
  assert.equal(Number(row.orders_count), 1);
  assert.equal(Number(row.revenue), 300);
});

test('Google Sheet sync selects only completed orders that are paid', async () => {
  const unpaid = await completed([{ id: 'sum-main', qty: 1 }]);
  const paid = await completed([{ id: 'sum-main', qty: 1 }]);
  await orders.updatePaymentStatus(paid.id, 'paid');
  const ids = new Set((await fixture.query(COMPLETED_ORDERS_QUERY)).rows.map((row) => row.order_id));
  assert.ok(ids.has(paid.id));
  assert.ok(!ids.has(unpaid.id), 'unpaid completed order waits until it is paid');
});

test('payment can be recorded only for accepted or completed orders', async () => {
  const order = await orders.createOrder({ customer: customer(), items: [{ id: 'sum-main', qty: 1 }], orderMode: 'Pickup' });
  await assert.rejects(orders.updatePaymentStatus(order.id, 'paid'), { code: 'INVALID_STATUS_TRANSITION' });
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal((await orders.updatePaymentStatus(order.id, 'paid')).payment_status, 'paid');
  await orders.updateOrderStatus(order.id, 'declined');
  await assert.rejects(orders.updatePaymentStatus(order.id, 'unpaid'), { code: 'INVALID_STATUS_TRANSITION' });
  assert.equal(await orders.updatePaymentStatus('missing-order', 'paid'), null);
});

test('declining an accepted order puts its deducted stock back and adds no sales', async () => {
  const before = (await sales.getSalesSummary()).reduce((sum, row) => sum + Number(row.revenue), 0);
  await fixture.query("UPDATE inventory SET stock=10 WHERE menu_item_id='sum-fry'");
  const order = await orders.createOrder({ customer: customer(), items: [{ id: 'sum-fry', qty: 4 }], orderMode: 'Pickup' });
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='sum-fry'")).rows[0].stock), 6);
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='sum-fry'")).rows[0].stock), 10);
  const afterTotal = (await sales.getSalesSummary()).reduce((sum, row) => sum + Number(row.revenue), 0);
  assert.equal(afterTotal, before);
});
