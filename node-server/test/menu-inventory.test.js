const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const database = new PGlite();
// This process uses an in-memory PostgreSQL instance only. Never load .env or pg.
const query = async (sql, parameters) => {
  const result = await database.query(sql, parameters);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
};
require.cache[require.resolve("../config/db")] = { exports: { query, connect: async () => ({ query, release() {} }) } };
require.cache[require.resolve("dotenv")] = { exports: { config: () => ({}) } };
const inventory = require("../models/inventoryModel");
const menu = require("../models/menuModel");
const orders = require("../models/orderModel");
const migration = fs.readFileSync(path.join(__dirname, "../menu_offers.sql"), "utf8");

before(async () => {
  await database.exec(`
    CREATE TABLE categories(id text PRIMARY KEY);
    INSERT INTO categories VALUES ('fried'),('frozen'),('mains');
    CREATE TABLE menu_items(id text PRIMARY KEY, category_id text REFERENCES categories(id), name text,
      unit text, min_qty numeric, step_qty numeric, seasonal boolean, image text, default_price numeric);
    CREATE TABLE inventory(menu_item_id text PRIMARY KEY REFERENCES menu_items(id), selling_price numeric NOT NULL,
      stock numeric CHECK(stock >= 0), available boolean);
    CREATE TABLE customers(id serial PRIMARY KEY, name text, phone text, email text, address text, latitude numeric, longitude numeric);
    CREATE TABLE orders(id text PRIMARY KEY, customer_id integer REFERENCES customers(id), invoice_id text, status text,
      order_mode text, notes text, total numeric, created_at timestamptz DEFAULT now(), payment_status text, paymet text,
      archived boolean DEFAULT false, delivery_date date, delivery_slot text, stock_reserved boolean DEFAULT false,
      invoice_share_token text, synced_at timestamptz);
    CREATE TABLE order_items(id serial PRIMARY KEY, order_id text REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id text REFERENCES menu_items(id), quantity numeric, unit_price numeric, subtotal numeric);
    CREATE TABLE sales_summary(summary_date date PRIMARY KEY, orders_count integer, revenue numeric);
    INSERT INTO menu_items VALUES
      ('fried-beef','fried','Cutlet (Beef)','1 Piece',10,5,false,'fried.jpeg',20),
      ('frozen-beef','frozen','Cutlet (Beef)','1 Piece',10,5,false,'frozen.jpeg',15),
      ('fr-irachi-pathiri','fried','Irachi Pathiri','1 Piece',10,5,false,'irachi.jpeg',20),
      ('fz-kallumakaya-plain','frozen','Kallumakaya (w/o masala)','1 Piece',10,5,false,'plain.jpeg',15),
      ('legacy-main','mains','Chicken Curry','1 KG',1,0.5,false,'curry.jpeg',600);
    INSERT INTO inventory SELECT id,default_price,20.00,true FROM menu_items;
    INSERT INTO customers(name,phone) VALUES ('Old customer','919999999999');
    INSERT INTO orders(id,customer_id,invoice_id,status,payment_status,total,stock_reserved) VALUES ('old-order',1,'OLD-INVOICE','accepted','unpaid',350,true);
    INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price,subtotal)
      VALUES ('old-order','fried-beef',10,20,200), ('old-order','fz-kallumakaya-plain',10,15,150);
  `);
  await database.exec(`BEGIN; ${migration} COMMIT;`);
  await database.exec(fs.readFileSync(path.join(__dirname, "../security_hardening.sql"), "utf8"));
  await database.exec(fs.readFileSync(path.join(__dirname, "../items_management.sql"), "utf8"));
});
after(() => database.close());

test("migration preserves old invoices, retires plain kallumakaya and is re-runnable", async () => {
  const beforeRows = (await query("SELECT * FROM inventory ORDER BY menu_item_id")).rows;
  await database.exec(`BEGIN; ${migration} COMMIT;`);
  assert.deepEqual((await query("SELECT * FROM inventory ORDER BY menu_item_id")).rows, beforeRows);
  assert.equal((await query("SELECT COUNT(*)::int count FROM order_items WHERE order_id='old-order'")).rows[0].count, 2);
  const catalog = await menu.getMenu();
  assert.equal(catalog.some((item) => item.id === "fz-kallumakaya-plain"), false);
  assert.equal(catalog.filter((item) => item.isCombo).length, 3);
  assert.equal(Number(catalog.find((item) => item.id === "mc-chattipathiri-1-5kg").price), 475);
  assert.equal(catalog.find((item) => item.cat === "mains").stock, null);
});

test("shared stock changes both snack variants but leaves prices and photos independent", async () => {
  await inventory.updateInventory("frozen-beef", { stock: 11 });
  let values = await inventory.getInventory();
  for (const id of ["fried-beef", "frozen-beef"]) assert.equal(Number(values.find((row) => row.menu_item_id === id).stock), 11);
  await inventory.updateInventory("fried-beef", { price: 22 });
  values = await inventory.getInventory();
  assert.equal(Number(values.find((row) => row.menu_item_id === "fried-beef").selling_price), 22);
  assert.equal(Number(values.find((row) => row.menu_item_id === "frozen-beef").selling_price), 15);
  const catalog = await menu.getMenu();
  assert.equal(catalog.find((row) => row.id === "fried-beef").img, "fried.jpeg");
  assert.equal(catalog.find((row) => row.id === "frozen-beef").img, "frozen.jpeg");
  await inventory.updateInventory("mc-ghee-rice", { stock: 500 });
  assert.equal((await inventory.getInventory()).find((row) => row.menu_item_id === "mc-ghee-rice").stock, null);
});

test("Sunday mains-only delivery is blocked but either snack type permits a mixed order", () => {
  const customer = { deliveryDate: "2026-09-13" };
  const mains = [{ categoryId: "mains" }];
  assert.throws(() => orders.validateMainsTiming(mains, customer, "Delivery", "2026-09-12"), /Sunday/);
  for (const categoryId of ["fried", "frozen"]) orders.validateMainsTiming([...mains, { categoryId }], customer, "Delivery", "2026-09-12");
  orders.validateMainsTiming(mains, customer, "Pickup", "2026-09-12");
  assert.throws(() => orders.validateMainsTiming([...mains, { categoryId: "fried" }], customer, "Delivery", customer.deliveryDate), /advance/);
});

function customer() {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 2);
  return { name: "Test customer", phone: "919876543210", address: "Test address", deliveryDate: date.toISOString().slice(0, 10), deliverySlot: "12-13" };
}

test("orders above stock and at zero stock succeed without deducting inventory or restoring it on decline", async () => {
  await inventory.updateInventory("frozen-beef", { stock: 0, available: true });
  const order = await orders.createOrder({ customer: customer(), items: [{ id: "frozen-beef", qty: 40 }], orderMode: "Delivery" });
  assert.equal(Number(order.total), 600);
  assert.equal(order.stock_reserved, false);
  await orders.updateOrderStatus(order.id, "declined");
  await orders.updateOrderStatus(order.id, "pending");
  assert.equal(Number((await inventory.getInventory()).find((row) => row.menu_item_id === "frozen-beef").stock), 0);
  await assert.rejects(orders.createOrder({ customer: customer(), items: [{ id: "frozen-beef", qty: 1 }], orderMode: "Delivery" }), /ordered from 10/);
});

test("inventory HTTP endpoint protects writes and rejects fractional stock", async () => {
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-only-secret-at-least-thirty-two-characters";
  const app = require("../app");
  const { COOKIE_NAME, createSessionToken } = require("../middleware/adminAuth");
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const body = JSON.stringify({ stock: 1 });
  const headers = { "Content-Type": "application/json", Cookie: `${COOKIE_NAME}=${await createSessionToken()}` };
  try {
    assert.equal((await fetch(`${base}/inventory/frozen-beef`, { method: "PUT", headers: { "Content-Type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(`${base}/inventory/frozen-beef`, { method: "PUT", headers, body: JSON.stringify({ stock: 1.5 }) })).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
