# Production availability and repository-owned payment QR

## Changes

- Production paused hides an item from the public menu/inventory. Admin retains its name, photo, price and stock; production available restores it. Mains now also have the toggle.
- Checkout checks availability transactionally, including old carts. Existing saved order retries still replay the same order (they do not place a second order).
- Customer menu and slideshow wait for live availability; browser snapshots are no longer displayed. The page shell still loads immediately. An open, visible page refreshes once per minute and when focused; this is not instant server push. Checkout always checks current availability. A failed refresh hides stale items until retry succeeds.
- Sales no longer has a QR uploader. The QR management/upload endpoints and writable model are removed, not merely hidden in the UI. Historical database overrides are ignored.
- `node-server/assets/upi-qr.png` is the exact supplied image, showing UPI ID `semisofficial1@okhdfcbank`. Future changes require repository access and a deployment. Menu-photo uploads remain available in Items.
- Existing `/upi-qr.jpeg` WhatsApp links remain valid. The response is correctly labelled `image/png`; the legacy URL extension is retained for compatibility.

## Deployment

1. No new migration or environment variable is required for this patch. The existing Items feature still requires `items_management.sql` if it has not already been installed. Do not rerun seed scripts.
2. Deploy the backend first, then the frontend. Confirm the Render static-site rewrite `/upi-qr.jpeg` still points to `https://semiskitchenbe.onrender.com/api/payment-qr/image` ahead of the SPA fallback. Do not add a public frontend file at that path, which could shadow the rewrite.
3. Open the live QR URL and scan it without completing a payment. Confirm the recipient and UPI ID with the owner. Existing downloaded images or WhatsApp previews cannot be recalled or forced to update.
4. Verify login, pause/resume for snacks and mains, public menu, an old cart, order acceptance, invoice/WhatsApp sharing and Sheets sync. A customer with an already open tab can see the previous menu until the next refresh (up to a minute while visible), but cannot submit a new paused-item order.
5. Confirm `/health`, correct pooled Neon URL, session secrets, allowed origins and proxy settings in the live Render dashboard. Source/build checks cannot verify those live values.

`payment_qr.sql` remains only as historical migration documentation/test compatibility. The old table is unused; no production data is dropped by this patch. No QR migration is needed. Database cleanup, if desired, should be separately backed up and approved.

## Hosting and consumption

Render keeps the existing static frontend and Starter Node backend configuration. The QR no longer queries Neon, reducing QR-view database traffic. Availability uses uncached menu reads: at most one scheduled refresh per minute per visible tab, plus page loads/focus refreshes. This can keep Neon active while customers leave the site visible. Photos remain independently cacheable.

Render reference checks: https://render.com/docs/web-services (PORT/0.0.0.0), https://render.com/docs/health-checks, https://render.com/docs/blueprint-spec.
