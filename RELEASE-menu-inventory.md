# Menu and inventory release

The client database has not been changed by this work. Verify the target branch before applying any database command.

## Database and deployment

Use a short maintenance window to prevent the old backend from reserving stock during the transition. Stop the old backend, apply the migration against the intended client database, then deploy the backend followed by the frontend. The migration creates the core schema when empty, but adds only the 13 new dishes, NOT the original catalog. For a realistic test, clone the populated client branch first. Do not select an empty branch simply because it is named production.

From `node-server`, with its `DATABASE_URL` pointing to the intended database:

```sh
node migrate.js menu_offers.sql
```

The runner applies the file in one transaction and rolls back on failure. Test on a disposable branch first. Do not start the new backend against the old schema: this release needs the added menu columns. The historical filename and migration markers are retained so existing deployment instructions and one-time stock adjustments remain compatible. The file no longer creates the retired promotion table.

The migration:

- Adds the requested dishes and three combos without overwriting existing selling prices.
- Keeps Chattipathiri as separate 1 kg, 1.5 kg and 2 kg packs for admin pricing, cart lines and invoices. The customer menu shows one card with weight-selection buttons and a 1 kg default (or the first available weight).
- Hides plain frozen kallumakaya while preserving its row for old invoices.
- Returns outstanding legacy stock reservations to inventory once, then switches to manual counts.
- Groups matching fried/frozen snacks. Fried/steamed momos share the frozen chicken-momo count; fried kallumakaya shares the frozen masala-kallumakaya count.
- Starts each shared count at the largest balance among its variants, rounded down to whole pieces. This avoids adding what may be duplicate production counts. Admin should check these opening balances once after migration.
- On subsequent runs, links newly imported variants to the existing owner without resetting its manual count. Conflicting existing owners cause an error for manual review rather than silently merging counts.
- Adds invoice uniqueness, stock/price/order integrity checks and query indexes to fresh and earlier bootstrapped databases. Existing valid tokens are preserved. Invalid historical data causes rollback; do not delete historical rows to bypass an error.

## Missing local menu/photos: safe test recovery

All existing menu images remain in the frontend assets. A database containing only the 13 new items has no photo references, so the live response replaces the bundled menu with placeholder cards. Clearing browser storage will not restore the missing database rows.

Preferred: create a disposable Neon branch from the populated client branch and use its pooled URL in the local backend. Apply the migration to that test branch. This retains the actual menu, prices and history.

Alternative for an empty/disposable test database with no customers or orders: use the explicit recovery tool. It inserts missing catalog rows from the bundled snapshot, including 58 original photo references. Those prices are TEST defaults, not a verified copy of current client prices. Existing rows, images, prices and shared counts are not overwritten. This tool is never run on startup or during deployment.

From `node-server`, preview only (no database writes):

```sh
node restore-test-menu.js --env=.env
```

It prints a credential-free `HOST:PORT/DATABASE` target. Confirm that hostname belongs to a disposable TEST branch in Neon. Stop the local backend before applying. Then use the exact target printed by the preview:

```sh
node restore-test-menu.js --env=.env --apply --confirm-test-target=HOST:PORT/DATABASE
```

Replace `HOST:PORT/DATABASE`; do not paste a full connection string into a command or chat. You can instead select an ignored `.env.client-test.local` file using `--env=.env.client-test.local`. The tool reads the URL from that selected file, never changes environment files, rejects URL connection-target overrides, refuses production mode and databases with customer/order data, and applies all changes in one transaction. The hostname confirmation is a human safety check, not automatic proof that a Neon branch is non-production. Restart the backend using the same verified test URL, then refresh the customer page.

Minimum increments follow existing conventions: piece items increase by 5, kilogram items by 0.5 kg, and whole-chicken/pack/combo items by 1. The frontend bundles the new dish and combo photos without requiring image database changes.

## Daily use

Inventory is manual and no longer blocks orders or decrements automatically. Matching snacks show the same shared stock value; editing their prices or photos remains independent. Mains and combos have no stock editor.

Mains still need advance ordering. Sunday delivery is blocked for mains-only carts and allowed when the cart includes fried or frozen snacks. Pickup follows the existing advance-order rules.

Invoice descriptions wrap within their column and continue onto additional template pages when needed. The final total appears on the last page. Google Sheets sync writes customer names/phones as literal text (including leading `=` or `+`); totals remain numeric for spreadsheet sums. Existing sheet formulas are not altered.

## Retired promotions: deployment and optional cleanup

The 24-hour promotion feature has been removed. Admin publishing, customer promotional pages, countdowns, listing requests and discounted checkout are no longer available. Regular combos, menu prices and shared manual inventory are unchanged.

The sequence below assumes the existing menu/inventory migration and security release are already deployed. Do not rerun the earlier menu migration solely to remove promotions. For an older deployment still missing checkout identifiers or database-backed sessions, complete `SECURITY-RELEASE.md` first; its frontend-first sequence applies to that earlier upgrade, not this removal.

1. Deploy the new backend first, then the frontend. This stops new promotional purchases immediately; already-open old promotional checkouts receive a refresh/regular-menu message, never silently pay a different price. Normal checkout continues to work.
2. Sync the Render Blueprint redirect `/o/*` → `/` (or add it in the static site's Redirects/Rewrites settings before the SPA fallback). The frontend also redirects old short links locally. Remove the obsolete `/o/*` noindex header if it remains in dashboard-managed settings.
3. Check regular customer checkout, admin login/inventory, combos, invoices and old short links. Previously saved order totals and invoice line prices remain intact. The old checkout hash format is intentionally retained for safe retries, not new promotional purchases.
4. Optional, only after **both deployments** and a verified backup: select the correct populated Neon branch privately, then run `node migrate.js remove_24_hour_offers.sql` from `node-server`. This permanently removes promotion definitions and their index, not orders, customers, menu items or invoice prices. It is not run automatically and is not required for the site to work. It uses no `CASCADE` and aborts on unexpected dependencies or lock timeout. Restore definitions from your backup if needed; do not roll back to code that needs the dropped table without restoring its schema first.

No live database changes or deployment are performed by the local removal task.

## Verification

`npm test` in `node-server` includes isolated in-memory PostgreSQL migration, stock, order and retirement-safety tests. Its test engine is a development dependency and is excluded by Render's `npm ci --omit=dev` build.

Frontend checks: `npm run lint`, `npm run test:checkout`, `npm run test:cart`, `npm run test:time`, `npm run test:seo`.

Optional browser test: run Vite on `127.0.0.1:5174`, install Playwright locally or supply `PLAYWRIGHT_MODULE`, then run `node test/browser-menu-inventory.mjs`. All API calls are intercepted with fixtures; no real order is placed.
