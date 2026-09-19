// Intercept all APIs; never load a live backend, database, or payment service.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5184';
const jpeg = await readFile(new URL('../../node-server/assets/upi-qr.jpeg', import.meta.url));
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let version = 'default', puts = 0, failSave = false, ready = true;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/upi-qr.jpeg') return route.fulfill({ contentType: 'image/jpeg', body: jpeg });
    if (url.pathname === '/api/payment-qr') {
      if (route.request().method() === 'PUT') {
        puts++;
        assert.equal(route.request().headers()['if-match'], `"${version}"`);
        assert.deepEqual(route.request().postDataBuffer(), jpeg);
        if (failSave) return route.fulfill({ status: 503, json: { message: 'Payment QR is temporarily unavailable. Please try again.' } });
        version = 'new-qr-version';
      }
      return route.fulfill({ json: { success: true, data: { ready, version, updatedAt: null, maxUploadBytes: 1048576 } } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, data: [] } });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/nashi`);
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  const card = page.getByRole('region', { name: 'Payment QR' });
  await card.waitFor({ timeout: 5000 });
  const input = card.getByLabel('Upload / Replace image');
  const file = { name: 'payment.jpeg', mimeType: 'image/jpeg', buffer: jpeg };
  await input.setInputFiles(file);
  await card.getByRole('img', { name: 'New payment QR preview' }).waitFor();
  assert.equal(await card.getByRole('button', { name: 'Save QR' }).isDisabled(), true);
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(puts, 0, 'Preview and cancel must not publish');
  await input.setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await card.getByRole('alert').filter({ hasText: /PNG or JPEG/ }).waitFor();
  await input.setInputFiles({ name: 'large.jpeg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1048577) });
  await card.getByRole('alert').filter({ hasText: /1 MB/ }).waitFor();
  await input.setInputFiles(file);
  await card.getByRole('checkbox').check();
  failSave = true;
  await card.getByRole('button', { name: 'Save QR' }).click();
  await card.getByRole('alert').filter({ hasText: /temporarily unavailable/ }).waitFor();
  assert.equal(version, 'default');
  assert.equal(await card.getByRole('img', { name: 'New payment QR preview' }).count(), 1);
  failSave = false;
  await card.getByRole('button', { name: 'Save QR' }).click();
  await card.getByRole('status').filter({ hasText: /saved/i }).waitFor();
  assert.equal(puts, 2);
  assert.match(await card.getByRole('img', { name: 'Current payment QR' }).getAttribute('src'), /new-qr-version/);
  assert.equal(await card.getByRole('img', { name: 'New payment QR preview' }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('img[alt="Current payment QR"]')?.src.includes('new-qr-version'));
  const box = await card.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  ready = false;
  await page.reload();
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await card.getByText(/database setup/i).waitFor();
  assert.equal(await input.isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile Sales QR preview, validation, cancel, confirm/save, failed-save retry, reload and migration guidance.');
} finally { await browser.close(); }
