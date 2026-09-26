// All APIs intercepted: no production orders or database writes.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_SITE_URL||'http://127.0.0.1:5185';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  await page.clock.install({time:new Date('2026-09-26T07:30:00Z')});
  let submissions=0,body;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==new URL(base).origin)return route.abort();
    if(url.pathname==='/api/menu')return route.fulfill({json:{success:true,data:[{id:'mc-ghee-rice',name:'Ghee Rice',cat:'mains',minQty:1,step:1,unit:'1 kg',price:600,stock:null,available:true}]}});
    if(url.pathname==='/api/orders'){
      submissions++;body=route.request().postDataJSON();
      return route.fulfill({json:{success:true,data:{id:'test',invoice_id:'test',total:600,status:'pending',items:body.items}}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,data:[]}});
    return route.continue();
  });
  await page.goto(base);
  await page.getByRole('button',{name:'Biriyani & Curries',exact:true}).click();
  await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('button',{name:'₹600',exact:true}).click();
  await page.getByRole('button',{name:'Proceed to checkout'}).click();
  await page.getByRole('button',{name:'Pickup',exact:true}).click();
  const date=page.locator('input[type="date"]');
  assert.equal(await date.getAttribute('min'),'2026-09-26');
  await date.fill('2026-09-26');
  const slots=await page.locator('select option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  assert.deepEqual(slots,['13-14','14-15','15-16','16-17','17-18','18-19','19-20','20-21']);
  assert.equal(await page.getByText(/cannot be ordered for today|same-day delivery is not available/).count(),0);
  await page.getByPlaceholder('Full name').fill('Test customer');
  const phone=page.getByPlaceholder('Phone number');
  await phone.fill('9876543210123');
  assert.equal(await phone.inputValue(),'9876543210');
  await phone.fill('abc123');
  assert.equal(await phone.inputValue(),'123');
  await page.locator('select').selectOption('13-14');
  await page.getByRole('button',{name:'Place order',exact:true}).click();
  assert.equal(await phone.getAttribute('aria-invalid'),'true');
  assert.equal(submissions,0);
  await phone.fill('9876543210');
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/orders'));
  await page.getByRole('button',{name:'Place order',exact:true}).click();
  await submitted;
  assert.equal(submissions,1);
  assert.equal(body.customer.deliveryDate,'2026-09-26');
  assert.equal(body.customer.phone,'9876543210');
  console.log('PASS: same-day mains slots, removed notices, phone input limits and checkout submission');
}finally{await browser.close();}
