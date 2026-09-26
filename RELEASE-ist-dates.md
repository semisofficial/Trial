# IST date consistency

Admin invoice, sales and payment date filters now use Indian Standard Time (`Asia/Kolkata`) for day, Monday–Sunday week and calendar-month boundaries. Invoice and sales grouping use the same boundaries, independent of device timezone or daylight saving time.

New sales-summary contributions use the order's original `created_at` converted to IST, not the database session timezone. This is still the **order-placement date**, not the date the admin clicks Completed. Repeated completion remains idempotent. Original timestamps, totals, invoice/Sheets formatting, and customer records are unchanged.

New `INV-YYYYMMDD-…` identifiers also use IST from the same database transaction timestamp saved as `created_at`. Existing identifiers, sharing tokens and retry results are preserved. Admin order cards, invoice lists and payment lists display that original timestamp as `Ordered: DD Mon YYYY, hh:mm:ss am/pm IST`, separate from the requested delivery slot. The invoice PDF continues to display the same placement time to the minute; Sheets retains seconds.

## Deploy

No database migration or timezone-setting change is required for this fix. Deploy the backend, then frontend. Test an order near midnight IST in Admin's Day/Week/Month filters. Existing retained orders are grouped correctly immediately by the new UI.

## Historical summaries: review before correcting

Existing `sales_summary` rows are **not** rewritten. They can retain revenue from orders already deleted after syncing to Sheets, so recomputing them solely from the current `orders` table could erase legitimate history.

Use `node-server/audits/sales-summary-ist.sql` in the correct Neon branch's SQL editor for a read-only comparison. It displays discrepancies between stored totals and completed orders still retained, grouped by IST. It is not a migration and does not change data.

- Differences can indicate timezone grouping, deleted orders, imported summaries, or other historical adjustments. They do not prove which explanation applies.
- No differences do not prove complete historical correctness either: offsetting discrepancies are possible.
- Before any historical correction, back up the branch and reconcile with the retained orders, Google Sheet records and available backups. Deleted-order timestamps cannot be reconstructed reliably from daily aggregate totals alone.
- No live database was queried or modified by these changes/tests.
