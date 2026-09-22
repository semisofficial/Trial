// All APIs intercepted: no live database, sessions or payment changes.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5185';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const qrRequests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/api/payment-qr')) qrRequests.push(url.pathname);
    if (url.pathname === '/api/admin/session') return route.fulfill({ json: { success: true, data: { authenticated: true } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, data: [] } });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/nashi`);
  await page.getByRole('button', { name: 'Open admin navigation' }).click();
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.getByRole('heading', { name: /Items sold/ }).waitFor();
  assert.equal(await page.locator('input[type=file]').count(), 0);
  assert.equal(await page.getByText('Payment QR', { exact: true }).count(), 0);
  assert.deepEqual(qrRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS: Sales has no payment QR upload or management requests.');
} finally { await browser.close(); }
