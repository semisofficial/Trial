// Focused Admin Items browser regression. Run against local Vite; every API
// request is intercepted so this never reads or writes a real backend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const uploadedPhotoFixture = readFileSync(new URL('../src/assets/images/broasted.jpeg', import.meta.url));

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const base = process.env.TEST_SITE_URL || "http://127.0.0.1:5185";

const items = [
  { id: "mc-broasted-chicken", name: "Broasted Chicken", cat: "mains", unit: "8 pieces", minQty: 1, step: 1, isCombo: false, img: "", isDraft: false, revision: "rev-broasted" },
  { id: "fr-samoosa", name: "Samoosa", cat: "fried", unit: "1 piece", minQty: 5, step: 1, isCombo: false, img: "fr-samoosa.png", isDraft: false, revision: "rev-samoosa" },
  { id: "mc-chattipathiri-1kg", name: "Family Chattipathiri 1 kg", cat: "mains", unit: "1 kg", minQty: 1, step: 1, isCombo: false, img: "/api/items/mc-chattipathiri-1kg/photo?v=12345678-1234-4234-8234-123456789abc", isDraft: false, revision: "rev-chatti" },
  { id: "draft-stew", name: "Pepper Stew", cat: "mains", unit: "1 pot", minQty: 1, step: 1, isCombo: false, img: "", isDraft: true, revision: "rev-draft" },
];
const adminMenu = items.map((item) => ({ ...item, price: item.id === "draft-stew" ? 0 : 250, stock: 0, available: item.id !== "draft-stew", stockGroupId: item.id }));
const inventory = adminMenu.map((item) => ({
  menu_item_id: item.id,
  stock: item.stock,
  selling_price: item.price,
  available: item.available,
  stock_group_id: item.stockGroupId,
  isDraft: item.isDraft,
}));

const requests = [];
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  requests.push({ path: url.pathname, method: request.method(), body: request.postData(), headers: request.headers() });

  const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ success: status < 400, data }) });
  if (url.pathname === "/api/admin/session") return json({ authenticated: true });
  if (url.pathname === "/api/items" && request.method() === "GET") return json(items);
  if (url.pathname === "/api/items" && request.method() === "POST") {
    const body = request.postDataJSON();
    const created = { id: "new-bread", ...body, img: "", isDraft: true, revision: "rev-new" };
    items.push(created);
    adminMenu.push({ ...created, price: 0, stock: 0, available: false, stockGroupId: created.id });
    inventory.push({ menu_item_id: created.id, stock: 0, selling_price: 0, available: false, stock_group_id: created.id, isDraft: true });
    return json(created, 201);
  }
  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch && request.method() === "PUT") {
    const item = items.find((entry) => entry.id === itemMatch[1]);
    if (request.headers()["if-match"] !== `"${item.revision}"`) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, message: "This item was changed by another staff member" }) });
    }
    Object.assign(item, request.postDataJSON(), { revision: `rev-${Date.now()}` });
    Object.assign(adminMenu.find((entry) => entry.id === item.id), item);
    return json(item);
  }
  if (itemMatch && request.method() === "DELETE") {
    const index = items.findIndex((entry) => entry.id === itemMatch[1]);
    items.splice(index, 1);
    return json({ retired: true });
  }
  const photoMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/photo$/);
  if (photoMatch && request.method() === "PUT") {
    const item = items.find((entry) => entry.id === photoMatch[1]);
    item.img = `/api/items/${item.id}/photo?v=photo-new`;
    item.revision = "rev-photo";
    return json(item);
  }
  if (photoMatch && request.method() === "GET") return route.fulfill({ status: 200, contentType: 'image/jpeg', body: uploadedPhotoFixture });
  if (url.pathname === "/api/menu/admin") return json(adminMenu);
  if (url.pathname === "/api/inventory/admin") return json(inventory);
  if (url.pathname === "/api/menu") return json(adminMenu.filter((item) => !item.isDraft));
  if (url.pathname === "/api/inventory") return json(inventory.filter((item) => !item.isDraft));
  if (url.pathname.startsWith("/api/inventory/") && request.method() === "PUT") {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const row = inventory.find((entry) => entry.menu_item_id === id);
    const patch = request.postDataJSON();
    Object.assign(row, {
      ...(patch.price !== undefined ? { selling_price: patch.price } : {}),
      ...(patch.available !== undefined ? { available: patch.available } : {}),
      ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
    });
    if (patch.available === true && Number(row.selling_price) > 0) row.isDraft = false;
    const menuItem = adminMenu.find((entry) => entry.id === id);
    Object.assign(menuItem, { price: row.selling_price, available: row.available, isDraft: row.isDraft });
    const managed = items.find((entry) => entry.id === id);
    if (managed) managed.isDraft = row.isDraft;
    return json(row);
  }
  if (url.pathname === "/api/orders" || url.pathname === "/api/orders/archived") return json([]);
  if (url.pathname === "/api/invoices/batch-info") return json({ totalInvoices: 0, batchSize: 3, totalBatches: 0 });
  if (url.pathname === "/api/payment-qr") return json({ configured: false, version: null });
  return json([]);
});
await context.route(/https?:\/\/(?!127\.0\.0\.1|localhost).*/, (route) => route.abort());

const page = await context.newPage();
async function openItems() {
  await page.getByRole('button', { name: 'Open admin navigation' }).click();
  await page.getByRole('button', { name: 'Items', exact: true }).click();
}
page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
page.on("console", (message) => console.log("BROWSER", message.type(), message.text()));
page.on("requestfailed", (request) => console.log("REQUEST FAILED", request.url(), request.failure()?.errorText));
try {
  await page.goto(`${base}/nashi`);
  await openItems();

  await page.getByRole("heading", { name: "Items", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Search items").count(), 1);
  assert.equal(await page.getByLabel("Filter items by category").count(), 1);
  assert.equal(await page.getByText("Pepper Stew", { exact: true }).count(), 1);
  const itemsPanel = page.getByTestId("items-manager");
  const bundledPhoto = page.getByTestId('item-mc-broasted-chicken').locator('img');
  assert.equal(await bundledPhoto.count(), 1, 'Items must use the same bundled photo fallback as the customer menu');
  await bundledPhoto.evaluate(img => img.decode());
  const bundledSrc = await bundledPhoto.getAttribute('src');
  await page.getByRole('button', { name: 'Edit Broasted Chicken', exact: true }).click();
  assert.equal(await page.getByAltText('Current item photo').getAttribute('src'), bundledSrc);
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await bundledPhoto.getAttribute('src'), bundledSrc, 'Saving metadata must retain the bundled photo');
  assert.match(await page.getByTestId('item-mc-chattipathiri-1kg').locator('img').getAttribute('src'), /\/api\/items\//, 'Uploaded photo must take priority over bundled fallback');
  assert.match(await page.getByTestId('item-draft-stew').innerText(), /Photo coming soon/, 'Truly missing photos retain the placeholder');
  assert.equal(await itemsPanel.getByPlaceholder("Price").count(), 0, "Items must not expose prices");
  assert.equal(await itemsPanel.getByPlaceholder("Stock").count(), 0, "Items must not expose stock");
  assert.doesNotMatch(await itemsPanel.innerText(), /₹|shared stock/i, "Items must not display price or stock values");

  await page.getByLabel("Search items").fill("pepper");
  assert.equal(await page.getByText("Samoosa", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Pepper Stew", { exact: true }).count(), 1);
  await page.getByLabel("Search items").fill("");
  await page.getByLabel("Filter items by category").selectOption("fried");
  assert.equal(await page.getByText("Samoosa", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Pepper Stew", { exact: true }).count(), 0);
  await page.getByLabel("Filter items by category").selectOption("all");

  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill("Malabar Bread");
  await page.getByLabel("Category", { exact: true }).selectOption("mains");
  await page.getByLabel("Unit").fill("1 piece");
  await page.getByLabel("Minimum quantity").fill("1");
  await page.getByLabel("Quantity increment").fill("1");
  await page.getByLabel("Combo item").check();
  await page.getByRole("button", { name: "Save item" }).click();
  await page.getByText("Malabar Bread", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(requests.find((entry) => entry.path === "/api/items" && entry.method === "POST").body), {
    name: "Malabar Bread", cat: "mains", unit: "1 piece", minQty: 1, step: 1, isCombo: true,
  });
  assert.match(await page.getByTestId("item-new-bread").innerText(), /Draft/);

  await page.getByTestId("item-new-bread").getByRole("button", { name: "Edit Malabar Bread" }).click();
  const upload = page.getByLabel("Item photo");
  await upload.setInputFiles({ name: "bread.png", mimeType: "image/png", buffer: Buffer.from("fake png preview") });
  await page.getByAltText("New photo preview").waitFor();
  await page.getByRole("button", { name: "Cancel photo" }).click();
  assert.equal(await page.getByAltText("New photo preview").count(), 0);
  await upload.setInputFiles({ name: "bread.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fake jpeg preview") });
  await page.getByRole("button", { name: "Save photo" }).click();
  const photoRequest = requests.find((entry) => entry.path === "/api/items/new-bread/photo" && entry.method === "PUT");
  assert.equal(photoRequest.headers["content-type"], "image/jpeg");
  assert.equal(photoRequest.headers["if-match"], '"rev-new"');
  await page.getByRole("button", { name: "Close item editor" }).click();

  await page.getByTestId("item-draft-stew").getByRole("button", { name: "Go to Inventory" }).click();
  await page.getByRole("heading", { name: "Pepper Stew", exact: true }).waitFor();
  const draftCard = page.getByTestId("inventory-draft-stew");
  assert.match(await draftCard.innerText(), /Draft/);
  assert.equal(await draftCard.getByRole("button", { name: "Enable item" }).isDisabled(), true);
  await draftCard.getByPlaceholder("Price").fill("275");
  await draftCard.getByRole("button", { name: "Save price" }).click();
  await draftCard.getByRole("button", { name: "Enable item" }).click();
  await openItems();
  assert.match(await page.getByTestId("item-draft-stew").innerText(), /Published/);

  await page.getByTestId("item-fr-samoosa").getByRole("button", { name: "Edit Samoosa" }).click();
  await page.getByLabel("Item name").fill("Crisp Samoosa");
  await page.getByRole("button", { name: "Save item" }).click();
  await page.getByText("Crisp Samoosa", { exact: true }).waitFor();
  const editRequest = requests.find((entry) => entry.path === "/api/items/fr-samoosa" && entry.method === "PUT");
  assert.equal(editRequest.headers["if-match"], '"rev-samoosa"');

  await page.getByTestId("item-fr-samoosa").getByRole("button", { name: "Delete Crisp Samoosa" }).click();
  assert.match(await page.getByRole("dialog").innerText(), /Crisp Samoosa/);
  assert.match(await page.getByRole("dialog").innerText(), /orders.*preserved/i);
  await page.getByRole("button", { name: "Retire item" }).click();
  await page.getByTestId("item-fr-samoosa").waitFor({state:'detached'});
  assert.equal(await page.getByText("Crisp Samoosa", { exact: true }).count(), 0);

  assert.ok(requests.some((entry) => entry.path === "/api/menu/admin"), "Admin must load the private menu endpoint");
  assert.ok(requests.some((entry) => entry.path === "/api/inventory/admin"), "Admin must load the private inventory endpoint");
  assert.equal(requests.some((entry) => entry.path === "/api/menu" && page.url().endsWith("/nashi")), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await openItems();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('button', { name: 'Save item' }).click();
  assert.match(await page.getByRole('dialog').getByRole('alert').innerText(), /Name and unit are required/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile must not overflow horizontally');
  await page.getByRole('button', { name: 'Close item editor' }).click();
  console.log("Admin Items browser checks passed: safe CRUD, filtering, photo workflow, draft handoff, private loaders, and no price/stock leakage.");
} finally {
  await browser.close();
}
