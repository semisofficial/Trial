const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { PDFDocument, PDFPage } = require('pdf-lib');
const { generateInvoicePDF } = require('../utils/invoiceGenerator');
const migration = fs.readFileSync(path.join(__dirname, '../menu_offers.sql'), 'utf8');

test('long combo descriptions stay inside their column and paginate without losing text', async () => {
  const name = 'Broasted full chicken + Hummus 250 g + Kuboos 11 pieces';
  const drawn = [];
  const original = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function (text, options) {
    drawn.push({ text, ...options });
    return original.call(this, text, options);
  };
  try {
    const bytes = await generateInvoicePDF({ name: 'Test customer', phone: '0000000000', invoice_id: 'TEST',
      order_id: 'TEST', created_at: '2026-09-09T06:30:00Z', total: 5950, payment_method: 'upi',
      items: Array.from({ length: 7 }, () => ({ name, quantity: 1, unit_price: 850, subtotal: 850 })) });
    const descriptions = drawn.filter((entry) => entry.x === 116.8);
    for (const entry of descriptions) {
      assert.ok(entry.x + entry.font.widthOfTextAtSize(entry.text, entry.size) <= 302,
        `Description overlaps price column: ${entry.text}`);
    }
    assert.equal(descriptions.map((entry) => entry.text).join(' '), Array(7).fill(name).join(' '));
    assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  } finally { PDFPage.prototype.drawText = original; }
});

test('new and previously bootstrapped databases reject invalid stock and duplicate invoice identifiers', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    await assert.rejects(db.query("UPDATE inventory SET stock=-1 WHERE menu_item_id='fz-irachi-pathiri'"), /check constraint/);
    await assert.rejects(db.query("UPDATE inventory SET selling_price=-1 WHERE menu_item_id='fz-irachi-pathiri'"), /check constraint/);
    await db.exec("INSERT INTO customers(name,phone) VALUES ('Test','0000000000')");
    const insert = "INSERT INTO orders(id,customer_id,invoice_id,order_mode,total,invoice_share_token) VALUES ($1,1,'INV','Pickup',10,$2)";
    await db.query(insert, ['A', 'tokenA']);
    await assert.rejects(db.query(insert, ['B', 'tokenB']), /unique constraint/);
    await assert.rejects(db.query("INSERT INTO orders(id,customer_id,invoice_id,order_mode,total,invoice_share_token) VALUES ('C',1,'INV2','Pickup',10,'tokenA')"), /unique constraint/);
    const indexes = (await db.query("SELECT indexname FROM pg_indexes WHERE tablename='orders'")).rows.map((r) => r.indexname);
    assert.ok(indexes.includes('idx_orders_created_at'));
    assert.ok(indexes.includes('idx_orders_customer_id'));
  } finally { await db.close(); }
});

test('rerunning migration links later imports without resetting an established manual count', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    await db.exec("UPDATE inventory SET stock=11 WHERE menu_item_id='fz-irachi-pathiri'; INSERT INTO menu_items(id,category_id,name,default_price) VALUES ('fr-irachi-pathiri','fried','Irachi Pathiri',20); INSERT INTO inventory VALUES ('fr-irachi-pathiri',20,99,true)");
    await db.exec(migration);
    const group = (await db.query("SELECT stock_group_id FROM menu_items WHERE id='fr-irachi-pathiri'")).rows[0].stock_group_id;
    assert.equal(group, 'fz-irachi-pathiri');
    assert.equal(Number((await db.query('SELECT stock FROM inventory WHERE menu_item_id=$1', [group])).rows[0].stock), 11);
    await db.exec(migration);
    assert.equal(Number((await db.query('SELECT stock FROM inventory WHERE menu_item_id=$1', [group])).rows[0].stock), 11);
  } finally { await db.close(); }
});

test('sheet sync sends untrusted customer text literally while keeping totals numeric', async () => {
  const modulePath = require.resolve('@googleapis/sheets');
  const original = require.cache[modulePath];
  let appended;
  require.cache[modulePath] = { exports: { sheets: () => ({ spreadsheets: { values: {
    get: async () => ({ data: { values: [] } }),
    append: async (request) => { appended = request; },
  } } }) } };
  const syncPath = require.resolve('../utils/googleSheetsSync');
  delete require.cache[syncPath];
  try {
    const { pushOrderRowsToSheet } = require(syncPath);
    await pushOrderRowsToSheet([{ invoice_id: 'INV', order_id: 'A', created_at: '2026-09-09T00:00:00Z',
      name: '=1+1', phone: '+919876543210', total: '850.00', payment_method: 'upi' }]);
    assert.equal(appended.valueInputOption, 'RAW');
    assert.equal(appended.requestBody.values[0][3], '=1+1');
    assert.equal(appended.requestBody.values[0][4], '+919876543210');
    assert.equal(appended.requestBody.values[0][5], 850);
  } finally {
    delete require.cache[syncPath];
    if (original) require.cache[modulePath] = original; else delete require.cache[modulePath];
  }
});

test('test-menu recovery restores original images without overwriting existing prices or shared counts', async () => {
  const { recoverTestMenu } = require('../restore-test-menu');
  const db = new PGlite();
  try {
    await db.exec(migration);
    await db.exec("UPDATE inventory SET selling_price=17, stock=11 WHERE menu_item_id='fz-irachi-pathiri'");
    await recoverTestMenu(db, migration);
    assert.equal(Number((await db.query("SELECT COUNT(*) count FROM menu_items WHERE image<>'' AND NOT retired")).rows[0].count), 58);
    const original = (await db.query("SELECT image FROM menu_items WHERE id='fr-cutlet-beef'")).rows[0];
    assert.equal(original.image, 'images/fr-cutlet-beef.png');
    const before = (await db.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows;
    await recoverTestMenu(db, migration);
    assert.deepEqual((await db.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows, before);
    const preserved = (await db.query("SELECT selling_price,stock FROM inventory WHERE menu_item_id='fz-irachi-pathiri'")).rows[0];
    assert.equal(Number(preserved.selling_price), 17);
    assert.equal(Number(preserved.stock), 11);
    await db.exec("INSERT INTO customers(name,phone) VALUES ('Someone','0000000000')");
    await assert.rejects(recoverTestMenu(db, migration), /customer or order data/);
  } finally { await db.close(); }
});

test('test-menu recovery requires an explicit test target confirmation and refuses production', () => {
  const { assertTestTarget } = require('../restore-test-menu');
  assert.throws(() => assertTestTarget('db.example/neondb', '', 'development'), /confirm/);
  assert.throws(() => assertTestTarget('db.example/neondb', 'different/neondb', 'development'), /confirm/);
  assert.throws(() => assertTestTarget('db.example/neondb', 'db.example/neondb', 'production'), /production/);
  assert.throws(() => assertTestTarget('db.example/neondb', 'db.example/neondb', 'development', 'production'), /production/);
  assert.doesNotThrow(() => assertTestTarget('db.example/neondb', 'db.example/neondb', 'development'));
});

test('test recovery confirmation identifies the actual Postgres target including port and rejects overrides', () => {
  const { testConnectionTarget } = require('../restore-test-menu');
  const { parse } = require('pg-connection-string');
  assert.throws(() => testConnectionTarget('postgresql://user:pass@test.example/test?host=live.example'), /parameter/);
  assert.throws(() => testConnectionTarget('postgresql://user:pass@test.example/test?dbname=live'), /parameter/);
  assert.throws(() => testConnectionTarget('postgresql://user:pass@test.example/test?options=-csearch_path=live'), /parameter/);
  for (const [url, target] of [
    ['postgresql://user:pass@test.example/test?sslmode=verify-full', 'test.example:5432/test'],
    ['postgresql://user:pass@localhost:5433/test', 'localhost:5433/test'],
    ['postgresql://user:pass@test.example/test%2Fother', 'test.example:5432/test%2Fother'],
  ]) {
    const result = testConnectionTarget(url);
    assert.equal(result.target, target);
    const effective = parse(result.connectionString);
    assert.equal(`${effective.host}:${effective.port}/${effective.database}`, target);
  }
});
