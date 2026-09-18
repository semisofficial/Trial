// Run against local Vite. All API/external requests are intercepted; no DB writes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../src/menuSnapshot.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
after(() => browser.close());
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5174';
const photos = [
  ['Broasted Chicken', 'broasted.jpeg'],
  ['Ghee Rice', 'ghee rice.jpeg'],
  ['Butter Garlic Chicken', 'butter garlic chicken.jpeg'],
  ['Patthiri', 'patthiri.jpeg'],
  ['Chapatis', 'chappati.jpeg'],
  ['Chattipathiri', 'chattipathiri.jpeg'],
  ['Vegetable Stew', 'vegetable stew.jpeg'],
  ['Broasted full chicken', 'broasted quboos hummus.jpeg'],
  ['Neypathal 11', 'neypathal beef masala.jpeg'],
  ['Batura 11', 'batura butter chicken.jpeg'],
];
async function fixture(mode = 'live') {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/menu' && mode !== 'live') return route.fulfill({ status: 503, json: { message: 'Offline test' } });
    return route.fulfill({ json: { success: true, data: url.pathname === '/api/menu' ? snapshot : [] } });
  });
  if (mode === 'cache') await context.addInitScript(menu => localStorage.setItem('semis_menu_cache_v2', JSON.stringify(menu)),
    snapshot.map(item => item.id === 'fz-irachi-pathiri' ? { ...item, img: 'fz-iracch pathiri.jpeg' } : item));
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Biriyani & Curries', exact: true }).click();
  return { context, page };
}

test('uploaded photos resolve for live, previously cached and bundled catalogs without DB image values', async () => {
  for (const mode of ['live', 'cache', 'snapshot']) {
    const { context, page } = await fixture(mode);
    try {
      for (const [name, filename] of photos) {
        const card = page.locator('main .group').filter({ hasText: name });
        const photo = card.locator('img');
        assert.equal(await photo.count(), 1, `${mode}: ${name} should have a photo`);
        await photo.scrollIntoViewIfNeeded();
        await photo.evaluate(img => img.decode());
        assert.ok(decodeURIComponent(await photo.getAttribute('src')).includes(filename), `${mode}: ${name} mapping`);
      }
      const chatti = page.locator('main .group').filter({ hasText: 'Chattipathiri' });
      for (const weight of ['1 kg', '1.5 kg', '2 kg']) {
        await chatti.getByRole('button', { name: weight, exact: true }).click();
        assert.ok(decodeURIComponent(await chatti.locator('img').getAttribute('src')).includes('chattipathiri.jpeg'));
      }
      await page.getByRole('button', { name: 'Frozen Snacks', exact: true }).click();
      const frozen = page.locator('main .group').filter({ hasText: 'Irachi Pathiri' }).locator('img');
      assert.equal(await frozen.count(), 1);
      await frozen.scrollIntoViewIfNeeded();
      await frozen.evaluate(img => img.decode());
      assert.ok(decodeURIComponent(await frozen.getAttribute('src')).includes('fz-irachi pathiri.jpeg'));
    } finally { await context.close(); }
  }
});

test('kilogram labels stay on one line and cards do not clip with mobile quantity controls', async () => {
  const { context, page } = await fixture();
  try {
    await page.getByRole('button', { name: 'Mains', exact: true }).click();
    for (const state of ['Add', 'quantity']) {
      if (state === 'quantity') {
        for (const card of await page.locator('main .group').all()) await card.getByRole('button', { name: 'Add', exact: true }).click();
      }
      for (const width of [320, 360, 375, 390, 414, 640, 768]) {
        await page.setViewportSize({ width, height: 800 });
        const issues = await page.locator('main .group').evaluateAll(cards => cards.flatMap(card => {
          const problems = [];
          for (const label of card.querySelectorAll('span')) {
            if (!/^1\s+kg$/i.test(label.textContent.trim())) continue;
            const range = document.createRange(); range.selectNodeContents(label);
            const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
            if (lines.size > 1) problems.push(`${card.textContent}: split unit`);
            const rect = range.getBoundingClientRect(), bounds = card.getBoundingClientRect();
            if (rect.right > bounds.right || rect.left < bounds.left) problems.push('clipped label');
          }
          if (card.scrollWidth > card.clientWidth + 1) problems.push('card overflow');
          return problems;
        }));
        assert.deepEqual(issues, [], `${width}px ${state}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
  } finally { await context.close(); }
});
