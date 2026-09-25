// Optional browser check: run against a local Vite server with Playwright installed.
// Every API request is intercepted; no real orders, emails, or database writes.
import assert from "node:assert/strict";
import snapshot from "../src/menuSnapshot.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const base = process.env.TEST_SITE_URL || "http://127.0.0.1:5174";
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const menu = snapshot.map((item) => ({ ...item, stock: 0, available: true, stockGroupId: item.id.replace(/^(fr|fz)-/, "") }));
// An admin price override must be reflected when switching weights.
menu.find((item) => item.id === "mc-chattipathiri-1-5kg").price = 490;
const inventory = menu.map((item) => ({ menu_item_id: item.id, stock: 0, selling_price: item.price, available: false, stock_group_id: item.stockGroupId }));
const offerRequests = [];
let lastOrder;
const checkoutKeys = [];
const checkoutBodies = [];
const errors = [];
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  let data = [];
  if (pathname.startsWith('/api/offers')) offerRequests.push(pathname);
  if (pathname === "/api/menu" || pathname === "/api/menu/admin") data = menu;
  else if (pathname === "/api/inventory" || pathname === "/api/inventory/admin") data = inventory;
  else if (pathname.startsWith("/api/inventory/") && request.method() === "PUT") {
    const id = pathname.split("/").at(-1);
    const item = inventory.find((entry) => entry.menu_item_id === id);
    const change = request.postDataJSON();
    if (change.stock !== undefined) inventory.filter((entry) => entry.stock_group_id === item.stock_group_id).forEach((entry) => { entry.stock = change.stock; });
    data = item;
  } else if (pathname === "/api/orders" && request.method() === "POST") {
    checkoutKeys.push(request.headers()["idempotency-key"]);
    lastOrder = request.postDataJSON();
    checkoutBodies.push(lastOrder);
    // Simulate a saved order whose response was lost. A retry must reuse its key.
    if (checkoutKeys.length === 1) return route.abort("failed");
    data = { id: "TEST-ONLY", invoice_id: "TEST-INVOICE", total: 240, items: lastOrder.items, status: "pending", created_at: new Date().toISOString() };
  }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, data }) });
});
await context.route(/https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());
const page = await context.newPage();
await page.clock.install();
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Biriyani & Curries", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().waitFor();
  assert.deepEqual(offerRequests, [], 'The regular menu must not request retired offers');
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
  // Fresh customer page: zero stock with production available still permits orders.
  await page.goto(base);
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  assert.equal(await page.getByText(/Insufficient stock/).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.goto(`${base}/nashi`);
  await page.getByRole("button", { name: "Open admin navigation" }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByPlaceholder("Stock").first().waitFor();
  const beforeCount = await page.getByPlaceholder("Stock").count();
  assert.equal(beforeCount, menu.filter((item) => item.cat !== "mains").length);
  assert.equal(await page.getByPlaceholder("Stock").first().inputValue(), "0");
  await page.getByPlaceholder("Stock").first().fill("11");
  await page.getByPlaceholder("Stock").first().press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll('input[placeholder="Stock"]')].filter((input) => input.value === "11").length === 2);

  assert.equal(await page.getByRole("button", { name: "24-hour offers", exact: true }).count(), 0);
  await page.goto(`${base}/o/TESTDEAL`);
  await page.waitForURL(`${base}/`);
  await page.getByRole("button", { name: "Frozen Snacks", exact: true }).click();
  const snack = page.locator('main .group').filter({ hasText: 'Irachi Pathiri' });
  await snack.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "₹150", exact: true }).click();
  await page.getByRole("button", { name: "Proceed to checkout" }).click();
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  await page.getByPlaceholder("Full name").fill("Test Customer");
  await page.getByPlaceholder("Phone number").fill("9876543210");
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(tomorrow);
  await page.locator("select").selectOption("12-13");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "couldn't place your order" }).first().waitFor();
  menu.find(item => item.id === 'fz-irachi-pathiri').available = false;
  const pausedRefresh = page.waitForResponse(response => response.url().endsWith('/api/menu'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pausedRefresh;
  await page.getByRole('button', { name: 'Retry original order', exact: true }).waitFor({ timeout: 3000 });
  // Advance past the selected delivery day. The server
  // can still replay an accepted request; the UI must retain its original key.
  await page.clock.fastForward(3 * 86400000);
  await page.getByPlaceholder("Full name").fill("Changed Customer");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'highlighted required fields' }).first().waitFor();
  assert.equal(checkoutKeys.length, 1, 'A changed checkout must not bypass delivery-date validation');
  await page.getByPlaceholder("Full name").fill("Test Customer");
  await page.getByRole("button", { name: "Retry original order", exact: true }).click();
  await page.getByText("Order sent!", { exact: true }).waitFor();
  assert.match(checkoutKeys[0] || "", /^[0-9a-f-]{36}$/i);
  assert.equal(checkoutKeys[1], checkoutKeys[0], "Network retry must preserve the original checkout key");
  assert.deepEqual(checkoutBodies[1], checkoutBodies[0], 'Menu refresh must not change an unresolved original order');
  assert.equal(lastOrder.offerSlug, undefined);
  assert.equal(lastOrder.items[0].qty, 10);
  assert.deepEqual(offerRequests, []);
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: Chattipathiri weights, combos, photos, zero-stock ordering, Sunday validation, shared integer stock, retired links, regular checkout retries, mobile width.");
} finally { await browser.close(); }
