// Intercept all APIs; never place or update a live order.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5185';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const order = { id:'stock-order', invoice_id:'STOCK-INV', invoice_share_token:'test-token', status:'pending',
    payment_status:'unpaid', payment_method:'upi', total:300, created_at:new Date().toISOString(),
    customer_name:'Stock customer', customer_phone:'9876543210', customer_address:'Test', order_mode:'Pickup',
    notes:null, latitude:null, longitude:null, delivery_date:null, delivery_slot:null,
    items:[{ id:'stock-fr',name:'Cutlet',qty:15,price:20 }],
    stock_shortages:[{ stock_group_id:'stock-fr',name:'Cutlet',required:15,available:10,shortage:5 }] };
  let failAccept = true;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/api/orders/stock-order/status' && route.request().method() === 'PUT') {
      if (failAccept) return route.fulfill({ status:503, json:{ success:false,
        message:'Order stock tracking needs database setup. Apply order_stock.sql before accepting orders.' } });
      order.status = route.request().postDataJSON().status;
      order.stock_shortages = [];
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success:true, authenticated:true,
      data: url.pathname === '/api/orders' ? [order] : [] } });
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${base}/nashi`);
  const warning = page.getByRole('region', { name:'Stock shortages' });
  await warning.waitFor({ timeout:5000 });
  assert.match(await warning.innerText(), /Available: 10.*Required: 15.*Shortage: 5/);
  assert.match(await warning.innerText(), /prepare.*decline/i);
  const box = await warning.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.getByRole('button', { name:'Accept',exact:true }).click();
  await page.getByText('Order stock tracking needs database setup. Apply order_stock.sql before accepting orders.', { exact:true }).waitFor();
  await warning.waitFor();
  assert.equal(order.status, 'pending');
  failAccept = false;
  await page.getByRole('button', { name:'Accept',exact:true }).click();
  await page.getByRole('tab', { name:'Accepted (1)',exact:true }).click();
  assert.equal(await warning.count(), 0);
  await page.getByRole('button', { name:'Mark completed',exact:true }).click();
  await page.getByRole('tab', { name:'Completed (1)',exact:true }).click();
  await page.getByText('Cutlet × 15', { exact:true }).waitFor();
  await page.getByRole('button', { name:'Open admin navigation' }).click();
  await page.getByRole('button', { name:'Sales',exact:true }).click();
  await page.getByText('15 sold', { exact:true }).waitFor();
  assert.equal(order.status, 'completed');
  console.log('PASS: Pending shows shortage, accepted/completed hide it, Sales counts all 15 items.');
} finally { await browser.close(); }
