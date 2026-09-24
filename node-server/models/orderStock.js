// All writes use the caller's order transaction and order-row lock.
async function deduct(client, orderId) {
  // Lock metadata before inventory, matching the manual Inventory edit lock order.
  const { rows: items } = await client.query(`SELECT m.id, m.category_id,
    COALESCE(m.stock_group_id,m.id) AS stock_id, oi.quantity
    FROM order_items oi JOIN menu_items m ON m.id=oi.menu_item_id
    WHERE oi.order_id=$1 ORDER BY m.id FOR SHARE OF m`, [orderId]);
  const required = new Map();
  for (const item of items) {
    if (!['fried', 'frozen'].includes(item.category_id)) continue;
    required.set(item.stock_id, (required.get(item.stock_id) || 0) + Number(item.quantity));
  }
  const ids = [...required.keys()].sort();
  if (!ids.length) return false;
  // Deterministic locks serialize different orders drawing from the same pool.
  const { rows } = await client.query(`SELECT menu_item_id, stock FROM inventory
    WHERE menu_item_id=ANY($1::text[]) ORDER BY menu_item_id FOR UPDATE`, [ids]);
  if (rows.length !== ids.length) throw new Error('Missing inventory for order stock group');
  for (const row of rows) {
    const deducted = Math.min(Math.max(Number(row.stock) || 0, 0), required.get(row.menu_item_id));
    // Keep zero deductions too: a later decline must never invent inventory.
    await client.query(`INSERT INTO order_stock_deductions(order_id,stock_item_id,quantity)
      VALUES ($1,$2,$3)`, [orderId, row.menu_item_id, deducted]);
    await client.query('UPDATE inventory SET stock=COALESCE(stock,0)-$1 WHERE menu_item_id=$2',
      [deducted, row.menu_item_id]);
  }
  return true;
}

async function restore(client, orderId) {
  const recorded = await client.query(`SELECT stock_item_id, quantity FROM order_stock_deductions
    WHERE order_id=$1 ORDER BY stock_item_id`, [orderId]);
  // Compatibility for historical stock_reserved=true orders predating this feature.
  // Their old implementation deducted each item's own inventory, not the shared pool.
  const rows = recorded.rows.length ? recorded.rows : (await client.query(`SELECT menu_item_id AS stock_item_id,
    SUM(quantity) AS quantity FROM order_items WHERE order_id=$1 GROUP BY menu_item_id ORDER BY menu_item_id`, [orderId])).rows;
  const locked = await client.query(`SELECT menu_item_id FROM inventory WHERE menu_item_id=ANY($1::text[])
    ORDER BY menu_item_id FOR UPDATE`, [rows.map(row => row.stock_item_id)]);
  if (locked.rows.length !== rows.length) throw new Error('Missing inventory for stock restoration');
  for (const row of rows) {
    await client.query('UPDATE inventory SET stock=COALESCE(stock,0)+$1 WHERE menu_item_id=$2',
      [row.quantity, row.stock_item_id]);
  }
  await client.query('DELETE FROM order_stock_deductions WHERE order_id=$1', [orderId]);
}

async function pendingShortages(client, ids) {
  if (!ids.length) return [];
  // One query for all pending orders. Each compares to current on-hand stock;
  // pending orders don't reserve it or receive an implicit priority.
  return (await client.query(`SELECT oi.order_id, COALESCE(m.stock_group_id,m.id) AS stock_group_id,
    string_agg(DISTINCT COALESCE(oi.item_name_snapshot,m.name), ' / ') AS name,
    SUM(oi.quantity) AS required, GREATEST(COALESCE(i.stock,0),0) AS available,
    SUM(oi.quantity)-GREATEST(COALESCE(i.stock,0),0) AS shortage
    FROM order_items oi JOIN menu_items m ON m.id=oi.menu_item_id
    LEFT JOIN inventory i ON i.menu_item_id=COALESCE(m.stock_group_id,m.id)
    WHERE oi.order_id=ANY($1::text[]) AND m.category_id IN ('fried','frozen')
    GROUP BY oi.order_id, COALESCE(m.stock_group_id,m.id), i.stock
    HAVING SUM(oi.quantity)>GREATEST(COALESCE(i.stock,0),0)
    ORDER BY oi.order_id, stock_group_id`, [ids])).rows;
}
module.exports = { deduct, restore, pendingShortages };
