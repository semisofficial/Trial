const {before,after,test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixture=require('../test-support/database').testDatabase();
const orders=require('../models/orderModel');
before(()=>fixture.schema());
after(()=>fixture.close());

test('completion groups revenue by the IST order date regardless of database session timezone',async()=>{
  const cases=[
    ['UTC','2026-02-28T18:29:59.999Z','2026-02-28'],
    ['UTC','2026-02-28T18:30:00Z','2026-03-01'],
    ['America/Los_Angeles','2026-12-31T18:30:00Z','2027-01-01'],
    ['Asia/Tokyo','2026-03-01T18:29:59Z','2026-03-01'],
  ];
  for(const [zone,created,date] of cases){
    await fixture.query('SELECT set_config($1,$2,false)',['TimeZone',zone]);
    const day=new Date();day.setUTCDate(day.getUTCDate()+3);
    const order=await orders.createOrder({customer:{name:'IST test',phone:'9876543210',address:'Test',deliveryDate:day.toISOString().slice(0,10),deliverySlot:'12-13'},orderMode:'Pickup',items:[{id:'mc-ghee-rice',qty:1}]});
    await fixture.query('UPDATE orders SET created_at=$2 WHERE id=$1',[order.id,created]);
    await fixture.query('DELETE FROM sales_summary'); // Isolated in-memory fixture only.
    await orders.updateOrderStatus(order.id,'accepted');
    await orders.updateOrderStatus(order.id,'completed');
    await orders.updateOrderStatus(order.id,'completed');
    assert.deepEqual((await fixture.query('SELECT summary_date::text AS date,orders_count,revenue::text AS revenue FROM sales_summary')).rows,[{date,orders_count:1,revenue:'600'}]);
    assert.equal(new Date((await fixture.query('SELECT created_at FROM orders WHERE id=$1',[order.id])).rows[0].created_at).getTime(),Date.parse(created));
  }
});

test('historical summary audit reports differences without rewriting stored history',async()=>{
  await fixture.query("INSERT INTO sales_summary(summary_date,orders_count,revenue) VALUES ('2026-02-28',2,1200)");
  const before=(await fixture.query('SELECT * FROM sales_summary ORDER BY summary_date')).rows;
  await fixture.query('BEGIN READ ONLY');
  try{
    const {rows}=await fixture.query(fs.readFileSync(path.join(__dirname,'../audits/sales-summary-ist.sql'),'utf8'));
    const feb=rows.find(row=>row.date==='2026-02-28');
    assert.equal(Number(feb.orders_difference),1);
    assert.equal(Number(feb.revenue_difference),600);
    const jan=rows.find(row=>row.date==='2027-01-01');
    assert.equal(Number(jan.orders_difference),-1);
    assert.equal(Number(jan.revenue_difference),-600);
  }finally{await fixture.query('ROLLBACK');}
  assert.deepEqual((await fixture.query('SELECT * FROM sales_summary ORDER BY summary_date')).rows,before);
});
