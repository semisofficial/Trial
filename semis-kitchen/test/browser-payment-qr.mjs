// All APIs intercepted: no live database, sessions or payment changes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5185';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const qrRequests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/api/payment-qr')) {
      qrRequests.push({ path: url.pathname, method: route.request().method() });
      if (url.pathname === '/api/payment-qr/image') return route.fulfill({ contentType: 'image/jpeg', body: await readFile(new URL('../../node-server/assets/payment-qr-2026-09-23.jpeg', import.meta.url)) });
    }
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
  const preview = page.getByRole('img', { name: 'Current payment QR' });
  await preview.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('img[alt="Current payment QR"]')?.naturalWidth > 0);
  assert.deepEqual(qrRequests, [{ path: '/api/payment-qr/image', method: 'GET' }]);
  const box = await preview.boundingBox();
  assert.ok(box.width <= 300 && box.x >= 0 && box.x + box.width <= 390);
  assert.deepEqual(errors, []);
  console.log('PASS: Sales displays a read-only QR preview without upload or management requests.');
} finally { await browser.close(); }
