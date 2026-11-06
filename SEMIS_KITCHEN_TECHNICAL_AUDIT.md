# Semis Kitchen — Technical Audit

Audit date: 2026-11-06 · Branch: `codex/render-migration` @ `83a8dad` (+ staged, uncommitted Fried/Frozen badge and swap-grouping changes from earlier in this session).

**Scope note:** You asked that no code be changed without your approval. This audit changed **no application code, tests, SQL or configuration**. Every "Fix" below is a *proposed* fix awaiting your approval. Verification of suspected defects used throw-away probe tests run from a scratch folder outside the repository, against an in-memory PGlite database. No real database, WhatsApp, email, Google Sheets or payment service was contacted.

---

## Repair log — 2026-11-06 (approved by owner)

Owner decisions:
1. Sales uses the permanent daily totals.
2. A normal Accept with too little stock stays as it is (SK-03).
3. Only paid invoices are synced to the Google Sheet.
4. No rounding change (SK-08).
5. Sales keep the placement date; no `completed_at` column (SK-10).

On wrong orders: the single "Delete completed order" removes the order from the daily total and leaves stock unchanged. Accepted orders get a Decline button.

| ID | Status | What changed | Verified by |
|---|---|---|---|
| SK-01 | **Fixed** | The Sales tab's Orders, Revenue and By day / By week figures come from `GET /api/sales/summary` through the new `src/lib/salesSummary.js`. A note says Paid / Unpaid / Items sold cover only orders not yet deleted. `getSalesSummary` returns `YYYY-MM-DD` text, so no timezone can shift a day. | `node-server/test/sales-summary.test.js`, `semis-kitchen/test/sales-summary.test.mjs` |
| SK-02 | **Fixed** | Single "Delete completed order" is now the *wrong-order* action. It subtracts the order from that IST day's `sales_summary` (never below 0) and leaves stock alone, and its confirmation text is accurate. Bulk "Delete paid & synced" keeps the totals and now says so; it also refreshes the active order list. | backend tests: subtract-one-day, keep-stock, bulk-keeps-totals |
| SK-03 | **Kept by decision** | No change. | — |
| SK-04 | **Fixed** | Inventory tab text now describes deduct-on-accept and restore-on-decline. | review |
| SK-05 | **Fixed (by policy)** | `COMPLETED_ORDERS_QUERY` selects only `payment_status='paid'` orders, so every sheet row is a settled sale and bulk delete never removes an unsynced order. The sheet layout is unchanged. | backend test: paid-only sync |
| SK-06 | **Fixed** | After the first successful load, a failed background refresh keeps the last menu and cart. A paused or removed cart item now shows "no longer available and won't be included" in the cart and at checkout. | lint/build; browser NOT TESTED |
| SK-07 | **Fixed (high)** | `npm audit fix` in both packages. The `body-parser`, `ip-address`, `brace-expansion`, `vite`, `source-map-js` and `sharp` patch updates are in the lockfiles only. Remaining: moderate `glob`/`minimatch` (archiver/eslint dependencies), which need `--force` major bumps and were left. | `npm audit`, full test suite, build |
| SK-08 | **Kept by decision** | No change. | — |
| SK-09 | **Fixed** | Payment status changes only for accepted or completed orders; otherwise HTTP 409. | backend test |
| SK-10 | **Kept by decision** | Placement date retained. | — |
| SK-11 | **Fixed** | Cart quantities are rounded to 3 decimals, like the server. | lint/build |
| SK-12 | **Fixed** | The payment toggle ignores taps while a request for that order is in flight. | lint/build; browser NOT TESTED |
| SK-13 | Open | WhatsApp is still disabled; verify the Graph API version and templates before enabling. | — |
| SK-14 | Open | Owner action: rotate that local password if it is reused. | — |
| SK-15 | **Fixed** | Removed unused `upsertSummary`. `fetchSalesSummary` is now used. Corrected the sync and delete comments. `sendWhatsAppText` is kept as part of the retained integration. | lint/tests |
| New | **Added** | A Decline button (with confirmation) on accepted orders. It uses the existing server transition, so stock is restored and no sale is recorded. | backend test: decline restores stock, no sales |

Results after repair: backend **89/89** tests pass, frontend unit tests **15/15**, ESLint clean, production build OK, SEO contract OK. `test/browser-ist-admin.mjs` now mocks `/api/sales/summary`, but it was NOT RUN because Playwright isn't installed.

**Visible effect after deploying:** past days on the Sales tab may show *higher* numbers than before. That is the deleted orders' sales reappearing from the permanent totals. To preview the differences, run the read-only `node-server/audits/sales-summary-ist.sql`. No database migration is needed for these changes.

---

## A. Executive summary

| | |
|---|---|
| Overall technical condition | **Good.** Server-side pricing, transactional order/stock logic, idempotent checkout, session auth and invoice privacy are carefully built and well tested (83 backend tests). |
| Overall functional condition | **Mostly correct**, with real gaps in *sales reporting after deletions*, *stock handling on a normal Accept*, and a *misleading delete confirmation*. |
| Critical findings | None. No exposed production secrets, no auth bypass, no incorrect price calculation found. |
| Confirmed issues | **15** (3 High, 4 Medium, 8 Low) plus 4 informational notes |
| Repaired | **10** (see Repair log); 3 kept unchanged by owner decision (SK-03, SK-08, SK-10) |
| Unresolved | 2 (SK-13 WhatsApp re-validation, SK-14 history password), plus moderate build-time advisories |
| Main production risks | Sales history silently shrinking when orders are deleted (SK-01/02); stock reaching 0 without warning when an order is accepted without enough stock (SK-03); one high-severity production dependency advisory (SK-07). |

There is no tax, discount, coupon, delivery fee, packaging charge, add-on or partial-payment logic anywhere in the code. The audit therefore checks only what exists: **unit price × quantity**, order total, paid/unpaid status and sales aggregation. No tax or fee rules were invented.

---

## B. Architecture assessment

**Frontend:** `semis-kitchen/` uses React 19, Vite 8 and Tailwind 4, and is deployed as a Render static site.
- `main.jsx` is the router. Its routes are `/` (customer `App.jsx`), `/privacy`, `/terms` and `/nashi` (the lazily loaded `Admin.jsx`).
- `lib/kitchen.jsx` holds the API client, the order mapper, formatting helpers and the WhatsApp `wa.me` share links.
- State is local React state. There is no global store. Browser storage is not used for business data: archives moved to the database.

**Backend:** `node-server/` uses Express 5 and `pg` against Neon Postgres, and is deployed as a Render web service in Singapore.
- Code is split into routes, controllers and models.
- Auth is a single admin password. It creates a random session token, and only its SHA-256 hash is stored in `admin_sessions`. The cookie is HttpOnly, SameSite=Lax and Secure in production.
- Rate limits are per IP and kept in memory.

**Data flow:**
1. **Checkout:** the customer's cart sends only `{id, qty}` to `POST /api/orders`. The server re-prices from `inventory.selling_price` under `FOR SHARE` locks, validates quantity rules, date, slot and the Sunday rule, then inserts the customer, the order and the line items in one transaction. It is idempotent via a UUID `Idempotency-Key`. The admin is then emailed through Resend, with a rate budget.
2. **Admin status change** (`PUT /orders/:id/status`) runs under a row lock. Accept deducts fried/frozen stock and records the deduction per order. Decline restores the recorded amounts. Complete adds the order to `sales_summary`.
3. **Invoice:** a PDF is generated on demand from the order rows (`pdf-lib` + template). It is available to customers through a capability token (`invoice_share_token`) or to an admin session.
4. **Sales tab:** this is computed in the browser from the active and archived orders, *not* from `sales_summary` (see SK-01).
5. **Sheets sync:** appends one row per completed order, then sets `synced_at`.

**Integrations:**
- Resend (admin email): active.
- Google Sheets: manual sync.
- Meta WhatsApp Cloud API: code is present but **disabled** (`WHATSAPP_NOTIFICATIONS_ENABLED=false`). Customer messages are actually sent manually through `wa.me` links that the admin clicks.
- OpenStreetMap tiles and Nominatim: delivery map.

**Persistence:**
- Postgres with numeric money columns.
- Foreign keys: `order_items → orders ON DELETE CASCADE` and `order_items → menu_items` (no cascade, so menu items are only ever retired).
- CHECK constraints on status, payment status, non-negative stock, price and total.
- Migrations are hand-run SQL files with no applied-migrations ledger, apart from one `app_migrations` row used by `menu_offers.sql`.

---

## C. Bug register

Severity reflects business impact on the live shop. "Probe" means it was reproduced by a scratch test against an in-memory database.

### SK-01 · High · Financial/Data — Sales tab loses history when orders are deleted
- **File:** `semis-kitchen/src/Admin.jsx`; `lib/kitchen.jsx`
- **Location:** Sales view, `const sold = allInvoiceOrders.filter(...)` (~L1385). `fetchSalesSummary` (~L533) is never called.
- **Problem:** Revenue, order count, paid/unpaid totals and the by-day/by-week breakdown are all recomputed from orders still in the database. Both deletion actions remove orders:
  - "Delete completed order" (`DELETE /orders/:id/completed`)
  - "Delete paid + synced orders" (`DELETE /orders/paid-synced`)

  After either one, past days' sales drop on the Sales tab. Meanwhile the server's `sales_summary` table keeps the correct totals but is never displayed. The two sources disagree permanently.
- **Reproduction:** Probe 4. Complete an order worth ₹200, then delete it. `sales_summary` stays at ₹200, but zero completed orders remain for the Sales tab to count.
- **Root cause:** Two independent sources for the same metric. The Sales UI uses the deletable one.
- **Proposed fix (needs your decision):**
  - (a) Show revenue and order counts from `sales_summary` (already correct, never decremented), and keep the per-order lists for paid/unpaid and items sold; **or**
  - (b) Stop offering hard deletes for completed orders and use the existing archive instead.

  Paid/Unpaid and "items sold" cannot come from `sales_summary`, which has no such columns. Option (a) needs either new columns or a label saying those figures cover retained orders only.
- **Verification:** Probe 4 (before). After the fix: a new test showing that a completed-then-deleted order still counts in Sales.

### SK-02 · High · Data/Functional — Delete-completed confirmation is factually wrong
- **File:** `semis-kitchen/src/Admin.jsx` ~L386–391
- **Problem:** The dialog says *"The invoice, payment record, and sales summary are not affected."* In reality:
  - The invoice link the customer received starts returning **404**. The invoice is generated from the order row, which has been deleted.
  - The payment status is deleted along with the order.
  - The Sales tab drops the order (SK-01).

  Only the hidden `sales_summary` row survives.
- **Reproduction:** Probe 4. `SINGLE_ORDER_QUERY` returns 1 row before the delete and 0 after.
- **Root cause:** The text describes the intended behaviour, not the actual behaviour.
- **Proposed fix:** Correct the wording ("The customer's invoice link will stop working and this order will no longer appear in Sales or Payments"). Or adopt option (b) of SK-01.
- **Verification:** Text review, plus Probe 4.

### SK-03 · High · Inventory — A normal Accept silently under-deducts stock
- **File:** `node-server/models/orderStock.js`, `deduct()`
- **Location:** `Math.min(Math.max(stock,0), required)`
- **Problem:** A pending order for 10 pieces with only 4 in stock can be accepted with the regular **Accept** button. It succeeds, stock drops to 0, only 4 are recorded as deducted, and nothing tells the admin that 6 were never covered. The "Accept included items" path *does* block shortages, so the two Accept buttons behave differently.
- **Reproduction:** Probe 1 gives `{status:'accepted', stockAfter:0, recordedDeduction:4, ordered:10}`. After a decline, stock correctly returns to 4.
- **Root cause:** Deliberate ("keeps its historical behavior"), because `inventory.stock` has a `>= 0` CHECK constraint. Stock is therefore clamped instead of the shortage being reported.
- **Mitigation already present:** pending cards show a shortage panel before Accept.
- **Proposed fix (business decision):**
  - (a) Block a normal Accept when there is a shortage, the same as edited Accept; **or**
  - (b) Allow it but return and display a warning ("6 Chicken Roll not covered by stock"); **or**
  - (c) Keep the current behaviour and document it.
- **Verification:** Probe 1.

### SK-04 · Medium · UI/Inventory — Inventory tab text contradicts actual behaviour
- **File:** `semis-kitchen/src/Admin.jsx` ~L1379
- **Problem:** The text says *"Orders do not reduce or restrict it."* Since commit `01b5738` ("inventory deduction"), accepting an order **does** reduce stock, and declining restores it.
- **Proposed fix:** Reword to "Accepting an order deducts fried/frozen stock; declining it restores the deducted amount."
- **Verification:** Code trace, plus Probes 1 and 6.

### SK-05 · Medium · Data — The Google Sheet is treated as the durable record but lacks payment status and items
- **File:** `node-server/utils/googleSheetsSync.js` (values row); `controllers/orderController.js` `deletePaidSyncedOrders`
- **Problem:**
  - The sheet row contains only `invoice_id, order_id, created_at, name, phone, total, payment_method`. There is **no payment status and no line items**, even though comments in `invoiceController.js` and `invoiceQueries.js` say it "pushes line items".
  - Rows are appended once and never updated. An order synced while unpaid and paid later never shows as paid in the sheet.
  - "Delete paid+synced" then removes the database copy, so the paid flag and line items are permanently lost.
- **Proposed fix:** Add a `payment_status` column, and optionally an items summary column. When deleting, either re-sync payment status first or require the order to have been paid at sync time. This needs your decision on the sheet layout, because existing sheet columns would shift.
- **Verification:** Code review. Not run against a real sheet: NOT TESTED.

### SK-06 · Medium · Customer — Cart lines vanish on a menu refresh failure or when an item is paused
- **File:** `semis-kitchen/src/App.jsx` ~L190–196 (`cartLines` filter), ~L859–864 (refresh `catch`)
- **Problem:** The menu reloads every 60 s and whenever the window regains focus.
  - If one refresh fails (a brief network blip or Neon waking up), `setMenu([])` hides the **entire cart**: total ₹0, empty list. The cart comes back on the next successful refresh.
  - If the kitchen pauses an item while it is in a customer's cart, the line silently disappears and checkout submits the order **without it**, with no notice to the customer.
  - Each refresh also briefly sets `liveReady=false`, so a submit at that moment shows "Please wait…".
- **Root cause:** Cart lines are derived only from the current menu. A failed refresh replaces the last good menu with an empty one.
- **Proposed fix:** Keep the last good menu when a refresh fails, and show a notice like "X is no longer available and was removed from your cart" when a cart item disappears.
- **Verification:** Code trace. Browser reproduction NOT TESTED.

### SK-07 · Medium · Security — Vulnerable dependencies
- **Files:** `node-server/package-lock.json`, `semis-kitchen/package-lock.json`
- **Problem (`npm audit`):**
  - **Production backend:** `body-parser` 2.0.0–2.3.0 is **High** (DoS via trailing bytes after a compressed body, GHSA-27r3-jxmh-p828). The app uses `express.json()` with inflation enabled. Also `ip-address` (moderate) and `brace-expansion`/`glob` (archiver dependencies).
  - **Frontend (build/dev only):** `vite` 8.2.0–8.2.2 (dev-server issue on Windows), `source-map-js`, `brace-expansion`, `minimatch`. These don't ship to customers.
- **Proposed fix:** `npm audit fix` in both folders (no `--force`), then rerun all tests and the build.
- **Verification:** `npm audit` output, 2026-11-06.

### SK-08 · Low · Financial — Totals use floating point and are stored unrounded
- **Files:**
  - `node-server/models/orderModel.js`: `insertOrder` and `replaceOrderItems` total = Σ qty×price in JS floats
  - `semis-kitchen/src/lib/kitchen.jsx`: `rupee()` (`toLocaleString`, up to 3 decimals)
  - `utils/invoiceGenerator.js`: `money()` (`toFixed(2)`)
- **Problem:** With a decimal price, e.g. ₹333.33 × 1.5 kg:
  - The database stores `499.995`.
  - The admin and cart show "₹499.995".
  - The invoice PDF shows "500.00".
  - The sheet receives 499.995.
- **Reproduction:** Probe 2.
- **Current exposure:** none. All current prices are whole rupees and quantity steps are 1 or 0.5, which are exact in binary. The admin price editor accepts 2 decimals, though, so this becomes reachable.
- **Proposed fix:** Round each line subtotal and the total to paise on the server (integer paise, or SQL `round(qty*price, 2)`), and format `rupee()` to at most 2 decimals. The rounding rule (half-up per line, then sum) needs your confirmation.

### SK-09 · Low · Data — Payment status can be set on pending or declined orders
- **File:** `node-server/controllers/orderController.js` `updatePaymentStatus`; `models/orderModel.js`
- **Problem:** The API accepts `paid` for any status. Probe 3 gives `{status:'declined', payment_status:'paid'}`. The UI only shows the toggle on Accepted orders, so this is reachable only through the API or a stale tab.
- **Proposed fix:** Allow payment changes only for accepted or completed orders (HTTP 409 otherwise).

### SK-10 · Low · Financial (needs a business rule) — Sales are dated by order placement, not completion or delivery
- **Files:** `orderModel.updateOrderStatus` (sales_summary insert uses `created_at`); `Admin.jsx` `inRange`/`groupSold` (use `createdAt`)
- **Problem:** An order placed on 27 Oct and completed on 6 Nov counts as 27 Oct revenue (Probe 5). The client and server agree with each other, so this is consistent, but it may not be what you want for orders taken up to 90 days in advance.
- **Question for you:** Should "sales on a day" mean placed, delivered (`delivery_date`) or completed?

### SK-11 · Low · Functional — Quantity precision differs between customer and server
- **File:** `semis-kitchen/src/App.jsx` L175, L184 round to **2** decimals. The server and admin editor use **3**.
- **Impact:** None with current steps (0.5, 1, 5). A future 0.125 kg step would be rounded to 0.13 and rejected by the server.
- **Proposed fix:** Use 3 decimals everywhere.

### SK-12 · Low · Functional — Payment toggle has no in-flight guard
- **File:** `semis-kitchen/src/Admin.jsx` `togglePayment` (~L292)
- **Problem:** The next value is computed from the current local state. A fast double-tap can send `paid` then `unpaid`, ending unpaid. Plausible from the code; not reproduced in a browser.
- **Proposed fix:** Ignore taps while a request for that order is in flight.

### SK-13 · Low · Integration — WhatsApp Cloud API code needs re-validation before it is enabled
- **File:** `node-server/utils/whatsappNotify.js`
- **Findings:**
  - Graph API version is hard-coded to `v21.0`. Meta retires versions roughly two years after release, so check that it is still supported before enabling.
  - The order total is sent unformatted (e.g. `1250.5`).
  - Template language `en_US` must exactly match the approved templates.
  - A failed API call never fails the order (good).
  - The token stays server-side and is never in a `VITE_` variable (good).
  - Duplicate sends are prevented by the `previousStatus` check (good).
  - `sendWhatsAppText` is unused.
- **Status:** the integration is disabled in production. Live behaviour is NOT TESTED; no messages were sent.

### SK-14 · Low · Security — Old commit contains a `.env`
- **Location:** `d12e8cc` (initial commit) added `node-server/.env`; `c9e1048` untracked it.
- **Content:** keys only checked, no values printed: `DB_HOST` (9 characters, consistent with `localhost`), `DB_PASSWORD` (5 characters). There is no Neon URL, API key or private key anywhere in the history (searched).
- **Risk:** If the GitHub repository is public and that local password is reused anywhere, rotate it.

### SK-15 · Low · Code quality — Dead or misleading code
- `salesModel.upsertSummary` and `salesController.upsertSummary`: unused.
- `fetchSalesSummary`: unused (see SK-01).
- `sendWhatsAppText`: unused.
- Comments in `invoiceController.js` and `invoiceQueries.js` say the sheet sync pushes "line items". It pushes one row per order.
- `deleteCompletedOrder`'s inline comment repeats the incorrect "not affected" claim from SK-02.

### Informational (not defects)
- **I-1:** Single shared admin password; no per-person accounts or audit log of who accepted, deleted or marked paid.
- **I-2:** Rate limits are in memory. They are correct only while the API runs as one instance, which is the current Render plan.
- **I-3:** The database column is spelt `paymet`. It is used consistently, so renaming it is not worth the migration risk.
- **I-4:** Migrations are run by hand, with no record of which files have been applied. The `RELEASE-*.md` files act as the runbook.

---

## D. Financial verification

| Formula | Where computed | Expected | Observed | Verdict |
|---|---|---|---|---|
| Line subtotal = unit price × qty | Server `insertOrder` (authoritative); cart `l.qty*l.price`; admin edit draft | 20 × 10 = 200; 100 × 2 = 200 | Same (backend tests + probes) | ✅ Correct |
| Order total = Σ line subtotals | Server only. The client never sends prices or totals; the server re-prices from `inventory.selling_price` | Σ lines | Matches line sum (`admin-order-edit` test: total 80 = 4 × 20) | ✅ Correct |
| Price used for a new order | Live `selling_price` at checkout, under lock | Current price | ✅. A stale tab cannot order at an old price; the server re-prices | ✅ |
| Edited order: existing line price | Original `unit_price` kept; a swapped-in item uses the current price | As designed | ✅ (existing tests) | ✅ |
| Quantity rule | qty ≥ min and (qty − min) a multiple of step | e.g. min 25, step 5: 30 ok, 27 rejected | ✅ server-enforced | ✅ |
| Duplicate cart lines | Aggregated per item before the 10,000 cap | | ✅ | ✅ |
| Invalid inputs | qty ≤ 0, NaN, Infinity, > 10,000, unknown or retired item, empty cart, > 100 lines | Rejected | ✅ `normalizeRequestedItems` / `priceItems` | ✅ |
| Invoice total | `orders.total`, lines from `order_items` snapshot | Same as order | Same source rows | ✅ |
| Rounding | No explicit rounding; floats stored as numeric | Paise (2 dp) | 333.33 × 1.5 → stored 499.995, invoice "500.00", admin "₹499.995" | ⚠️ SK-08 (not currently reachable) |
| Taxes, discounts, fees, add-ons | Not implemented anywhere | — | — | N/A. No rules exist; none invented |
| Revenue (sales_summary) | +total once, on the transition to completed | Counted once | Double "complete" → +1 order only (Probe 7) | ✅ |
| Revenue (Sales tab) | Σ total of completed orders still in the database, within range | Should equal `sales_summary` | Drops after deletes (Probe 4) | ❌ SK-01 |
| Declined orders in revenue | Excluded (status filter) | Excluded | ✅ | ✅ |
| Paid vs unpaid | Σ of completed orders by `payment_status` | Paid + Unpaid = Revenue | Holds by construction (same `sold` set, disjoint filters) | ✅ (subject to SK-01) |
| Day/week/month bounds | `indiaRangeBounds`: IST midnight, Monday week start, calendar month | IST | Verified by code reading; existing `india-time` / `ist-sales` tests pass | ✅ |
| Date sales are attributed to | Placement date (`created_at`) | Business rule unclear | Placed 27 Oct, completed 6 Nov → 27 Oct (Probe 5) | ❓ SK-10 |

---

## E. Security findings

| Area | Finding |
|---|---|
| Admin authorization | ✅ Every admin route is protected server-side by `requireAdmin`; hiding `/nashi` is not the protection. Sessions are random 256-bit tokens with only the hash stored, a 12 h expiry, revocation on logout and invalidation when the password or secret changes. Login: 5 attempts per 15 min per IP, constant-time compare. |
| CSRF | ✅ SameSite=Lax cookie, CORS restricted to an exact origin allow-list, JSON-only bodies. |
| Invoice links | ✅ 192-bit capability token; `no-store`, `no-referrer`, `noindex`. Links are not revocable once shared (accepted design). |
| XSS / injection | ✅ No `dangerouslySetInnerHTML`; the invoice HTML page escapes output; all SQL is parameterised; the migration runner only accepts `.sql` files inside `node-server/`. |
| Uploads | ✅ Item photos: admin only, PNG/JPEG magic-byte check, 3 MB / 12 MP limit, re-encoded to WebP by sharp, one conversion at a time. |
| Secrets | ✅ No secrets in frontend code or `VITE_*`. The WhatsApp token, Resend key and Google key are server-only. `scripts/check-secrets.cjs`: 0 findings. ⚠️ An old local-dev `.env` is in git history (SK-14). |
| Headers | ✅ Helmet on the API; strict CSP, X-Frame-Options DENY and nosniff on the static site. |
| Dependencies | ⚠️ SK-07 (`body-parser` high in production). |
| Logging | Customer names and phones are not logged; order IDs are. Acceptable. |
| Remaining risk | Shared password with no audit trail (I-1). |

This review found no exploitable vulnerability beyond SK-07, but that is not proof the application is secure.

---

## F. Testing results

| Test | Initial result | Final result |
|---|---|---|
| Application startup | NOT TESTED (you asked to run servers yourself) | NOT TESTED |
| Production build (`vite build`) | PASS | PASS (no code changed) |
| Lint (`eslint`) | PASS, 0 problems | PASS |
| Type checking | N/A (plain JS, none configured) | N/A |
| Backend unit + integration (`node --test`, PGlite) | PASS 83/83 | PASS 83/83 |
| Frontend unit (`test/*.test.mjs`) | PASS 11/11 | PASS 11/11 |
| Frontend browser tests (`test/browser-*.mjs`) | NOT TESTED (need running servers and a browser) | NOT TESTED |
| Audit probes (scratch, in-memory DB) | 7 run: confirmed SK-01, 02, 03, 08, 09, 10; confirmed idempotent accept/decline/complete (Probes 6, 7) | — |
| Customer ordering (server path) | PASS (existing checkout/security tests) | PASS |
| Customer ordering (browser UI) | NOT TESTED | NOT TESTED |
| Admin workflows (server path) | PASS (status transitions, edit-accept, delete guards) | PASS |
| Admin workflows (browser UI) | NOT TESTED | NOT TESTED |
| Invoice calculations | PASS (totals from the same rows); rounding caveat SK-08 | — |
| Inventory | Deduct/restore correct and idempotent; SK-03 under-deduction confirmed | — |
| Sales reporting | `sales_summary` correct; Sales tab inconsistent after deletes (SK-01) | — |
| WhatsApp integration | NOT TESTED (disabled; no live messages sent) | NOT TESTED |
| Google Sheets / Resend live | NOT TESTED (no credentials used) | NOT TESTED |
| Mobile responsiveness | NOT TESTED | NOT TESTED |
| `npm audit` | Backend: 1 high (prod) + moderate; frontend: build-time highs | Unchanged |

---

## G. Files modified

During the audit itself, only this report was written. The approved repairs then changed the following files:

**Backend**
- `node-server/models/orderModel.js`: payment-status guard; mistaken-completed delete subtracts from `sales_summary`.
- `node-server/controllers/orderController.js`: 409 for a payment change on an invalid status; corrected comments.
- `node-server/models/salesModel.js`, `controllers/salesController.js`: summary dates returned as text; unused `upsertSummary` removed.
- `node-server/utils/invoiceQueries.js`, `controllers/invoiceController.js`: paid-only sheet sync; corrected comments.
- `node-server/test/sales-summary.test.js` (new): tests for these changes. `node-server/test/items-management.test.js` now marks its order paid before checking the sync query.

**Frontend**
- `semis-kitchen/src/lib/salesSummary.js` (new): range and grouping of daily totals.
- `semis-kitchen/src/Admin.jsx`: Sales from daily totals; Decline on accepted orders; accurate delete and inventory texts; payment double-tap guard; bulk delete refreshes the active list.
- `semis-kitchen/src/App.jsx`: keep the menu on refresh failure; removed-item notice; 3-decimal cart quantities.
- `semis-kitchen/test/sales-summary.test.mjs` (new). `semis-kitchen/test/browser-ist-admin.mjs` now mocks the summary endpoint.

**Dependencies**
- `node-server/package-lock.json`, `semis-kitchen/package-lock.json`: `npm audit fix` (patch/minor only).

Already staged from earlier in this session (approved feature work, not part of the audit):
- `node-server/models/orderModel.js`: order items now include `category`.
- `node-server/test/admin-order-edit.test.js`: test for the category.
- `semis-kitchen/src/lib/kitchen.jsx`: `SnackTypeBadge` and the `category` mapping.
- `semis-kitchen/src/Admin.jsx`: Fried/Frozen badges and Swap list grouped by category.

---

## H. Remaining issues / decisions needed from you

1. **SK-01:** Should Sales show the permanent `sales_summary` totals, or should completed orders stop being hard-deletable?
2. **SK-03:** Should a normal Accept with insufficient stock be blocked, warned about, or left as is?
3. **SK-05:** May the Google Sheet layout gain a `payment_status` column (and items)?
4. **SK-08:** Confirm rounding to paise (half-up per line).
5. **SK-10:** Should a sale belong to the placed, delivery or completed date?
6. Straightforward once you approve: SK-02 and SK-04 (wording), SK-06, SK-07 (`npm audit fix`), SK-09, SK-11, SK-12, SK-15.
7. **Manual checks needed:** browser/mobile walkthrough, the `browser-*.mjs` suites, and confirming the WhatsApp Graph version and templates before enabling them.

---

## I. Production readiness

*Update after the repairs:* the SK-01, SK-02 and SK-07 conditions below are resolved, and SK-03 is accepted as is. What remains is the manual browser and mobile check of the changed screens before deploying.

**Conditionally ready** (it is already live). The core money path is sound and well tested: the server re-prices every order, checkout is idempotent and transactional, and admin access is enforced server-side. No critical defect was found.

The conditions are:
- Fix SK-02's misleading text **before staff delete more completed orders**.
- Decide on SK-01 so reported sales stop shrinking.
- Decide on SK-03.
- Apply the SK-07 dependency update.

UI behaviour on real devices has not been verified in this audit.
