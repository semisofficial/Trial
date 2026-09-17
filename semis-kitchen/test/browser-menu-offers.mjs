// Optional browser check: run against a local Vite server with Playwright installed.
// Every API request is intercepted; no real orders, emails, or database writes.
import assert from "node:assert/strict";
import snapshot from "../src/menuSnapshot.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const base = process.env.TEST_SITE_URL || "http://127.0.0.1:5174";
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const menu = snapshot.map((item) => ({ ...item, stock: 0, available: false, stockGroupId: item.id.replace(/^(fr|fz)-/, "") }));
// An admin price override must be reflected when switching weights.
menu.find((item) => item.id === "mc-chattipathiri-1-5kg").price = 490;
const inventory = menu.map((item) => ({ menu_item_id: item.id, stock: 0, selling_price: item.price, available: false, stock_group_id: item.stockGroupId }));
let active = [];
let lastOrder;
const checkoutKeys = [];
const errors = [];
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  let data = [];
  let extra = {};
  if (pathname === "/api/menu") data = menu;
  else if (pathname === "/api/inventory") data = inventory;
  else if (pathname.startsWith("/api/inventory/") && request.method() === "PUT") {
    const id = pathname.split("/").at(-1);
    const item = inventory.find((entry) => entry.menu_item_id === id);
    const change = request.postDataJSON();
    if (change.stock !== undefined) inventory.filter((entry) => entry.stock_group_id === item.stock_group_id).forEach((entry) => { entry.stock = change.stock; });
    data = item;
  } else if (pathname === "/api/orders" && request.method() === "POST") {
    checkoutKeys.push(request.headers()["idempotency-key"]);
    lastOrder = request.postDataJSON();
    // Simulate a saved order whose response was lost. A retry must reuse its key.
    if (checkoutKeys.length === 1) return route.abort("failed");
    data = { id: "TEST-ONLY", invoice_id: "TEST-INVOICE", total: 240, items: lastOrder.items, status: "pending", created_at: new Date().toISOString() };
  } else if (pathname === "/api/offers" && request.method() === "POST") {
    data = { ...request.postDataJSON(), slug: "TESTDEAL", starts_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
    active = [data];
  } else if (pathname === "/api/offers") { data = active; extra.serverNow = new Date().toISOString(); }
  else if (pathname === "/api/offers/TESTDEAL") { data = active[0]; extra.serverNow = new Date().toISOString(); }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data, ...extra }) });
});
await context.route(/https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
const page = await context.newPage();
await page.clock.install();
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Biriyani & Curries", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().waitFor();
  assert.match(await page.locator("main .group").first().innerText(), /1\s+combo/);
  await page.getByRole("button", { name: "Mains", exact: true }).click();
  assert.equal(await page.locator("main .group").filter({ hasText: /1\s+combo/ }).count(), 0);
  const chattipathiri = page.locator("main .group").filter({ hasText: "Chattipathiri" });
  assert.equal(await chattipathiri.count(), 1, "All Chattipathiri weights must share one card");
  assert.doesNotMatch(await chattipathiri.innerText(), /1 pack/i, "Chattipathiri's card must not show pack subtext");
  assert.equal(await page.getByText("Ordering information", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Questions customers often ask" }).count(), 0);
  assert.match(await chattipathiri.innerText(), /₹350/);
  await chattipathiri.getByRole("button", { name: "Add", exact: true }).click();
  await chattipathiri.getByRole("button", { name: "1.5 kg", exact: true }).click();
  assert.match(await chattipathiri.innerText(), /₹490/);
  await chattipathiri.getByRole("button", { name: "Add", exact: true }).click();
  await chattipathiri.getByRole("button", { name: "2 kg", exact: true }).click();
  assert.match(await chattipathiri.innerText(), /₹650/);
  await chattipathiri.getByRole("button", { name: "Add", exact: true }).click();
  await chattipathiri.getByRole("button", { name: "1 kg", exact: true }).click();
  assert.equal(await chattipathiri.getByRole("button", { name: "Add", exact: true }).count(), 0, "Switching weights preserves that weight's cart quantity");
  await page.getByRole("button", { name: "₹1,490", exact: true }).click();
  for (const weight of ["1 kg", "1.5 kg", "2 kg"]) await page.getByText(`Chattipathiri - ${weight}`, { exact: true }).waitFor();
  await page.goto(base);
  await page.getByRole("button", { name: "Biriyani & Curries", exact: true }).click();
  await page.getByRole("button", { name: "Mains", exact: true }).click();
  const rice = page.locator("main .group").filter({ hasText: "Ghee Rice" });
  await rice.locator('img').scrollIntoViewIfNeeded();
  await rice.locator('img').evaluate(img => img.decode());
  await rice.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "₹600", exact: true }).click();
  await page.getByRole("button", { name: "Proceed to checkout" }).click();
  const sunday = new Date(Date.now() + 2 * 86400000);
  sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7));
  await page.locator('input[type="date"]').fill(sunday.toISOString().slice(0, 10));
  await page.getByRole("alert").filter({ hasText: "Mains-only orders" }).waitFor();
  // Fresh customer page: zero stock/false availability must still allow snack ordering.
  await page.goto(base);
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  assert.equal(await page.getByText(/Insufficient stock/).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.goto(`${base}/nashi`);
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByPlaceholder("Stock").first().waitFor();
  const beforeCount = await page.getByPlaceholder("Stock").count();
  assert.equal(beforeCount, menu.filter((item) => item.cat !== "mains").length);
  assert.equal(await page.getByPlaceholder("Stock").first().inputValue(), "0");
  await page.getByPlaceholder("Stock").first().fill("11");
  await page.getByPlaceholder("Stock").first().press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll('input[placeholder="Stock"]')].filter((input) => input.value === "11").length === 2);

  await page.getByRole("button", { name: "24-hour offers", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByLabel("Minimum pieces").fill("20");
  await page.getByLabel("Offer ₹ per piece").fill("12");
  await page.getByRole("button", { name: "Publish for 24 hours" }).click();
  await page.getByText("Offer published.", { exact: false }).waitFor();
  assert.equal(active[0].items[0].minQty, 20);
  const shareUrl = new URL(await page.getByRole("link", { name: "Share on WhatsApp", exact: true }).getAttribute("href"));
  assert.ok(shareUrl.searchParams.get("text").includes(`${new URL(base).origin}/o/TESTDEAL`), "Offer sharing must stay on the test origin");
  await page.goto(`${base}/o/TESTDEAL`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "₹240", exact: true }).click();
  await page.getByRole("button", { name: "Proceed to checkout" }).click();
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  await page.getByPlaceholder("Full name").fill("Test Customer");
  await page.getByPlaceholder("Phone number").fill("919876543210");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(tomorrow);
  await page.locator("select").selectOption("12-13");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "couldn't place your order" }).first().waitFor();
  // Advance past the offer's expiry and the selected delivery day. The server
  // can still replay an accepted request; the UI must retain its original key.
  await page.clock.fastForward(3 * 86400000);
  await page.getByPlaceholder("Full name").fill("Changed Customer");
  assert.equal(await page.getByRole("button", { name: "Place order", exact: true }).isDisabled(), true, "Expired offers must not accept changed/new purchases");
  await page.getByPlaceholder("Full name").fill("Test Customer");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.getByText("Order sent!", { exact: true }).waitFor();
  assert.match(checkoutKeys[0] || "", /^[0-9a-f-]{36}$/i);
  assert.equal(checkoutKeys[1], checkoutKeys[0], "Network retry must preserve the original checkout key");
  assert.equal(lastOrder.offerSlug, "TESTDEAL");
  assert.equal(lastOrder.items[0].qty, 20);
  active[0].expires_at = new Date(Date.now() + 3000).toISOString();
  await page.goto(`${base}/o/TESTDEAL`);
  await page.getByRole("heading", { name: "Offer unavailable" }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("button", { name: "Add", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: single Chattipathiri card, weight prices/cart quantities, removed ordering section, combos, photos, zero-stock ordering, Sunday warning, shared integer stock, offer publishing/checkout/expiry, mobile width.");
} finally { await browser.close(); }
