const db = require("../config/db");

const TRANSIENT_CONNECTION_CODES = new Set([
  "08000", "08003", "08006", "08001", "08004", "08007", "08P01",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
]);

function isTransientConnectionError(error) {
  return TRANSIENT_CONNECTION_CODES.has(error?.code)
    || /connection terminated|connection timeout|connection terminated unexpectedly/i.test(error?.message || "");
}

async function queryMenu() {
  return db.query(`
    SELECT
      m.id,
      m.category_id AS cat,
      m.name,
      CASE
        WHEN m.category_id = 'mains' AND m.min_qty IN (10, 20) THEN '1 Piece'
        ELSE m.unit
      END AS unit,
      m.min_qty AS "minQty",
      m.step_qty AS "step",
      m.seasonal,
      m.image AS img,
      COALESCE(i.selling_price, m.default_price) AS price,
      COALESCE(i.stock, 0) AS stock,
      COALESCE(i.available, true) AS available
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
    LEFT JOIN inventory i ON i.menu_item_id = m.id
    ORDER BY c.id, m.name;
  `);
}

async function getMenu() {
  let result;
  try {
    result = await queryMenu();
  } catch (error) {
    if (!isTransientConnectionError(error)) throw error;
    // A menu read is idempotent, so one retry is safe after Neon wakes or a
    // pooled connection is replaced. Never apply this pattern to order writes.
    result = await queryMenu();
  }
  return result.rows;
}

module.exports = { getMenu };
