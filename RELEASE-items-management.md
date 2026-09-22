# Admin Items release

The Items sidebar section manages names, categories, units, quantity rules and photos. Prices and stock remain in Inventory. New items are hidden drafts until a positive price is saved and the item is explicitly enabled in Inventory. Removing an item retires it without deleting historical orders or shared stock anchors.

## Before deploying

1. Back up the populated Neon branch that the live backend actually uses. Test on a separate branch first; do not choose an empty branch merely because it is named production.
2. From `node-server`, with `DATABASE_URL` pointing to that intended branch, run `node migrate.js items_management.sql`. This release assumes the existing menu and security migrations are already installed. Do not rerun catalog seed/recovery scripts.
3. Confirm `Migration complete: items_management.sql`. The migration is atomic through the runner and rerunnable; it adds tables/columns and snapshots existing order-line names without resetting prices or stock. The compatibility trigger also snapshots orders written by the previous backend during rollout.
4. Deploy the backend, then frontend. No new environment variables or external storage accounts are required. Do not deploy this backend before the migration.
5. Verify admin login, Items search/edit, draft creation, photo replacement, Inventory price/enable, customer ordering, past invoices, WhatsApp sharing and Sheets sync. Test deletion using a disposable item, not a real menu entry.

Historical names already changed before this migration cannot be reconstructed; the migration saves each item's current name for old lines. Future edits preserve the saved invoice names. A code rollback should leave this additive schema in place.

## Upload/storage limits

- JPEG/PNG input only, at most 3 MiB and 12 megapixels, not animated.
- Photos are oriented, stripped of metadata, resized within 960 x 960 without enlargement, and saved as WebP up to 160 KiB. Particularly detailed files may need a smaller source image.
- Only one uploaded image is kept per item; replacing it overwrites the record. Retiring the item removes its uploaded bytes. Neon backup/history retention may temporarily retain older versions.
- 100 maximum-sized uploaded images occupy about 15.6 MiB of image payload, plus database overhead/history. Images are not included in menu JSON. The backend image cache is bounded to 50 images (under 8 MiB), and public images have five-minute browser caching. First/uncached image views still consume database/backend bandwidth.
- Existing bundled images are retained. No existing image library, live database, or deployed service is removed by this patch.

The automated integration tests use isolated in-memory PostgreSQL; they never apply this migration to the live Neon database.
