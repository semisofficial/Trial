const crypto = require("crypto");
const db = require("../config/db");

const ORDER_SELECT = `
  SELECT o.id, o.invoice_id, o.status, o.order_mode, o.notes, o.total,
    o.created_at, o.payment_status, o.paymet AS payment_method, o.archived,
    o.delivery_date, o.delivery_slot, o.synced_at, o.invoice_share_token,
    c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
    c.latitude, c.longitude,
    COALESCE(json_agg(json_build_object('id', oi.menu_item_id, 'name', mi.name,
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

function makeInvoiceId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${date}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
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
    combined.set(id, Math.round(((combined.get(id) || 0) + qty) * 1000) / 1000);
  }
  return [...combined].map(([id, qty]) => ({ id, qty }));
}

function normalizeCustomer(customer) {
  if (!customer || typeof customer !== "object") throw orderError("Customer details are required");
  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").replace(/[^0-9+]/g, "");
  const address = String(customer.address || "").trim();
  const notes = String(customer.notes || "").trim();
  if (name.length < 2 || name.length > 100) throw orderError("Please enter a valid customer name");
  if (!/^\+?\d{7,15}$/.test(phone)) throw orderError("Please enter a valid phone number");
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
    if (slotStartMinutes < indiaMinutesOfDay(now) + 180) {
      throw orderError("Same-day orders require at least 3 hours of preparation time");
    }
  }
}

function validateMainsTiming(items, customer, _orderMode, today = indiaTodayISO()) {
  if (customer.deliveryDate === today && items.some((item) => item.categoryId === "mains")) {
    throw orderError("Biriyani and Main items must be ordered at least one day in advance");
  }
}

function followsQuantityRule(qty, minQty, stepQty) {
  if (qty + 1e-9 < minQty) return false;
  const steps = (qty - minQty) / stepQty;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}

async function priceAndReserveItems(client, requestedItems) {
  const result = await client.query(
    `SELECT mi.id, mi.name, mi.category_id, mi.min_qty, mi.step_qty,
            i.selling_price, i.stock, i.available
       FROM menu_items mi JOIN inventory i ON i.menu_item_id = mi.id
      WHERE mi.id = ANY($1::text[]) FOR UPDATE OF i`,
    [requestedItems.map((item) => item.id)]
  );
  const catalog = new Map(result.rows.map((row) => [String(row.id), row]));
  if (catalog.size !== requestedItems.length) throw orderError("One or more menu items no longer exist");

  const authoritativeItems = [];
  for (const requested of requestedItems) {
    const row = catalog.get(requested.id);
    const minQty = Number(row.min_qty) || 1;
    const stepQty = Number(row.step_qty) || 1;
    const stock = Number(row.stock);
    const price = Number(row.selling_price);
    if (!row.available) throw orderError(`${row.name} is currently unavailable`, "INSUFFICIENT_STOCK");
    if (!followsQuantityRule(requested.qty, minQty, stepQty)) {
      throw orderError(`${row.name} must be ordered from ${minQty} in steps of ${stepQty}`);
    }
    if (!Number.isFinite(stock) || requested.qty > stock) {
      throw orderError(`Insufficient stock for ${row.name}. Only ${Math.max(0, stock || 0)} available.`, "INSUFFICIENT_STOCK");
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

  for (const item of authoritativeItems) {
    const updated = await client.query(
      `UPDATE inventory SET stock = stock - $1
        WHERE menu_item_id = $2 AND available = true AND stock >= $1
        RETURNING menu_item_id`,
      [item.qty, item.id]
    );
    if (updated.rowCount !== 1) throw orderError(`Insufficient stock for ${item.name}`, "INSUFFICIENT_STOCK");
  }
  return authoritativeItems;
}

async function insertOrder(client, { customer, items, orderMode, notes }) {
  const id = makeOrderId();
  const invoiceId = makeInvoiceId();
  const invoiceShareToken = makeInvoiceShareToken();
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const customerResult = await client.query(
    `INSERT INTO customers (name, phone, email, address, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [customer.name, customer.phone, customer.email || null, customer.address || null,
     customer.location?.lat ?? null, customer.location?.lng ?? null]
  );
  const paymentMethod = ["cod", "upi"].includes(customer.paymentMethod) ? customer.paymentMethod : "cod";
  const orderResult = await client.query(
    `INSERT INTO orders (id, customer_id, invoice_id, status, order_mode, notes, total,
       payment_status, paymet, delivery_date, delivery_slot, stock_reserved, invoice_share_token)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, 'unpaid', $7, $8, $9, true, $10)
     RETURNING *`,
    [id, customerResult.rows[0].id, invoiceId, orderMode, notes || null, total,
     paymentMethod, customer.deliveryDate || null, customer.deliverySlot || null, invoiceShareToken]
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price, subtotal)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, item.id, item.qty, item.price, item.qty * item.price]
    );
  }
  return { ...orderResult.rows[0], customer, items };
}

async function createOrder({ customer, items, orderMode, notes }) {
  const cleanCustomer = normalizeCustomer(customer);
  validateDeliveryDetails(cleanCustomer, orderMode);
  const requestedItems = normalizeRequestedItems(items);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const authoritativeItems = await priceAndReserveItems(client, requestedItems);
    validateMainsTiming(authoritativeItems, cleanCustomer, orderMode);
    const order = await insertOrder(client, {
      customer: cleanCustomer,
      items: authoritativeItems,
      orderMode,
      notes: cleanCustomer.notes || notes,
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

async function getOrders() {
  return (await db.query(`${ORDER_SELECT} WHERE o.archived = false GROUP BY o.id, c.id ORDER BY o.created_at DESC`)).rows;
}

async function getArchivedOrders() {
  return (await db.query(`${ORDER_SELECT} WHERE o.archived = true GROUP BY o.id, c.id ORDER BY o.created_at DESC`)).rows;
}

async function archiveOrders(ids) {
  if (!ids?.length) return [];
  return (await db.query(`UPDATE orders SET archived = true WHERE id = ANY($1) RETURNING id`, [ids])).rows;
}

async function restoreOrderStock(client, id) {
  await client.query(
    `UPDATE inventory i SET stock = i.stock + oi.quantity
       FROM order_items oi WHERE oi.order_id = $1 AND i.menu_item_id = oi.menu_item_id`, [id]
  );
}

async function reserveExistingOrder(client, id) {
  const result = await client.query(
    `SELECT oi.menu_item_id AS id, oi.quantity AS qty, mi.name, i.stock, i.available
       FROM order_items oi JOIN inventory i ON i.menu_item_id = oi.menu_item_id
       JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE oi.order_id = $1 FOR UPDATE OF i`, [id]
  );
  for (const row of result.rows) {
    if (!row.available || Number(row.qty) > Number(row.stock)) {
      throw orderError(`Insufficient stock for ${row.name}. Only ${Math.max(0, Number(row.stock) || 0)} available.`, "INSUFFICIENT_STOCK");
    }
  }
  for (const row of result.rows) {
    await client.query(`UPDATE inventory SET stock = stock - $1 WHERE menu_item_id = $2`, [row.qty, row.id]);
  }
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
      if (reserved && status === "declined") {
        await restoreOrderStock(client, id);
        reserved = false;
      } else if (reserved && status === "completed") {
        reserved = false;
      } else if (!reserved && (status === "pending" || status === "accepted")) {
        await reserveExistingOrder(client, id);
        reserved = true;
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
         SELECT created_at::date, 1, total FROM orders WHERE id = $1
         ON CONFLICT (summary_date) DO UPDATE SET
           orders_count = sales_summary.orders_count + 1,
           revenue = sales_summary.revenue + EXCLUDED.revenue`,
        [id]
      );
    }
    await client.query("COMMIT");
    return { ...updated.rows[0], previousStatus: previous.status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePaymentStatus(id, paymentStatus) {
  return (await db.query(`UPDATE orders SET payment_status=$1 WHERE id=$2 RETURNING *`, [paymentStatus, id])).rows[0];
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
  createOrder, getOrders, getArchivedOrders, archiveOrders, updateOrderStatus,
  updatePaymentStatus, deleteOrder, deletePaidSyncedOrders,
  // Exported for deterministic validation tests; not exposed as HTTP routes.
  validateDeliveryDetails, validateMainsTiming,
};
