const db = require("../config/db");

// Permanent daily sales totals. A row is incremented when an order is marked
// completed and only reduced when a mistaken completed order is deleted, so
// bulk clean-up of old orders never changes reported sales.
// The date is returned as plain 'YYYY-MM-DD' text so no server or browser
// timezone can shift it to a neighbouring day.
async function getSalesSummary() {
  const result = await db.query(`
    SELECT
      to_char(summary_date, 'YYYY-MM-DD') AS date,
      orders_count,
      revenue
    FROM sales_summary
    ORDER BY summary_date DESC
  `);
  return result.rows;
}

module.exports = { getSalesSummary };
