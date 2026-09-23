// Exercise the actual Vite rewrite and Express API with in-memory PostgreSQL.
// Never starts server.js, loads .env, or connects to the production database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import viteConfig from '../vite.config.js';
const require = createRequire(import.meta.url);
const { testDatabase } = require('../../node-server/test-support/database');
const fixture = testDatabase();
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'qr-routing-test-password';
process.env.SESSION_SECRET = 'qr-routing-test-secret-at-least-thirty-two-characters';
delete process.env.RENDER;
delete process.env.TRUST_PROXY_HOPS;
const app = require('../../node-server/app');
let api, vite;
try {
  await fixture.schema();
  const migration = await readFile(new URL('../../node-server/payment_qr.sql', import.meta.url), 'utf8');
  await fixture.database.exec(migration);
  api = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const target = `http://127.0.0.1:${api.address().port}`;
  vite = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0,
      proxy: Object.fromEntries(Object.entries(viteConfig.server.proxy).map(([key, options]) => [key, { ...options, target }])) },
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const fallback = await fetch(`${base}/upi-qr.jpeg`, { signal: AbortSignal.timeout(10000) });
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('content-type'), /image\/jpeg/);
  const expected = await readFile(new URL('../../node-server/assets/payment-qr-2026-09-23.jpeg', import.meta.url));
  assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), expected);
  const signedIn = await fetch(`${base}/api/admin/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get('set-cookie').split(';')[0];
  const saved = await fetch(`${base}/api/payment-qr`, { method: 'PUT',
    headers: { cookie, 'Content-Type': 'image/jpeg', 'If-Match': '"default"' }, body: Buffer.from('upload-disabled') });
  assert.equal(saved.status, 404);
  const live = await fetch(`${base}/upi-qr.jpeg?v=old-cached-version`);
  assert.equal(live.status, 200);
  assert.deepEqual(Buffer.from(await live.arrayBuffer()), expected);
  assert.equal(live.headers.get('cache-control'), 'no-store');
  const current = await fetch(`${base}/api/payment-qr/image?v=2026-09-23`);
  assert.equal(current.status, 200);
  assert.deepEqual(Buffer.from(await current.arrayBuffer()), expected);
  console.log('PASS: legacy and current QR URLs serve the exact fixed image; uploads are rejected.');
} finally {
  await vite?.close();
  if (api) { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
  await fixture.close();
}
