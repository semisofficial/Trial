const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');

const fixture = testDatabase();
const orders = require('../models/orderModel');
const inventory = require('../models/inventoryModel');
let serial = 0;

before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty,stock_group_id)
    VALUES ('edit-a','fried','Edit A','1 piece',1,1,'edit-a'),
           ('edit-b','frozen','Edit B','1 piece',1,1,'edit-b'),
           ('edit-c','fried','Edit C','1 piece',1,1,'edit-c')`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    VALUES ('edit-a',20,20,true),('edit-b',30,20,true),('edit-c',40,20,true)`);
});
after(() => fixture.close());

function customer() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 3);
  return {
    name: `Edit test ${++serial}`,
    phone: '9876543210',
    address: 'Test',
    deliveryDate: date.toISOString().slice(0, 10),
    deliverySlot: '12-13',
  };
}

async function create(items = [{ id: 'edit-a', qty: 2 }, { id: 'edit-b', qty: 3 }]) {
  return orders.createOrder({ customer: customer(), items, orderMode: 'Pickup' });
}

test('edited acceptance omits lines, changes quantity, preserves original price and updates total atomically', async () => {
  const order = await create();
  await inventory.updateInventory('edit-a', { price: 99 });

  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 4 }]);
  assert.equal(accepted.status, 'accepted');
  assert.equal(Number(accepted.total), 80, 'original unit price is preserved for an existing line');

  const saved = await fixture.query(`SELECT menu_item_id,quantity,unit_price,subtotal,item_name_snapshot
    FROM order_items WHERE order_id=$1 ORDER BY id`, [order.id]);
  assert.deepEqual(saved.rows.map((row) => ({
    id: row.menu_item_id,
    qty: Number(row.quantity),
    price: Number(row.unit_price),
    subtotal: Number(row.subtotal),
    name: row.item_name_snapshot,
  })), [{ id: 'edit-a', qty: 4, price: 20, subtotal: 80, name: 'Edit A' }]);
  assert.equal(Number((await fixture.query('SELECT total FROM orders WHERE id=$1', [order.id])).rows[0].total), 80);
  assert.equal(Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='edit-a'")).rows[0].stock), 16);
});

test('swapped items use the replacement current price and snapshot name', async () => {
  const order = await create([{ id: 'edit-a', qty: 2 }]);
  await inventory.updateInventory('edit-c', { price: 45 });
  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-c', qty: 2 }]);
  assert.equal(Number(accepted.total), 90);
  const row = (await fixture.query('SELECT menu_item_id,unit_price,subtotal,item_name_snapshot FROM order_items WHERE order_id=$1', [order.id])).rows[0];
  assert.equal(row.menu_item_id, 'edit-c');
  assert.equal(Number(row.unit_price), 45);
  assert.equal(Number(row.subtotal), 90);
  assert.equal(row.item_name_snapshot, 'Edit C');
});

test('edited acceptance rolls back item edits, total and status if included stock is insufficient', async () => {
  await inventory.updateInventory('edit-b', { stock: 1 });
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-b', qty: 3 }]);
  const before = (await fixture.query('SELECT menu_item_id,quantity,unit_price,subtotal FROM order_items WHERE order_id=$1 ORDER BY id', [order.id])).rows;
  const beforeTotal = Number(order.total);

  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-b', qty: 3 }]), (error) => error.code === 'INSUFFICIENT_STOCK');

  const persisted = await fixture.query('SELECT status,total,stock_reserved FROM orders WHERE id=$1', [order.id]);
  assert.equal(persisted.rows[0].status, 'pending');
  assert.equal(Number(persisted.rows[0].total), beforeTotal);
  assert.equal(persisted.rows[0].stock_reserved, false);
  assert.deepEqual((await fixture.query('SELECT menu_item_id,quantity,unit_price,subtotal FROM order_items WHERE order_id=$1 ORDER BY id', [order.id])).rows, before);
  assert.equal(Number((await fixture.query("SELECT stock FROM inventory WHERE menu_item_id='edit-b'")).rows[0].stock), 1);
  assert.equal((await fixture.query('SELECT * FROM order_stock_deductions WHERE order_id=$1', [order.id])).rows.length, 0);
});

test('edited acceptance is pending-only and rejects unavailable replacement items', async () => {
  const first = await create([{ id: 'edit-a', qty: 1 }]);
  await inventory.updateInventory('edit-c', { available: false });
  await assert.rejects(orders.acceptEditedOrder(first.id, [{ id: 'edit-c', qty: 1 }]), /replacement/);
  assert.equal((await fixture.query('SELECT status FROM orders WHERE id=$1', [first.id])).rows[0].status, 'pending');

  const second = await create([{ id: 'edit-a', qty: 1 }]);
  await orders.updateOrderStatus(second.id, 'accepted');
  await assert.rejects(orders.acceptEditedOrder(second.id, [{ id: 'edit-a', qty: 1 }]), (error) => error.code === 'INVALID_STATUS_TRANSITION');
});
