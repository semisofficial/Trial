// Local browser only; API requests intercepted, no real catalog writes.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_SITE_URL || 'http://127.0.0.1:5185';
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  let rows = ['Alpha','Beta','Gamma'].map((name,i)=>({id:`snack-${i}`,name,cat:'fried',unit:'1 Piece',minQty:1,step:1,isCombo:false,isDraft:false,img:'',revision:`r${i}`}));
  let saves=0, conflict=false;
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(base).origin)return route.abort();
    if(url.pathname==='/api/items/reorder'){
      saves++;
      if(conflict)return route.fulfill({status:409,json:{success:false,message:'Items changed in another session. Reload the list before reordering.'}});
      const body=req.postDataJSON();
      assert.equal(body.section,'fried');
      assert.equal(body.items.length,3);
      rows=body.items.map(({id})=>({...rows.find(r=>r.id===id),revision:`save${saves}-${id}`}));
      return route.fulfill({json:{success:true,data:rows}});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,authenticated:true,
      data:url.pathname==='/api/items'?rows:url.pathname==='/api/menu'||url.pathname==='/api/menu/admin'?rows.map(r=>({...r,price:20,available:true,stock:10})):[]}});
    return route.continue();
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  async function openItems(){
    await page.goto(`${base}/nashi`);
    await page.getByRole('button',{name:'Open admin navigation'}).click();
    await page.getByRole('button',{name:'Items',exact:true}).click();
  }
  await openItems();
  const handle=name=>page.getByRole('button',{name:`Move ${name}`,exact:true});
  await handle('Beta').waitFor({timeout:5000});
  await handle('Beta').focus(); await page.keyboard.press('ArrowUp');
  await page.getByText('Menu order saved.',{exact:true}).waitFor();
  assert.deepEqual(rows.map(r=>r.name),['Beta','Alpha','Gamma']);
  await page.getByRole('textbox',{name:'Search items'}).fill('Alpha');
  assert.equal(await handle('Alpha').isDisabled(),true);
  await page.getByRole('textbox',{name:'Search items'}).fill('');
  // Actual touch events, including pointer capture, not HTML drag/drop emulation.
  await handle('Beta').scrollIntoViewIfNeeded();
  const from=await handle('Beta').boundingBox();
  const target=await page.locator('[data-reorder-key]').filter({has:page.getByRole('heading',{name:'Alpha',exact:true})}).boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+from.width/2,y:from.y+from.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+from.width/2,y:target.y+target.height-8}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('[data-reorder-key] h3')?.textContent==='Alpha');
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Move Beta"]')?.disabled);
  assert.deepEqual(rows.map(r=>r.name),['Alpha','Beta','Gamma']);
  // Stale saves reload the authoritative order rather than silently overwriting it.
  conflict=true;
  await handle('Beta').focus(); await page.keyboard.press('ArrowUp');
  await page.getByTestId('items-manager').getByRole('alert').filter({hasText:'Items changed in another session'}).waitFor();
  assert.deepEqual(await page.locator('[data-reorder-key] h3').allTextContents(),['Alpha','Beta','Gamma']);
  assert.equal(saves,3);
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Move Beta"]')?.disabled);
  conflict=false;
  await page.setViewportSize({width:1280,height:900});
  await handle('Alpha').scrollIntoViewIfNeeded();
  const mouseFrom=await handle('Alpha').boundingBox();
  const mouseTarget=await page.locator('[data-reorder-key]').filter({has:page.getByRole('heading',{name:'Beta',exact:true})}).boundingBox();
  await page.mouse.move(mouseFrom.x+20,mouseFrom.y+20); await page.mouse.down();
  await page.mouse.move(mouseFrom.x+20,mouseTarget.y+mouseTarget.height-8,{steps:5});
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(saves,3,'Escape cancels without sending a save');
  await page.mouse.move(mouseFrom.x+20,mouseFrom.y+20); await page.mouse.down();
  await page.mouse.move(mouseFrom.x+20,mouseTarget.y+mouseTarget.height-8,{steps:5}); await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-reorder-key] h3')?.textContent==='Beta');
  await page.getByText('Menu order saved.',{exact:true}).waitFor();
  assert.deepEqual(rows.map(r=>r.name),['Beta','Alpha','Gamma']);
  await page.goto(base);
  await page.locator('main .group').filter({hasText:'Alpha'}).waitFor();
  const names=await page.locator('main .group').allTextContents();
  assert.ok(names.findIndex(name=>name.includes('Beta'))<names.findIndex(name=>name.includes('Alpha')));
  assert.deepEqual(errors,[],'Reordering must not produce browser runtime errors');
  console.log('PASS: mouse/touch/keyboard reordering, Escape cancellation, search guard, save conflict recovery and customer ordering.');
} finally {await browser.close();}
