const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
process.env.NODE_ENV = 'production';
process.env.ADMIN_PASSWORD = 'qr-test-password';
process.env.SESSION_SECRET = 'qr-test-secret-at-least-thirty-two-characters';
delete process.env.RENDER;
delete process.env.TRUST_PROXY_HOPS;
const app = require('../app');
let server, base, cookie;
before(async () => {
  await fixture.schema();
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(base + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close(); });
test('payment QR upload and management endpoints are removed even for signed-in staff', async () => {
  for (const auth of [{}, { cookie }]) {
    for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
      const response = await fetch(base + '/payment-qr', { method, headers: auth });
      assert.equal(response.status, 404);
    }
  }
});
test('fixed QR image is served without using historical database overrides', async () => {
  await fixture.database.exec(fs.readFileSync(path.join(__dirname, '../payment_qr.sql'), 'utf8'));
  await fixture.query("UPDATE payment_qr SET image=$1, version=gen_random_uuid()::text, updated_at=now() WHERE id=1", [Buffer.from('untrusted old override')]);
  fixture.setUnavailable(true);
  try {
    const image = await fetch(base + '/payment-qr/image');
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/jpeg/);
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), fs.readFileSync(path.join(__dirname, '../assets/payment-qr-2026-09-23.jpeg')));
  } finally { fixture.setUnavailable(false); }
});
