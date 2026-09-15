const db = require("../config/db");

async function getInventory() {
  const result = await db.query(`
    SELECT
      i.menu_item_id, i.selling_price, i.available,
      CASE WHEN m.category_id = 'mains' THEN NULL ELSE FLOOR(COALESCE(s.stock, 0)) END AS stock,
      COALESCE(m.stock_group_id, m.id) AS stock_group_id
    FROM inventory i JOIN menu_items m ON m.id = i.menu_item_id
    LEFT JOIN inventory s ON s.menu_item_id = COALESCE(m.stock_group_id, m.id)
    WHERE NOT m.retired ORDER BY i.menu_item_id
  `);

  return result.rows;
}

async function updateInventory(id, data) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT category_id, COALESCE(stock_group_id, id) AS stock_id
      FROM menu_items WHERE id = $1 AND NOT retired FOR SHARE`, [id]);
    const item = found.rows[0];
    if (!item) { await client.query("ROLLBACK"); return null; }
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
