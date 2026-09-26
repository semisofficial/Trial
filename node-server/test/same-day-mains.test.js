const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fixture=require('../test-support/database').testDatabase();
const orders=require('../models/orderModel');
before(()=>fixture.schema());
after(()=>fixture.close());

test('same-day checkout allows every not-yet-started slot and preserves Sunday rules',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-26T07:30:00Z')}); // Saturday 1 PM IST
  const order=(slot,mode='Delivery',snacks=false)=>({
    customer:{name:'Test customer',phone:'9876543210',address:'Test address',deliveryDate:new Date().toISOString().slice(0,10),deliverySlot:slot},
    orderMode:mode,items:[{id:'mc-ghee-rice',qty:1},...(snacks?[{id:'fz-irachi-pathiri',qty:10}]:[])],idempotencyKey:randomUUID(),
  });
  for(const mode of ['Delivery','Pickup']){
    const saved=await orders.createOrder(order('13-14',mode));
    assert.ok(saved.id);
    await assert.rejects(orders.createOrder(order('12-13',mode)),/already started/);
  }
  t.mock.timers.setTime(new Date('2026-09-26T07:31:00Z').getTime());
  assert.ok((await orders.createOrder(order('14-15'))).id);
  t.mock.timers.setTime(new Date('2026-09-26T15:00:00Z').getTime()); // 8:30 PM IST
  await assert.rejects(orders.createOrder(order('20-21')),/already started/);
  t.mock.timers.setTime(new Date('2026-09-27T07:30:00Z').getTime());
  await assert.rejects(orders.createOrder(order('16-17')),/Sunday/);
  assert.ok((await orders.createOrder(order('16-17','Delivery',true))).id);
  assert.ok((await orders.createOrder(order('16-17','Pickup'))).id);
  t.mock.timers.reset();
});
