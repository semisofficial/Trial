const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
const orders = require('../models/orderModel');
const inventory = require('../models/inventoryModel');
let serial = 0;
before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty,stock_group_id)
    VALUES ('stock-fr','fried','Fried cutlet','1 piece',1,1,'stock-fr'),
    ('stock-fz','frozen','Frozen cutlet','1 piece',1,1,'stock-fr')`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    VALUES ('stock-fr',20,10,true),('stock-fz',15,99,true)`);
});
after(() => fixture.close());
async function stock() { return Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='stock-fr'")).rows[0].stock); }
async function create(items = [{ id: 'stock-fr', qty: 15 }]) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 3);
  return orders.createOrder({ customer: { name: `Stock test ${++serial}`, phone: '9876543210', address: 'Test',
    deliveryDate: date.toISOString().slice(0,10), deliverySlot: '12-13' }, items, orderMode: 'Pickup' });
}
test('pending shortages combine shared variants without deducting stock; mains excluded', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create([{ id:'stock-fr',qty:8 }, { id:'stock-fz',qty:7 }, { id:'mc-ghee-rice',qty:1 }]);
  const row = (await orders.getOrders()).find(o => o.id === order.id);
  assert.equal(await stock(), 10);
  assert.equal(row.stock_shortages.length, 1);
  assert.equal(Number(row.stock_shortages[0].required), 15);
  assert.equal(Number(row.stock_shortages[0].available), 10);
  assert.equal(Number(row.stock_shortages[0].shortage), 5);
  await inventory.updateInventory('stock-fz', { stock: 15 });
  assert.deepEqual((await orders.getOrders()).find(o => o.id === order.id).stock_shortages, []);
  await inventory.updateInventory('stock-fr', { stock: 10 });
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 10);
});
test('accept deducts once, clamps to zero, and decline restores only actual deduction', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create([{ id:'stock-fr',qty:8 }, { id:'stock-fz',qty:7 }]);
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(await stock(), 0);
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(await stock(), 0);
  // New stock arriving after acceptance must not be overwritten on decline.
  await inventory.updateInventory('stock-fz', { stock: 4 });
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 14);
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 14);
  await orders.updateOrderStatus(order.id, 'pending');
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(await stock(), 0);
  await orders.deleteOrder(order.id);
  assert.equal(await stock(), 14);
});
test('completion keeps full ordered sales and cannot deduct or count revenue twice', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create();
  const revenue = async () => Number((await fixture.query('SELECT COALESCE(SUM(revenue),0) AS total FROM sales_summary')).rows[0].total);
  const beforeRevenue = await revenue();
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(await revenue(), beforeRevenue);
  await orders.updateOrderStatus(order.id, 'completed');
  await orders.updateOrderStatus(order.id, 'completed');
  assert.equal(await stock(), 0);
  assert.equal(await revenue(), beforeRevenue + 300);
  const saved = (await orders.getOrders()).find(o => o.id === order.id);
  assert.equal(Number(saved.items[0].qty), 15);
  assert.equal(Number(saved.total), 300);
  await orders.deleteOrder(order.id);
  assert.equal(await stock(), 0);
});
test('zero-stock acceptance and later decline never invent inventory', async () => {
  await inventory.updateInventory('stock-fr', { stock: 0 });
  const order = await create();
  await orders.updateOrderStatus(order.id, 'accepted');
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 0);
});
test('migration reruns preserve stock, historical orders, and active deduction records', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create();
  await orders.updateOrderStatus(order.id, 'accepted');
  const before = (await fixture.query('SELECT * FROM order_stock_deductions ORDER BY order_id, stock_item_id')).rows;
  await fixture.database.exec(fs.readFileSync(path.join(__dirname, '../order_stock.sql'), 'utf8'));
  assert.equal(await stock(), 0);
  assert.deepEqual((await fixture.query('SELECT * FROM order_stock_deductions ORDER BY order_id, stock_item_id')).rows, before);
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 10);
});

test('separate orders consume shared stock in turn; each restores its own deduction', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const first = await create([{ id:'stock-fr',qty:8 }]);
  const second = await create([{ id:'stock-fz',qty:7 }]);
  await orders.updateOrderStatus(first.id, 'accepted');
  assert.equal(await stock(), 2);
  const warning = (await orders.getOrders()).find(o => o.id === second.id).stock_shortages[0];
  assert.equal(Number(warning.shortage), 5);
  await orders.updateOrderStatus(second.id, 'accepted');
  assert.equal(await stock(), 0);
  await orders.updateOrderStatus(first.id, 'declined');
  assert.equal(await stock(), 8);
  await orders.updateOrderStatus(second.id, 'declined');
  assert.equal(await stock(), 10);
});

test('mains-only acceptance does not touch inventory; historical accepted orders are not retroactively deducted', async () => {
  const mainStock = (await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='mc-ghee-rice'")).rows[0].stock;
  const main = await create([{ id:'mc-ghee-rice',qty:1 }]);
  await orders.updateOrderStatus(main.id, 'accepted');
  assert.equal((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='mc-ghee-rice'")).rows[0].stock, mainStock);
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const historical = await create();
  await fixture.query("UPDATE orders SET status='accepted', stock_reserved=false WHERE id=$1", [historical.id]);
  await orders.updateOrderStatus(historical.id, 'accepted');
  await orders.updateOrderStatus(historical.id, 'declined');
  assert.equal(await stock(), 10);
});

test('failed acceptance rolls back inventory and deduction rows together with status', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create();
  const realConnect = fixture.pool.connect;
  fixture.pool.connect = async () => {
    const client = await realConnect();
    return { ...client, query: async (sql, params) => {
      if (sql.includes('UPDATE orders o SET status')) throw new Error('Test status write failure');
      return client.query(sql, params);
    } };
  };
  try { await assert.rejects(orders.updateOrderStatus(order.id, 'accepted'), /Test status write failure/); }
  finally { fixture.pool.connect = realConnect; }
  assert.equal(await stock(), 10);
  assert.equal((await fixture.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status, 'pending');
  assert.equal((await fixture.query('SELECT * FROM order_stock_deductions WHERE order_id=$1',[order.id])).rows.length, 0);
  await orders.updateOrderStatus(order.id, 'accepted');
  assert.equal(await stock(), 0);
});

test('legacy reserved orders restore their original item stock only once', async () => {
  await inventory.updateInventory('stock-fr', { stock: 0 });
  const order = await create([{ id:'stock-fr',qty:5 }]);
  await fixture.query("UPDATE orders SET status='accepted', stock_reserved=true WHERE id=$1", [order.id]);
  await orders.updateOrderStatus(order.id, 'declined');
  await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(await stock(), 5);
});

test('missing migration fails acceptance safely with an actionable setup message', async () => {
  await inventory.updateInventory('stock-fr', { stock: 10 });
  const order = await create();
  await fixture.query('ALTER TABLE order_stock_deductions RENAME TO deductions_test_backup');
  try {
    const controller = require('../controllers/orderController');
    let status, body;
    const res = { status(code) { status=code; return this; }, json(value) { body=value; return this; } };
    await controller.updateOrderStatus({ params:{ id:order.id }, body:{ status:'accepted' } }, res);
    assert.equal(status, 503);
    assert.match(body.message, /order_stock\.sql/);
    assert.equal(await stock(), 10);
    assert.equal((await fixture.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status, 'pending');
  } finally { await fixture.query('ALTER TABLE deductions_test_backup RENAME TO order_stock_deductions'); }
});
