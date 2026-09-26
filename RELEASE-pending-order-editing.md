# Pending-order editing + same-day checkout

## What changed

- Same-day checkout no longer requires three hours of preparation time. A slot is available until its start time; slots that have already started are rejected by both browser and backend validation.
- The existing Sunday restriction for mains-only delivery remains unchanged.
- Pending admin order cards now have an expandable editor. Staff can include/omit lines, omit current shortage groups, change quantities, or swap an item before acceptance.
- `Accept full order` preserves the existing full-order acceptance path.
- `Accept included items` commits edited order lines, the recalculated order total, stock deduction and status change in one database transaction.
- Existing order-line prices are preserved when only quantity/omission is changed. A newly swapped replacement uses its current authoritative selling price.
- Edited acceptance rejects insufficient included fried/frozen stock and rolls back completely, so the invoice, total and inventory cannot be left out of sync.

## Date/time consistency

The existing IST fix is retained: new `INV-YYYYMMDD-…` numbers use the same PostgreSQL transaction timestamp saved in `created_at`, with the invoice date computed in `Asia/Kolkata`. Admin order/payment/invoice views, invoice PDFs and Sheets formatting use that original order-placement timestamp in IST.

## Database/deploy

No new database migration is required for these changes; they use the existing orders, order_items, inventory and order_stock_deductions schema.

Deploy backend first, then frontend. After deployment, verify:

1. An order placed between midnight and 5:30 AM IST gets the current IST date in both its invoice number and admin `Ordered:` timestamp.
2. A same-day slot that has not started is selectable and accepted without a three-hour lead time.
3. In Pending, expand a card, omit/swap/change quantity, then use `Accept included items`; verify total, invoice and inventory.
4. Use `Accept full order` on an untouched order to confirm the existing path still behaves as before.
