const db = require("../config/db");

async function getInventory(includeDrafts = false) {
  const result = await db.query(`
    SELECT
      i.menu_item_id, i.selling_price, i.available,
      CASE WHEN m.category_id = 'mains' THEN NULL ELSE FLOOR(COALESCE(s.stock, 0)) END AS stock,
      COALESCE(m.stock_group_id, m.id) AS stock_group_id
    FROM inventory i JOIN menu_items m ON m.id = i.menu_item_id
    LEFT JOIN inventory s ON s.menu_item_id = COALESCE(m.stock_group_id, m.id)
    WHERE NOT m.retired AND ($1::boolean OR (NOT m.is_draft AND i.available)) ORDER BY i.menu_item_id
  `, [includeDrafts]);

  return result.rows;
}

async function updateInventory(id, data) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT category_id, is_draft, COALESCE(stock_group_id, id) AS stock_id
      FROM menu_items WHERE id = $1 AND NOT retired FOR UPDATE`, [id]);
    const item = found.rows[0];
    if (!item) { await client.query("ROLLBACK"); return null; }
    if (item.is_draft && data.available === true) {
      const current = await client.query('SELECT selling_price FROM inventory WHERE menu_item_id=$1 FOR UPDATE', [id]);
      if (!(Number(data.price ?? current.rows[0]?.selling_price) > 0)) {
        const error = new Error('Set a positive price before enabling this new item');
        error.publicMessage = error.message; error.status = 400; throw error;
      }
      await client.query('UPDATE menu_items SET is_draft=false, item_revision=gen_random_uuid() WHERE id=$1', [id]);
    }
    if (data.stock !== undefined && item.category_id !== "mains") {
      await client.query("UPDATE inventory SET stock = $1 WHERE menu_item_id = $2", [data.stock, item.stock_id]);
    }
    const result = await client.query(`UPDATE inventory SET
      selling_price = COALESCE($1, selling_price), available = COALESCE($2, available)
      WHERE menu_item_id = $3 RETURNING *`, [data.price, data.available, id]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = {
  getInventory,
  updateInventory,
};
