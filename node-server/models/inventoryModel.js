const db = require("../config/db");

async function getInventory() {
  const result = await db.query(`
    SELECT
      menu_item_id,
      selling_price,
      stock,
      available
    FROM inventory
    ORDER BY menu_item_id
  `);

  return result.rows;
}

async function updateInventory(id, data) {
  const { stock, available, price } = data;

  const result = await db.query(
    `
    UPDATE inventory
    SET
      stock = COALESCE($1, stock),
      available = COALESCE($2, available),
      selling_price = COALESCE($3, selling_price)
    WHERE menu_item_id=$4
    RETURNING *
    `,
    [stock, available, price, id]
  );

  return result.rows[0];
}

module.exports = {
  getInventory,
  updateInventory,
};
