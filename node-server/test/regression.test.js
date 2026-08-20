const { after, test } = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL ||= "postgresql://user:pass@localhost:5432/semis_test";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

const db = require("../config/db");
const {
  COOKIE_NAME, createSessionToken, validSession, cookieOptions,
} = require("../middleware/adminAuth");
const { validateDeliveryDetails, validateMainsTiming } = require("../models/orderModel");
const { buildSheetSyncPlan } = require("../utils/googleSheetsSync");
const { groupOrders, money, paymentLabel } = require("../utils/invoiceGenerator");
const { normalizeIndianPhone } = require("../utils/whatsappNotify");
const { getAllowedOrigins } = require("../app");

after(() => db.end());

function requestWithToken(token) {
  return { headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` } };
}

function expectInvalid(fn) {
  assert.throws(fn, (error) => error?.code === "INVALID_ORDER");
}

test("admin sessions accept valid tokens and reject malformed, tampered, and expired tokens", () => {
  const originalNow = Date.now;
  const issuedAt = originalNow();
  Date.now = () => issuedAt;
  try {
    const token = createSessionToken();
    assert.equal(validSession(requestWithToken(token)), true);
    assert.equal(validSession(requestWithToken(`${token}x`)), false);
    assert.equal(validSession({ headers: { cookie: `${COOKIE_NAME}=%ZZ` } }), false);
    Date.now = () => issuedAt + (12 * 60 * 60 * 1000) + 1;
    assert.equal(validSession(requestWithToken(token)), false);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(cookieOptions().sameSite, "lax");
  assert.equal(cookieOptions().httpOnly, true);
});

test("production CORS excludes localhost while development keeps it", () => {
  assert.equal(getAllowedOrigins("production", "").includes("http://localhost:5173"), false);
  assert.equal(getAllowedOrigins("development", "").includes("http://localhost:5173"), true);
  assert.equal(getAllowedOrigins("production", "https://preview.example").includes("https://preview.example"), true);
});

test("checkout validation enforces address, date range, slots, and mains timing", () => {
  const today = "2026-08-20";
  const valid = { address: "Test address", location: null, deliveryDate: today, deliverySlot: "11-12" };
  validateDeliveryDetails(valid, "Delivery", today);
  expectInvalid(() => validateDeliveryDetails({ ...valid, address: "" }, "Delivery", today));
  expectInvalid(() => validateDeliveryDetails({ ...valid, deliveryDate: "2026-08-19" }, "Delivery", today));
  expectInvalid(() => validateDeliveryDetails({ ...valid, deliveryDate: "2026-02-30" }, "Delivery", today));
  expectInvalid(() => validateDeliveryDetails({ ...valid, deliveryDate: "2026-11-19" }, "Delivery", today));
  expectInvalid(() => validateDeliveryDetails({ ...valid, deliverySlot: "21-22" }, "Delivery", today));
  expectInvalid(() => validateMainsTiming([{ categoryId: "mains" }], valid, "Delivery", today));
  validateMainsTiming([{ categoryId: "fried" }], valid, "Delivery", today);
  validateMainsTiming([{ categoryId: "mains" }], valid, "Pickup", today);
});

test("Google Sheets sync plan deduplicates order rows and existing IDs", () => {
  const rows = [
    { order_id: "A", item: 1 },
    { order_id: "A", item: 2 },
    { order_id: "B", item: 1 },
  ];
  const plan = buildSheetSyncPlan(rows, new Set(["A"]));
  assert.deepEqual(plan.missing.map((row) => row.order_id), ["B"]);
  assert.equal(plan.alreadyPresent, 1);
  assert.deepEqual(plan.confirmedOrderIds, ["A", "B"]);
});

test("invoice rows group without phantom items and format payment values", () => {
  const orders = groupOrders([
    { order_id: "A", invoice_id: "I", order_item_id: 1, item_name: "Roll", quantity: 2, unit_price: 10, subtotal: 20 },
    { order_id: "A", invoice_id: "I", order_item_id: 2, item_name: "Tea", quantity: 1, unit_price: 5, subtotal: 5 },
    { order_id: "B", invoice_id: "J", order_item_id: null },
  ]);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[1].items.length, 0);
  assert.equal(money(25), "25.00");
  assert.equal(paymentLabel("upi"), "UPI");
  assert.equal(paymentLabel("cod"), "COD");
});

test("retained WhatsApp phone normalization does not make network calls", () => {
  assert.equal(normalizeIndianPhone("98765 43210"), "919876543210");
  assert.equal(normalizeIndianPhone("+91 98765 43210"), "919876543210");
  assert.equal(normalizeIndianPhone("12345"), "12345");
});
