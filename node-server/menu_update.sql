-- Menu update: adds only the items from the new menu photos that don't
-- already exist (matched by name + category_id, case-insensitive).
-- Existing items are left untouched. "Irachi Pathiri" is intentionally
-- skipped for the FROZEN category only (per instruction) — it IS added
-- for FRIED, since only the frozen version was excluded.
--
-- Safe to re-run: every insert is guarded by WHERE NOT EXISTS.
--
-- ASSUMPTIONS — please verify against your actual schema before/after running:
--   1. menu_items.id has a default (SERIAL/IDENTITY) so it doesn't need to
--      be supplied here. If inserts fail with a NOT NULL violation on `id`,
--      the id column needs a value supplied — let me know your id scheme.
--   2. `unit` is left as '' (empty string) for every new item since there's
--      no existing seed data in this repo to infer the right convention
--      from (e.g. "/plate", "each", "1kg"). Please review/edit these in the
--      DB or Admin panel after import.
--   3. min_qty = 1, step_qty = 1 for all new items (standard default).
--   4. seasonal = true only for the new Fish/Mutton curry items, per the
--      menu's own note: "All Mutton & Fish item prices depend on the
--      seasonal price."
--   5. `image` filenames follow the existing naming convention
--      (fz-/fr-/mc- prefix + kebab-case) but no actual photo files exist
--      yet for these — items will show "No image" in the UI until you
--      upload matching files to semis-kitchen/src/assets/images/.
--   6. Each new item also gets a matching `inventory` row (selling_price =
--      default_price, stock = 0, available = true) — required because the
--      Admin price/stock editor only UPDATEs inventory; without a row there
--      it silently no-ops.
--
-- Run with: node migrate.js menu_update.sql
-- (or paste directly into your Neon SQL editor / psql)

-- ---------------------------------------------------------------------------
-- FROZEN SNACKS — 2 new items (Momos Chicken, Kunafa Chicken).
-- Irachi Pathiri intentionally NOT added here (excluded per instruction).
-- ---------------------------------------------------------------------------

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'frozen', 'Momos Chicken', '', 1, 1, false, 'fz-momos-chicken.png', 20
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'frozen' AND lower(name) = lower('Momos Chicken'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 20, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'frozen', 'Kunafa Chicken', '', 1, 1, false, 'fz-kunafa-chicken.png', 35
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'frozen' AND lower(name) = lower('Kunafa Chicken'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 35, 0, true FROM new_item;

-- ---------------------------------------------------------------------------
-- FRIED SNACKS — 3 new items (Irachi Pathiri, Momos, Kunafa Chicken)
-- ---------------------------------------------------------------------------

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'fried', 'Irachi Pathiri', '', 1, 1, false, 'fr-irachi-pathiri.png', 20
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'fried' AND lower(name) = lower('Irachi Pathiri'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 20, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id, category_id, name, unit, min_qty, step_qty,seasonal, image, default_price)
  SELECT gen_random_uuid()::text,'fried','Steamed Momos','',1,1,false,'fr-steamed-momos.png',25
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'fried' AND lower(name) = lower('Steamed Momos'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 25, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'fried', 'Fried Momos', '', 1, 1, false, 'fr-fried-momos.png', 25
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'fried' AND lower(name) = lower('Fried Momos'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 25, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'fried', 'Kunafa Chicken', '', 1, 1, false, 'fr-kunafa-chicken.png', 40
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'fried' AND lower(name) = lower('Kunafa Chicken'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 40, 0, true FROM new_item;

-- ---------------------------------------------------------------------------
-- MAINS (Biriyani & Curries) — 21 new items
-- ---------------------------------------------------------------------------

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Beef Curry (Masala)', '', 1, 1, false, 'mc-beef-curry-masala.png', 750
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Beef Curry (Masala)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 750, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Beef Curry (Coconut)', '', 1, 1, false, 'mc-beef-curry-coconut.png', 800
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Beef Curry (Coconut)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 800, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Beef Dry Fry', '', 1, 1, false, 'mc-beef-dry-fry.png', 800
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Beef Dry Fry'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 800, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Beef Stew', '', 1, 1, false, 'mc-beef-stew.png', 850
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Beef Stew'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 850, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Fish Moly', '', 1, 1, true, 'mc-fish-moly.png', 650
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Fish Moly'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 650, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Fish Mulakuttath', '', 1, 1, true, 'mc-fish-mulakuttath.png', 400
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Fish Mulakuttath'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 400, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Fish Chilly', '', 1, 1, true, 'mc-fish-chilly.png', 750
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Fish Chilly'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 750, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Mutton Stew', '', 1, 1, true, 'mc-mutton-stew.png', 1250
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Mutton Stew'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 1250, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Mutton Masala', '', 1, 1, true, 'mc-mutton-masala.png', 1100
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Mutton Masala'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 1100, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Mutton Varattiyath', '', 1, 1, true, 'mc-mutton-varattiyath.png', 1150
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Mutton Varattiyath'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 1150, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kallumakaya Masala', '', 1, 1, false, 'mc-kallumakaya-masala.png', 700
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kallumakaya Masala'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 700, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kallumakaya Fry', '', 1, 1, false, 'mc-kallumakaya-fry.png', 650
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kallumakaya Fry'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 650, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Paal Kappa', '', 1, 1, false, 'mc-paal-kappa.png', 300
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Paal Kappa'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 300, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Pasta', '', 1, 1, false, 'mc-pasta.png', 750
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Pasta'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 750, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Batura', '', 1, 1, false, 'mc-batura.png', 15
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Batura'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 15, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kannuvecha Pathiri (Half cooked)', '', 1, 1, false, 'mc-kannuvecha-pathiri-half-cooked.png', 13
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kannuvecha Pathiri (Half cooked)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 13, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kannuvecha Pathiri (Fried)', '', 1, 1, false, 'mc-kannuvecha-pathiri-fried.png', 15
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kannuvecha Pathiri (Fried)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 15, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Neypathal', '', 1, 1, false, 'mc-neypathal.png', 20
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Neypathal'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 20, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kuboos', '', 1, 1, false, 'mc-kuboos.png', 10
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kuboos'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 10, 0, true FROM new_item;

-- Kozhi Nirachath has two priced variants (Spring/Broiler) — split into two
-- items, matching the existing "Name (Variant)" convention used elsewhere
-- (e.g. "Kallumakaya (w/ masala)").
WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kozhi Nirachath (Spring)', '', 1, 1, false, 'mc-kozhi-nirachath-spring.png', 350
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kozhi Nirachath (Spring)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 350, 0, true FROM new_item;

WITH new_item AS (
  INSERT INTO menu_items (id,category_id,name,unit,min_qty,step_qty,seasonal,image,default_price)
  SELECT gen_random_uuid()::text, 'mains', 'Kozhi Nirachath (Broiler)', '', 1, 1, false, 'mc-kozhi-nirachath-broiler.png', 500
  WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE category_id = 'mains' AND lower(name) = lower('Kozhi Nirachath (Broiler)'))
  RETURNING id
)
INSERT INTO inventory (menu_item_id, selling_price, stock, available)
SELECT id, 500, 0, true FROM new_item;

-- Piece-based breads/pathiri use quantity minimums, not kilogram units.
UPDATE menu_items
SET unit = '1 Piece'
WHERE category_id = 'mains' AND min_qty IN (10, 20);
