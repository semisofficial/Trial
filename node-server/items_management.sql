-- Additive, re-runnable. Apply before deploying Items management.
-- Existing menu IDs, prices, stock and original image paths are unchanged.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS item_revision uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS item_photos (
  menu_item_id text PRIMARY KEY REFERENCES menu_items(id),
  revision uuid NOT NULL DEFAULT gen_random_uuid(),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 163840)
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_name_snapshot text;
CREATE OR REPLACE FUNCTION capture_order_item_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_name_snapshot IS NULL THEN
    SELECT name INTO NEW.item_name_snapshot FROM menu_items WHERE id = NEW.menu_item_id FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capture_order_item_name ON order_items;
CREATE TRIGGER capture_order_item_name BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION capture_order_item_name();
UPDATE order_items oi SET item_name_snapshot = m.name FROM menu_items m
  WHERE oi.menu_item_id = m.id AND oi.item_name_snapshot IS NULL;
ALTER TABLE order_items ALTER COLUMN item_name_snapshot SET NOT NULL;
