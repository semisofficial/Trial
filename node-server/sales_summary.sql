-- sales_summary table (for use with Neon / any PostgreSQL)
-- Run this once in your Neon database if the table wasn't already created.

CREATE TABLE IF NOT EXISTS sales_summary (
  summary_date DATE PRIMARY KEY,
  orders_count INTEGER DEFAULT 0,
  revenue NUMERIC DEFAULT 0
);

-- Add payment tracking to the orders table (run once).
-- payment_status: 'paid' | 'unpaid'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';

-- Payment method chosen at checkout: 'cod' (Cash on Delivery) | 'upi'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paymet TEXT DEFAULT 'cod';

-- Shared, database-backed archive flag. Previously archived orders were kept
-- in each admin browser's localStorage, which diverged across users. Now all
-- admins share the same archive via PostgreSQL.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Requested delivery/pickup date + time slot, chosen by the customer at
-- checkout. delivery_slot stores a slot id like "11-12" meaning
-- 11:00 AM - 12:00 PM (slots run hourly from 11 AM to 9 PM).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_slot TEXT;

-- Inventory is reserved atomically when a new order is created. The flag
-- makes decline/delete restoration idempotent and prevents double-decrements.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_reserved BOOLEAN NOT NULL DEFAULT false;
-- Orders accepted by the previous frontend flow already had stock deducted.
UPDATE orders SET stock_reserved = true WHERE status = 'accepted' AND stock_reserved = false;

-- Separate unguessable capability token for customer-facing invoice links.
-- Admin sessions can still open invoices without putting this token in a URL.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_share_token TEXT;
UPDATE orders
SET invoice_share_token = replace(gen_random_uuid()::text, '-', '')
WHERE invoice_share_token IS NULL;
ALTER TABLE orders ALTER COLUMN invoice_share_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_share_token ON orders (invoice_share_token);

-- Database-level integrity guards. Application validation gives friendly
-- errors; these constraints are the final protection against malformed data.
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_stock_nonnegative;
-- NULL means stock has not been entered yet; it remains unorderable because
-- order validation treats it as zero. The constraint still forbids negatives.
ALTER TABLE inventory ADD CONSTRAINT inventory_stock_nonnegative CHECK (stock IS NULL OR stock >= 0);
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_price_nonnegative;
ALTER TABLE inventory ADD CONSTRAINT inventory_price_nonnegative CHECK (selling_price IS NOT NULL AND selling_price >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_allowed;
ALTER TABLE orders ADD CONSTRAINT orders_status_allowed CHECK (status IS NOT NULL AND status IN ('pending', 'accepted', 'declined', 'completed'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_allowed;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_allowed CHECK (payment_status IS NOT NULL AND payment_status IN ('paid', 'unpaid'));

-- Tracks whether (and when) an order's line items were pushed to the
-- Google Sheet. Previously the sync endpoint re-queried and re-appended
-- every completed order on every click, producing duplicate rows in the
-- sheet on a second sync. Now the sync query only picks up orders where
-- this is still NULL, and sets it once appended. Also used to gate which
-- paid orders are safe to delete from the DB (see the "delete paid+synced
-- invoices" cleanup endpoint) — an order is only deleted once its
-- financial record is confirmed to live on permanently in the sheet.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Remove the table left by the retired SSE notification system. No current
-- application code reads or writes it, and DROP IF EXISTS is safe on fresh DBs.
DROP TABLE IF EXISTS realtime_events;

-- ---------------------------------------------------------------------------
-- Performance indexes (run once on Neon). These speed up the frequent
-- queries used by the app: order listing, payment filtering, and inventory
-- lookups. Indexes become increasingly important as order volume grows and
-- with multiple concurrent users.
-- ---------------------------------------------------------------------------

-- Speeds up the heavy getOrders() query (ORDER BY created_at DESC + status)
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);

-- Speeds up joining order_items -> menu_items in getOrders()
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id ON order_items (menu_item_id);

-- Speeds up menu + inventory lookups
CREATE INDEX IF NOT EXISTS idx_inventory_menu_item_id ON inventory (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items (category_id);

-- Concurrent order inserts: ensures unique order IDs are indexed (already PK,
-- but keeps composite lookups fast when joining by customer)
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
