# Security Hardening Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the coupled backend changes, and superpowers:dispatching-parallel-agents for the independent header work. Steps use checkbox syntax for tracking.

**Goal:** Resolve the confirmed local audit findings without changing the restaurant's ordering rules or writing to production.

**Architecture:** Replace stateless admin sessions with hashed, revocable database sessions. Attach hashed checkout identifiers to existing orders and serialize matching submissions within the order transaction. Add bounded notification budgets, response hardening and regression coverage.

**Tech Stack:** Existing Express, node-postgres, React/Vite, Node test runner, in-memory PGlite, Playwright, Render static headers. No new production dependency or polling service.

**Spec:** User-approved design in this conversation (2026-09-14): database-backed sessions and duplicate-order protection, expired-session cleanup, multiple admins, generic errors, quantity validation, CSP, invoice no-index, notification safeguards, dependency checks. Work in the current checkout, preserving all uncommitted changes.

## Global Constraints

- No live database writes, notifications, credential rotation, Git-history rewrite, commits, pushes or deployments in this implementation.
- Preserve menu/inventory changes, multiple admins, manual inventory, Sunday mixed-order rules, invoice/QR sharing and Google Sheets.
- WhatsApp automation stays disabled; no analytics, CAPTCHA or cookie banner.
- No timer/cron querying Neon. Session validation is request-driven; health and anonymous menu browsing never query the session table.
- Security migration is additive and re-runnable. Operator applies it before backend deployment.

## Task 1: Durable authentication and request safety

Files: `node-server/security_hardening.sql`, `middleware/adminAuth.js`, `routes/authRoutes.js`, `middleware/rateLimits.js`, `controllers/invoiceController.js`, `app.js`, and tests.

- [x] Add failing HTTP/in-memory tests: login, copied-cookie replay after logout (401), credential rotation (401), expired and tampered sessions, two independent admins, DB failure (503), anonymous requests with no auth lookup, one lookup per HTTP request.
- [x] Store SHA-256 hashes of 32-byte random session tokens, credential-version HMAC and 12-hour expiry; delete expired/version-mismatched records on login, cap active sessions at 100. Never store tokens or passwords.
- [x] Make `createSessionToken()` and `validSession(req)` async, add `revokeSession(req)`, and await every consumer. Memoize only for the same request object, never across HTTP requests.
- [x] Add `no-store` to admin and private responses. Preserve HttpOnly, Secure in production and SameSite=Lax.
- [x] Validate explicit proxy configuration; default to one hop on Render and no trusted proxy off Render. Test local forwarded-header spoofing; document that live proxy-chain verification is still required.
- [x] Run `node --test test/security-auth.test.js test/regression.test.js test/menu-inventory.test.js` and resolve regressions.

Example invariant:
```js
assert.equal((await fetch(base + '/api/admin/session', { headers: { cookie: loggedOutCookie } })).status, 401);
```

## Task 2: Idempotent checkout and notification budget

Files: `models/orderModel.js`, `controllers/orderController.js`, `utils/emailNotify.js`, `utils/notificationBudget.js`, `security_hardening.sql`, `semis-kitchen/src/lib/checkoutAttempt.js`, `src/App.jsx`, `src/lib/kitchen.jsx`, and tests.

- [x] Add failing tests for duplicate-item aggregation above 10,000; repeated same-key request; same key/different cart conflict; original price retained on retry; fresh key permits deliberate repeat; transaction rollback permits retry; no second email on replay.
- [x] Add nullable indexed checkout-key and request hashes to orders (existing rows unchanged). Validate a UUID checkout key at the HTTP boundary. Inside the transaction acquire a per-key advisory lock, compare the canonical normalized request hash, and replay before applying current date/price checks.
- [x] Keep the key for an unchanged failed checkout, rotate after success or payload change; hold no customer data in persistent browser storage. Suppress simultaneous submit handlers with a ref.
- [x] Validate aggregate quantities after combining duplicate IDs. Do not impose stock availability restrictions.
- [x] Add one persistent email-budget row: at most 100 attempts per UTC day, at least 60 seconds apart. Budget exhaustion skips only the email, not the order; log a non-sensitive warning. Order replays never request another email.
- [x] Ensure internal hashes are never returned in the order response.
- [x] Run backend tests, frontend unit tests and intercepted browser retry scenario.

Example invariant:
```js
assert.equal(first.id, retry.id);
assert.equal((await query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 1);
```

## Task 3: Independent response hardening

Files: `render.yaml`, `node-server/routes/invoiceRoutes.js`, `controllers/inventoryController.js`, frontend/backend hardening tests.

- [x] First reproduce raw inventory error disclosure and missing invoice no-index headers; then return generic errors and add no-index/no-referrer/private-no-store at the invoice router boundary (including error responses).
- [x] Add frontend CSP permitting existing same-origin scripts, inline styles needed by React/Leaflet, local fonts/images and the exact OpenStreetMap services. Disallow inline executable scripts, eval, objects, framing and foreign base URLs. Preserve map geolocation, QR/invoice links and SEO JSON-LD.
- [x] Test the actual policy in a browser against built assets and mocked external APIs; verify normal rendering and blocked injected script.

## Task 4: Release verification and operator handoff

- [x] Retry npm advisory checks with TLS verification enabled; do not claim clean results when the endpoint fails.
- [x] Add a redacting tracked-secret check with fixture tests and documented commands; do not print any historical credential.
- [x] Run all backend tests, frontend tests/lint/build and intercepted browser tests. Get a scoped independent code review of security changes and address actionable findings.
- [x] Write `SECURITY-RELEASE.md`: migration/deploy order, one-time admin re-login, bounded overhead estimate, notification limits, rollback compatibility, unresolved external credential rotation and live proxy check.

## Progress

- Baseline: 20 backend tests passed before implementation.
- User explicitly selected the current checkout; existing dirty changes remain untouched except necessary integrations.
- Final local verification: 43 backend tests, 7 frontend unit tests, lint/build/SEO, intercepted browser flows and CSP checks; npm audit reported zero advisories in both packages on 2026-09-15.
- Independent review found expiry-retry and internal-response hash gaps; both received regression tests and fixes. Production migration, credential follow-up and live proxy/header checks remain operator actions documented in SECURITY-RELEASE.md.
