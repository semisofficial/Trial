import { indiaRangeBounds } from "./dateTime.js";

// Permanent daily totals from GET /api/sales/summary:
// [{ date: 'YYYY-MM-DD' (IST calendar day), orders_count, revenue }]
// Each row is placed at the start instant of its IST day so the existing
// Day/Week/Month range filters and By day/By week grouping apply unchanged.
export function normalizeSummaryRows(rows) {
  return (rows || [])
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
    .map((row) => ({
      date: row.date,
      start: indiaRangeBounds("day", row.date).start,
      orders: Number(row.orders_count) || 0,
      revenue: Number(row.revenue) || 0,
    }));
}

export function summaryInRange(rows, range, reference) {
  if (range === "all") return rows;
  const { start, end } = indiaRangeBounds(range, reference);
  return rows.filter((row) => row.start >= start && row.start <= end);
}

export function summaryTotals(rows) {
  return rows.reduce(
    (totals, row) => ({ orders: totals.orders + row.orders, revenue: totals.revenue + row.revenue }),
    { orders: 0, revenue: 0 }
  );
}

// group is "day" or "week". Returns [[periodStart, { orders, revenue }], ...]
// newest first, omitting periods whose totals are all zero.
export function groupSummary(rows, group) {
  const byPeriod = new Map();
  for (const row of rows) {
    const key = indiaRangeBounds(group, row.date).start;
    const current = byPeriod.get(key) || { orders: 0, revenue: 0 };
    byPeriod.set(key, { orders: current.orders + row.orders, revenue: current.revenue + row.revenue });
  }
  return [...byPeriod.entries()]
    .filter(([, totals]) => totals.orders > 0 || totals.revenue > 0)
    .sort((a, b) => b[0] - a[0]);
}
