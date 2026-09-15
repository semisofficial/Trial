// Build first. Local static server applies the checked-in Render CSP.
// API, map tiles and geocoding are intercepted; no backend or .env is loaded.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import snapshot from '../src/menuSnapshot.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const blueprint = await readFile(new URL('../../render.yaml', import.meta.url), 'utf8');
const policy = blueprint.match(/name: Content-Security-Policy\s+value: (.+)/)?.[1];
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const target = resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let data, extension = extname(target);
    try { data = await readFile(target); } catch { data = await readFile(resolve(root, 'index.html')); extension = '.html'; }
    res.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
    if (policy) res.setHeader('Content-Security-Policy', policy);
    res.end(data);
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 10.85, longitude: 76.27 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname.startsWith('/api/')) {
      let data = [];
      if (url.pathname === '/api/menu') data = snapshot;
      if (url.pathname === '/api/inventory') data = snapshot.map(item => ({ menu_item_id: item.id, selling_price: item.price, stock: 0, available: true }));
      return route.fulfill({ json: { success: true, authenticated: true, data, serverNow: new Date().toISOString() } });
    }
    if (/^[abc]\.tile\.openstreetmap\.org$/.test(url.hostname)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64') });
    if (url.hostname === 'nominatim.openstreetmap.org') return route.fulfill({ json: { display_name: 'Test delivery address, Kerala' } });
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.violatedDirective));
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Add', exact: true }).first().waitFor();
  assert.equal(await page.locator('script[type="application/ld+json"]').evaluate(el => JSON.parse(el.textContent)['@type']), 'Restaurant');
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /index, follow/);
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: /₹/ }).last().click();
  await page.getByRole('button', { name: 'Proceed to checkout' }).click();
  await page.locator('.leaflet-tile-loaded').first().waitFor().catch(async error => {
    console.error(await page.evaluate(() => ({ violations: window.policyViolations, tiles: [...document.querySelectorAll('.leaflet-tile')].map(img => img.src) })));
    throw error;
  });
  await page.getByRole('button', { name: 'Use my location' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[placeholder^="Address appears"]')?.value === 'Test delivery address, Kerala');
  assert.equal(await page.locator('.leaflet-marker-icon').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
  await page.goto(`${base}/nashi`);
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByPlaceholder('Stock').first().waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.injectedScriptRan = true';
    document.body.append(script);
  });
  assert.equal(await page.evaluate(() => window.injectedScriptRan === true), false, 'Inline injected executable script must be blocked');
  await page.waitForFunction(() => window.policyViolations.includes('script-src-elem'));
  console.log('PASS: built menu, SEO JSON-LD, map tiles, geolocation/address lookup, admin inventory, and blocked inline injection');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
