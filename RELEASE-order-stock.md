# Acceptance stock tracking and pending shortages

## Deploy in this order

1. Back up the Neon branch used by Render's DATABASE_URL. Do not assume it is named production.
2. Against that branch, apply `node-server/order_stock.sql` using the Neon SQL Editor, or `node migrate.js order_stock.sql` from `node-server` with the correct DATABASE_URL. The migration only adds a deduction ledger. It is safe to rerun and changes no existing stock, orders or prices.
3. Deploy the backend, then frontend. No new environment variables are needed. The migration must finish before accepting snack orders with the new backend.
4. Verify Pending warnings, shared fried/frozen stock, acceptance, and completed Sales. Tests in the repository use isolated in-memory databases, not live customer data.

## Rules

- Pending orders never reserve stock. Each warning compares that order's combined fried/frozen requirement to the current shared inventory. It does not allocate stock among other pending orders. Refresh the dashboard after another admin's changes.
- Acceptance locks the order and shared inventory rows, deducting up to the available quantity. Stock never goes negative. Mains are excluded. Pending shortages update after local stock saves and status changes.
- Repeated acceptance requests do not deduct again. A decline or application deletion of a reserved accepted order restores only its recorded deduction. Reopening and accepting a declined order calculates a fresh deduction.
- Completion retains the full quantity, line prices, invoice total and normal completed-only Sales behavior. No second deduction occurs. Deleting a completed order never restores consumed stock.
- Previously accepted orders are not back-deducted on deployment or completion. Pre-existing legacy reservations retain their original restoration behavior.
- The shortage is a production reminder, not an extra charge. Preparing 5 missing items for an accepted order of 15 does not add another 5 to the invoice or Sales.
- Manual stock input remains an absolute count of unallocated stock. Stock prepared specifically to fulfill an already accepted shortage is not deducted again on completion; do not count those committed pieces as free inventory.

## Deletion and recovery

Do not use raw SQL DELETE for an accepted order with stock_reserved=true: it bypasses application restoration. Deleting an order cascades its ledger rows. Keep normal database backups. The ledger is small (one row per snack stock group per accepted order), and QR/payment/customer checkout behavior is unchanged.

## Verification scope

The automated PostgreSQL tests run in PGlite, which uses one database connection. They cover repeated requests, interleaved order lifecycles and transaction rollback, but do not reproduce multiple real PostgreSQL sessions. Production code uses order and inventory row locks in deterministic inventory-key order for concurrency safety.
