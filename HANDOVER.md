# Semi's Kitchen ownership and deployment handover

Updated: 20 August 2026

This guide transfers ownership without copying secrets into source control or chat. Use the existing Vercel project-transfer workflow where possible; it preserves deployments, aliases, domains, configuration, and project environment variables. Rotate every credential after ownership moves.

## 1. Before the handover

1. Ask the client to enable MFA on Vercel, Neon, Google, GitHub, and Resend.
2. The client creates a Vercel Pro team and invites the current Vercel project owner.
3. The client creates or selects a Neon Free organization and invites the current Neon project administrator if a direct project transfer will be used.
4. Save a database backup using the **direct/unpooled** Neon connection string. Do not use the `-pooler` URL with `pg_dump`:

   ```powershell
   pg_dump -Fc -v -d "DIRECT_NEON_URL" -f semis-kitchen-before-handover.dump
   ```

5. Export or copy the current Google Sheet as a backup.
6. Commit/tag the final source and confirm these commands pass:

   ```powershell
   cd node-server
   npm.cmd test
   cd ..\semis-kitchen
   npm.cmd run lint
   npm.cmd run build
   ```

Never commit `.env`, a database URL, Google private key, Resend key, Meta token, or session secret.

## 2. Migrate Neon into the client-owned project

The client created a fresh PostgreSQL 18 Neon project in Singapore. Copy the existing database into it instead of transferring the old project. Use **direct/unpooled** URLs for the dump and restore; use the pooled destination URL only for the deployed application.

For this small database, Neon's Import Data Assistant is the easiest option. Give it the old project's direct URL privately, select the client's `neondb` destination, and let it run its compatibility check and import. Alternatively, restore the backup manually:

```powershell
pg_restore -v --clean --if-exists --no-owner -d "CLIENT_DIRECT_NEON_URL" semis-kitchen-before-handover.dump
```

Then use the client's pooled URL in Vercel. Do not send either URL through chat.

After import, compare table names and row counts between both databases before changing Vercel. Keep the old project unchanged until production acceptance is complete.

Official references:

- [Migrating between Neon projects](https://neon.com/docs/import/migrate-from-neon)

## 3. Transfer Google Sheets safely

Do not give the client the old service-account private key as permanent ownership.

1. Copy the existing order sheet into a Drive location owned by the client. Keep existing order IDs in column B so the sync deduplication continues to work.
2. In a client-owned Google Cloud project, enable the Google Sheets API and create a service account.
3. Create a new key for that service account and keep the downloaded JSON private.
4. Share the client-owned sheet with the new service-account email as **Editor**.
5. Set the new email, private key, and sheet ID in backend Vercel environment variables.
6. From the admin dashboard, run one sync and confirm it reports existing orders rather than appending duplicates.
7. Revoke the old service-account key after successful cutover.

## 4. Transfer Vercel projects

Transfer the existing projects instead of recreating them. Vercel documents this as a zero-downtime transfer and shows the domains, aliases, and environment variables that will move.

1. Transfer the backend project first from **Project Settings → General → Transfer Project**.
2. Add `api.semiskitchen.in` to the backend Vercel project, configure the DNS record Vercel provides, and confirm `https://api.semiskitchen.in/api/menu` returns the menu.
3. Transfer the frontend project.
4. Confirm `semiskitchen.in` and `www.semiskitchen.in` are assigned to the frontend project.
5. Confirm the frontend project has **no `VITE_API_URL`**. Browser API calls must use relative `/api` URLs so the admin cookie remains first-party.
6. The frontend proxies `/api/*` and `/invoice/*` to the client-owned `api.semiskitchen.in` backend domain. Attach and verify that domain before deploying the frontend.
7. Reconnect the Git repository and any Vercel integrations that did not transfer.
8. Configure Vercel Spend Management and alerts on the client's Pro team.

Official reference: [Vercel project transfers](https://vercel.com/docs/projects/transferring-projects)

## 5. Backend Vercel environment variables

Set secrets in Vercel Project Settings, for Production and any Preview environment that genuinely needs them.

| Variable | Required now | Ownership / value guidance |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Client Neon pooled URL; hostname must contain `-pooler` |
| `ADMIN_PASSWORD` | Yes | New client-chosen strong password |
| `SESSION_SECRET` | Yes | New random value of at least 32 characters |
| `ALLOWED_ORIGINS` | Recommended | `https://semiskitchen.in,https://www.semiskitchen.in` plus explicitly approved previews |
| `PUBLIC_SITE_URL` | Yes | `https://semiskitchen.in` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | For Sheets | Client-owned service account |
| `GOOGLE_PRIVATE_KEY` | For Sheets | Client-owned key with newlines represented as `\n` |
| `GOOGLE_SHEET_ID` | For Sheets | Client-owned sheet ID |
| `RESEND_API_KEY` | For email | Client-owned Resend key |
| `RESEND_FROM` | For email | Sender on the client's verified domain |
| `ADMIN_EMAIL` | For email | Restaurant-controlled inbox |
| `WHATSAPP_NOTIFICATIONS_ENABLED` | Yes | Keep `false` during the Meta pause |
| `WHATSAPP_PHONE_NUMBER_ID` | Later | Retain only when the client Meta account is ready |
| `WHATSAPP_PERMANENT_TOKEN` | Later | Retain only when ready; never expose it |
| `PUBLIC_API_BASE_URL` | Later | Use `https://semiskitchen.in` when WhatsApp is enabled |

`DB_INACTIVITY_TIMEOUT_MS` is intentionally not used. The application limits each warm function instance to two database connections, releases idle clients after 30 seconds, and uses Neon's pooled endpoint. Neon Free independently scales compute to zero after inactivity.

## 6. Secret rotation order

After both projects are in the client team:

1. Rotate the Neon database password and update `DATABASE_URL`.
2. Set a new `ADMIN_PASSWORD` and `SESSION_SECRET`. This invalidates old admin sessions.
3. Install the client's Google service-account credentials, test sync, then revoke the old Google key.
4. Install the client's Resend key/sender/recipient, test one notification, then revoke the old key.
5. Keep WhatsApp disabled. When Meta is repaired, install only client-owned credentials and enable the flag after template testing.
6. Remove the previous owner from Vercel, Neon, Google Cloud/Drive, GitHub, Resend, and Meta after the client verifies operation.

## 7. Functional acceptance checklist

- Customer menu and random slideshow load on mobile and desktop.
- Only the current and next slideshow photos load initially; menu images lazy-load.
- Cart cannot exceed stock; a second server-side check rejects stale stock.
- Invalid/past dates, invalid slots, missing delivery location, and same-day mains delivery are rejected.
- A test order appears as pending in admin and reserves stock once.
- Accepting an order does not deduct stock twice.
- Accepted orders appear in invoice batches.
- Declining/deleting a reserved order restores stock once.
- Public invoice without its share token returns 404; the tokenized link works under `semiskitchen.in`.
- QR appears with the manual WhatsApp share, not inside the invoice.
- Google Sheet sync does not duplicate an existing order ID.
- Admin login, logout, rate limiting, and error banner work.
- WhatsApp automatic notifications remain off.

## 8. Measured deployment footprint

Measurements from the repository and current Neon database on 20 August 2026. The client-owned replacement Neon project is in Singapore, and the backend Vercel Function is pinned to Singapore (`sin1`) to keep application-to-database latency low:

| Resource | Measured size |
| --- | ---: |
| Frontend production build | 4.14 MiB total |
| Frontend image assets | approximately 3.59 MiB |
| Initial customer JavaScript | approximately 278 KB raw / 86.4 KB gzip, including the display-only first-visit menu snapshot |
| Deferred delivery-map JavaScript | approximately 160 KB raw / 51 KB gzip |
| Deferred admin JavaScript | approximately 36 KB raw / 8 KB gzip |
| Backend installed production dependencies | 55.61 MiB on disk |
| Invoice PDF template | 995.2 KiB |
| Generated invoice | approximately 1.04 MiB each |
| Three-invoice ZIP batch | approximately 3.13 MiB |
| UPI QR image | 63.6 KiB |
| Neon database total | 8.12 MiB |
| Neon public tables and indexes | 0.49 MiB |
| Current data | 9 orders, 9 customers, 11 order lines |

PDFs and ZIPs are generated in memory and are not stored on Vercel or Neon. The QR is one static file. Google Sheets is the durable export for completed orders; paid and confirmed-synced orders can be cleaned up manually from admin.

## 9. Forecast at 20 customers per day

Assumption: roughly 600 customer sessions/orders per 30-day month. These are conservative planning estimates, not billing guarantees.

- **Vercel requests:** normally a few thousand API/function requests per month, far below one million. Customer startup uses one menu request; the redundant inventory request was removed.
- **Vercel Fast Data Transfer:** ordinary browsing should remain around 0.3–0.9 GB/month depending on categories viewed and browser caching. If every customer downloads one 1.04 MiB invoice, add about 0.63 GB/month. A practical planning range is under 2 GB/month, versus 1 TB included on Pro.
- **QR transfer:** 600 downloads would be about 38 MiB/month.
- **Neon storage:** order/customer/line growth should normally be only a few MiB per month. The current total is 8.12 MiB versus 0.5 GB on Free. Regular paid+synced cleanup slows long-term growth.
- **Neon compute:** at 20 short daily bursts and a five-minute scale-to-zero window, a rough upper estimate is about 12.5 CU-hours/month before admin activity, well below 100 CU-hours/project/month.
- **Neon network transfer:** menu/order/admin query results should normally remain well below 100 MiB/month, far below the Free plan's 5 GB/month.
- **Invoice function memory/network:** batches are capped at three invoices to avoid large responses and memory spikes.

Current official allowances used for comparison:

- [Vercel Pro](https://vercel.com/docs/plans/pro-plan): 1 TB monthly Fast Data Transfer, 10 million Edge Requests, and a $20 monthly infrastructure credit.
- [Vercel limits](https://vercel.com/docs/limits): function bundle limit 250 MB compressed and static upload limit 1 GB on Pro.
- [Neon pricing](https://neon.com/pricing): 0.5 GB storage and 100 CU-hours per project on Free.
- [Neon network transfer](https://neon.com/docs/introduction/network-transfer): 5 GB/month on Free.

## 10. Monthly monitoring

Vercel Pro team:

- Open **Usage** and review Fast Data Transfer, Edge Requests, Function Invocations, Active CPU, and Provisioned Memory by project.
- Enable spend alerts and a low initial hard budget appropriate for the client.
- Investigate sudden invoice traffic or repeated 429 responses before raising limits.

Neon Free organization:

- Review project **Monitoring/Usage** for storage, CU-hours, and public network transfer.
- Keep autoscaling and the five-minute scale-to-zero behavior enabled.
- Keep only necessary branches and use the pooled application URL.
- Upgrade before approaching 0.5 GB storage, 100 CU-hours, or 5 GB transfer; exceeding Free network transfer can suspend compute until the next cycle.

## 11. Final ownership sign-off

The handover is complete only after the client confirms:

- They own both Vercel projects and `semiskitchen.in`.
- They own the Neon project and can rotate its credentials.
- They own the Google Sheet, Google Cloud project, and service account.
- They own the Resend sender domain and key.
- They own the Git repository and production branch.
- All old credentials are revoked.
- The previous owner has been removed from each service.
- The backup is retained securely for an agreed period and then deleted securely.
