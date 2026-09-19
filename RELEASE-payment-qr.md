# Admin payment QR replacement

Sales now includes a Payment QR card: choose a PNG/JPEG, preview it, verify the
payment account, confirm, and save. Cancel does not publish. The saved image is
shared by all admins and survives backend restarts/redeployments.

## Rollout (not performed automatically)

1. Back up the intended Neon branch. Confirm which branch the live backend uses;
   a local server pointed at that branch also writes live data.
2. Use Node 22.12+ (22.x) or Node 24.x; the backend engine range is now explicit
   for Sharp compatibility. Ensure no Render `NODE_VERSION` or version file pins
   Node 18/20. In `node-server`, install dependencies with `npm ci`. Apply the additive,
   re-runnable migration to that intended branch:

   ```powershell
   node migrate.js payment_qr.sql
   ```

   This creates one settings row. It does not modify orders, menu, stock, prices,
   invoices, or the original bundled QR. Before migration, the original image
   still works and the Sales tab explains that uploads need database setup.
3. Deploy the backend first. Check `/api/payment-qr/image` returns the current
   image and the authenticated Sales settings request works.
4. Sync the Render Blueprint routing change, then deploy the frontend. Ensure
   the static site's `/upi-qr.jpeg` **Rewrite** points to
   `https://semiskitchenbe.onrender.com/api/payment-qr/image` before the SPA
   fallback. If managing routes manually, add this exact rewrite in Render.
   A code redeploy alone is not proof the service's route settings were synced.
5. Open `https://semiskitchen.in/upi-qr.jpeg` and confirm it displays an image,
   not HTML. The old static frontend asset moved to `node-server/assets` so it
   cannot shadow the new rewrite. Do not redeploy an old frontend after admins
   start replacing QR images: it would serve its old bundled image again.
6. In Sales, upload the intended real QR, preview/confirm/save, reopen the public
   link, and scan it to check the correct recipient. Do not publish a test
   account to production. Test cancel and refresh without changing payment data.

## Limits and safety

- Admin authentication and allowed-origin checks protect uploads; upload rate
  limit: 20 per hour per IP. Only one image conversion runs per backend process;
  simultaneous conversions receive a retry message rather than filling a queue.
  A stale admin version cannot overwrite a newer QR.
- PNG/JPEG only, up to 1 MiB, 128–2048 pixels on each side. No SVG or animation.
- Sharp decodes/re-encodes to JPEG at high quality, removes metadata, and keeps
  dimensions/quiet zones. No cropping/resizing. Re-scan after saving: format
  validation cannot verify ownership of a payment account or guarantee scanability.
- One current image, maximum 512 KiB in PostgreSQL, plus small row metadata.
  Replacement updates that row, not an image per invoice. PostgreSQL history,
  WAL and backups can temporarily retain old versions as normal.
- One cached image per backend process. Public reads check only the small
  revision row, fetch image bytes when changed, and support conditional 304
  responses. There is no polling timer or image request on customer menu load.
- A database outage returns an error rather than silently serving a potentially
  obsolete payment account. Missing migration alone permits the initial fallback.
- The public link stays the same, including existing WhatsApp messages. Previously
  downloaded images or WhatsApp previews cannot be recalled/forced to refresh.
- Invoices, message text/order, sales totals, and WhatsApp auto-notification flag
  are unchanged. No new credentials, paid storage service, or persistent disk.

## Local verification

Backend tests use in-memory PGlite, never `.env` or live Neon. From `node-server`:
`npm test`. Frontend: `npm run lint`, `npm run build`,
`node --test test/*.test.mjs`. Browser scripts accept `PLAYWRIGHT_MODULE` if
Playwright is supplied externally; `browser-payment-qr.mjs` accepts
`TEST_SITE_URL` (default local Vite on port 5184). All its API calls are
intercepted. `node test/payment-qr-routing.mjs` starts isolated Vite/Express
servers with in-memory PostgreSQL to test the actual public-link rewrite.
