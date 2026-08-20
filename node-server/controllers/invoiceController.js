const db = require("../config/db");
const { generateInvoicePDF, groupOrders } = require("../utils/invoiceGenerator");
const { SINGLE_ORDER_QUERY, ACCEPTED_ORDERS_QUERY, ACCEPTED_ORDERS_COUNT_QUERY, COMPLETED_ORDERS_QUERY } = require("../utils/invoiceQueries");
const { pushOrderRowsToSheet } = require("../utils/googleSheetsSync");
const { validSession } = require("../middleware/adminAuth");

const INVOICE_NOT_FOUND = "Invoice not found";
const INVOICE_BATCH_SIZE = 3;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Public, branded page intended for links manually shared with customers.
// Unlike a raw PDF response, this HTML can provide WhatsApp/social link-preview
// metadata and a readable thank-you message before the customer opens the PDF.
async function getInvoiceSharePage(req, res) {
  const orderId = String(req.params.orderId || "").trim();
  const token = String(req.query.token || "").trim();
  const isAdmin = validSession(req);
  if (!orderId || (!isAdmin && !token)) return res.status(404).send(INVOICE_NOT_FOUND);

  const authorized = await db.query(
    `SELECT 1 FROM orders WHERE id = $1 AND ($2::text IS NULL OR invoice_share_token = $2)`,
    [orderId, isAdmin ? null : token]
  );
  if (authorized.rowCount === 0) return res.status(404).send(INVOICE_NOT_FOUND);

  const safeOrderId = escapeHtml(orderId);
  const encodedOrderId = encodeURIComponent(orderId);
  const publicOrigin = (process.env.PUBLIC_SITE_URL || "https://semiskitchen.in").replace(/\/$/, "");
  const tokenQuery = isAdmin ? "" : `?token=${encodeURIComponent(token)}`;
  const pageUrl = `${publicOrigin}/invoice/${encodedOrderId}${tokenQuery}`;
  const pdfUrl = `${publicOrigin}/api/invoices/${encodedOrderId}${tokenQuery}`;
  const previewDescription = "View your invoice from Semi’s Kitchen.";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Your invoice | Semi's Kitchen</title>
  <meta name="description" content="${escapeHtml(previewDescription)}">
  <meta property="og:title" content="Your invoice from Semi's Kitchen">
  <meta property="og:description" content="${escapeHtml(previewDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Your invoice from Semi's Kitchen">
  <meta name="twitter:description" content="${escapeHtml(previewDescription)}">
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6edd7;color:#3f3b24;font-family:Arial,sans-serif}.card{width:min(100%,620px);background:#fff8e8;border:1px solid #e8d7b5;border-radius:28px;padding:36px;box-shadow:0 20px 50px rgba(63,59,36,.12);text-align:center}h1{margin:0 0 18px;font-family:Georgia,serif;font-size:clamp(30px,7vw,46px)}p{white-space:pre-line;line-height:1.75;color:#6f6657}.id{margin:24px 0 8px;font-size:13px;color:#8a806f}.button{display:inline-block;margin-top:20px;padding:14px 24px;border-radius:999px;background:#6f6f32;color:#fff8e8;text-decoration:none;font-weight:700}
  </style>
</head>
<body><main class="card"><h1>Your invoice is ready</h1><p>Open your Semi’s Kitchen invoice using the button below.</p><div class="id">Order ${safeOrderId}</div><a class="button" href="${escapeHtml(pdfUrl)}">View invoice</a></main></body>
</html>`);
}

// GET /api/invoices/:orderId  -> streams back a single filled invoice PDF
async function getInvoice(req, res) {
  try {
    const isAdmin = validSession(req);
    const token = String(req.query.token || "").trim();
    if (!isAdmin && !token) {
      return res.status(404).json({ success: false, error: INVOICE_NOT_FOUND });
    }
    const result = await db.query(SINGLE_ORDER_QUERY, [req.params.orderId, isAdmin ? null : token]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: INVOICE_NOT_FOUND });
    }

    const [order] = groupOrders(result.rows);
    const pdfBuffer = await generateInvoicePDF(order);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${order.invoice_id}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("❌ Failed to generate invoice:", err);
    res.status(500).json({ success: false, error: "Failed to generate invoice" });
  }
}

async function getAcceptedInvoiceBatchInfo(req, res) {
  try {
    const result = await db.query(ACCEPTED_ORDERS_COUNT_QUERY);
    const totalInvoices = result.rows[0]?.total || 0;
    res.json({
      success: true,
      data: {
        totalInvoices,
        batchSize: INVOICE_BATCH_SIZE,
        totalBatches: Math.ceil(totalInvoices / INVOICE_BATCH_SIZE),
      },
    });
  } catch (err) {
    console.error("Failed to count accepted invoices:", err);
    res.status(500).json({ success: false, error: "Failed to count invoices" });
  }
}

// Generates at most three invoices in memory. No ZIP or PDF is written to
// Vercel storage, Neon, or the repository.
async function getAcceptedInvoicesZip(req, res) {
  const archiver = require("archiver");
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const result = await db.query(ACCEPTED_ORDERS_QUERY, [INVOICE_BATCH_SIZE, (page - 1) * INVOICE_BATCH_SIZE]);
    const orders = groupOrders(result.rows);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, error: "Invoice batch not found" });
    }

    const invoices = [];
    for (const order of orders) {
      invoices.push({ order, pdfBuffer: await generateInvoicePDF(order) });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="accepted-invoices-batch-${page}.zip"`);
    res.setHeader("Cache-Control", "private, no-store");

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (error) => res.destroy(error));
    archive.pipe(res);

    for (const { order, pdfBuffer } of invoices) {
      archive.append(pdfBuffer, { name: `invoice-${order.invoice_id}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    console.error("❌ Failed to generate batch invoices:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Failed to generate invoices" });
    else res.destroy(err);
  }
}

// POST /api/invoices/sync-sheet -> pushes completed-but-not-yet-synced
// orders' line items into the Google Sheet configured via GOOGLE_SHEET_ID
// (see googleSheetsSync.js for one-time setup steps), then marks them
// synced so a second click doesn't re-append the same rows.
async function syncCompletedOrdersToSheet(req, res) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["semis-kitchen-google-sheets-sync"]);
    const result = await client.query(COMPLETED_ORDERS_QUERY);
    const { appended, alreadyPresent, confirmedOrderIds } = await pushOrderRowsToSheet(result.rows);

    if (confirmedOrderIds.length > 0) {
      await client.query(`UPDATE orders SET synced_at = now() WHERE id = ANY($1)`, [confirmedOrderIds]);
    }

    await client.query("COMMIT");
    res.json({ success: true, appended, alreadyPresent });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Failed to sync orders to sheet:", err);
    res.status(500).json({ success: false, error: "Failed to sync to Google Sheets" });
  } finally {
    client.release();
  }
}

module.exports = { getInvoice, getInvoiceSharePage, getAcceptedInvoiceBatchInfo, getAcceptedInvoicesZip, syncCompletedOrdersToSheet };
