const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fixture=require('../test-support/database').testDatabase();
const orders=require('../models/orderModel');
const {fmtDate,fmtTime}=require('../utils/invoiceGenerator');
before(async()=>{
  await fixture.schema();
  // Control the database clock, not order creation logic. No production DB.
  await fixture.query('CREATE TABLE test_clock(value timestamptz)');
  await fixture.query("INSERT INTO test_clock VALUES ('2026-09-25T18:30:00Z')");
  await fixture.database.exec(`CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT value FROM public.test_clock';
    SET search_path = public, pg_catalog;
    ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT public.now();`);
});
after(()=>fixture.close());

test('new invoice numbers, persisted timestamps and PDF dates agree across IST midnight',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-25T18:30:00Z')});
  for(const [instant,prefix,pdfDate,pdfTime,zone,appClockSkew=0] of [
    ['2026-09-25T18:29:59Z','20260925','25 Sept 2026','11:59 pm','UTC'],
    ['2026-09-25T18:30:00Z','20260926','26 Sept 2026','12:00 am','UTC'],
    ['2026-12-31T18:30:00Z','20270101','01 Jan 2027','12:00 am','America/Los_Angeles'],
    ['2028-02-28T18:30:00Z','20280229','29 Feb 2028','12:00 am','Asia/Tokyo'],
    ['2026-09-25T20:00:00Z','20260926','26 Sept 2026','01:30 am','UTC',2*86400000],
  ]){
    t.mock.timers.setTime(Date.parse(instant)+appClockSkew);
    await fixture.query('UPDATE test_clock SET value=$1',[instant]);
    await fixture.query('SELECT set_config($1,$2,false)',['TimeZone',zone]);
    const day=new Date();day.setUTCDate(day.getUTCDate()+3);
    const input={customer:{name:'Clock test',phone:'9876543210',address:'Test',deliveryDate:day.toISOString().slice(0,10),deliverySlot:'12-13'},orderMode:'Pickup',items:[{id:'mc-ghee-rice',qty:1}],idempotencyKey:randomUUID()};
    const saved=await orders.createOrder(input);
    assert.match(saved.invoice_id,new RegExp(`^INV-${prefix}-[A-F0-9]{10}$`));
    assert.equal(new Date(saved.created_at).getTime(),Date.parse(instant));
    assert.equal(fmtDate(saved.created_at),pdfDate);
    assert.equal(fmtTime(saved.created_at).toLowerCase().replace(/\s+/g,' '),pdfTime);
    // A retry on a later date must preserve the original identifier/time/token.
    await fixture.query("UPDATE test_clock SET value=value+interval '1 day'");
    t.mock.timers.setTime(Date.parse(instant)+86400000);
    const replay=await orders.createOrder(input);
    assert.equal(replay.invoice_id,saved.invoice_id);
    assert.equal(replay.invoice_share_token,saved.invoice_share_token);
    assert.equal(new Date(replay.created_at).getTime(),Date.parse(instant));
  }
  t.mock.timers.reset();
});
