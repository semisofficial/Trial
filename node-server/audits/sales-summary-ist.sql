-- READ ONLY. Compare stored summaries with completed orders still retained.
-- A difference is NOT proof of a timezone error: deleted orders may contribute
-- to stored summaries. Do not replace stored totals using this query's output.
WITH retained AS (
  SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS date,
         count(*) AS orders_count, sum(total) AS revenue
  FROM orders WHERE status = 'completed'
  GROUP BY (created_at AT TIME ZONE 'Asia/Kolkata')::date
)
SELECT COALESCE(s.summary_date, r.date)::text AS date,
       COALESCE(s.orders_count, 0) AS stored_orders,
       COALESCE(r.orders_count, 0) AS retained_orders_ist,
       COALESCE(s.revenue, 0) AS stored_revenue,
       COALESCE(r.revenue, 0) AS retained_revenue_ist,
       COALESCE(s.orders_count, 0) - COALESCE(r.orders_count, 0) AS orders_difference,
       COALESCE(s.revenue, 0) - COALESCE(r.revenue, 0) AS revenue_difference
FROM sales_summary s FULL JOIN retained r ON r.date = s.summary_date
WHERE COALESCE(s.orders_count, 0) <> COALESCE(r.orders_count, 0)
   OR COALESCE(s.revenue, 0) <> COALESCE(r.revenue, 0)
ORDER BY COALESCE(s.summary_date, r.date);
