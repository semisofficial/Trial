import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5185';
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const item = { id: 'pause-test', name: 'Pause test snack', cat: 'fried', unit: '1 piece', minQty: 1, step: 1, price: 25, available: true, img: 'fr-samoosa.png' };
  await context.addInitScript(value => localStorage.setItem('semis_menu_cache_v2', JSON.stringify([value])), item);
  let paused = true, fail = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  await context.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname !== '/api/menu') throw new Error('Unexpected API call');
    await gate;
    if (fail) return route.fulfill({ status: 503, json: { success: false } });
    // Also defend against an older API returning available:false instead of filtering.
    await route.fulfill({ json: { success: true, data: [{ ...item, available: !paused }] } });
  });
  await context.route(/https?:\/\/(?!127\.0\.0\.1|localhost).*/, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  assert.equal(await page.getByText(item.name, { exact: true }).count(), 0, 'Cached dish must not flash before availability arrives');
  release();
  await page.waitForResponse(r => r.url().endsWith('/api/menu'));
  await page.getByText('No items are available for ordering right now.').waitFor({ timeout: 3000 });
  assert.equal(await page.getByText(item.name, { exact: true }).count(), 0);
  assert.equal(await page.getByAltText(item.name, { exact: true }).count(), 0, 'Paused photo must not appear in slideshow');
  paused = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const card = page.locator('main .group').filter({ hasText: item.name });
  await card.waitFor();
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  paused = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await card.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: '₹25', exact: true }).count(), 0, 'Paused item must not stay in customer cart');
  paused = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await card.waitFor();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await card.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS: paused dishes absent from cached startup, menu, slideshow and cart; resume restores them; failed refresh hides stale menu.');
} finally { await browser.close(); }
