-- Apply after items_management.sql, before deploying menu reordering.
-- Additive and rerunnable; no financial, stock, image or order data is changed.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS display_order bigint;
WITH ranked AS (
  SELECT id, category_id, is_combo,
    CASE WHEN id IN ('mc-chattipathiri-1kg','mc-chattipathiri-1-5kg','mc-chattipathiri-2kg')
      THEN 'chattipathiri-weights' ELSE id END AS card,
    row_number() OVER (PARTITION BY category_id,is_combo ORDER BY name,id) AS position
  FROM menu_items
), grouped AS (
  SELECT id, MIN(position) OVER (PARTITION BY category_id,is_combo,card) AS position FROM ranked
)
UPDATE menu_items m SET display_order=g.position FROM grouped g
WHERE m.id=g.id AND m.display_order IS NULL;
ALTER TABLE menu_items ALTER COLUMN display_order SET DEFAULT 2147483647;
ALTER TABLE menu_items ALTER COLUMN display_order SET NOT NULL;
