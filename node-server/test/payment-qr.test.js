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
const original = fs.readFileSync(path.join(__dirname, '../assets/upi-qr.jpeg'));
const request = (suffix = '', options = {}) => fetch(`${base}/api/payment-qr${suffix}`, options);
const upload = (body, version = 'default', type = 'image/jpeg', extra = {}) => request('', {
  method: 'PUT', headers: { cookie, 'Content-Type': type, 'If-Match': `"${version}"`, ...extra }, body,
});

before(async () => {
  await fixture.schema();
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fixture.close();
});

test('old QR stays public before migration; admin sees setup requirement and cannot save', async () => {
  const image = await request('/image');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), original);
  const metadata = await request('', { headers: { cookie } });
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).data.ready, false);
  assert.equal((await upload(original)).status, 503);
});

test('anonymous uploads and metadata reads fail closed', async () => {
  assert.equal((await request()).status, 401);
  assert.equal((await request('', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: original })).status, 401);
});

test('migration is additive and rerunnable; saved QR persists as a single replaceable image', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '../payment_qr.sql'), 'utf8');
  await fixture.database.exec(migration);
  const saved = await upload(original);
  assert.equal(saved.status, 200);
  const first = (await saved.json()).data;
  assert.equal(first.ready, true);
  assert.notEqual(first.version, 'default');
  await fixture.database.exec(migration);
  const metadata = (await (await request('', { headers: { cookie } })).json()).data;
  assert.equal(metadata.version, first.version);
  const image = await request('/image');
  assert.equal(image.status, 200);
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.ok(bytes.length > 1000 && bytes.length <= 524288);
  assert.match(image.headers.get('cache-control'), /must-revalidate/);
  assert.match(image.headers.get('x-robots-tag'), /noindex/);
  // Node fetch otherwise adds Cache-Control: no-cache to conditional requests,
  // which explicitly asks Express for a fresh body rather than a 304.
  const cached = await request('/image', { headers: { 'If-None-Match': image.headers.get('etag'), 'Cache-Control': 'max-age=0' } });
  assert.equal(cached.status, 304);
  const stale = await upload(original);
  assert.equal(stale.status, 409, 'A second admin must not unknowingly overwrite a newer QR');
  assert.equal((await upload(original, first.version)).status, 200);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM payment_qr')).rows[0].n, 1);
  assert.equal((await fixture.query('SELECT count(*)::int n FROM menu_items')).rows[0].n > 0, true);
});

test('invalid, oversized and foreign-origin uploads never replace the current QR', async () => {
  const current = (await (await request('', { headers: { cookie } })).json()).data;
  for (const [body, type, status] of [
    [Buffer.from('<svg onload="alert(1)"></svg>'), 'image/jpeg', 400],
    [original.subarray(0, 100), 'image/jpeg', 400],
    [original, 'image/svg+xml', 415],
    [Buffer.alloc(1024 * 1024 + 1), 'image/jpeg', 413],
  ]) assert.equal((await upload(body, current.version, type)).status, status);
  assert.equal((await upload(original, current.version, 'image/jpeg', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await (await request('', { headers: { cookie } })).json()).data.version, current.version);
});

test('database outage does not silently revert customers to a potentially obsolete payment account', async () => {
  fixture.setUnavailable(true);
  try {
    const response = await request('/image');
    assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await response.text(), /Simulated|private database/);
  } finally { fixture.setUnavailable(false); }
});

test('PNG uploads are decoded to a bounded JPEG and persist after a model reload', async () => {
  const sharp = require('sharp');
  const png = await sharp(original).png().toBuffer();
  const current = (await (await request('', { headers: { cookie } })).json()).data;
  const saved = await upload(png, current.version, 'image/png');
  assert.equal(saved.status, 200);
  const version = (await saved.json()).data.version;
  delete require.cache[require.resolve('../models/paymentQrModel')];
  const reloaded = require('../models/paymentQrModel');
  const meta = await reloaded.metadata();
  assert.equal(meta.version, version);
  const image = await reloaded.image(meta);
  const decoded = await sharp(image.bytes).metadata();
  const dimensions = await sharp(original).metadata();
  assert.equal(decoded.format, 'jpeg');
  assert.equal(decoded.width, dimensions.width, 'QR must not be cropped or rescaled');
  assert.equal(decoded.height, dimensions.height);
  assert.equal(decoded.exif, undefined);
  assert.equal(decoded.icc, undefined);
  assert.ok(image.bytes.length <= 524288);
  fixture.queries.length = 0;
  await request('/image');
  fixture.queries.length = 0;
  await request('/image');
  assert.equal(fixture.queries.length, 1, 'Repeat views only transfer a tiny revision row from Neon');
  assert.doesNotMatch(fixture.queries[0], /SELECT image/);
});

test('huge dimensions, missing revision and mismatched formats leave the stored image intact', async () => {
  const sharp = require('sharp');
  const current = (await (await request('', { headers: { cookie } })).json()).data;
  const huge = await sharp({ create: { width: 2049, height: 128, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await upload(huge, current.version, 'image/png')).status, 400);
  assert.equal((await upload(original, current.version, 'image/png')).status, 400);
  assert.equal((await request('', { method: 'PUT', headers: { cookie, 'Content-Type': 'image/jpeg' }, body: original })).status, 400);
  assert.equal((await (await request('', { headers: { cookie } })).json()).data.version, current.version);
  await assert.rejects(fixture.query('UPDATE payment_qr SET image = $1 WHERE id = 1', [Buffer.alloc(524289)]), /check constraint/);
});

test('concurrent image conversions are bounded to one job on the small backend instance', async () => {
  const sharp = require('sharp');
  const large = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: 'white' } }).png().toBuffer();
  const current = (await (await request('', { headers: { cookie } })).json()).data;
  const responses = await Promise.all([upload(large, current.version, 'image/png'), upload(large, current.version, 'image/png')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
  const busy = responses.find(response => response.status === 429);
  assert.match((await busy.json()).message, /being processed/);
});
