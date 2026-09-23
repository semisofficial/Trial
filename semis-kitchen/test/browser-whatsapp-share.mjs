// Local Vite only. Capture outgoing links without contacting WhatsApp or the API.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const context = await browser.newContext();
  const orders = ['pending', 'accepted', 'completed', 'declined'].map((status, i) => ({
    id: `TEST-${status}`, invoice_id: `INV-${status}`, invoice_share_token: `token-${status}`,
    status, payment_status: 'unpaid', payment_method: 'upi', total: 150,
    created_at: new Date().toISOString(), customer_name: `Customer ${status}`,
    customer_phone: `987654321${i}`, customer_address: '', order_mode: 'Pickup',
    notes: null, latitude: null, longitude: null, delivery_date: null, delivery_slot: null,
    items: [{ id: 'test-snack', name: 'Test snack', qty: 10, price: 15 }],
  }));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {
      success: true, authenticated: true, data: url.pathname === '/api/orders' ? orders : [],
    } });
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { shareInvoiceOnWhatsApp, shareDeclineOnWhatsApp } = await import('/src/lib/kitchen.jsx');
    const opened = [];
    window.open = (...args) => { opened.push(args); return null; };
    for (const phone of ['9876543210', '+91 98765 43210']) {
      shareInvoiceOnWhatsApp('TEST/ORDER', phone, 'test+token');
    }
    let missingTokenRejected = false;
    try { shareInvoiceOnWhatsApp('TEST', '9876543210', ''); }
    catch { missingTokenRejected = true; }
    shareDeclineOnWhatsApp('9876543210');
    return { opened, missingTokenRejected };
  });
  assert.equal(result.opened.length, 3, 'Missing invoice tokens must not open a share');
  assert.equal(result.missingTokenRejected, true);
  for (const [href, target, features] of result.opened.slice(0, 2)) {
    const url = new URL(href);
    assert.equal(url.origin + url.pathname, 'https://wa.me/919876543210');
    assert.equal(target, '_blank');
    assert.equal(features, 'noopener,noreferrer');
    const text = url.searchParams.get('text');
    assert.equal(text, [
      'Thank you for choosing Semi’s Kitchen! ❤️',
      'We truly appreciate your order and the trust you’ve placed in us. Every dish is prepared with care, love, and attention to detail.',
      'We hope you enjoy every bite!',
      'Thank you for supporting Semi’s Kitchen. 🍽️✨',
      'UPI payment QR: https://semiskitchen.in/api/payment-qr/image?v=2026-09-23',
      'Your invoice: https://semiskitchen.in/invoice/TEST%2FORDER?token=test%2Btoken',
    ].join('\n'));
    assert.equal((text.match(/UPI payment QR:/g) || []).length, 1);
  }
  const declined = new URL(result.opened[2][0]);
  assert.equal(declined.pathname, '/919876543210');
  assert.match(declined.searchParams.get('text'), /decline your order/);
  assert.doesNotMatch(declined.searchParams.get('text'), /upi-qr/);
  await page.goto(`${base}/nashi`);
  await page.evaluate(() => { window.sharedLinks = []; window.open = url => window.sharedLinks.push(url); });
  for (const [status, label, phone] of [['accepted', 'Accepted', '919876543211'], ['completed', 'Completed', '919876543212']]) {
    await page.getByRole('tab', { name: `${label} (1)`, exact: true }).click();
    await page.getByText(`Customer ${status}`, { exact: true }).waitFor();
    const button = page.getByRole('button', { name: 'Share on WhatsApp', exact: true });
    assert.equal(await button.count(), 1, `${label} order cards need a share button`);
    await button.click();
    const link = new URL(await page.evaluate(() => window.sharedLinks.at(-1)));
    assert.equal(link.pathname, `/${phone}`);
    const text = link.searchParams.get('text');
    assert.ok(text.startsWith('Thank you for choosing Semi’s Kitchen! ❤️'));
    assert.ok(text.endsWith(`Your invoice: https://semiskitchen.in/invoice/TEST-${status}?token=token-${status}`));
    assert.ok(text.includes('UPI payment QR: https://semiskitchen.in/api/payment-qr/image?v=2026-09-23'));
    await page.setViewportSize({ width: 360, height: 800 });
    const card = page.locator('main .shadow-sm').filter({ hasText: `Customer ${status}` });
    assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Order actions must wrap inside their card');
    const box = await button.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 360, 'Share button must fit the mobile viewport');
  }
  for (const label of ['Pending', 'Declined']) {
    await page.getByRole('tab', { name: `${label} (1)`, exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Share on WhatsApp', exact: true }).count(), 0);
  }
  console.log('PASS: direct customer chat, current QR and invoice links, token guard and decline message.');
} finally { await browser.close(); }
