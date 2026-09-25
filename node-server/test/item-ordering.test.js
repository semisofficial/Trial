const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { testDatabase } = require('../test-support/database');
const fixture = testDatabase();
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'ordering-test-password';
process.env.SESSION_SECRET = 'ordering-test-secret-at-least-thirty-two-characters';
delete process.env.RENDER;
delete process.env.TRUST_PROXY_HOPS;
const app = require('../app');
const items = require('../models/itemsModel');
const menu = require('../models/menuModel');
let server, base, cookie;
before(async () => {
  await fixture.schema();
  await fixture.query(`INSERT INTO menu_items(id,category_id,name,unit,min_qty,step_qty) VALUES
    ('order-a','fried','A snack','1 Piece',1,1),('order-b','fried','B snack','1 Piece',1,1),
    ('order-c','fried','C snack','1 Piece',1,1)`);
  await fixture.query(`INSERT INTO inventory(menu_item_id,selling_price,stock,available)
    SELECT id,20,12,true FROM menu_items WHERE id IN ('order-a','order-b','order-c')`);
  server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const login = await fetch(base+'/admin/login',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fixture.close(); });
const sectionOf = i => i.cat === 'mains' && i.isCombo ? 'combos' : i.cat;
async function payload(section) { return { section, items:(await items.list()).filter(i=>sectionOf(i)===section).map(({id,revision})=>({id,revision})) }; }
function save(body, auth=true) { return fetch(base+'/items/reorder',{ method:'PUT',headers:{'Content-Type':'application/json',...(auth?{cookie}:{})},body:JSON.stringify(body) }); }

test('staff can persist menu order without changing stock, price or photos', async () => {
  const body = await payload('fried'); body.items.reverse();
  const beforeRows = (await fixture.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows;
  const response = await save(body);
  assert.equal(response.status,200,await response.clone().text());
  const expected = body.items.map(i=>i.id);
  assert.deepEqual((await items.list()).filter(i=>i.cat==='fried').map(i=>i.id),expected);
  assert.deepEqual((await menu.getMenu()).filter(i=>i.cat==='fried').map(i=>i.id),expected);
  assert.deepEqual((await fixture.query('SELECT * FROM inventory ORDER BY menu_item_id')).rows,beforeRows);
  assert.equal((await save(body)).status,409,'stale admin must not overwrite a newer order');
});
test('reorder rejects anonymous, missing, duplicate, foreign-section and malformed entries', async () => {
  const body = await payload('fried');
  assert.equal((await save(body,false)).status,401);
  assert.equal((await save({...body,items:body.items.slice(1)})).status,409);
  assert.equal((await save({...body,items:[...body.items,body.items[0]]})).status,400);
  const foreign = (await payload('mains')).items[0];
  assert.equal((await save({...body,items:[foreign,...body.items.slice(1)]})).status,409);
  assert.equal((await save({...body,stock:0})).status,400);
  assert.equal((await save({section:'invalid',items:[]})).status,400);
});
test('Chattipathiri weights move together and combo order remains separate', async () => {
  const body = await payload('mains');
  const chatti = body.items.filter(i=>i.id.startsWith('mc-chattipathiri-'));
  const others = body.items.filter(i=>!i.id.startsWith('mc-chattipathiri-'));
  assert.equal((await save({...body,items:[chatti[0],others[0],...chatti.slice(1),...others.slice(1)]})).status,400);
  assert.equal((await save({...body,items:[...chatti,...others]})).status,200);
  const all = await menu.getMenu();
  const mains = all.filter(i=>i.cat==='mains');
  assert.ok(mains.slice(0,3).every(i=>i.isCombo));
  assert.ok(mains.filter(i=>!i.isCombo).slice(0,3).every(i=>i.id.startsWith('mc-chattipathiri-')));
});
test('renames preserve position, new items append, migration rerun preserves saved order', async () => {
  const beforeList = (await items.list()).filter(i=>i.cat==='fried');
  const first = beforeList[0];
  await items.update(first.id,{ name:'ZZ renamed',cat:'fried',unit:first.unit,minQty:first.minQty,step:first.step,isCombo:false },first.revision);
  assert.deepEqual((await items.list()).filter(i=>i.cat==='fried').map(i=>i.id),beforeList.map(i=>i.id));
  const fresh = await items.create({ name:'AA new',cat:'fried',unit:'1 Piece',minQty:1,step:1,isCombo:false });
  assert.equal((await items.list()).filter(i=>i.cat==='fried').at(-1).id,fresh.id);
  const listBefore = await items.list();
  await fixture.database.exec(fs.readFileSync(path.join(__dirname,'../item_ordering.sql'),'utf8'));
  assert.deepEqual(await items.list(),listBefore);
});
