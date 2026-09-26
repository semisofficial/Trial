// Local UI, intercepted APIs only. No database reads/writes.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_SITE_URL||'http://127.0.0.1:5185';
const browser=await chromium.launch({channel:'msedge',headless:true});
const dates=['2026-02-28T18:29:59.999Z','2026-02-28T18:30:00Z','2026-03-01T18:29:59.999Z','2026-03-01T18:30:00Z'];
const orders=dates.map((created_at,i)=>({id:`IST-${i}`,invoice_id:`INV-IST-${i}`,status:'completed',created_at,total:100,payment_status:'paid',payment_method:'cod',customer_name:`Customer ${i}`,customer_phone:'9876543210',customer_address:'Test',order_mode:'Pickup',items:[{id:'rice',name:'Rice',qty:1,price:100}]}));
try{
  for(const timezoneId of ['UTC','America/Los_Angeles','Asia/Tokyo','Asia/Kolkata']){
    const context=await browser.newContext({timezoneId,viewport:{width:1280,height:900}});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==new URL(base).origin)return route.abort();
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,authenticated:true,data:url.pathname==='/api/orders'?orders:[]}});
      return route.continue();
    });
    const page=await context.newPage();
    await page.goto(`${base}/nashi`);
    await page.getByRole('tab',{name:'Completed (4)',exact:true}).click();
    await page.getByText('Ordered: 01 Mar 2026, 12:00:00 am IST',{exact:true}).waitFor({timeout:5000});
    const nav=async name=>{
      await page.getByRole('button',{name:'Open admin navigation'}).click();
      await page.getByRole('button',{name,exact:true}).click();
    };
    await nav('Invoices');
    await page.getByText('Customer 0',{exact:true}).waitFor();
    await page.getByText('Ordered: 28 Feb 2026, 11:59:59 pm IST',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Day',exact:true}).click();
    await page.locator('input[type="date"]').fill('2026-03-01');
    await page.getByText('Customer 1',{exact:true}).waitFor();
    assert.equal(await page.getByText('Customer 0',{exact:true}).count(),0,`${timezoneId}: exclude previous IST date`);
    assert.equal(await page.getByText('Customer 2',{exact:true}).count(),1,`${timezoneId}: include end of IST date`);
    assert.equal(await page.getByText('Customer 3',{exact:true}).count(),0,`${timezoneId}: exclude next IST date`);
    await page.getByRole('button',{name:'By day',exact:true}).click();
    await page.getByText('Ordered: 01 Mar 2026, 12:00:00 am IST',{exact:true}).waitFor();
    await page.getByText(/2 invoices.*₹200/).waitFor();
    await page.getByRole('button',{name:'Week',exact:true}).click();
    await page.locator('input[type="date"]').fill('2026-03-02');
    await page.getByRole('button',{name:'By week',exact:true}).click();
    assert.equal(await page.getByText('Customer 2',{exact:true}).count(),0);
    await page.getByText('Customer 3',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'02 Mar 2026 – 08 Mar 2026',exact:true}).waitFor();
    await nav('Sales');
    await page.getByRole('button',{name:'Month',exact:true}).click();
    await page.locator('input[type="date"]').fill('2026-03-01');
    await page.getByText('3 sold',{exact:true}).waitFor();
    await page.getByRole('button',{name:'By day',exact:true}).click();
    await page.getByText('2 orders · ₹200',{exact:true}).waitFor();
    await page.getByRole('button',{name:'By week',exact:true}).click();
    await page.getByText('23 Feb 2026 – 01 Mar 2026',{exact:true}).waitFor();
    await context.close();
  }
  console.log('PASS: Admin invoice filters/grouping and sales grouping agree in UTC, Los Angeles, Tokyo and India');
}finally{await browser.close();}
