# Admin item ordering

## Deploy

1. Back up the live Neon branch. Verify the migration command targets the same branch/database used by Render; do not paste credentials into chat.
2. After the existing `items_management.sql` migration, run from `node-server`:

   ```powershell
   node migrate.js item_ordering.sql
   ```

3. Wait for `Migration complete: item_ordering.sql` before deploying the backend. Deploy the frontend afterward.
4. In Admin → Items, drag a two-line handle within a section. Reload the customer menu and confirm the order. Test on a phone as well.

The additive migration stores one integer position per menu item. It is rerunnable and preserves saved positions; it does not modify stock, prices, photos, orders, or historical invoices. No live migration is applied by the implementation tests.

## Behavior

- Drag with mouse or touch. Near the screen edges the page scrolls while dragging. Escape or a cancelled gesture abandons the move.
- Keyboard users focus a handle and press Up/Down to move one position.
- Saving is automatic on drop; controls are locked during saving. Success/error is shown.
- Ordering stays within fried, frozen, mains, or combos. Combos remain before mains. Chattipathiri weight variants move as a single customer card; each remains individually editable.
- Clear search before reordering, so hidden matches cannot be moved accidentally. Category filtering is supported.
- Paused/draft items retain positions without becoming visible to customers. New items append to their section. Renaming does not move an item; changing section appends it to the new section.
- Stale changes are rejected and the latest list is reloaded instead of overwriting another admin's edits.
- Customers see the order on their next menu refresh (existing visible-page polling runs every 60 seconds).

## Verification

Tests use disposable in-memory PostgreSQL and intercepted browser APIs, never production data. Backend tests cover authorization, malformed payloads, conflicts, section boundaries, grouped weights, unchanged inventory, append/rename behavior, and rerunning the migration.
