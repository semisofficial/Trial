# Menu, inventory and 24-hour offers release

The client database has not been changed by this work. Verify the target branch before applying any database command.

## Database and deployment

Use a short maintenance window to prevent the old backend from reserving stock during the transition. Stop the old backend, apply the migration against the intended client database, then deploy the backend followed by the frontend. The migration creates the core schema when empty, but adds only the 13 new dishes, NOT the original catalog. For a realistic test, clone the populated client branch first. Do not select an empty branch simply because it is named production.

From `node-server`, with its `DATABASE_URL` pointing to the intended database:

```sh
node migrate.js menu_offers.sql
```

The runner applies the file in one transaction and rolls back on failure. Test on a disposable branch first. Do not start the new backend against the old schema: this release needs the added menu columns and `offers` table.

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

Minimum increments follow existing conventions: piece items increase by 5, kilogram items by 0.5 kg, and whole-chicken/pack/combo items by 1. New photos show “Photo coming soon”.

The updated Render configuration includes `X-Robots-Tag: noindex, follow` on `/o/*`. Sync the Blueprint configuration, or add that header to the static site manually if its settings are managed in the dashboard.

## Daily use

Inventory is manual and no longer blocks orders or decrements automatically. Matching snacks show the same shared stock value; editing their prices or photos remains independent. Mains and combos have no stock editor.

Mains still need advance ordering. Sunday delivery is blocked for mains-only carts and allowed when the cart includes fried or frozen snacks. Pickup follows the existing advance-order rules.

In Admin → 24-hour offers, choose snacks, each minimum quantity, and its discounted price per piece. Publish starts a fixed 24-hour window and generates a link such as `https://semiskitchen.in/o/Ab12Cd34`. Copy the link for a status/story or share it on WhatsApp. It also appears on the main customer page while active. “Close now” ends it early. Publish a fresh offer for a new weekend.

Offer links now use the current frontend origin, so local and staging links do not accidentally open production. A localhost link is only usable on the same computer; use a staging deployment when another person needs to test it.

Invoice descriptions wrap within their column and continue onto additional template pages when needed. The final total appears on the last page. Google Sheets sync writes customer names/phones as literal text (including leading `=` or `+`); totals remain numeric for spreadsheet sums. Existing sheet formulas are not altered.

Expired pages show an offer-closed message and a regular-menu link. The server rejects expired offer checkouts; orders submitted during the valid offer retain their discounted prices in invoices. Expiry is checked during requests, so no scheduler or database polling process is needed. Offer records are small JSON rows; old links are never reused.

## Verification

`npm test` in `node-server` includes isolated in-memory PostgreSQL migration, stock, order and offer tests. Its test engine is a development dependency and is excluded by Render's `npm ci --omit=dev` build.

Frontend checks: `npm run lint`, `npm run test:checkout`, `npm run test:cart`, `npm run test:time`, `npm run test:seo`.

Optional browser test: run Vite on `127.0.0.1:5174`, install Playwright locally or supply `PLAYWRIGHT_MODULE`, then run `node test/browser-menu-offers.mjs`. All API calls are intercepted with fixtures; no real order is placed.
