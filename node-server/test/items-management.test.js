const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
process.env.ADMIN_PASSWORD = 'items-test-password';
process.env.SESSION_SECRET = 'items-test-secret-at-least-thirty-two-characters';
process.env.NODE_ENV = 'production';
delete process.env.RENDER;
delete process.env.TRUST_PROXY_HOPS;
const app = require('../app');
const orders = require('../models/orderModel');
let server, base, cookie, created;
const details = { name: 'New test snack', cat: 'fried', unit: '1 Piece', minQty: 10, step: 1, isCombo: false };
async function call(url, method = 'GET', body, revision, authenticated = true) {
  return fetch(base + url, { method, headers: {
    ...(authenticated ? { cookie } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(revision ? { 'If-Match': `"${revision}"` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const data = async response => { assert.ok(response.ok, await response.clone().text()); return (await response.json()).data; };
function orderInput(id, qty = 10) {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2);
  return { customer: { name: 'Items test customer', phone: '919999999999', address: 'Test only',
    deliveryDate: day.toISOString().slice(0, 10), deliverySlot: '12-13' }, orderMode: 'Pickup',
    items: [{ id, qty }], idempotencyKey: randomUUID() };
}
before(async () => {
  await fixture.schema();
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await call('/admin/login', 'POST', { password: process.env.ADMIN_PASSWORD }, null, false);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close(); });

test('Items and private Inventory/menu endpoints require admin; metadata never includes financial fields', async () => {
  for (const route of ['/items', '/menu/admin', '/inventory/admin']) {
    assert.equal((await call(route, 'GET', null, null, false)).status, 401);
  }
  assert.equal((await call('/items', 'POST', details, null, false)).status, 401);
  const rows = await data(await call('/items'));
  assert.ok(rows.length > 0);
  for (const row of rows) for (const key of ['price', 'stock', 'selling_price', 'default_price']) assert.equal(key in row, false);
});

test('new items are drafts until priced and explicitly enabled in Inventory', async () => {
  created = await data(await call('/items', 'POST', details));
  assert.equal(created.isDraft, true);
  for (const route of ['/menu', '/inventory']) {
    const rows = await data(await call(route, 'GET', null, null, false));
    assert.equal(rows.some(row => (row.id || row.menu_item_id) === created.id), false);
  }
  assert.equal((await data(await call('/menu/admin'))).some(row => row.id === created.id), true);
  assert.equal((await data(await call('/inventory/admin'))).some(row => row.menu_item_id === created.id), true);
  await assert.rejects(orders.createOrder(orderInput(created.id)), /no longer exist|not available/);
  assert.equal((await call(`/inventory/${created.id}`, 'PUT', { available: true })).status, 400);
  await data(await call(`/inventory/${created.id}`, 'PUT', { price: 20 }));
  assert.equal((await data(await call('/menu'))).some(row => row.id === created.id), false);
  await data(await call(`/inventory/${created.id}`, 'PUT', { available: true }));
  assert.equal((await data(await call('/menu'))).some(row => row.id === created.id), true);
  created = (await data(await call('/items'))).find(row => row.id === created.id);
});

test('renames preserve original names in order lists, replay, PDF query and Sheets query', async () => {
  const request = orderInput(created.id);
  const placed = await orders.createOrder(request);
  const revision = created.revision;
  created = await data(await call(`/items/${created.id}`, 'PUT', { ...details, name: 'Renamed snack' }, revision));
  assert.equal(created.name, 'Renamed snack');
  assert.equal((await call(`/items/${created.id}`, 'PUT', details, revision)).status, 409);
  assert.equal((await orders.createOrder(request)).items[0].name, 'New test snack');
  assert.equal((await orders.getOrders()).find(row => row.id === placed.id).items[0].name, 'New test snack');
  const queries = require('../utils/invoiceQueries');
  assert.equal((await fixture.query(queries.SINGLE_ORDER_QUERY, [placed.id, null])).rows[0].item_name, 'New test snack');
  await fixture.query("UPDATE orders SET status='accepted' WHERE id=$1", [placed.id]);
  assert.equal((await fixture.query(queries.ACCEPTED_ORDERS_QUERY, [100, 0])).rows.find(row => row.order_id === placed.id).item_name, 'New test snack');
  await fixture.query("UPDATE orders SET status='completed' WHERE id=$1", [placed.id]);
  assert.equal((await fixture.query(queries.COMPLETED_ORDERS_QUERY)).rows.find(row => row.order_id === placed.id).item_name, 'New test snack');
});

test('metadata rejects price, stock, HTML-like image paths, invalid categories and quantities', async () => {
  for (const body of [{ ...details, price: 1 }, { ...details, stock: 10 }, { ...details, img: 'https://bad.example/file' },
    { ...details, name: ' ' }, { ...details, cat: 'other' }, { ...details, step: 0 }, { ...details, minQty: -1 },
    { ...details, isCombo: true }, { ...details, unit: '' }]) {
    assert.equal((await call('/items', 'POST', body)).status, 400);
  }
  const response = await fetch(base + '/items', { method: 'POST', headers: { cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(details) });
  assert.equal(response.status, 403);
});

test('photo upload is protected, bounded, versioned and survives model reload without image history', async () => {
  const photo = await require('sharp')({ create: { width: 200, height: 200, channels: 3, background: '#228844' } }).jpeg().toBuffer();
  const upload = (body, type, revision, withCookie = true) => fetch(`${base}/items/${created.id}/photo`, {
    method: 'PUT', headers: { ...(withCookie ? { cookie } : {}), 'Content-Type': type, 'If-Match': `"${revision}"` }, body });
  assert.equal((await upload(photo, 'image/jpeg', created.revision, false)).status, 401);
  assert.equal((await upload(Buffer.from('<svg/>'), 'image/png', created.revision)).status, 400);
  assert.equal((await upload(Buffer.alloc(3 * 1024 * 1024 + 1), 'image/jpeg', created.revision)).status, 413);
  const previous = created.revision;
  created = await data(await upload(photo, 'image/jpeg', previous));
  assert.match(created.img, /^\/api\/items\/[^/]+\/photo\?v=/);
  const image = await fetch(base.replace(/\/api$/, '') + created.img);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.ok(bytes.length > 100 && bytes.length <= 160 * 1024);
  const info = await require('sharp')(bytes).metadata();
  assert.ok(info.width <= 960 && info.height <= 960);
  assert.equal(info.exif, undefined);
  assert.equal((await upload(photo, 'image/jpeg', previous)).status, 409);
  const oldUrl = created.img;
  created = await data(await upload(photo, 'image/jpeg', created.revision));
  assert.equal((await fetch(base.replace(/\/api$/, '') + oldUrl, { redirect: 'manual' })).status, 307);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM item_photos WHERE menu_item_id=$1', [created.id])).rows[0].n, 1);
  delete require.cache[require.resolve('../models/itemsModel')];
  const reloaded = require('../models/itemsModel');
  assert.equal((await reloaded.list()).find(row => row.id === created.id).img, created.img);
});

test('retirement preserves orders and shared-stock siblings while removing uploaded bytes', async () => {
  await fixture.query("INSERT INTO menu_items(id,category_id,name,stock_group_id) VALUES ('test-sibling','frozen','Sibling',$1)", [created.id]);
  await fixture.query("INSERT INTO inventory(menu_item_id,selling_price,stock) VALUES ('test-sibling',15,0)");
  await fixture.query('UPDATE menu_items SET stock_group_id=id WHERE id=$1', [created.id]);
  assert.equal((await call(`/items/${created.id}`, 'PUT', { ...details, cat: 'mains' }, created.revision)).status, 400);
  assert.equal((await call(`/items/${created.id}`, 'DELETE', null, created.revision)).status, 200);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM order_items WHERE menu_item_id=$1', [created.id])).rows[0].n, 1);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM item_photos WHERE menu_item_id=$1', [created.id])).rows[0].n, 0);
  assert.equal((await call(`/items/${created.id}/photo`, 'GET', null, null, false)).status, 404);
  await data(await call('/inventory/test-sibling', 'PUT', { stock: 7 }));
  assert.equal(Number((await fixture.query('SELECT stock FROM inventory WHERE menu_item_id=$1', [created.id])).rows[0].stock), 7);
  await assert.rejects(orders.createOrder(orderInput(created.id)), /no longer exist|not available/);
});

test('migration backfills old line names and reruns preserve saved names and draft status', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../items_management.sql'), 'utf8');
  await fixture.database.exec(sql);
  assert.equal((await fixture.query('SELECT item_name_snapshot FROM order_items WHERE menu_item_id=$1', [created.id])).rows[0].item_name_snapshot, 'New test snack');
  const draft = await data(await call('/items', 'POST', details));
  await fixture.database.exec(sql);
  assert.equal((await data(await call('/items'))).find(row => row.id === draft.id).isDraft, true);
});

test('draft photos stay private and public photo conditional requests use version ETags', async () => {
  let draft = await data(await call('/items', 'POST', details));
  const photo = await require('sharp')({ create: { width: 20, height: 20, channels: 3, background: '#228844' } }).png().toBuffer();
  draft = await data(await fetch(`${base}/items/${draft.id}/photo`, {
    method: 'PUT', headers: { cookie, 'Content-Type': 'image/png', 'If-Match': `"${draft.revision}"` }, body: photo,
  }));
  const url = base.replace(/\/api$/, '') + draft.img;
  assert.equal((await fetch(url)).status, 404);
  const privatePhoto = await fetch(url, { headers: { cookie } });
  assert.equal(privatePhoto.status, 200);
  assert.match(privatePhoto.headers.get('cache-control'), /private, no-store/);
  await data(await call(`/inventory/${draft.id}`, 'PUT', { price: 10, available: true }));
  const publicPhoto = await fetch(url);
  assert.equal(publicPhoto.status, 200);
  // Node fetch otherwise adds Cache-Control: no-cache to conditional requests.
  assert.equal((await fetch(url, { headers: { 'If-None-Match': publicPhoto.headers.get('etag'), 'Cache-Control': 'max-age=0' } })).status, 304);
});
