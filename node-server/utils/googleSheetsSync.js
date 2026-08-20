const { sheets } = require("@googleapis/sheets");
const { JWT } = require("google-auth-library");

const SHEETS_REQUEST_OPTIONS = Object.freeze({
  timeout: 15_000,
  retry: false,
});

// --- One-time setup (do this in Google Cloud Console, not in code) ---
// 1. Create/select a project -> APIs & Services -> Library -> enable "Google Sheets API".
// 2. APIs & Services -> Credentials -> Create Credentials -> Service account.
// 3. Open the service account -> Keys -> Add Key -> Create new key -> JSON.
// 4. Open your target Google Sheet -> Share -> paste the service account's
//    client_email -> give it Editor access.
// 5. Copy the spreadsheet ID from its URL.
//
// --- Env vars to set on Vercel (Settings -> Environment Variables) ---
// GOOGLE_SERVICE_ACCOUNT_EMAIL = client_email from the JSON key
// GOOGLE_PRIVATE_KEY           = private_key from the JSON key, with real
//                                 newlines escaped as \n (paste as one line)
// GOOGLE_SHEET_ID              = the spreadsheet ID from step 5

function getSheetsClient() {
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheets({ version: "v4", auth });
}

function buildSheetSyncPlan(rows, existingIds) {
  const seen = new Set();
  const orders = [];
  for (const row of rows) {
    if (seen.has(row.order_id)) continue;
    seen.add(row.order_id);
    orders.push(row);
  }
  const missing = orders.filter((order) => !existingIds.has(String(order.order_id)));
  return {
    missing,
    alreadyPresent: orders.length - missing.length,
    confirmedOrderIds: orders.map((order) => order.order_id),
  };
}

// rows: raw pg result rows (one row per order item). Collapses to ONE sheet row
// per order with only the fields needed for an order-level log.
async function pushOrderRowsToSheet(rows, sheetName = "Orders") {
  if (!rows.length) return { appended: 0, alreadyPresent: 0, confirmedOrderIds: [] };

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const existingResponse = await sheets.spreadsheets.values.get(
    {
      spreadsheetId,
      range: `${sheetName}!B:B`,
      majorDimension: "COLUMNS",
    },
    SHEETS_REQUEST_OPTIONS
  );
  const existingIds = new Set(
    (existingResponse.data.values?.[0] || []).map((value) => String(value).trim()).filter(Boolean)
  );
  const { missing, alreadyPresent, confirmedOrderIds } = buildSheetSyncPlan(rows, existingIds);
  const values = missing.map((r) => [
    r.invoice_id,
    r.order_id,
    new Date(r.created_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
    r.name,
    r.phone,
    r.total,
    r.payment_method,
  ]);

  if (values.length > 0) {
    await sheets.spreadsheets.values.append(
      {
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      },
      SHEETS_REQUEST_OPTIONS
    );
  }

  return {
    appended: values.length,
    alreadyPresent,
    confirmedOrderIds,
  };
}

async function writeHeaderRow(sheetName = "Orders") {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const header = ["invoice_id", "order_id", "created_at", "name", "phone", "total", "payment_method"];
  await sheets.spreadsheets.values.update(
    {
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] },
    },
    SHEETS_REQUEST_OPTIONS
  );
}

module.exports = { getSheetsClient, buildSheetSyncPlan, pushOrderRowsToSheet, writeHeaderRow };
