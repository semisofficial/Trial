const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
process.env.NODE_ENV = 'production';
delete process.env.RENDER;
delete process.env.TRUST_PROXY_HOPS;
process.env.ADMIN_PASSWORD = 'security-test-password';
process.env.SESSION_SECRET = 'security-test-secret-at-least-thirty-two-characters';
process.env.ALLOWED_ORIGINS = '';
const app = require('../app');
const auth = require('../middleware/adminAuth');
let server, base;

before(async () => {
  await fixture.schema();
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fixture.close();
});
async function login() {
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const status = async cookie => (await fetch(`${base}/api/admin/session`, { headers: { cookie } })).status;

test('logout revokes a copied cookie while another admin remains signed in', async () => {
  const first = await login();
  const second = await login();
  assert.equal(await status(first), 200);
  assert.equal((await fetch(`${base}/api/admin/logout`, { method: 'POST', headers: { cookie: first } })).status, 200);
  assert.equal(await status(first), 401);
  assert.equal(await status(second), 200);
});

test('password and signing-secret changes each invalidate existing sessions', async () => {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  try {
    const first = await login();
    process.env.ADMIN_PASSWORD = 'rotated-security-test-password';
    assert.equal(await status(first), 401);
    const second = await login();
    process.env.SESSION_SECRET = 'rotated-security-test-secret-at-least-thirty-two-characters';
    assert.equal(await status(second), 401);
  } finally { process.env.ADMIN_PASSWORD = password; process.env.SESSION_SECRET = secret; }
});

test('stored sessions contain hashes, expire, and clean up on the next login', async () => {
  const cookie = await login();
  const rawToken = cookie.slice(cookie.indexOf('=') + 1);
  const rows = (await fixture.query('SELECT * FROM admin_sessions')).rows;
  assert.ok(rows.length > 0);
  assert.ok(!JSON.stringify(rows).includes(rawToken));
  await fixture.query("UPDATE admin_sessions SET expires_at=now()-interval '1 minute'");
  assert.equal(await status(cookie), 401);
  await login();
  assert.equal((await fixture.query('SELECT count(*)::int n FROM admin_sessions WHERE expires_at <= now()')).rows[0].n, 0);
});

test('authentication survives a module reload and caps stored active sessions', async () => {
  const cookie = await login();
  delete require.cache[require.resolve('../middleware/adminAuth')];
  assert.equal(await require('../middleware/adminAuth').validSession({ headers: { cookie } }), true);
  for (let i = 0; i < 102; i++) await auth.createSessionToken();
  assert.ok((await fixture.query('SELECT count(*)::int n FROM admin_sessions')).rows[0].n <= 100);
});

test('database failures fail closed with 503 and do not expose internal errors', async () => {
  const cookie = await login();
  fixture.setUnavailable(true);
  try {
    const response = await fetch(`${base}/api/admin/session`, { headers: { cookie } });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /Simulated|private database/);
  } finally { fixture.setUnavailable(false); }
});

test('anonymous requests do not perform session lookups; signed-in checks perform only one', async () => {
  fixture.queries.length = 0;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/menu`)).status, 200);
  assert.equal((await fetch(`${base}/api/orders`)).status, 401);
  assert.equal(fixture.queries.filter(q => q.includes('admin_sessions')).length, 0);
  const cookie = await login();
  fixture.queries.length = 0;
  const response = await fetch(`${base}/api/admin/session`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(fixture.queries.filter(q => q.includes('admin_sessions')).length, 1);
});

test('invalid sessions cannot bypass invoice tokens through an un-awaited Promise', async () => {
  const response = await fetch(`${base}/api/invoices/not-an-order`, {
    headers: { cookie: `${auth.COOKIE_NAME}=${'A'.repeat(43)}` },
  });
  assert.equal(response.status, 404);
  assert.equal(await status(`${auth.COOKIE_NAME}=%ZZ`), 401);
});

test('direct local hosting does not trust forged forwarding headers to evade login limits', async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const response = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${i + 1}` },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});
