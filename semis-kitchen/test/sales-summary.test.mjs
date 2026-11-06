import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummaryRows, summaryInRange, summaryTotals, groupSummary } from '../src/lib/salesSummary.js';

// Expected values below are worked out by hand, not with the functions under test.
const rows = normalizeSummaryRows([
  { date: '2026-03-02', orders_count: 1, revenue: '100' },   // Monday
  { date: '2026-03-01', orders_count: 2, revenue: '250.5' }, // Sunday
  { date: '2026-02-28', orders_count: 3, revenue: '600' },   // Saturday
  { date: '2026-01-31', orders_count: 1, revenue: '40' },
  { date: '2026-03-03', orders_count: 0, revenue: '0' },     // emptied by a deletion
  { date: 'bad', orders_count: 9, revenue: '999' },          // ignored
]);

test('rows parse to numbers and invalid dates are dropped', () => {
  assert.equal(rows.length, 5);
  assert.equal(rows.find((row) => row.date === '2026-03-01').revenue, 250.5);
  // 1 Mar 00:00 IST = 28 Feb 18:30 UTC
  assert.equal(rows.find((row) => row.date === '2026-03-01').start, Date.UTC(2026, 1, 28, 18, 30));
});

test('day, week and month ranges use IST calendar days', () => {
  assert.deepEqual(summaryTotals(summaryInRange(rows, 'day', '2026-03-01')), { orders: 2, revenue: 250.5 });
  // Week of Mon 23 Feb – Sun 1 Mar: 3 + 2 orders, 600 + 250.5
  assert.deepEqual(summaryTotals(summaryInRange(rows, 'week', '2026-02-26')), { orders: 5, revenue: 850.5 });
  // March: 2 + 1 + 0 orders, 250.5 + 100 + 0
  assert.deepEqual(summaryTotals(summaryInRange(rows, 'month', '2026-03-15')), { orders: 3, revenue: 350.5 });
  assert.deepEqual(summaryTotals(summaryInRange(rows, 'all')), { orders: 7, revenue: 990.5 });
});

test('grouping by week starts on Monday and skips empty periods', () => {
  const weeks = groupSummary(rows, 'week');
  assert.deepEqual(weeks.map(([, totals]) => totals), [
    { orders: 1, revenue: 100 },   // week of 2 Mar (3 Mar row is zero)
    { orders: 5, revenue: 850.5 }, // week of 23 Feb
    { orders: 1, revenue: 40 },    // week of 26 Jan
  ]);
  const days = groupSummary(rows, 'day');
  assert.equal(days.length, 4, 'the all-zero day is hidden');
  assert.deepEqual(days[0][1], { orders: 1, revenue: 100 });
});

test('day/week/month totals agree with each other', () => {
  const month = summaryTotals(summaryInRange(rows, 'month', '2026-03-01'));
  const byDay = groupSummary(summaryInRange(rows, 'month', '2026-03-01'), 'day')
    .reduce((sum, [, totals]) => ({ orders: sum.orders + totals.orders, revenue: sum.revenue + totals.revenue }), { orders: 0, revenue: 0 });
  assert.deepEqual(byDay, month);
});
