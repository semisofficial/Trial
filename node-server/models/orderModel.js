const crypto = require("crypto");
const db = require("../config/db");
const orderStock = require('./orderStock');

const ORDER_SELECT = `
  SELECT o.id, o.invoice_id, o.status, o.order_mode, o.notes, o.total,
    o.created_at, o.payment_status, o.paymet AS payment_method, o.archived,
    o.delivery_date, o.delivery_slot, o.synced_at, o.invoice_share_token,
    c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
    c.latitude, c.longitude,
    COALESCE(json_agg(json_build_object('id', oi.menu_item_id, 'name', oi.item_name_snapshot,
      'qty', oi.quantity, 'price', oi.unit_price))
      FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
`;

function orderError(message, code = "INVALID_ORDER") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function makeOrderId() {
  return `SK${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function makeInvoiceShareToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw orderError("Your cart must contain between 1 and 100 items");
  }
  const combined = new Map();
  for (const item of items) {
    const id = String(item?.id || "").trim();
    const qty = Number(item?.qty);
    if (!id || !Number.isFinite(qty) || qty <= 0 || qty > 10000) {
      throw orderError("One or more cart quantities are invalid");
    }
    const aggregate = Math.round(((combined.get(id) || 0) + qty) * 1000) / 1000;
    if (aggregate > 10000) throw orderError("One or more cart quantities exceed the safety limit");
    combined.set(id, aggregate);
  }
  return [...combined].map(([id, qty]) => ({ id, qty }));
}

function normalizeCustomer(customer) {
  if (!customer || typeof customer !== "object") throw orderError("Customer details are required");
  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const address = String(customer.address || "").trim();
  const notes = String(customer.notes || "").trim();
  if (name.length < 2 || name.length > 100) throw orderError("Please enter a valid customer name");
  if (!/^\d{10}$/.test(phone)) throw orderError("Please enter a valid 10-digit phone number");
  if (address.length > 500 || notes.length > 1000) throw orderError("Customer details are too long");
  const location = customer.location?.lat != null && customer.location?.lng != null
    ? { lat: Number(customer.location.lat), lng: Number(customer.location.lng) }
    : null;
  if (location && (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)
      || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180)) {
    throw orderError("Delivery location is invalid");
  }
  return {
    name, phone, address, notes, location,
    email: null,
    paymentMethod: ["cod", "upi"].includes(customer.paymentMethod) ? customer.paymentMethod : "cod",
    deliveryDate: /^\d{4}-\d{2}-\d{2}$/.test(customer.deliveryDate || "") ? customer.deliveryDate : null,
    deliverySlot: /^([0-9]{1,2})-([0-9]{1,2})$/.test(customer.deliverySlot || "") ? customer.deliverySlot : null,
  };
}

const DELIVERY_SLOTS = new Set(Array.from({ length: 10 }, (_, index) => `${11 + index}-${12 + index}`));

function indiaTodayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function indiaMinutesOfDay(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function validISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validateDeliveryDetails(customer, orderMode, today = indiaTodayISO(), now = new Date()) {
  if (orderMode === "Delivery" && !customer.address && !customer.location) {
    throw orderError("A delivery address or map location is required");
  }
  if (!validISODate(customer.deliveryDate)) {
    throw orderError("Please select a valid delivery date");
  }
  const maximum = new Date(`${today}T00:00:00Z`);
  maximum.setUTCDate(maximum.getUTCDate() + 90);
  const maximumISO = maximum.toISOString().slice(0, 10);
  if (customer.deliveryDate < today || customer.deliveryDate > maximumISO) {
    throw orderError("Delivery date must be between today and 90 days from today");
  }
  if (!DELIVERY_SLOTS.has(customer.deliverySlot)) {
    throw orderError("Please select a valid delivery time between 11 AM and 9 PM");
  }
  if (customer.deliveryDate === today) {
    const slotStartMinutes = Number(customer.deliverySlot.split("-")[0]) * 60;
    if (slotStartMinutes < indiaMinutesOfDay(now)) {
      throw orderError("The selected same-day delivery slot has already started");
    }
  }
}

function validateMainsTiming(items, customer, orderMode) {
  // Category restrictions are independent of same-day slot availability.
  const hasMains = items.some((item) => item.categoryId === "mains");
  const hasSnacks = items.some((item) => ["fried", "frozen"].includes(item.categoryId));
  if (orderMode === "Delivery" && hasMains && !hasSnacks
      && new Date(`${customer.deliveryDate}T00:00:00Z`).getUTCDay() === 0) {
    throw orderError("Mains-only orders cannot be delivered on Sunday. Choose another date or include fried or frozen snacks.");
  }
}

function followsQuantityRule(qty, minQty, stepQty) {
  if (qty + 1e-9 < minQty) return false;
  const steps = (qty - minQty) / stepQty;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}

async function priceItems(client, requestedItems) {
  const result = await client.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.min_qty, mi.step_qty,
            i.selling_price, i.available
       FROM menu_items mi JOIN inventory i ON i.menu_item_id = mi.id
      WHERE mi.id = ANY($1::text[]) AND NOT mi.retired AND NOT mi.is_draft FOR SHARE OF mi, i`,
    [requestedItems.map((item) => item.id)]
  );
  const catalog = new Map(result.rows.map((row) => [String(row.id), row]));
  if (catalog.size !== requestedItems.length) throw orderError("One or more menu items no longer exist");

  const authoritativeItems = [];
  for (const requested of requestedItems) {
    const row = catalog.get(requested.id);
    if (!row.available) throw orderError(`${row.name} is currently unavailable. Please remove it from your cart.`);
    const minQty = Number(row.min_qty) || 1;
    const stepQty = Number(row.step_qty) || 1;
    const price = Number(row.selling_price);
    if (!followsQuantityRule(requested.qty, minQty, stepQty)) {
      throw orderError(`${row.name} must be ordered from ${minQty} in steps of ${stepQty}`);
    }
    if (!Number.isFinite(price) || price < 0) throw orderError(`${row.name} does not have a valid selling price`);
    authoritativeItems.push({
      id: requested.id,
      name: row.name,
      categoryId: row.category_id,
      qty: requested.qty,
      price,
    });
  }

  return authoritativeItems;
}

function publicOrderRow(row) {
  const result = { ...row };
  delete result.checkout_key_hash;
  delete result.checkout_request_hash;
  return result;
}

async function insertOrder(client, { customer, items, orderMode, notes, keyHash, requestHash }) {
  const id = makeOrderId();
  const invoiceSuffix = crypto.randomBytes(5).toString("hex").toUpperCase();
  const invoiceShareToken = makeInvoiceShareToken();
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const customerResult = await client.query(
    `INSERT INTO customers (name, phone, email, address, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [customer.name, customer.phone, customer.email || null, customer.address || null,
     customer.location?.lat ?? null, customer.location?.lng ?? null]
  );
  const paymentMethod = ["cod", "upi"].includes(customer.paymentMethod) ? customer.paymentMethod : "cod";
  // PostgreSQL now() is stable within this transaction: the invoice date and
  // recorded placement timestamp cannot disagree across an IST midnight.
  const orderResult = await client.query(
    `INSERT INTO orders (id, customer_id, invoice_id, status, order_mode, notes, total,
       payment_status, paymet, delivery_date, delivery_slot, stock_reserved, invoice_share_token,
       checkout_key_hash, checkout_request_hash, created_at)
     VALUES ($1, $2, 'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' || $3,
       'pending', $4, $5, $6, 'unpaid', $7, $8, $9, false, $10, $11, $12, now())
     RETURNING *`,
    [id, customerResult.rows[0].id, invoiceSuffix, orderMode, notes || null, total,
     paymentMethod, customer.deliveryDate || null, customer.deliverySlot || null, invoiceShareToken,
     keyHash || null, requestHash || null]
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, item_name_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, item.id, item.qty, item.price, item.qty * item.price, item.name]
    );
  }
  return { ...publicOrderRow(orderResult.rows[0]), customer, items, replayed: false };
}

async function createOrder({ customer, items, orderMode, notes, offerSlug, idempotencyKey }) {
  const cleanCustomer = normalizeCustomer(customer && { ...customer, notes: customer.notes || notes });
  if (!["Delivery", "Pickup"].includes(orderMode)) throw orderError("Invalid order mode");
  const requestedItems = normalizeRequestedItems(items);
  // The public HTTP endpoint requires this key. Optional only for internal callers.
  if (idempotencyKey != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw orderError("Invalid checkout identifier");
  }
  const keyHash = idempotencyKey
    ? crypto.createHash("sha256").update(idempotencyKey.toLowerCase()).digest("hex") : null;
  const requestHash = keyHash ? crypto.createHash("sha256").update(JSON.stringify({
    // Retain the old hash format so previously saved checkouts remain retryable.
    // This field no longer enables promotional pricing for new orders.
    customer: cleanCustomer, orderMode, offerSlug: offerSlug ?? null,
    items: [...requestedItems].sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex") : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (keyHash) {
      // Serializes matching keys across processes, without locking other checkouts.
      // The unique index remains a final database-level guard.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [keyHash]);
      const existing = (await client.query("SELECT * FROM orders WHERE checkout_key_hash=$1 FOR UPDATE", [keyHash])).rows[0];
      if (existing) {
        if (existing.checkout_request_hash !== requestHash) {
          throw orderError("This checkout identifier was already used for different details. Please start a new checkout.", "IDEMPOTENCY_CONFLICT");
        }
        const savedItems = (await client.query(`SELECT oi.menu_item_id AS id, oi.item_name_snapshot AS name,
          mi.category_id AS "categoryId", oi.quantity AS qty, oi.unit_price AS price
          FROM order_items oi JOIN menu_items mi ON mi.id=oi.menu_item_id
          WHERE oi.order_id=$1 ORDER BY oi.id`, [existing.id])).rows
          .map(item => ({ ...item, qty: Number(item.qty), price: Number(item.price) }));
        await client.query("COMMIT");
        return { ...publicOrderRow(existing), customer: cleanCustomer, items: savedItems, replayed: true };
      }
    }
    // Old open tabs must refresh instead of silently ordering at a different price.
    // Saved orders above can still replay their original prices, without the old table.
    if (offerSlug != null) throw orderError("This promotion is no longer available. Please refresh and order from the regular menu.");
    // A retry of an already-saved order must succeed even after its delivery slot ends.
    validateDeliveryDetails(cleanCustomer, orderMode);
    const authoritativeItems = await priceItems(client, requestedItems);
    validateMainsTiming(authoritativeItems, cleanCustomer, orderMode);
    const order = await insertOrder(client, {
      customer: cleanCustomer,
      items: authoritativeItems,
      orderMode,
      notes: cleanCustomer.notes,
      keyHash, requestHash,
    });
    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


async function priceEditedItems(client, orderId, requestedItems) {
  const normalized = normalizeRequestedItems(requestedItems);
  const originalRows = (await client.query(
    `SELECT oi.menu_item_id AS id, oi.quantity, oi.unit_price, oi.item_name_snapshot
       FROM order_items oi WHERE oi.order_id=$1 ORDER BY oi.id`,
    [orderId]
  )).rows;
  const original = new Map(originalRows.map((row) => [String(row.id), row]));

  const result = await client.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.min_qty, mi.step_qty, mi.retired, mi.is_draft,
            i.selling_price, i.available
       FROM menu_items mi JOIN inventory i ON i.menu_item_id=mi.id
      WHERE mi.id = ANY($1::text[]) FOR SHARE OF mi, i`,
    [normalized.map((item) => item.id)]
  );
  const catalog = new Map(result.rows.map((row) => [String(row.id), row]));
  if (catalog.size !== normalized.length) throw orderError("One or more selected menu items no longer exist");

  const authoritativeItems = [];
  for (const requested of normalized) {
    const row = catalog.get(requested.id);
    const prior = original.get(requested.id);
    const changedQuantity = !prior || Math.abs(Number(prior.quantity) - requested.qty) > 1e-9;
    if (!prior && (row.retired || row.is_draft || row.available === false)) {
      throw orderError(`${row.name} cannot be used as a replacement right now`);
    }
    if (changedQuantity) {
      const minQty = Number(row.min_qty) || 1;
      const stepQty = Number(row.step_qty) || 1;
      if (!followsQuantityRule(requested.qty, minQty, stepQty)) {
        throw orderError(`${row.name} must be ordered from ${minQty} in steps of ${stepQty}`);
      }
    }
    const price = prior ? Number(prior.unit_price) : Number(row.selling_price);
    if (!Number.isFinite(price) || price < 0) throw orderError(`${row.name} does not have a valid selling price`);
    authoritativeItems.push({
      id: requested.id,
      name: prior ? prior.item_name_snapshot : row.name,
      categoryId: row.category_id,
      qty: requested.qty,
      price,
    });
  }
  return authoritativeItems;
}

async function replaceOrderItems(client, orderId, items) {
  await client.query(`DELETE FROM order_items WHERE order_id=$1`, [orderId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal, item_name_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orderId, item.id, item.qty, item.price, item.qty * item.price, item.name]
    );
  }
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  await client.query(`UPDATE orders SET total=$1 WHERE id=$2`, [total, orderId]);
  return total;
}

async function acceptEditedOrder(id, requestedItems) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const previous = (await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!previous) { await client.query("ROLLBACK"); return null; }
    if (previous.status !== "pending") {
      throw orderError(`Order cannot be edited while ${previous.status}`, "INVALID_STATUS_TRANSITION");
    }
    if (previous.stock_reserved) throw orderError("Pending order already has reserved stock");

    const items = await priceEditedItems(client, id, requestedItems);
    validateMainsTiming(items, { deliveryDate: String(previous.delivery_date || "").slice(0, 10) }, previous.order_mode);
    const total = await replaceOrderItems(client, id, items);

    // Edited acceptance is specifically the safe partial-order path: every
    // included fried/frozen quantity must still be on hand at commit time.
    // The normal Accept action keeps its historical behavior for full orders.
    const shortages = await orderStock.pendingShortages(client, [id]);
    if (shortages.length) {
      throw orderError("One or more included items exceed current stock. Reduce the quantity or omit them and try again.", "INSUFFICIENT_STOCK");
    }
    const reserved = await orderStock.deduct(client, id);
    const updated = (await client.query(
      `UPDATE orders o SET status='accepted', stock_reserved=$1, total=$2 WHERE o.id=$3
       RETURNING o.*, (SELECT phone FROM customers WHERE id=o.customer_id) AS customer_phone,
         (SELECT name FROM customers WHERE id=o.customer_id) AS customer_name`,
      [reserved, total, id]
    )).rows[0];
    await client.query("COMMIT");
    return { ...publicOrderRow(updated), previousStatus: previous.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOrders() {
  const rows = (await db.query(`${ORDER_SELECT} WHERE o.archived = false GROUP BY o.id, c.id ORDER BY o.created_at DESC`)).rows;
  const shortages = await orderStock.pendingShortages(db, rows.filter(o => o.status === 'pending').map(o => o.id));
  const byOrder = new Map();
  for (const row of shortages) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  }
  return rows.map(o => ({ ...o, stock_shortages: byOrder.get(o.id) || [] }));
}

async function getArchivedOrders() {
  return (await db.query(`${ORDER_SELECT} WHERE o.archived = true GROUP BY o.id, c.id ORDER BY o.created_at DESC`)).rows;
}

async function archiveOrders(ids) {
  if (!ids?.length) return [];
  return (await db.query(`UPDATE orders SET archived = true WHERE id = ANY($1) RETURNING id`, [ids])).rows;
}

async function restoreOrderStock(client, id) {
  await orderStock.restore(client, id);
}

async function updateOrderStatus(id, status) {
  const transitions = {
    pending: new Set(["accepted", "declined"]),
    accepted: new Set(["completed", "declined"]),
    declined: new Set(["pending"]),
    completed: new Set(),
  };
  if (!Object.hasOwn(transitions, status)) throw orderError("Invalid order status");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [id]);
    const previous = before.rows[0];
    if (!previous) { await client.query("ROLLBACK"); return null; }
    if (status !== previous.status && !transitions[previous.status]?.has(status)) {
      throw orderError(`Order cannot move from ${previous.status} to ${status}`, "INVALID_STATUS_TRANSITION");
    }
    let reserved = previous.stock_reserved;
    if (status !== previous.status) {
      if (status === "accepted" && !reserved) {
        reserved = await orderStock.deduct(client, id);
      } else if (reserved && status === "declined") {
        await restoreOrderStock(client, id);
        reserved = false;
      } else if (reserved && status === "completed") {
        reserved = false;
      }
    }
    const updated = await client.query(
      `UPDATE orders o SET status = $1, stock_reserved = $2 WHERE o.id = $3
       RETURNING o.*, (SELECT phone FROM customers WHERE id=o.customer_id) AS customer_phone,
         (SELECT name FROM customers WHERE id=o.customer_id) AS customer_name`,
      [status, reserved, id]
    );
    if (status === "completed" && previous.status !== "completed") {
      await client.query(
        `INSERT INTO sales_summary (summary_date, orders_count, revenue)
         SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date, 1, total FROM orders WHERE id = $1
         ON CONFLICT (summary_date) DO UPDATE SET
           orders_count = sales_summary.orders_count + 1,
           revenue = sales_summary.revenue + EXCLUDED.revenue`,
        [id]
      );
    }
    await client.query("COMMIT");
    return { ...publicOrderRow(updated.rows[0]), previousStatus: previous.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePaymentStatus(id, paymentStatus) {
  const row = (await db.query(`UPDATE orders SET payment_status=$1 WHERE id=$2 RETURNING *`, [paymentStatus, id])).rows[0];
  return row ? publicOrderRow(row) : row;
}

async function deleteUnreferencedCustomers(client, customerIds) {
  const uniqueIds = [...new Set(customerIds.filter((id) => id != null))];
  if (uniqueIds.length === 0) return;
  await client.query(
    `DELETE FROM customers c
     WHERE c.id = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)`,
    [uniqueIds]
  );
}

async function deleteOrder(id) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT stock_reserved, customer_id FROM orders WHERE id=$1 FOR UPDATE`, [id]);
    if (!found.rows[0]) { await client.query("ROLLBACK"); return false; }
    if (found.rows[0].stock_reserved) await restoreOrderStock(client, id);
    await client.query(`DELETE FROM orders WHERE id=$1`, [id]);
    await deleteUnreferencedCustomers(client, [found.rows[0].customer_id]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deletePaidSyncedOrders() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`DELETE FROM orders
      WHERE status='completed' AND payment_status='paid' AND synced_at IS NOT NULL
      RETURNING id, customer_id`);
    await deleteUnreferencedCustomers(client, result.rows.map((row) => row.customer_id));
    await client.query("COMMIT");
    return result.rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createOrder, getOrders, getArchivedOrders, archiveOrders, updateOrderStatus, acceptEditedOrder,
  updatePaymentStatus, deleteOrder, deletePaidSyncedOrders,
  // Exported for deterministic validation tests; not exposed as HTTP routes.
  validateDeliveryDetails, validateMainsTiming,
};
