# Security release checklist

These changes are local only. No production migration, credential rotation, commit, push or deployment was performed by this security task.

## Before deployment

1. Review and commit the complete menu/offers and security changes together. Do not commit `.env`, database exports or service-account keys. From the repository root run `node scripts/check-secrets.cjs`, then after staging run `node scripts/check-secrets.cjs --staged`. The latter checks the Git index, not unstaged replacements. This is a heuristic text check, not a historical or binary secret scanner.
2. Confirm the intended Neon branch/database privately. Test in an isolated child branch first; retain a recoverable backup before touching production. Do not replace a populated database with the baseline schema.
3. The database must already have the application's base tables and `menu_offers.sql` changes. From `node-server`, the operator then runs `node migrate.js security_hardening.sql` against the explicitly selected database. The migration is additive, atomic through the existing runner, and re-runnable. It adds `admin_sessions`, two nullable hash columns/index on `orders`, and one `admin_notification_budget` row. No existing orders are deleted.
4. Deploy the frontend with checkout identifiers before the new backend (the old backend ignores the extra header). Then deploy the backend after the migration. Already-open old frontend tabs must refresh: the new backend rejects missing checkout identifiers with a refresh message instead of accepting an unsafe retry. Until the new backend is live, the old backend's retry behavior still applies.
5. Admins sign in again once. Old cookies are intentionally invalid. Keep `ADMIN_PASSWORD` and a separate random `SESSION_SECRET` configured only on the backend. Multiple admins can still sign in independently.

Do not run a migration merely because the local dev server reports missing tables: first confirm which branch/database its connection points to.

## Changes and limits

- Admin sessions use random tokens, with only SHA-256 hashes and credential-version HMACs stored in Neon. Logout revokes that session. Changing either credential invalidates old sessions on their next request. Sessions expire after 12 hours; login cleans expired/old-version rows and caps retained sessions at 100. The oldest session may need to log in again if that cap is reached.
- Authenticated requests perform one indexed session check per HTTP request, including invoice authentication. There is no background session polling or cleanup cron. Anonymous menu browsing does not query the session table. A session-database failure fails closed with a generic 503.
- A UUID checkout key plus normalized request hash is stored on the order. Matching retries return that order at its original price, without another customer, order or email. Reusing the key with different details is rejected. Locking and insertion occur in the order transaction. Duplicate line quantities are aggregated before the 10,000-per-item safety limit; this is not an inventory restriction.
- Retry keys live only in the mounted checkout, not persistent browser storage. An unchanged pending checkout can retry after its date cutoff or offer expiry; the server rejects any unsaved expired purchase. Refreshing/closing the page loses the key. If the outcome is uncertain after that, contact the restaurant before placing another order. Deleting the underlying order also removes its retry record.
- Email alerts are limited to one attempt per 60 seconds and 100 attempts per UTC day, shared across processes and restarts. Budget exhaustion or email failure does **not** reject an order. Check the admin dashboard for every pending order: closely spaced orders may not each generate email. No second email is sent on replay. Failed provider attempts consume budget; there is no automatic resend queue.
- Inventory failures return generic errors. Invoice routes (including errors) carry private/no-store, no-referrer and noindex/nofollow/noarchive headers. These do not revoke links someone already possesses.
- Render's static-site CSP permits same-origin scripts/API requests and the specific existing OpenStreetMap image/geocoding hosts. Inline JavaScript, foreign frames and objects are blocked. React/Leaflet inline styles remain allowed. If you later set an external `VITE_API_URL`, add that exact trusted origin to `connect-src` and retest; do not use a wildcard to bypass it.
- `qs` was updated in the backend lockfile to resolve reported npm advisories. PGlite is a development-only test dependency, not a production database or service.

## Storage and network impact

The added per-order metadata is two 64-character hashes (128 ASCII bytes of payload, plus PostgreSQL row/index overhead). At 600 orders/month that is 76,800 bytes of hash payload/month, not a full database-size forecast. The checkout-key index adds overhead too. Existing customer/order/item/invoice data growth is separate.

Session data is capped at 100 rows and the email budget at one row. PostgreSQL still has page/index allocation and MVCC/vacuum overhead; row caps are not exact disk-size caps. No new image assets, analytics requests, recurring database jobs or production packages are added. Each checkout adds a small header; each authenticated HTTP request adds a database lookup, so actual latency/Neon usage should be observed after deployment. Local tests do not measure production CU-hours or Render bandwidth.

## Required external follow-up

- **Historical credential:** the earlier audit found a non-empty local database password in Git history. Its value was not printed. If it was reused anywhere, rotate every affected credential. Removing today's file does not remove history. History rewriting requires separate coordination with the client and fork owners; it was not done here.
- **Proxy verification:** local development trusts zero proxies. Render defaults to one hop; `TRUST_PROXY_HOPS` accepts only 0–3. Verify the actual direct-backend and frontend-rewrite paths on Render before relying on client-IP rate limits. A trusted proxy must overwrite untrusted forwarded headers. Do not set `trust proxy: true` or guess a larger hop count. See [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).
- **Live headers:** after deployment inspect responses for the public frontend, `/invoice/...` and `/api/invoices/...` on the custom domain, including invalid links. Confirm Render applies the new CSP and invoice-specific headers. See [Render static headers](https://render.com/docs/static-site-headers).
- **Controlled acceptance test:** log in with two sessions, log one out and confirm it cannot access admin endpoints while the other can. Test customer checkout, manual WhatsApp sharing, invoice/QR links and Google Sheets with a client-approved test order. Avoid real email/order tests without approval.

## Local verification

Backend: `cd node-server` then `npm test`. Tests use in-memory PGlite and mocked external boundaries; they never apply migrations to Neon. PostgreSQL multi-connection races and the deployed proxy chain still require environment-specific verification.

Frontend: from `semis-kitchen`, run `npm run lint`, `npm run test:seo`, and `node --test test/checkout-attempt.test.mjs test/checkout-date.test.mjs test/floating-cart.test.mjs test/india-time.test.mjs`.

Optional Playwright: run `node test/browser-menu-offers.mjs` against local Vite on port 5174; run `node test/browser-security-headers.mjs` after building. Set `PLAYWRIGHT_MODULE` to your Playwright installation when necessary. Both scripts intercept external/API traffic; neither places live orders. The latter serves built files with the checked-in CSP.

Run `npm audit` separately in both packages with TLS verification enabled. Advisory results are point-in-time checks, not proof of vulnerability-free software.

## Rollback

Keep the additive schema when rolling back application code; do not drop tables/columns or restore an old database over new customer orders. Old code does not use the new columns, but rolling back authentication/checkout code restores the audited weaknesses. Old and new session formats are incompatible, so expect another login. Prefer a forward fix and retest. No automated rollback or destructive cleanup is included.
