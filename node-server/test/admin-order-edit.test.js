const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');

const fixture = testDatabase();
const orders = require('../models/orderModel');
const inventory = require('../models/inventoryModel');
const orderStock = require('../models/orderStock');
let serial = 0;

// PGlite uses one connection: these tests prove transaction/rollback behavior
// and stock arithmetic, not multi-session PostgreSQL lock contention.
before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty,stock_group_id)
    VALUES ('edit-a','fried','Edit A','1 piece',1,1,'edit-a'),
           ('edit-b','frozen','Edit B','1 piece',1,1,'edit-b'),
           ('edit-c','fried','Edit C','1 piece',1,1,'edit-c'),
           ('edit-step','fried','Edit Step','1 piece',5,5,'edit-step'),
           ('grp-fz','frozen','Group Frozen','1 piece',1,1,'grp-fz'),
           ('grp-fr','fried','Group Fried','1 piece',1,1,'grp-fz'),
           ('edit-main','mains','Edit Main','1 plate',1,1,'edit-main')`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    VALUES ('edit-a',20,20,true),('edit-b',30,20,true),('edit-c',40,20,true),('edit-step',10,50,true),
           ('grp-fz',15,10,true),('grp-fr',25,0,true),('edit-main',100,NULL,true)`);
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
const setStock = (id, stock) => fixture.query('UPDATE inventory SET stock=$1 WHERE menu_item_id=$2', [stock, id]);
const stockOf = async (id) => Number((await fixture.query('SELECT stock FROM inventory WHERE menu_item_id=$1', [id])).rows[0].stock);
const lines = async (orderId) => (await fixture.query(`SELECT menu_item_id AS id, quantity, unit_price, subtotal
  FROM order_items WHERE order_id=$1 ORDER BY id`, [orderId])).rows
  .map((row) => ({ id: row.id, qty: Number(row.quantity), price: Number(row.unit_price), subtotal: Number(row.subtotal) }));
const ledger = async (orderId) => (await fixture.query(`SELECT stock_item_id AS id, quantity
  FROM order_stock_deductions WHERE order_id=$1 ORDER BY stock_item_id`, [orderId])).rows
  .map((row) => ({ id: row.id, qty: Number(row.quantity) }));
const orderRow = async (orderId) => (await fixture.query('SELECT status,total,stock_reserved FROM orders WHERE id=$1', [orderId])).rows[0];

test('edited acceptance omits lines, changes quantity, preserves original price and updates total atomically', async () => {
  await setStock('edit-a', 20);
  const order = await create();
  await inventory.updateInventory('edit-a', { price: 99 });

  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 4 }]);
  assert.equal(accepted.status, 'accepted');
  assert.equal(Number(accepted.total), 80, 'original unit price is preserved for an existing line');
  assert.deepEqual(await lines(order.id), [{ id: 'edit-a', qty: 4, price: 20, subtotal: 80 }]);
  assert.equal(Number((await orderRow(order.id)).total), 80);
  assert.equal(await stockOf('edit-a'), 16);
  await inventory.updateInventory('edit-a', { price: 20 });
});

test('Case A: a shortage in an included line no longer blocks edited acceptance', async () => {
  await setStock('edit-a', 20);
  await setStock('edit-b', 1);
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-b', qty: 3 }]);

  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-b', qty: 3 }]);
  assert.equal(accepted.status, 'accepted');
  assert.equal(Number(accepted.total), 90, 'total contains only the included line at its saved price');
  assert.deepEqual(await lines(order.id), [{ id: 'edit-b', qty: 3, price: 30, subtotal: 90 }]);
  assert.equal(await stockOf('edit-b'), 0, 'only the available unit was deducted; stock never goes negative');
  assert.deepEqual(await ledger(order.id), [{ id: 'edit-b', qty: 1 }], 'the actual deduction is recorded');
  assert.equal(await stockOf('edit-a'), 20, 'the omitted line is not deducted');
  assert.equal((await orderRow(order.id)).stock_reserved, true);
  assert.deepEqual(accepted.stock_shortages.map((s) => ({ id: s.stock_group_id, required: Number(s.required),
    available: Number(s.available), shortage: Number(s.shortage) })),
  [{ id: 'edit-b', required: 3, available: 1, shortage: 2 }], 'the shortage is returned as a warning');
});

test('Case B: omitting the shortage item accepts only the remaining item', async () => {
  await setStock('edit-a', 20);
  await setStock('edit-b', 1);
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-b', qty: 3 }]);

  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 2 }]);
  assert.equal(Number(accepted.total), 40);
  assert.deepEqual(await lines(order.id), [{ id: 'edit-a', qty: 2, price: 20, subtotal: 40 }]);
  assert.equal(await stockOf('edit-a'), 18);
  assert.equal(await stockOf('edit-b'), 1, 'the omitted short item keeps its stock');
  assert.deepEqual(accepted.stock_shortages, []);
});

test('Case C: declining an edited accepted order restores only the recorded deduction', async () => {
  await setStock('edit-b', 2);
  const order = await create([{ id: 'edit-a', qty: 1 }, { id: 'edit-b', qty: 5 }]);
  await orders.acceptEditedOrder(order.id, [{ id: 'edit-b', qty: 5 }]);
  assert.equal(await stockOf('edit-b'), 0);
  assert.deepEqual(await ledger(order.id), [{ id: 'edit-b', qty: 2 }]);

  await setStock('edit-b', 4); // staff produced more meanwhile
  const declined = await orders.updateOrderStatus(order.id, 'declined');
  assert.equal(declined.status, 'declined');
  assert.equal(await stockOf('edit-b'), 6, 'restores the 2 deducted units, not the 5 ordered');
  assert.deepEqual(await ledger(order.id), []);
  assert.equal((await orderRow(order.id)).stock_reserved, false);
});

test('Case D: a swap uses the replacement price, quantity, total and its shared stock group', async () => {
  await setStock('grp-fz', 10);
  await inventory.updateInventory('grp-fr', { price: 26 });
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-c', qty: 1 }]);

  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 2 }, { id: 'grp-fr', qty: 4 }]);
  assert.equal(Number(accepted.total), 2 * 20 + 4 * 26);
  assert.deepEqual(await lines(order.id), [
    { id: 'edit-a', qty: 2, price: 20, subtotal: 40 },
    { id: 'grp-fr', qty: 4, price: 26, subtotal: 104 },
  ]);
  const name = (await fixture.query(`SELECT item_name_snapshot FROM order_items WHERE order_id=$1 AND menu_item_id='grp-fr'`, [order.id])).rows[0];
  assert.equal(name.item_name_snapshot, 'Group Fried');
  assert.equal(await stockOf('grp-fz'), 6, 'fried variant draws from the shared frozen stock group');
  assert.equal(await stockOf('grp-fr'), 0, 'the variant row itself is not used as stock');
  assert.equal(await stockOf('edit-c'), 20, 'the swapped-out item is not deducted');
});

test('fried and frozen lines of one stock group are deducted together, up to the shared stock', async () => {
  await setStock('grp-fz', 5);
  const order = await create([{ id: 'grp-fz', qty: 3 }, { id: 'grp-fr', qty: 4 }]);
  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'grp-fz', qty: 3 }, { id: 'grp-fr', qty: 4 }]);
  assert.equal(await stockOf('grp-fz'), 0);
  assert.deepEqual(await ledger(order.id), [{ id: 'grp-fz', qty: 5 }]);
  assert.equal(Number(accepted.stock_shortages[0].shortage), 2);
});

test('mains lines are accepted without stock deduction', async () => {
  const order = await create([{ id: 'edit-main', qty: 2 }, { id: 'edit-a', qty: 1 }]);
  const accepted = await orders.acceptEditedOrder(order.id, [{ id: 'edit-main', qty: 2 }]);
  assert.equal(Number(accepted.total), 200);
  assert.deepEqual(await ledger(order.id), []);
  assert.equal((await orderRow(order.id)).stock_reserved, false);
});

test('swapping a line onto an item already in the order is rejected instead of mispriced', async () => {
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-c', qty: 1 }]);
  await inventory.updateInventory('edit-a', { price: 99 });
  const before = await lines(order.id);
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 2 }, { id: 'edit-a', qty: 1 }]),
    (error) => error.code === 'INVALID_ORDER' && /only once/.test(error.message));
  assert.equal((await orderRow(order.id)).status, 'pending');
  assert.deepEqual(await lines(order.id), before);
  await inventory.updateInventory('edit-a', { price: 20 });
});

test('Case E: invalid edits are still rejected and leave the order unchanged', async () => {
  const order = await create([{ id: 'edit-a', qty: 1 }, { id: 'edit-step', qty: 5 }]);
  const before = await lines(order.id);
  const stockBefore = await stockOf('edit-a');

  await assert.rejects(orders.acceptEditedOrder(order.id, []), /between 1 and 100/);
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 0 }]), /invalid/);
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: -2 }]), /invalid/);
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-step', qty: 7 }]), /steps of 5/);
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'no-such-item', qty: 1 }]), /no longer exist/);
  await inventory.updateInventory('edit-c', { available: false });
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-c', qty: 1 }]), /replacement/);
  await inventory.updateInventory('edit-c', { available: true });

  assert.equal((await orderRow(order.id)).status, 'pending');
  assert.deepEqual(await lines(order.id), before);
  assert.equal(await stockOf('edit-a'), stockBefore);
  assert.deepEqual(await ledger(order.id), []);
});

test('Case E: a database failure after deduction rolls back lines, total, stock, ledger and status together', async () => {
  await setStock('edit-a', 20);
  const order = await create([{ id: 'edit-a', qty: 2 }, { id: 'edit-b', qty: 3 }]);
  const before = await lines(order.id);
  const originalDeduct = orderStock.deduct;
  orderStock.deduct = async (client, id) => {
    await originalDeduct(client, id);
    throw new Error('Simulated failure after deduction');
  };
  try {
    await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 4 }]), /Simulated failure/);
  } finally {
    orderStock.deduct = originalDeduct;
  }
  const row = await orderRow(order.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.stock_reserved, false);
  assert.equal(Number(row.total), Number(order.total));
  assert.deepEqual(await lines(order.id), before);
  assert.equal(await stockOf('edit-a'), 20);
  assert.deepEqual(await ledger(order.id), []);
});

test('edited acceptance is pending-only', async () => {
  const order = await create([{ id: 'edit-a', qty: 1 }]);
  await orders.updateOrderStatus(order.id, 'accepted');
  await assert.rejects(orders.acceptEditedOrder(order.id, [{ id: 'edit-a', qty: 1 }]), (error) => error.code === 'INVALID_STATUS_TRANSITION');
});

test('admin order list labels each snack line as fried or frozen', async () => {
  const order = await create();
  const listed = (await orders.getOrders()).find((row) => row.id === order.id);
  const categories = Object.fromEntries(listed.items.map((item) => [item.id, item.category]));
  assert.deepEqual(categories, { 'edit-a': 'fried', 'edit-b': 'frozen' });
});
