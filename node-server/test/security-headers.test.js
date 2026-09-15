const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.ADMIN_PASSWORD = 'test-only-admin-password';
process.env.SESSION_SECRET = 'test-only-secret-01234567890123456789';

// Replace the external database before any application import; never load .env.
const dbPath = require.resolve('../config/db');
const databaseError = new Error('private database host credentials SQL detail');
let failDatabase = false;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    if (failDatabase) throw databaseError;
    if (params?.[0] === 'shared-order') return { rows: [{ authorized: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
  connect: async () => { throw databaseError; },
} };
const inventory = require('../controllers/inventoryController');
const invoices = require('../routes/invoiceRoutes');

test('inventory database failures never disclose internal details', async () => {
  failDatabase = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const handler of [inventory.getInventory, inventory.updateInventory]) {
      let status, body;
      const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
      await handler({ body: { stock: 1 }, params: { id: 'test' } }, res);
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.doesNotMatch(JSON.stringify(body), /private|credentials|SQL|database host/);
      assert.ok(body.message);
    }
  } finally { console.error = originalError; failDatabase = false; }
});

test('every invoice response including authorization and database errors is private and unindexable', async () => {
  const app = express();
  app.use('/api/invoices', invoices);
  app.use((err, req, res, next) => res.status(500).json({ success: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/invoices`;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [path, status, broken] of [
      ['/missing', 404, false], ['/share/missing', 404, false],
      ['/batch-info', 401, false], ['/batch', 401, false],
      ['/share/missing?token=test', 404, false],
      ['/share/shared-order?token=test', 200, false],
      ['/missing?token=test', 500, true], ['/share/missing?token=test', 500, true],
    ]) {
      failDatabase = broken;
      const response = await fetch(base + path);
      assert.equal(response.status, status, path);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', path);
      assert.equal(response.headers.get('cache-control'), 'private, no-store', path);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer', path);
    }
  } finally {
    console.error = originalError;
    failDatabase = false;
    await new Promise(resolve => server.close(resolve));
  }
});
