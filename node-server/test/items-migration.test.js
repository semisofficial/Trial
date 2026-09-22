const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Items migration backfills legacy orders, supports old inserts, and preserves named categories and inventory', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE categories(id text PRIMARY KEY, name text NOT NULL); INSERT INTO categories VALUES ('fried','Client label')");
    await db.exec(sql('menu_offers.sql'));
    await db.exec(`INSERT INTO menu_items(id,category_id,name,default_price) VALUES ('legacy','fried','Original snack',17);
      INSERT INTO inventory(menu_item_id,selling_price,stock) VALUES ('legacy',19,23);
      INSERT INTO customers(name,phone) VALUES ('Test','919999999999');
      INSERT INTO orders(id,customer_id,invoice_id,order_mode,total) VALUES ('old',1,'OLD','Pickup',19);
      INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price,subtotal) VALUES ('old','legacy',1,19,19);`);
    await db.exec(sql('items_management.sql'));
    await db.exec("UPDATE menu_items SET name='Renamed' WHERE id='legacy'");
    await db.exec(sql('items_management.sql'));
    assert.equal((await db.query("SELECT item_name_snapshot FROM order_items WHERE order_id='old'")).rows[0].item_name_snapshot, 'Original snack');
    await db.exec("INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price,subtotal) VALUES ('old','legacy',1,19,19)");
    assert.deepEqual((await db.query("SELECT item_name_snapshot FROM order_items ORDER BY id")).rows.map(r => r.item_name_snapshot), ['Original snack', 'Renamed']);
    const item = (await db.query("SELECT m.is_draft,m.default_price,i.stock,i.selling_price,c.name FROM menu_items m JOIN inventory i ON i.menu_item_id=m.id JOIN categories c ON c.id=m.category_id WHERE m.id='legacy'")).rows[0];
    assert.equal(item.is_draft, false);
    assert.equal(Number(item.default_price), 17);
    assert.equal(Number(item.selling_price), 19);
    assert.equal(Number(item.stock), 23);
    assert.equal(item.name, 'Client label');
  } finally { await db.close(); }
});
