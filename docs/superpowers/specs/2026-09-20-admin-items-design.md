# Admin Items management design

Status: proposed written design for user review; implementation has not started.

## Agreed intent

Give the client an **Items** entry in the existing admin sidebar to manage menu
names, photos, additions and removals without editing code or redeploying.
The Items interface must not display or edit price or stock. Those remain in
Inventory. New items start hidden and become customer-visible only after the
admin sets a positive price and explicitly enables them in Inventory.

Preserve the existing sidebar, its sign-out action, other sub-tabs, order rules,
shared fried/frozen inventory, QR settings, invoices and integrations.

## UI and workflow

- Add Items to the existing primary sidebar; use the existing mobile drawer.
- Show a searchable, category-filtered list with thumbnail, name, category and
  a Draft/Published status. No price, stock, revenue or inventory inputs.
- Add/edit form: name, category (fried/frozen/mains), unit, minimum quantity,
  quantity increment and a mains-only combo flag. Use existing category IDs.
- Require a nonblank name and unit, finite positive quantities, and a valid
  category. Server generates immutable IDs; do not derive identity from names.
- Upload/replace an optional JPEG or PNG with preview and Save/Cancel. New items
  without a photo show the existing photo placeholder. Existing bundled images
  stay in use until explicitly replaced. Keep the old photo when an upload fails.
- Create the item as a draft first; upload can then be retried independently
  without losing the item or accidentally publishing it.
- Explain draft activation with “Set price and enable this item in Inventory.”
  Drafts must be visible to admins in Inventory, but not on the customer menu or
  slideshow. Customer API responses must not leak draft item records.
- Use a confirmation naming the item before removing it. “Delete” means retire
  it from the active catalogue, not delete its historical identity. No bulk
  delete, permanent purge or restore interface is included in this patch.
- Preserve the Chattipathiri weight selector. Name/photo changes must show for
  its selected variant rather than being overridden by hard-coded display text.
  Adding a general-purpose variant-management system is out of scope.

## Server boundaries

Add an authenticated item-management API, separate from the public menu read.
Its list/create/update responses contain only item-management fields, a revision
and draft state, never prices or inventory counts. Reject price/stock fields in
item-management requests rather than silently ignoring them.

Use existing admin sessions, exact-origin restrictions, generic errors and rate
limits. Reject unknown fields and constrain text lengths and numeric ranges.
Guard updates, photo replacement and retirement with revisions so stale admin
forms cannot silently overwrite another admin's changes. Keep revisions and
updates atomic in PostgreSQL.

Create a menu item and its inventory row in one transaction: zero initial price,
unavailable, and draft. Add explicit draft state rather than treating every
existing unavailable item as a draft. Inventory's enable operation must atomically
verify a positive effective price before clearing draft state. Price entry alone
does not publish. The ordering API must reject draft and retired IDs even if
submitted directly or retained in an old cart.

New snack items have independent inventory identities by default. Preserve all
existing stock-group references; never auto-pair items by their editable names.
Do not add a stock-link editor to this no-stock tab. Retiring a shared-stock
anchor retains its database row so the remaining snack variant still works.
Changing the category of an existing linked snack to mains is rejected until
that relationship can be deliberately handled in a future inventory change.

## Persistent photos and consumption

Use the existing Neon database and Sharp dependency, not Render's ephemeral
filesystem and not a new paid account. Store one replacement photo per item in
a separate table so normal menu queries never select binary data.

Proposed limits:

- JPEG/PNG input, maximum 3 MiB and 12 megapixels; reject animations and SVG.
- Decode, orient, strip metadata and resize inside 960 x 960 without enlarging
  or cropping. Encode WebP with a maximum stored size of 160 KiB. Reject an
  image that cannot meet the bound rather than silently keeping oversized data.
- At most one conversion per backend process; apply authenticated upload rate
  limits. Do not queue unlimited work or load all stored photos into memory.
- One stored image per item, upsert on replacement. Retiring an item removes
  its uploaded photo bytes, but not the item or order records.
- A versioned, same-origin public image URL returned in menu metadata. Do not
  embed base64 images in menu JSON, browser menu caches or invoice records.
- Cache successful images with a bounded browser/CDN lifetime and ETags. An old
  revision URL must not label new bytes as immutable historical content; either
  redirect to the current revision without caching the redirect, or return a
  non-cacheable missing-image response that the UI handles with a placeholder.
- Bound any in-process image cache (maximum 8 MiB); there are no polling timers.

At the maximum stored size, 100 uploaded photos represent about 15.6 MiB of raw
image bytes. This is not a total database usage guarantee: row/index overhead,
PostgreSQL history/WAL/backups, and actual image views add their own consumption.

Teach the existing image resolver to accept only the intended same-origin item
image paths while retaining existing bundled-image mappings. Apply this to menu
cards, slideshow, admin preview and cached menu rendering. Do not allow arbitrary
URL/path input, HTML, SVG or filesystem access through item metadata.

## Preserve historical orders and invoices

Current order, invoice and Sheets queries join `menu_items.name`, so renaming a
menu row would presently change old order descriptions. Address this as part of
the feature, not as an optional later fix.

- Add an order-line name snapshot and backfill existing lines with their current
  menu name before editing is enabled. Prior names already overwritten before
  this migration cannot be reconstructed from the current database alone.
- Capture the server-authoritative name when every new order line is inserted.
  Include compatibility for old backend inserts during the rollout, using a
  database insert trigger to fill missing snapshots.
- Use the saved name in order lists, checkout replays, individual/batch invoices
  and Sheets synchronization. Keep historical prices and totals unchanged.
- Keep the existing foreign-key item identity on retirement; never cascade-delete
  orders or remove customer data as part of item deletion.
- Serialize edits against order creation so each accepted order records a
  consistent name and price. Do not rewrite existing Sheets rows automatically.

## Migration and rollout

Provide one additive, re-runnable `items_management.sql` migration covering draft
state, revision metadata, photo storage and historical name snapshots. Existing
items remain published; existing prices, stock, photos and IDs are preserved.
Do not rerun menu seeding as part of this migration. Test against both the minimal
test schema and the imported named-category schema.

Test only with in-memory/disposable databases during implementation. Do not
read credentials into outputs, apply live migrations, deploy, push or merge as
part of writing this design. Later rollout: verify target branch, backup, apply
migration, deploy backend, then frontend. No new environment secrets are needed.
Document the new photo route and verify the existing `/api/*` rewrite covers it.

## Verification and completion criteria

Backend integration tests must demonstrate:

- Authentication/origin protection and rejection of forbidden fields.
- Draft creation, positive-price activation, public draft exclusion and direct
  checkout rejection for drafts/retired IDs.
- Name edits do not change historical order, invoice, replay or Sheets names.
- Retirement preserves old orders and a shared-stock sibling's operation.
- Valid photo upload/replacement, invalid/oversized image rejection, revision
  conflicts, bounded processing and cache behaviour, and persistence after reload.
- Migration reruns preserve existing data and image records.

Browser tests must demonstrate desktop/mobile sidebar access, no price/stock
fields or values in Items, search/filter, create/edit, upload preview/cancel/save,
clear failures, safe retirement, draft-to-Inventory handoff, customer image/name
refresh, and unchanged existing sub-tabs. Test customer placeholders and the
Chattipathiri selector after name/photo edits.

Run the complete backend suite, frontend tests, lint, production build/SEO checks,
targeted browser regressions and secret guard. Review the completed diff before
reporting readiness. Record any remaining operational steps separately from
implemented/tested behaviour.

## Scope exclusions

No customer redesign, price/stock editor inside Items, image library, multiple
photos per item, arbitrary category creation, automatic fried/frozen pairing,
general variant editor, restored offers feature, or changes to WhatsApp/QR text.

## Design self-review

Checked against the approved scope: prices/stock stay in Inventory; draft
activation is explicit; retired items retain history; photos have persistent
bounded storage; rename protection covers all known order-description consumers;
the release is additive and does not depend on new provider credentials.
