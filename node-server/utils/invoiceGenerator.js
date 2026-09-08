const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");

const TEMPLATE_PATH = path.join(__dirname, "templates", "E_BILL.pdf");
const FONT_REGULAR_PATH = path.join(__dirname, "fonts", "OpenSans-Regular.ttf");
const FONT_BOLD_PATH = path.join(__dirname, "fonts", "OpenSans-Bold.ttf");

// ---- Layout constants, measured directly off E_BILL.pdf's label positions ----
// (x, yTop) where yTop is distance from the TOP of the page — we convert to
// pdf-lib's bottom-origin coordinates at draw time using pageHeight. x is set
// to (label's right edge + 6pt gap) so every value starts a consistent
// distance after its key label.
const LAYOUT = {
  name: { x: 150.4, yTop: 248.7 },
  phone: { x: 178.6, yTop: 266.6 },
  invoiceNo: { x: 186.2, yTop: 284.6 },
  orderId: { x: 171.8, yTop: 302.6 },
  date: { x: 460.6, yTop: 241.8 },
  time: { x: 460.5, yTop: 255.5 },

  table: {
    // Header underline sits at yTop 395.9; the payment/total line sits at
    // 569.3. 7 rows spaced evenly across that 173.4pt gap, with matching
    // padding above the first row and below the last.
    firstRowYTop: 417.7,
    rowHeight: 21.7,
    maxRowsPerPage: 7,
    desc: { x: 116.8, align: "left" },
    unitPrice: { rightX: 347.6, align: "right" },
    qty: { centerX: 386.7, align: "center" },
    subtotal: { rightX: 477.3, align: "right" },
  },

  paymentMethod: { x: 236.5, yTop: 603.4 },
  total: { rightX: 477.3, yTop: 599.4 },
};

const FONT_SIZE = 10;
const INK = rgb(0.13, 0.13, 0.13);
const INDIA_TIME_ZONE = "Asia/Kolkata";

function money(n) {
  return Number(n).toFixed(2);
}

function fmtDate(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(d) {
  const dt = new Date(d);
  return dt.toLocaleTimeString("en-IN", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function paymentLabel(code) {
  return code === "upi" ? "UPI" : "COD";
}

/**
 * Groups the flat SQL rows (one row per order_item) into one object per order.
 * Expects rows shaped like the query in getInvoiceRows() below.
 */
function groupOrders(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.order_id)) {
      map.set(r.order_id, {
        invoice_id: r.invoice_id,
        order_id: r.order_id,
        created_at: r.created_at,
        name: r.name,
        phone: r.phone,
        total: r.total,
        payment_method: r.payment_method,
        items: [],
      });
    }
    // LEFT-joined orders with no items would produce a null order_items row —
    // guard against that so an empty order doesn't get a phantom blank line.
    if (r.order_item_id != null) {
      map.get(r.order_id).items.push({
        name: r.item_name,
        quantity: r.quantity,
        unit_price: r.unit_price,
        subtotal: r.subtotal,
      });
    }
  }
  return Array.from(map.values());
}

function drawTextRight(page, font, text, rightX, yTop, pageHeight, size = FONT_SIZE) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - width, y: pageHeight - yTop, size, font, color: INK });
}

function drawTextCenter(page, font, text, centerX, yTop, pageHeight, size = FONT_SIZE) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - width / 2, y: pageHeight - yTop, size, font, color: INK });
}

function drawTextLeft(page, font, text, x, yTop, pageHeight, size = FONT_SIZE) {
  page.drawText(text, { x, y: pageHeight - yTop, size, font, color: INK });
}

/**
 * Renders one order into a filled PDF (Buffer). Automatically spans multiple
 * template pages if the order has more line items than fit on one page.
 */
async function generateInvoicePDF(order) {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  // Same typeface as the template's own labels (Open Sans), so values sit
  // in visual sync with the bold keys instead of a mismatched system font.
  const font = await out.embedFont(fs.readFileSync(FONT_REGULAR_PATH));
  const fontBold = await out.embedFont(fs.readFileSync(FONT_BOLD_PATH));

  const { table } = LAYOUT;
  const pages = [];
  for (let i = 0; i < order.items.length; i += table.maxRowsPerPage) {
    pages.push(order.items.slice(i, i + table.maxRowsPerPage));
  }
  if (pages.length === 0) pages.push([]); // orders with zero items still get an invoice

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const templateDoc = await PDFDocument.load(templateBytes);
    const [templatePage] = await out.copyPages(templateDoc, [0]);
    out.addPage(templatePage);
    const page = templatePage;
    const { height: pageHeight } = page.getSize();
    const isLastPage = pageIdx === pages.length - 1;

    // Header fields only make sense once — draw them on every page for
    // simplicity (cheap paper, but never ambiguous which order this is).
    drawTextLeft(page, font, order.name || "", LAYOUT.name.x, LAYOUT.name.yTop, pageHeight);
    drawTextLeft(page, font, order.phone || "", LAYOUT.phone.x, LAYOUT.phone.yTop, pageHeight);
    drawTextLeft(page, font, String(order.invoice_id ?? ""), LAYOUT.invoiceNo.x, LAYOUT.invoiceNo.yTop, pageHeight);
    drawTextLeft(page, font, String(order.order_id ?? ""), LAYOUT.orderId.x, LAYOUT.orderId.yTop, pageHeight);
    drawTextLeft(page, font, fmtDate(order.created_at), LAYOUT.date.x, LAYOUT.date.yTop, pageHeight);
    drawTextLeft(page, font, fmtTime(order.created_at), LAYOUT.time.x, LAYOUT.time.yTop, pageHeight);

    // Line items
    let yTop = table.firstRowYTop;
    for (const item of pages[pageIdx]) {
      drawTextLeft(page, font, item.name || "", table.desc.x, yTop, pageHeight);
      drawTextRight(page, font, money(item.unit_price), table.unitPrice.rightX, yTop, pageHeight);
      drawTextCenter(page, font, String(item.quantity), table.qty.centerX, yTop, pageHeight);
      drawTextRight(page, font, money(item.subtotal), table.subtotal.rightX, yTop, pageHeight);
      yTop += table.rowHeight;
    }

    // Payment method (regular weight, like other values) + total (bold,
    // matching the TOTAL label's weight) only on the final page
    if (isLastPage) {
      drawTextLeft(page, fontBold, paymentLabel(order.payment_method), LAYOUT.paymentMethod.x, LAYOUT.paymentMethod.yTop, pageHeight);
      drawTextRight(page, fontBold, money(order.total), LAYOUT.total.rightX, LAYOUT.total.yTop, pageHeight, 11);
    }
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}

module.exports = { generateInvoicePDF, groupOrders, money, fmtDate, fmtTime, paymentLabel };
