const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
const menu = require('../models/menuModel');
const inventory = require('../models/inventoryModel');
const orders = require('../models/orderModel');
before(async () => {
  await fixture.schema();
  await fixture.query("INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty) VALUES ('pause-test','fried','Pause test','1 piece',1,1)");
  await fixture.query("INSERT INTO inventory(menu_item_id,selling_price,stock,available) VALUES ('pause-test',25,8,true)");
});
after(() => fixture.close());
test('paused items are private, cannot be newly ordered, and return unchanged when resumed', async () => {
  await inventory.updateInventory('pause-test', { available: false });
  assert.equal((await menu.getMenu()).some(i => i.id === 'pause-test'), false);
  assert.equal((await inventory.getInventory()).some(i => i.menu_item_id === 'pause-test'), false);
  const hidden = (await menu.getMenu(true)).find(i => i.id === 'pause-test');
  assert.equal(hidden.available, false);
  assert.equal(Number(hidden.price), 25);
  assert.equal(Number(hidden.stock), 8);
  const date = new Date(); date.setDate(date.getDate() + 2);
  await assert.rejects(orders.createOrder({ customer: { name: 'Test', phone: '9999999999', address: 'Test', deliveryDate: date.toISOString().slice(0,10), deliverySlot: '12-13' }, items: [{ id: 'pause-test', qty: 1 }], orderMode: 'Pickup' }), /available|paused/);
  await inventory.updateInventory('pause-test', { available: true });
  const visible = (await menu.getMenu()).find(i => i.id === 'pause-test');
  assert.equal(visible.name, 'Pause test');
  assert.equal(Number(visible.price), 25);
  assert.equal(Number(visible.stock), 8);
});
