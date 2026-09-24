-- Apply once before deploying acceptance stock tracking. Safe to rerun.
-- No existing inventory, order quantities, prices or statuses are changed.
CREATE TABLE IF NOT EXISTS order_stock_deductions (
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  stock_item_id text NOT NULL REFERENCES inventory(menu_item_id),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (order_id, stock_item_id)
);
