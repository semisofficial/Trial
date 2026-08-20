# Semi's Kitchen: Render deployment and cutover

This repository supports Render without removing the existing Vercel setup.
Use the root `render.yaml` Blueprint to create:

- `semiskitchen`: free Static Site, global CDN, root `semis-kitchen`
- `semiskitchenbe`: Starter Web Service, Singapore, root `node-server`

Neon remains the database. No database import or schema change is required.

## 1. Create the Render Blueprint

In the client's Render workspace, choose **New > Blueprint**, connect
`semisofficial/Trial`, and select `render.yaml`. Use the `main` branch.

Do not attach production domains yet. The Vercel deployment remains live while
both Render services build.

## 2. Configure backend secrets

Enter these only on the `semiskitchenbe` Web Service. Values marked `sync:
false` in the Blueprint are requested in the Render dashboard and are never
stored in Git.

Required core values:

- `DATABASE_URL`: verified imported Neon branch, pooled URL containing `-pooler`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`: at least 32 random characters
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `ADMIN_EMAIL`

The Blueprint sets these non-secret production values:

- `NODE_ENV=production`
- `ALLOWED_ORIGINS=https://semiskitchen.in,https://www.semiskitchen.in`
- `PUBLIC_SITE_URL=https://semiskitchen.in`
- `PUBLIC_API_BASE_URL=https://semiskitchen.in`
- `WHATSAPP_NOTIFICATIONS_ENABLED=false`

Do not set `VITE_API_URL` on the Static Site. Relative `/api` requests are
required for the first-party Admin cookie.

## 3. Test Render before DNS

Using the generated backend `onrender.com` URL, verify:

- `/health` returns `{ "success": true, "status": "healthy" }`
- `/` returns the API-running response
- `/api/menu` returns all menu items

The `/health` endpoint intentionally performs no database query, so Render's
continuous health checks do not consume Neon CU-hours.

Using the generated Static Site URL, verify the page, slideshow, menu images,
favicon, `/admin` SPA route, and mobile layout. At this stage its `/api` rewrite
still reaches whichever service owns `api.semiskitchen.in` (initially Vercel).

## 4. Cut over the backend first

1. Add `api.semiskitchen.in` to the Render Web Service.
2. Record the existing GoDaddy `api` CNAME so rollback is possible.
3. Replace only that CNAME with the exact Render target.
4. Wait for Render to show the domain as verified and TLS-ready.
5. Keep the frontend on Vercel and run the complete workflow through it:
   Admin login, menu/inventory reads, one controlled order, stock reservation,
   acceptance, invoice, Resend, Google Sheets sync, payment, and completion.

This stage tests the Render backend with the real first-party frontend proxy.
If anything fails, restore the recorded Vercel `api` CNAME; no data migration
or rollback is needed.

## 5. Cut over the Static Site

Only after the backend workflow passes:

1. Add `semiskitchen.in` to the Render Static Site. Render also configures the
   corresponding `www` domain/redirect.
2. Record the existing GoDaddy root and `www` records.
3. Apply the exact DNS records Render requests.
4. Confirm both domains have valid TLS.
5. Test in a private browser window and on iOS Safari.

The Static Site routes must remain ordered as follows:

1. `/api/*` to `https://api.semiskitchen.in/api/*`
2. `/invoice/*` to the API invoice-share route
3. `/*` to `/index.html`

Putting the SPA fallback first would turn API calls into HTML and break login,
ordering, inventory, and invoices.

## 6. Final production checks

- Customer first paint and live stock confirmation
- Insufficient-stock blocking
- Admin login remains active after dashboard data loads
- Price, stock, and availability edits
- One order reserves stock exactly once
- Accept does not reserve it twice; decline restores it
- Accepted/completed invoice visibility
- Single PDF and maximum three-invoice ZIP
- Manual WhatsApp message and separate QR image
- Resend notification
- Google Sheets idempotent sync
- `/health` checks do not wake Neon

Keep the Vercel projects and their configuration intact for at least one week.
They provide a fast DNS rollback while Render usage and memory are observed.

## Operational settings

- Region: Singapore
- Backend plan: Starter (512 MB / 0.5 CPU)
- Instances: one
- Health check: `/health`
- No persistent disk is required
- Do not add a Neon keep-alive job
- Do not point health checks at `/api/menu`
- Keep the pooled database connection and application pool maximum of two

Render uses an ephemeral filesystem, which is safe here: PDFs and ZIPs are
generated in memory and no business data is stored on local disk.
